import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../app/config.dart';
import 'api.dart';

/// Người dùng đăng nhập (vai trò và quyền do máy chủ cấp; ứng dụng chỉ dùng để ẩn/hiện chức năng,
/// máy chủ luôn kiểm tra lại quyền).
class AppUser {
  AppUser(this.raw);
  final Map<String, dynamic> raw;
  String get id => raw['id'] as String;
  String get username => raw['username'] as String;
  String get name => (raw['name'] as String?)?.isNotEmpty == true ? raw['name'] as String : username;
  String get role => raw['role'] as String;
  String? get scope => raw['scope'] as String?;
  List<String> get permissions => (raw['permissions'] as List? ?? const []).cast<String>();
  bool can(String p) => permissions.contains(p);
  bool get isStaff => role == 'specialist' || role == 'leader' || role == 'admin';
  bool get isFieldOfficer => role == 'specialist';
  String get roleLabel => const {
        'citizen': 'Người dân',
        'specialist': 'Cán bộ Sở NN&MT / Kiểm lâm',
        'leader': 'Lãnh đạo / UBND',
        'admin': 'Quản trị hệ thống',
      }[role] ??
      role;
}

class SessionState {
  const SessionState({this.ready = false, this.user, this.guest = false, this.bootstrap = const {}, this.error});
  final bool ready;
  final AppUser? user;
  final bool guest;
  final Map<String, dynamic> bootstrap;
  final String? error;

  bool get signedIn => user != null;
  bool get entered => signedIn || guest; // đã qua màn hình đăng nhập
  Map<String, dynamic> get catalogs => (bootstrap['catalogs'] as Map?)?.cast<String, dynamic>() ?? const {};
  List<Map<String, dynamic>> get communes => ((bootstrap['communes'] as List?) ?? const []).cast<Map>().map((e) => e.cast<String, dynamic>()).toList();
  Map<String, dynamic> get map => (bootstrap['map'] as Map?)?.cast<String, dynamic>() ?? const {};
  bool get demoLogin => AppConfig.demoLoginAllowed && ((bootstrap['features'] as Map?)?['demo_login'] == true);
  List<Map<String, dynamic>> get demoRoles => ((bootstrap['demo_roles'] as List?) ?? const []).cast<Map>().map((e) => e.cast<String, dynamic>()).toList();

  String communeName(String? code) {
    if (code == null) return '—';
    for (final c in communes) {
      if (c['code'] == code) return c['name'] as String;
    }
    return code;
  }

  SessionState copyWith({bool? ready, AppUser? user, bool clearUser = false, bool? guest, Map<String, dynamic>? bootstrap, String? error}) => SessionState(
        ready: ready ?? this.ready,
        user: clearUser ? null : (user ?? this.user),
        guest: guest ?? this.guest,
        bootstrap: bootstrap ?? this.bootstrap,
        error: error,
      );
}

/// SharedPreferences được khởi tạo trong main() rồi override provider này.
final prefsProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('prefsProvider chưa được override'));

class ServerUrl extends Notifier<String> {
  @override
  String build() => ref.read(prefsProvider).getString('server_url') ?? AppConfig.defaultApiBase;
  Future<void> set(String url) async {
    final v = AppConfig.normalize(url);
    await ref.read(prefsProvider).setString('server_url', v);
    state = v;
  }
}

final serverUrlProvider = NotifierProvider<ServerUrl, String>(ServerUrl.new);
final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiProvider = Provider<ApiClient>((ref) {
  final api = ApiClient(baseUrl: ref.watch(serverUrlProvider), tokens: ref.read(tokenStoreProvider));
  api.onSessionExpired = () => ref.read(sessionProvider.notifier).expired();
  return api;
});

/// Mã thiết bị ngẫu nhiên sinh khi cài (không dùng định danh phần cứng – đặc tả mục 7).
final deviceIdProvider = Provider<String>((ref) {
  final p = ref.read(prefsProvider);
  var id = p.getString('device_id');
  if (id == null) {
    id = const Uuid().v4();
    p.setString('device_id', id);
  }
  return id;
});

class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionState();

  ApiClient get _api => ref.read(apiProvider);
  SharedPreferences get _prefs => ref.read(prefsProvider);

  /// M01: kiểm tra mạng/phiên bản, khôi phục phiên đăng nhập bằng refresh token.
  Future<void> start() async {
    var signed = false;
    if (await _api.tokens.readRefresh() != null) signed = await _api.refreshSession();
    final guest = _prefs.getBool('guest') ?? false;
    try {
      final boot = await _api.get<Map<String, dynamic>>('/api/mobile/bootstrap');
      await _prefs.setString('bootstrap_cache', _encode(boot));
      final u = boot['user'];
      state = SessionState(ready: true, user: signed && u is Map ? AppUser(u.cast<String, dynamic>()) : null, guest: guest && !signed, bootstrap: boot);
      _registerDevice();
    } on ApiException catch (e) {
      // ngoại tuyến: dùng cấu hình đã lưu để vẫn vào được dữ liệu cũ
      final cached = _decode(_prefs.getString('bootstrap_cache'));
      final cachedUser = _decode(_prefs.getString('user_cache'));
      state = SessionState(
        ready: true,
        bootstrap: cached ?? const {},
        user: cachedUser != null && (signed || await _api.tokens.readRefresh() != null) ? AppUser(cachedUser) : null,
        guest: guest,
        error: e.message,
      );
    }
  }

  Future<void> reloadBootstrap() async {
    final boot = await _api.get<Map<String, dynamic>>('/api/mobile/bootstrap');
    final u = boot['user'];
    state = state.copyWith(bootstrap: boot, user: u is Map ? AppUser(u.cast<String, dynamic>()) : null, clearUser: u is! Map && state.user != null && _api.tokens.accessToken == null);
  }

  Future<void> _accept(Map<String, dynamic> r) async {
    await _api.tokens.save(r['access_token'] as String, r['refresh_token'] as String);
    final user = AppUser((r['user'] as Map).cast<String, dynamic>());
    await _prefs.setBool('guest', false);
    await _prefs.setString('user_cache', _encode(user.raw));
    state = state.copyWith(user: user, guest: false, ready: true);
    try {
      await reloadBootstrap();
    } catch (_) {}
    _registerDevice();
  }

  Future<void> login(String username, String password) async {
    final r = await _api.post<Map<String, dynamic>>('/api/mobile/auth/login', {'username': username, 'password': password, 'device_id': ref.read(deviceIdProvider)});
    await _accept(r);
  }

  Future<void> register({required String name, String? phone, String? email, required String password}) async {
    final r = await _api.post<Map<String, dynamic>>('/api/mobile/auth/register', {'name': name, 'phone': phone, 'email': email, 'password': password});
    await _accept(r);
  }

  /// Đăng nhập nhanh theo vai trò (tài khoản demo do máy chủ cấp khi bật MOBILE_DEMO_LOGIN).
  Future<void> demoLogin(String roleKey) async {
    if (state.signedIn) await logout(silent: true);
    final r = await _api.post<Map<String, dynamic>>('/api/mobile/auth/demo', {'role': roleKey, 'device_id': ref.read(deviceIdProvider)});
    await _accept(r);
  }

  Future<void> continueAsGuest() async {
    if (state.signedIn) await logout(silent: true);
    await _prefs.setBool('guest', true);
    state = state.copyWith(guest: true, clearUser: true, ready: true);
  }

  /// TC12: thu hồi token trên máy chủ, xoá token và dữ liệu nghiệp vụ nhạy cảm đã lưu trên máy.
  Future<void> logout({bool silent = false, bool allDevices = false}) async {
    final rt = await _api.tokens.readRefresh();
    try {
      if (_api.tokens.accessToken != null) await _api.post('/api/mobile/auth/logout', {'refresh_token': rt, 'all': allDevices, 'device_id': ref.read(deviceIdProvider)});
    } catch (_) {}
    await _api.tokens.clear();
    for (final k in _prefs.getKeys().where((k) => k.startsWith('cache:') || k == 'user_cache')) {
      await _prefs.remove(k);
    }
    await _prefs.setBool('guest', false);
    state = SessionState(ready: true, bootstrap: state.bootstrap);
  }

  void expired() {
    if (state.user == null) return;
    state = SessionState(ready: true, bootstrap: state.bootstrap, error: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');
  }

  Future<void> registerDevice() => _registerDevice();

  Future<void> _registerDevice() async {
    try {
      final communes = _prefs.getStringList('subscribed_communes') ?? const [];
      final p = _prefs;
      final keys = p.getString('push_keys');
      await _api.post('/api/mobile/devices', {
        'device_id': ref.read(deviceIdProvider), 'platform': _platform(), 'app_version': '1.0.0', 'subscribed_communes': communes,
        if (p.getString('push_provider') != null) 'push_provider': p.getString('push_provider'),
        if (p.getString('push_endpoint') != null) 'push_endpoint': p.getString('push_endpoint'),
        if (keys != null) 'push_keys': jsonDecode(keys),
        if (p.getString('push_env') != null) 'push_env': p.getString('push_env'),
      });
    } catch (_) {}
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);

String _platform() => kIsWeb ? 'web' : defaultTargetPlatform.name;

String _encode(Map<String, dynamic> m) => jsonEncode(m);
Map<String, dynamic>? _decode(String? s) {
  if (s == null) return null;
  try {
    return (jsonDecode(s) as Map).cast<String, dynamic>();
  } catch (_) {
    return null;
  }
}
