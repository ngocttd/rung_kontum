import 'package:flutter/foundation.dart';

/// Cấu hình biên dịch. Truyền khi build/chạy:
///   flutter run --dart-define=API_BASE_URL=https://kontum.humgsoftware.pro.vn
/// Không đặt khoá bí mật (mật khẩu DB, khoá GEE, khoá thời tiết) trong ứng dụng – mọi thứ đi qua backend.
class AppConfig {
  AppConfig._();

  static const String _hostedBase = 'https://kontum.humgsoftware.pro.vn';
  static const String _apiFromEnv = String.fromEnvironment('API_BASE_URL');

  /// Cho phép hiện khối "Đăng nhập nhanh theo vai trò" (chỉ hiện khi máy chủ cũng bật MOBILE_DEMO_LOGIN).
  /// Bản phát hành chính thức: --dart-define=DEMO_LOGIN=false
  static const bool demoLoginAllowed = bool.fromEnvironment('DEMO_LOGIN', defaultValue: !kReleaseMode);

  static const String privacyPolicyUrl = String.fromEnvironment('PRIVACY_POLICY_URL');
  /// Trang HTTPS cho người dùng thực hiện xóa tài khoản, không phải trang hỗ trợ chung.
  static const String accountDeletionUrl = String.fromEnvironment('ACCOUNT_DELETION_URL');

  static const String appName = 'MobileGIS Kon Tum';
  static const String webPortal = String.fromEnvironment('WEB_PORTAL_URL', defaultValue: _hostedBase);

  /// Mọi nền tảng dùng máy chủ HTTPS đã triển khai, có thể ghi đè bằng --dart-define.
  static String get defaultApiBase {
    if (_apiFromEnv.isNotEmpty) return _trim(_apiFromEnv);
    return _hostedBase;
  }

  static String _trim(String s) => s.endsWith('/') ? s.substring(0, s.length - 1) : s;
  static String normalize(String s) => _trim(s.trim());

  static const Duration connectTimeout = Duration(seconds: 12);
  static const Duration receiveTimeout = Duration(seconds: 40);
}
