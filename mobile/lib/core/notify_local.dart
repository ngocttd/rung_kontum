import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Hiển thị thông báo trên thiết bị (khay hệ thống) cho bản tin nhận khi ứng dụng đang mở (Socket.IO, hoặc FCM khi socket chưa nối).
/// Ứng dụng ở nền/đã đóng: hệ điều hành tự hiển thị bản tin FCM trên kênh Android cùng mã (canh_bao / chung).
class LocalNotifs {
  LocalNotifs._();
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;

  /// Bản tin được chạm (payload JSON) – router mở màn hình tương ứng.
  static final ValueNotifier<Map<String, dynamic>?> tapped = ValueNotifier(null);

  static const _alerts = AndroidNotificationChannel('canh_bao', 'Cảnh báo cháy rừng', description: 'Cảnh báo đã phê duyệt và sự kiện cháy đã xác minh', importance: Importance.high);
  static const _general = AndroidNotificationChannel('chung', 'Nhiệm vụ và hồ sơ', description: 'Nhiệm vụ hiện trường, tiến độ phản ánh, kết quả duyệt', importance: Importance.defaultImportance);

  static Future<void> init() async {
    if (_ready || kIsWeb) return;
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(requestAlertPermission: false, requestBadgePermission: false, requestSoundPermission: false),
      ),
      onDidReceiveNotificationResponse: (r) {
        if (r.payload == null) return;
        try {
          tapped.value = (jsonDecode(r.payload!) as Map).cast<String, dynamic>();
        } catch (_) {}
      },
    );
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await android?.createNotificationChannel(_alerts);
    await android?.createNotificationChannel(_general);
    _ready = true;
  }

  /// Android 13+: xin quyền hiển thị thông báo.
  static Future<bool> requestPermission() async {
    if (kIsWeb) return false;
    await init();
    final android = _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) return await android.requestNotificationsPermission() ?? false;
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    return await ios?.requestPermissions(alert: true, sound: true, badge: true) ?? false;
  }

  /// n = { id, kind, title, body, link|data, priority }
  static Future<void> show(Map<String, dynamic> n) async {
    if (kIsWeb) return;
    await init();
    final urgent = n['kind'] == 'fire_danger' || n['kind'] == 'fire_confirmed' || n['priority'] == 'high';
    final ch = urgent ? _alerts : _general;
    final body = n['body']?.toString() ?? '';
    await _plugin.show(
      id: (n['id']?.toString() ?? DateTime.now().toIso8601String()).hashCode & 0x7fffffff,
      title: n['title']?.toString() ?? 'MobileGIS Kon Tum',
      body: body,
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(ch.id, ch.name, channelDescription: ch.description, importance: ch.importance, priority: urgent ? Priority.high : Priority.defaultPriority, styleInformation: BigTextStyleInformation(body)),
        iOS: const DarwinNotificationDetails(presentAlert: true, presentSound: true),
      ),
      payload: jsonEncode({'id': n['id'], 'kind': n['kind'], ...((n['link'] ?? n['data']) as Map? ?? {}).cast<String, dynamic>()}),
    );
  }
}
