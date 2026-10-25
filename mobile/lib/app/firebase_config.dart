import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Cấu hình Firebase (Cloud Messaging) truyền lúc build – không cần google-services.json / GoogleService-Info.plist:
///   flutter build apk --dart-define-from-file=firebase.json      (mẫu: firebase.example.json)
/// Lấy giá trị ở Firebase console → Project settings → Your apps (Android / iOS).
/// Các giá trị này là định danh công khai của ứng dụng (không phải khoá bí mật); khoá gửi thông báo
/// (service account) chỉ nằm trên máy chủ. Thiếu cấu hình → ứng dụng vẫn chạy, thông báo chỉ qua Socket.IO khi mở.
class FirebaseConfig {
  FirebaseConfig._();

  static const _projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const _senderId = String.fromEnvironment('FIREBASE_SENDER_ID');
  static const _androidApiKey = String.fromEnvironment('FIREBASE_ANDROID_API_KEY');
  static const _androidAppId = String.fromEnvironment('FIREBASE_ANDROID_APP_ID');
  static const _iosApiKey = String.fromEnvironment('FIREBASE_IOS_API_KEY');
  static const _iosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');
  static const _iosBundleId = String.fromEnvironment('FIREBASE_IOS_BUNDLE_ID', defaultValue: 'vn.gov.kontum.kontumMobilegis');
  static const _storageBucket = String.fromEnvironment('FIREBASE_STORAGE_BUCKET');

  static FirebaseOptions? get options {
    if (kIsWeb || _projectId.isEmpty || _senderId.isEmpty) return null;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        if (_androidApiKey.isEmpty || _androidAppId.isEmpty) return null;
        return FirebaseOptions(apiKey: _androidApiKey, appId: _androidAppId, messagingSenderId: _senderId, projectId: _projectId, storageBucket: _storageBucket.isEmpty ? null : _storageBucket);
      case TargetPlatform.iOS:
        if (_iosApiKey.isEmpty || _iosAppId.isEmpty) return null;
        return FirebaseOptions(apiKey: _iosApiKey, appId: _iosAppId, messagingSenderId: _senderId, projectId: _projectId, iosBundleId: _iosBundleId, storageBucket: _storageBucket.isEmpty ? null : _storageBucket);
      default:
        return null;
    }
  }

  static bool get available => options != null;
}
