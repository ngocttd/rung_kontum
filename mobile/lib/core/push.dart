import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../app/firebase_config.dart';
import 'notification_payload.dart';
import 'notify_local.dart';
import 'session.dart';

enum PushChannel { none, fcm, socketOnly }

class PushState {
  const PushState({this.channel = PushChannel.none, this.registered = false, this.message});
  final PushChannel channel;
  final bool registered;
  final String? message;
  String get label => switch (channel) {
        PushChannel.fcm => registered ? 'Firebase Cloud Messaging – đã đăng ký' : 'Firebase Cloud Messaging – chưa đăng ký',
        PushChannel.socketOnly => 'Chỉ khi ứng dụng mở',
        PushChannel.none => 'Chưa bật',
      };
}

bool _firebaseReady = false;

// Backend gửi notification + data; iOS/Android tự hiển thị khi ứng dụng ở nền.
@pragma('vm:entry-point')
Future<void> _onBackgroundMessage(RemoteMessage message) async {}

class PushService extends Notifier<PushState> {
  int _operation = 0;
  bool _enabling = false;

  @override
  PushState build() {
    if (kIsWeb || !FirebaseConfig.available) {
      return PushState(channel: PushChannel.socketOnly, message: kIsWeb ? null : 'Chưa cấu hình thông báo đẩy cho bản cài đặt này.');
    }
    if (_firebaseReady) {
      // Đăng ký listener ngay cả khi API thiết bị đang lỗi hoặc mất mạng.
      final foreground = FirebaseMessaging.onMessage.listen((m) {
        unawaited(LocalNotifs.show({
          ...m.data,
          'title': m.notification?.title,
          'body': m.notification?.body,
        }).catchError((Object e) => debugPrint('[push] Không hiển thị được thông báo: $e')));
      });
      // ignore: deprecated_member_use
      final refresh = FirebaseMessaging.instance.onTokenRefresh.listen((token) {
        if (ref.read(prefsProvider).getBool('push_enabled') == true) {
          unawaited(_registerToken(token).catchError((Object e) {
            if (ref.mounted) state = const PushState(channel: PushChannel.fcm, message: 'Chưa cập nhật được thông báo. Vui lòng thử đăng ký lại.');
          }));
        }
      }, onError: (Object e) => debugPrint('[push] Không làm mới được token: $e'));
      ref.onDispose(() {
        _operation++;
        unawaited(foreground.cancel());
        unawaited(refresh.cancel());
      });
    }
    // Chỉ báo đã đăng ký sau khi xác minh quyền và API thành công trong enable().
    return const PushState(channel: PushChannel.fcm);
  }

  static Future<void> init() async {
    if (_firebaseReady) return;
    final opts = FirebaseConfig.options;
    if (opts == null) return;
    try {
      await Firebase.initializeApp(options: opts);
      FirebaseMessaging.onBackgroundMessage(_onBackgroundMessage);
      await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(alert: false, badge: false, sound: false);
      FirebaseMessaging.onMessageOpenedApp.listen((m) => LocalNotifs.tapped.value = notificationPayload(m.data));
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) LocalNotifs.tapped.value = notificationPayload(initial.data);
      _firebaseReady = true;
    } catch (e) {
      debugPrint('[push] Không khởi tạo được Firebase: $e');
    }
  }

  Future<void> _registerToken(String token) async {
    final operation = _operation;
    final p = ref.read(prefsProvider);
    if (p.getBool('push_enabled') == false) return;
    await p.setString('push_provider', 'fcm');
    await p.setString('push_endpoint', token);
    final version = await PackageInfo.fromPlatform();
    if (!ref.mounted || operation != _operation) return;
    await ref.read(apiProvider).post('/api/mobile/devices', {
      'device_id': ref.read(deviceIdProvider),
      'platform': defaultTargetPlatform.name,
      'app_version': '${version.version}+${version.buildNumber}',
      'push_provider': 'fcm',
      'push_endpoint': token,
      'subscribed_communes': p.getStringList('subscribed_communes') ?? const [],
    });
    // Nếu người dùng tắt trong lúc HTTP đang gửi, gửi lại trạng thái tắt sau đó.
    if (ref.mounted && operation != _operation && p.getBool('push_enabled') == false) {
      await ref.read(sessionProvider.notifier).registerDevice();
    }
  }

  Future<void> enable({bool interactive = false}) async {
    if (kIsWeb || !FirebaseConfig.available || _enabling) return;
    final p = ref.read(prefsProvider);
    if (!interactive && p.getBool('push_enabled') == false) return;
    if (!_firebaseReady) {
      state = const PushState(channel: PushChannel.fcm, message: 'Chưa khởi tạo được thông báo đẩy.');
      return;
    }
    _enabling = true;
    final operation = ++_operation;
    bool current() => ref.mounted && operation == _operation;
    try {
      final fm = FirebaseMessaging.instance;
      final perm = interactive
          ? await fm.requestPermission(alert: true, badge: true, sound: true)
          : await fm.getNotificationSettings();
      if (!current()) return;
      if (perm.authorizationStatus != AuthorizationStatus.authorized && perm.authorizationStatus != AuthorizationStatus.provisional) {
        state = const PushState(channel: PushChannel.fcm, message: 'Chọn Bật / đăng ký lại để cho phép thông báo. Nếu đã từ chối, hãy bật trong Cài đặt điện thoại.');
        return;
      }
      if (interactive) await p.setBool('push_enabled', true);
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        String? apns;
        for (var i = 0; i < 10 && current(); i++) {
          apns = await fm.getAPNSToken();
          if (apns != null) break;
          await Future<void>.delayed(const Duration(milliseconds: 500));
        }
        if (!current()) return;
        if (apns == null) {
          state = const PushState(channel: PushChannel.fcm, message: 'Chưa nhận được mã thông báo từ Apple. Vui lòng thử lại khi có mạng.');
          return; // Không gọi getToken khi chưa có APNs token.
        }
      }
      // Backend dùng FCM HTTP v1 message.token; chuyển sang FID phải đổi cả backend.
      // ignore: deprecated_member_use
      final token = await fm.getToken();
      if (!current()) return;
      if (token == null) {
        state = const PushState(channel: PushChannel.fcm, message: 'Chưa nhận được mã thông báo. Vui lòng thử lại khi có mạng.');
        return;
      }
      await p.setBool('push_enabled', true);
      await _registerToken(token);
      if (current()) state = const PushState(channel: PushChannel.fcm, registered: true);
    } catch (e) {
      debugPrint('[push] Đăng ký thất bại: $e');
      if (current()) state = const PushState(channel: PushChannel.fcm, message: 'Chưa đăng ký được thông báo. Vui lòng kiểm tra mạng và thử lại.');
    } finally {
      _enabling = false;
    }
  }

  Future<void> disable() async {
    ++_operation;
    final p = ref.read(prefsProvider);
    await p.setBool('push_enabled', false);
    // Lưu 'none' để các lần đăng ký thiết bị sau cũng gửi lại yêu cầu tắt.
    await p.setString('push_provider', 'none');
    await p.remove('push_endpoint');
    if (_firebaseReady) {
      try {
        // ignore: deprecated_member_use
        await FirebaseMessaging.instance.deleteToken();
      } catch (e) {
        debugPrint('[push] Chưa xóa được token: $e');
      }
    }
    try {
      await ref.read(sessionProvider.notifier).registerDevice();
    } catch (_) {}
    if (ref.mounted) state = const PushState(channel: PushChannel.fcm, message: 'Đã tắt thông báo đẩy.');
  }
}

final pushProvider = NotifierProvider<PushService, PushState>(PushService.new);
