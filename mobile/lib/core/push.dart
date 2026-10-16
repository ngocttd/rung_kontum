import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:unifiedpush/unifiedpush.dart';

import '../app/config.dart';
import 'notify_local.dart';
import 'session.dart';

/// Push theo nền tảng thiết bị – KHÔNG dùng Firebase:
///  - Android: UnifiedPush (chuẩn mở) qua ứng dụng phân phối do người dùng chọn (ntfy, NextPush, Sunup…);
///    máy chủ gửi Web Push mã hoá đầu-cuối (RFC 8291) ký VAPID; thư viện unifiedpush giải mã trên máy.
///  - iOS: APNs – token thiết bị lấy qua kênh native `vn.gov.kontum/apns` (ios/Runner/AppDelegate.swift).
///  - Web: chỉ Socket.IO khi trang đang mở.
/// Khi ứng dụng đang mở, Socket.IO giao trước; máy chủ không gửi push trùng.
enum PushChannel { none, unifiedpush, apns, socketOnly }

class PushState {
  const PushState({this.channel = PushChannel.none, this.registered = false, this.distributor, this.message});
  final PushChannel channel;
  final bool registered;
  final String? distributor;
  final String? message;
  String get label => switch (channel) {
        PushChannel.apns => registered ? 'APNs (Apple) – đã đăng ký' : 'APNs (Apple) – chưa đăng ký',
        PushChannel.unifiedpush => registered ? 'UnifiedPush${distributor != null ? ' qua ${distributor!.split('.').last}' : ''} – đã đăng ký' : 'UnifiedPush – chưa đăng ký',
        PushChannel.socketOnly => 'Chỉ khi ứng dụng mở (Socket.IO)',
        PushChannel.none => 'Chưa bật',
      };
}

const _apns = MethodChannel('vn.gov.kontum/apns');
bool get _isAndroid => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
bool get _isIOS => !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

// ---------- callback UnifiedPush: có thể chạy khi ứng dụng đã đóng (engine nền) → không dùng Riverpod ----------
@pragma('vm:entry-point')
Future<void> _onNewEndpoint(PushEndpoint e, String instance) async {
  final p = await SharedPreferences.getInstance();
  final keys = e.pubKeySet == null ? null : {'p256dh': e.pubKeySet!.pubKey, 'auth': e.pubKeySet!.auth};
  await p.setString('push_provider', 'webpush');
  await p.setString('push_endpoint', e.url);
  if (keys != null) await p.setString('push_keys', jsonEncode(keys));
  await _postDevice(p, {'push_provider': 'webpush', 'push_endpoint': e.url, 'push_keys': keys});
}

@pragma('vm:entry-point')
Future<void> _onMessage(PushMessage m, String instance) async {
  try {
    final n = (jsonDecode(utf8.decode(m.content)) as Map).cast<String, dynamic>();
    await LocalNotifs.show({...n, 'link': n['data']});
  } catch (_) {
    await LocalNotifs.show({'title': 'MobileGIS Kon Tum', 'body': 'Có thông báo mới'});
  }
}

@pragma('vm:entry-point')
Future<void> _onUnregistered(String instance) async {
  final p = await SharedPreferences.getInstance();
  for (final k in ['push_provider', 'push_endpoint', 'push_keys']) {
    await p.remove(k);
  }
  await _postDevice(p, {'push_provider': 'none'});
}

/// Gửi thông tin thiết bị khi không có phiên Riverpod (nền). Không kèm token: máy chủ giữ nguyên liên kết người dùng.
Future<void> _postDevice(SharedPreferences p, Map<String, dynamic> extra) async {
  final base = p.getString('server_url') ?? AppConfig.defaultApiBase;
  final id = p.getString('device_id');
  if (id == null) return;
  try {
    await Dio(BaseOptions(connectTimeout: const Duration(seconds: 10))).post('$base/api/mobile/devices', data: {
      'device_id': id, 'platform': defaultTargetPlatform.name, 'app_version': '1.0.0',
      'subscribed_communes': p.getStringList('subscribed_communes') ?? const [], ...extra,
    });
  } catch (_) {/* gửi lại ở lần mở ứng dụng sau (session._registerDevice) */}
}

class PushService extends Notifier<PushState> {
  @override
  PushState build() {
    final p = ref.read(prefsProvider);
    final provider = p.getString('push_provider');
    return PushState(
      channel: kIsWeb ? PushChannel.socketOnly : _isIOS ? PushChannel.apns : _isAndroid ? PushChannel.unifiedpush : PushChannel.socketOnly,
      registered: provider != null && p.getString('push_endpoint') != null,
    );
  }

  /// Gọi trong main(): đăng ký callback UnifiedPush trước khi có sự kiện (kể cả khi được đánh thức ở nền).
  static Future<void> initCallbacks() async {
    if (!_isAndroid) return;
    try {
      await UnifiedPush.initialize(onNewEndpoint: _onNewEndpoint, onMessage: _onMessage, onUnregistered: _onUnregistered, onRegistrationFailed: (r, i) {});
    } catch (_) {}
  }

  /// Bật nhận thông báo đẩy cho thiết bị (sau khi có cấu hình bootstrap).
  Future<void> enable({bool interactive = false}) async {
    if (kIsWeb) return;
    final vapid = ((ref.read(sessionProvider).bootstrap['push'] as Map?)?['webpush_vapid_public_key']) as String?;
    try {
      if (_isAndroid) {
        await LocalNotifs.requestPermission();
        final ok = await UnifiedPush.tryUseCurrentOrDefaultDistributor();
        if (!ok) {
          state = PushState(channel: PushChannel.unifiedpush, message: 'Chưa có ứng dụng phân phối UnifiedPush (ví dụ ntfy). Khi ứng dụng đang mở vẫn nhận qua Socket.IO.');
          return;
        }
        await UnifiedPush.register(vapid: vapid);
        state = PushState(channel: PushChannel.unifiedpush, registered: true, distributor: await UnifiedPush.getDistributor());
      } else if (_isIOS) {
        final token = await _apns.invokeMethod<String>('requestToken');
        if (token == null) return;
        final p = ref.read(prefsProvider);
        await p.setString('push_provider', 'apns');
        await p.setString('push_endpoint', token);
        await p.setString('push_env', kReleaseMode ? 'production' : 'sandbox');
        await ref.read(apiProvider).post('/api/mobile/devices', {
          'device_id': ref.read(deviceIdProvider), 'platform': 'iOS', 'app_version': '1.0.0', 'push_provider': 'apns', 'push_endpoint': token,
          'push_env': kReleaseMode ? 'production' : 'sandbox', 'subscribed_communes': p.getStringList('subscribed_communes') ?? const [],
        });
        state = const PushState(channel: PushChannel.apns, registered: true);
      }
    } on PlatformException catch (e) {
      state = PushState(channel: state.channel, message: e.code == 'DENIED' ? 'Bạn chưa cho phép thông báo – bật trong Cài đặt của iOS.' : 'Không đăng ký được thông báo: ${e.message}');
    } catch (e) {
      state = PushState(channel: state.channel, message: 'Không đăng ký được thông báo: $e');
    }
  }

  Future<List<String>> distributors() async => _isAndroid ? UnifiedPush.getDistributors() : const [];

  Future<void> useDistributor(String d) async {
    await UnifiedPush.saveDistributor(d);
    await enable(interactive: true);
  }

  /// Tắt push nền tảng (vẫn nhận qua Socket.IO khi mở ứng dụng).
  Future<void> disable() async {
    if (_isAndroid) {
      try {
        await UnifiedPush.unregister();
      } catch (_) {}
    }
    final p = ref.read(prefsProvider);
    for (final k in ['push_provider', 'push_endpoint', 'push_keys', 'push_env']) {
      await p.remove(k);
    }
    try {
      await ref.read(apiProvider).post('/api/mobile/devices', {'device_id': ref.read(deviceIdProvider), 'platform': defaultTargetPlatform.name, 'push_provider': 'none', 'subscribed_communes': p.getStringList('subscribed_communes') ?? const []});
    } catch (_) {}
    state = PushState(channel: state.channel, message: 'Đã tắt thông báo đẩy.');
  }
}

final pushProvider = NotifierProvider<PushService, PushState>(PushService.new);
