import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../app/config.dart';
import '../app/firebase_config.dart';
import 'notify_local.dart';
import 'realtime.dart';
import 'session.dart';

/// Thông báo đẩy qua Firebase Cloud Messaging (Android và iOS):
///  - ứng dụng ở nền/đã đóng: hệ điều hành hiển thị bản tin FCM (máy chủ gửi kèm phần notification);
///  - ứng dụng đang mở: Socket.IO giao trước và máy chủ huỷ bản FCM đang chờ (không báo trùng); nếu socket
///    chưa kết nối mà FCM tới, ứng dụng tự hiện thông báo cục bộ;
///  - chạm vào thông báo → mở đúng màn hình (LocalNotifs.tapped);
///  - token FCM gửi lên máy chủ (POST /api/mobile/devices, push_provider = fcm) và cập nhật khi Firebase làm mới.
/// Cấu hình Firebase: lib/app/firebase_config.dart (dart-define). Bản web: chỉ Socket.IO.
enum PushChannel { none, fcm, socketOnly }

class PushState {
  const PushState({this.channel = PushChannel.none, this.registered = false, this.message});
  final PushChannel channel;
  final bool registered;
  final String? message;
  String get label => switch (channel) {
        PushChannel.fcm => registered ? 'Firebase Cloud Messaging – đã đăng ký' : 'Firebase Cloud Messaging – chưa đăng ký',
        PushChannel.socketOnly => 'Chỉ khi ứng dụng mở (Socket.IO)',
        PushChannel.none => 'Chưa bật',
      };
}

bool _firebaseReady = false;

/// Bản tin FCM khi ứng dụng ở nền: hệ điều hành đã hiển thị phần notification → không cần làm gì thêm.
@pragma('vm:entry-point')
Future<void> _onBackgroundMessage(RemoteMessage m) async {}

Map<String, dynamic> _payloadOf(RemoteMessage m) {
  final d = Map<String, dynamic>.from(m.data);
  Map<String, dynamic> link = const {};
  try {
    if (d['link'] is String) link = (jsonDecode(d['link'] as String) as Map).cast<String, dynamic>();
  } catch (_) {}
  return {'id': d['id'], 'kind': d['kind'], 'priority': d['priority'], ...link};
}

/// Gửi token khi không có phiên Riverpod (Firebase làm mới token lúc khởi động). Không kèm access token:
/// máy chủ giữ nguyên liên kết người dùng của thiết bị.
Future<void> _postToken(String token) async {
  final p = await SharedPreferences.getInstance();
  await p.setString('push_provider', 'fcm');
  await p.setString('push_endpoint', token);
  final id = p.getString('device_id');
  if (id == null) return;
  try {
    await Dio(BaseOptions(connectTimeout: const Duration(seconds: 10))).post('${p.getString('server_url') ?? AppConfig.defaultApiBase}/api/mobile/devices', data: {
      'device_id': id, 'platform': defaultTargetPlatform.name, 'app_version': '1.0.0', 'push_provider': 'fcm', 'push_endpoint': token,
      'subscribed_communes': p.getStringList('subscribed_communes') ?? const [],
    });
  } catch (_) {/* gửi lại ở lần mở ứng dụng sau (PushService.enable) */}
}

class PushService extends Notifier<PushState> {
  @override
  PushState build() {
    final p = ref.read(prefsProvider);
    if (kIsWeb || !FirebaseConfig.available) {
      return PushState(channel: PushChannel.socketOnly, message: kIsWeb ? null : 'Bản build chưa có cấu hình Firebase – chỉ nhận thông báo khi ứng dụng mở.');
    }
    return PushState(channel: PushChannel.fcm, registered: p.getString('push_provider') == 'fcm' && p.getString('push_endpoint') != null);
  }

  /// Gọi trong main(): khởi tạo Firebase và các callback trước khi có bản tin.
  static Future<void> init() async {
    final opts = FirebaseConfig.options;
    if (opts == null) return;
    try {
      await Firebase.initializeApp(options: opts);
      FirebaseMessaging.onBackgroundMessage(_onBackgroundMessage);
      // iOS: ứng dụng đang mở thì để ứng dụng tự quyết hiển thị (tránh trùng với Socket.IO)
      await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(alert: false, badge: true, sound: false);
      // Dùng FCM registration token (đích `message.token` của HTTP v1 mà máy chủ đang gửi). firebase_messaging 17
      // đánh dấu deprecated để chuyển sang register()/onRegistered (Installation ID) – đổi cả hai phía khi nâng cấp.
      // ignore: deprecated_member_use
      FirebaseMessaging.instance.onTokenRefresh.listen(_postToken);
      // chạm thông báo khi ứng dụng ở nền / đã đóng
      FirebaseMessaging.onMessageOpenedApp.listen((m) => LocalNotifs.tapped.value = _payloadOf(m));
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) LocalNotifs.tapped.value = _payloadOf(initial);
      _firebaseReady = true;
    } catch (e) {
      debugPrint('[push] Không khởi tạo được Firebase: $e');
    }
  }

  StreamSubscription<RemoteMessage>? _fg;

  /// Bật nhận thông báo đẩy cho thiết bị (xin quyền, lấy token FCM, gửi lên máy chủ).
  Future<void> enable({bool interactive = false}) async {
    if (kIsWeb || !FirebaseConfig.available) return;
    if (!_firebaseReady) {
      state = const PushState(channel: PushChannel.fcm, message: 'Firebase chưa khởi tạo được – kiểm tra cấu hình bản build.');
      return;
    }
    try {
      final fm = FirebaseMessaging.instance;
      final perm = await fm.requestPermission(alert: true, badge: true, sound: true);
      if (perm.authorizationStatus == AuthorizationStatus.denied) {
        state = const PushState(channel: PushChannel.fcm, message: 'Bạn chưa cho phép thông báo – bật trong Cài đặt của điện thoại.');
        return;
      }
      await LocalNotifs.init();
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        // iOS cần APNs token trước khi có FCM token (Firebase chuyển tiếp qua APNs)
        for (var i = 0; i < 10 && await fm.getAPNSToken() == null; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 500));
        }
      }
      // ignore: deprecated_member_use
      final token = await fm.getToken();
      if (token == null) {
        state = const PushState(channel: PushChannel.fcm, message: 'Chưa nhận được token FCM – thử lại khi có mạng.');
        return;
      }
      final p = ref.read(prefsProvider);
      await p.setString('push_provider', 'fcm');
      await p.setString('push_endpoint', token);
      await ref.read(apiProvider).post('/api/mobile/devices', {
        'device_id': ref.read(deviceIdProvider), 'platform': defaultTargetPlatform.name, 'app_version': '1.0.0', 'push_provider': 'fcm', 'push_endpoint': token,
        'subscribed_communes': p.getStringList('subscribed_communes') ?? const [],
      });
      // ứng dụng đang mở: Socket.IO giao trước; nếu socket chưa kết nối thì tự hiện bản tin FCM
      _fg ??= FirebaseMessaging.onMessage.listen((m) {
        if (ref.read(realtimeProvider).connected) return;
        LocalNotifs.show({'id': m.data['id'], 'kind': m.data['kind'], 'priority': m.data['priority'], 'title': m.notification?.title, 'body': m.notification?.body, 'link': _payloadOf(m)});
      });
      state = const PushState(channel: PushChannel.fcm, registered: true);
    } catch (e) {
      state = PushState(channel: PushChannel.fcm, message: 'Không đăng ký được thông báo: $e');
    }
  }

  /// Tắt push (vẫn nhận qua Socket.IO khi mở ứng dụng).
  Future<void> disable() async {
    if (_firebaseReady) {
      try {
        // ignore: deprecated_member_use
        await FirebaseMessaging.instance.deleteToken();
      } catch (_) {}
    }
    final p = ref.read(prefsProvider);
    for (final k in ['push_provider', 'push_endpoint']) {
      await p.remove(k);
    }
    try {
      await ref.read(apiProvider).post('/api/mobile/devices', {'device_id': ref.read(deviceIdProvider), 'platform': defaultTargetPlatform.name, 'push_provider': 'none', 'subscribed_communes': p.getStringList('subscribed_communes') ?? const []});
    } catch (_) {}
    state = PushState(channel: state.channel, message: 'Đã tắt thông báo đẩy.');
  }
}

final pushProvider = NotifierProvider<PushService, PushState>(PushService.new);
