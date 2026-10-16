import Flutter
import UIKit
import UserNotifications

/// Thông báo đẩy iOS qua APNs trực tiếp (không Firebase):
///  - kênh `vn.gov.kontum/apns`, hàm `requestToken`: xin quyền thông báo, đăng ký APNs, trả về device token (hex)
///    để ứng dụng gửi lên máy chủ (POST /api/mobile/devices, push_provider = apns);
///  - máy chủ gửi bằng khoá .p8 qua HTTP/2 (src/services/push/apns.js).
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var pendingTokenResult: FlutterResult?
  private var apnsToken: String?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "KontumApnsToken") else { return }
    let channel = FlutterMethodChannel(name: "vn.gov.kontum/apns", binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { return }
      guard call.method == "requestToken" else { result(FlutterMethodNotImplemented); return }
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
        DispatchQueue.main.async {
          if let error = error {
            result(FlutterError(code: "APNS_ERROR", message: error.localizedDescription, details: nil)); return
          }
          if !granted {
            result(FlutterError(code: "DENIED", message: "Người dùng chưa cho phép thông báo", details: nil)); return
          }
          if let token = self.apnsToken { result(token); return }
          self.pendingTokenResult = result
          UIApplication.shared.registerForRemoteNotifications()
        }
      }
    }
  }

  override func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02x", $0) }.joined()
    apnsToken = token
    pendingTokenResult?(token)
    pendingTokenResult = nil
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
  }

  override func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    pendingTokenResult?(FlutterError(code: "APNS_ERROR", message: error.localizedDescription, details: nil))
    pendingTokenResult = nil
  }

  // Ứng dụng đang mở: vẫn hiện banner (Socket.IO thường giao trước, máy chủ khi đó không gửi APNs trùng)
  override func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                       withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .list, .sound])
  }
}
