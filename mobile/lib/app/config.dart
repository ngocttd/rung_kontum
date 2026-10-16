import 'package:flutter/foundation.dart';

/// Cấu hình biên dịch. Truyền khi build/chạy:
///   flutter run --dart-define=API_BASE_URL=http://192.168.1.10:3000 --dart-define=DEMO_LOGIN=true
/// Không đặt khoá bí mật (mật khẩu DB, khoá GEE, khoá thời tiết) trong ứng dụng – mọi thứ đi qua backend.
class AppConfig {
  AppConfig._();

  static const String _apiFromEnv = String.fromEnvironment('API_BASE_URL');

  /// Cho phép hiện khối "Đăng nhập nhanh theo vai trò" (chỉ hiện khi máy chủ cũng bật MOBILE_DEMO_LOGIN).
  /// Bản phát hành chính thức: --dart-define=DEMO_LOGIN=false
  static const bool demoLoginAllowed = bool.fromEnvironment('DEMO_LOGIN', defaultValue: true);

  static const String appName = 'MobileGIS Kon Tum';
  static const String webPortal = String.fromEnvironment('WEB_PORTAL_URL', defaultValue: '');

  /// Địa chỉ máy chủ mặc định: theo --dart-define; bản web dùng chính origin đang phục vụ;
  /// Android emulator truy cập máy phát triển qua 10.0.2.2.
  static String get defaultApiBase {
    if (_apiFromEnv.isNotEmpty) return _trim(_apiFromEnv);
    if (kIsWeb) return _trim(Uri.base.origin);
    if (defaultTargetPlatform == TargetPlatform.android) return 'http://10.0.2.2:3000';
    return 'http://localhost:3000';
  }

  static String _trim(String s) => s.endsWith('/') ? s.substring(0, s.length - 1) : s;
  static String normalize(String s) => _trim(s.trim());

  static const Duration connectTimeout = Duration(seconds: 12);
  static const Duration receiveTimeout = Duration(seconds: 40);
}
