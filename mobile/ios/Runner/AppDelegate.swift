import Flutter
import UIKit
import UserNotifications

/// Thông báo đẩy iOS qua Firebase Cloud Messaging (plugin firebase_messaging tự đăng ký APNs và chuyển token).
/// Điều kiện: khoá APNs (.p8) đã tải lên Firebase console → Project settings → Cloud Messaging → Apple app configuration,
/// capability Push Notifications (Runner.entitlements) và Background Modes → Remote notifications (Info.plist).
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // flutter_local_notifications + firebase_messaging cùng nhận sự kiện thông báo khi ứng dụng đang mở
    UNUserNotificationCenter.current().delegate = self
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
