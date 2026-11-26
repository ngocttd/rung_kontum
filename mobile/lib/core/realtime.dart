import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;

import 'data.dart';
import 'notify_local.dart';
import 'session.dart';

/// Kết nối Socket.IO tới máy chủ (namespace /mobile) khi ứng dụng đang mở:
///  - "notification": thông báo mới (lưu ở PostgreSQL) → hiện trong ứng dụng/khay hệ thống và xác nhận (ack) để máy chủ
///    không gửi push nền tảng trùng;
///  - "changed": dữ liệu web/mobile thay đổi → làm mới màn hình liên quan ngay (đồng bộ tức thời).
class RealtimeState {
  const RealtimeState({this.connected = false, this.lastNotification, this.hotspotAlert});
  final bool connected;
  final Map<String, dynamic>? lastNotification;

  /// Điểm nóng vệ tinh MỚI xuất hiện trên bản đồ (chưa xác minh): { count, id, lat, lon, commune, at } – khung ứng dụng hiện thông báo trong ứng dụng.
  final Map<String, dynamic>? hotspotAlert;

  RealtimeState copyWith({bool? connected, Map<String, dynamic>? lastNotification, Map<String, dynamic>? hotspotAlert}) =>
      RealtimeState(connected: connected ?? this.connected, lastNotification: lastNotification ?? this.lastNotification, hotspotAlert: hotspotAlert ?? this.hotspotAlert);
}

class Realtime extends Notifier<RealtimeState> {
  sio.Socket? _socket;
  Timer? _poll;
  String? _identity; // user id hoặc 'guest' của kết nối hiện tại
  String? _baseUrl;
  final Set<String> _notifiedHotspotIds = {};

  @override
  RealtimeState build() {
    ref.onDispose(() {
      _poll?.cancel();
      _socket?.dispose();
    });
    return const RealtimeState();
  }

  /// Kết nối (hoặc kết nối lại khi đổi người dùng / máy chủ).
  void connect() {
    final s = ref.read(sessionProvider);
    if (!s.ready) return;
    final api = ref.read(apiProvider);
    if (_baseUrl != null && _baseUrl != api.baseUrl) {
      _knownHotspots = null;
      _notifiedHotspotIds.clear();
    }
    _baseUrl = api.baseUrl;
    _poll ??= Timer.periodic(const Duration(minutes: 2), (_) {
      if (WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) {
        unawaited(_checkHotspots());
      }
    });
    final id = '${api.baseUrl}|${s.user?.id ?? 'guest'}';
    if (_socket != null && _identity == id) {
      if (!_socket!.connected) _socket!.connect();
      return;
    }
    _socket?.dispose();
    _identity = id;
    final rt = (s.bootstrap['realtime'] as Map?) ?? const {'path': '/socket.io', 'namespace': '/mobile'};
    final socket = sio.io(
      '${api.baseUrl}${rt['namespace'] ?? '/mobile'}',
      sio.OptionBuilder()
          .setTransports(['websocket'])
          .setPath(rt['path']?.toString() ?? '/socket.io')
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(2000)
          .setReconnectionDelayMax(30000)
          // token mới nhất ở mỗi lần (kết nối lại) – token truy cập chỉ sống 15 phút
          .setAuthFn((cb) => cb({
                if (api.tokens.accessToken != null) 'token': api.tokens.accessToken,
                'device_id': ref.read(deviceIdProvider),
                'communes': ref.read(prefsProvider).getStringList('subscribed_communes') ?? const <String>[],
              }))
          .build(),
    );
    socket.onConnect((_) {
      state = state.copyWith(connected: true);
      unawaited(_checkHotspots()); // lần đầu: ghi nhận danh sách hiện có; nối lại: phát hiện điểm nóng đến trong lúc mất kết nối
    });
    socket.onDisconnect((_) => state = state.copyWith(connected: false));
    socket.onConnectError((e) async {
      state = state.copyWith(connected: false);
      if ('$e'.contains('TOKEN_EXPIRED') && await api.refreshSession()) socket.connect();
    });
    socket.on('notification', (data) async {
      if (WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) return;
      Map<String, dynamic>? n;
      Function? acknowledge;
      if (data is List && data.isNotEmpty) {
        n = (data.first as Map).cast<String, dynamic>();
        if (data.last is Function) acknowledge = data.last as Function;
      } else if (data is Map) {
        n = data.cast<String, dynamic>();
      }
      if (n == null) return;
      final hid = (n['link'] is Map ? (n['link'] as Map)['id'] : null)?.toString();
      if (hid != null && hid.isNotEmpty) _notifiedHotspotIds.add(hid);
      state = state.copyWith(connected: true, lastNotification: n);
      ref.invalidate(notificationsProvider);
      _refreshFor(n['kind'] as String?);
      if (!kIsWeb) {
        try {
          await LocalNotifs.show(n);
        } catch (e) {
          debugPrint('[notification] $e');
          return; // Máy chủ tiếp tục giao FCM nếu không hiển thị được qua socket.
        }
      }
      acknowledge?.call({'ok': true});
    });
    socket.on('changed', (data) {
      final c = (data is Map ? data['collection'] : data is List && data.isNotEmpty ? (data.first as Map)['collection'] : null)?.toString();
      _refreshCollection(c);
    });
    _socket = socket;
    socket.connect();
  }

  /// Đổi danh sách xã theo dõi mà không phải kết nối lại.
  void subscribe(List<String> communes) => _socket?.emit('subscribe', communes);

  void disconnect() {
    _poll?.cancel();
    _poll = null;
    _socket?.dispose();
    _socket = null;
    _identity = null;
    // Giữ _knownHotspots để khi mở lại ứng dụng vẫn phát hiện được điểm nóng xuất hiện lúc ở nền.
    state = state.copyWith(connected: false);
  }

  void _refreshFor(String? kind) {
    switch (kind) {
      case 'report':
        ref.invalidate(myReportsProvider);
      case 'assignment':
      case 'verification':
        ref.invalidate(assignmentsProvider);
        ref.invalidate(pendingVerificationsProvider);
      case 'fire_danger':
      case 'fire_confirmed':
      case 'fire_report':
        ref.invalidate(homeProvider);
        ref.invalidate(hotspotsProvider);
        ref.invalidate(fireAlertsProvider);
    }
  }

  Set<String>? _knownHotspots; // null = chưa có mốc so sánh (lần tải đầu chỉ ghi nhận, không báo)
  bool _checking = false, _again = false;

  /// Tải lại điểm nóng, so với danh sách đã biết: có điểm mới xuất hiện trên bản đồ → báo ngay trong ứng dụng
  /// và hiển thị thông báo hệ thống nếu máy chủ chưa gửi riêng qua Socket.IO.
  Future<void> _checkHotspots() async {
    if (_checking) {
      _again = true;
      return;
    }
    _checking = true;
    try {
      do {
        _again = false;
        final baseline = _knownHotspots == null;
        if (!baseline) ref.invalidate(hotspotsProvider);
        final g = (await ref.read(hotspotsProvider.future)).data;
        final known = _knownHotspots ?? <String>{};
        final fresh = <Map<String, dynamic>>[];
        final now = DateTime.now().toUtc();
        for (final f in ((g['features'] as List?) ?? const []).cast<Map>()) {
          final p = (f['properties'] as Map).cast<String, dynamic>();
          final id = p['id']?.toString();
          if (id == null) continue;
          final isNew = known.add(id);
          final status = (p['status'] ?? 'new').toString();
          final t = DateTime.tryParse(p['utc']?.toString() ?? '');
          if (baseline || !isNew || ['rejected', 'closed'].contains(status)) continue;
          if (status == 'new' && t != null && now.difference(t) > const Duration(days: 7)) continue;
          final c = (f['geometry'] as Map)['coordinates'] as List;
          fresh.add({...p, 'lon': (c[0] as num).toDouble(), 'lat': (c[1] as num).toDouble()});
        }
        _knownHotspots = known;
        if (fresh.isEmpty) continue;
        final first = fresh.first;
        final firstId = first['id'].toString();
        final confirmed = first['status'] == 'confirmed' || first['status'] == 'handling';
        state = state.copyWith(hotspotAlert: {
          'count': fresh.length,
          'id': firstId,
          'lat': first['lat'],
          'lon': first['lon'],
          'commune': first['commune'],
          'confirmed': confirmed,
          'at': DateTime.now().toIso8601String(),
        });
        if (!kIsWeb) {
          Future<void>.delayed(const Duration(milliseconds: 1800), () async {
            if (!ref.mounted || _notifiedHotspotIds.contains(firstId)) return;
            _notifiedHotspotIds.add(firstId);
            final place = first['commune'] != null ? ' tại ${first['commune']}' : '';
            final title = fresh.length > 1
                ? 'Phát hiện ${fresh.length} điểm nóng mới trên bản đồ'
                : (confirmed ? 'Cảnh báo cháy rừng$place (đã xác nhận)' : 'Điểm nóng mới$place (chưa xác minh)');
            final body = confirmed
                ? 'Điểm cháy đã xác minh vừa cập nhật trên bản đồ. Chạm để xem chi tiết vị trí.'
                : 'Điểm dị thường nhiệt vừa xuất hiện trên bản đồ Kon Tum. Chạm để kiểm tra vị trí và trạng thái xác minh.';
            try {
              await LocalNotifs.show({
                'id': 'hs-map:$firstId',
                'notification_id': '',
                'kind': confirmed ? 'fire_confirmed' : 'fire_report',
                'priority': 'high',
                'title': title,
                'body': body,
                'link': {'screen': 'hotspot', 'id': firstId, 'lat': first['lat'], 'lon': first['lon'], 'commune': first['commune']},
              });
            } catch (_) {}
          });
        }
      } while (_again);
    } catch (_) {
      // ngoại tuyến hoặc lỗi tạm thời: giữ mốc cũ, lần sau so sánh lại
    } finally {
      _checking = false;
    }
  }

  void _refreshCollection(String? c) {
    switch (c) {
      case 'reports':
        ref.invalidate(myReportsProvider);
        ref.invalidate(publicReportsProvider);
      case 'alerts':
        ref.invalidate(fireAlertsProvider);
        ref.invalidate(candidatesProvider);
        ref.invalidate(homeProvider);
        unawaited(_checkHotspots()); // tải lại điểm nóng và báo nếu có điểm mới
      case 'assignments':
        ref.invalidate(assignmentsProvider);
      case 'verifications':
        ref.invalidate(pendingVerificationsProvider);
        ref.invalidate(assignmentsProvider);
      case 'surveys':
        ref.invalidate(mySurveysProvider);
        ref.invalidate(pendingSurveysProvider);
        ref.invalidate(assignmentsProvider);
      case 'news':
        ref.invalidate(newsProvider);
        ref.invalidate(homeProvider);
      case 'documents':
        ref.invalidate(documentsProvider);
      case 'layers':
        ref.invalidate(layersProvider);
    }
  }
}

final realtimeProvider = NotifierProvider<Realtime, RealtimeState>(Realtime.new);
