import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../app/config.dart';

/// Lỗi API thống nhất: máy chủ trả { error, code } kèm mã HTTP (đặc tả mục 8).
class ApiException implements Exception {
  ApiException(this.message, {this.code, this.status, this.data});
  final String message;
  final String? code;
  final int? status;
  final Map<String, dynamic>? data;

  /// Không kết nối được máy chủ (mất mạng, hết thời gian chờ) → giữ bản ghi trong hàng đợi.
  bool get isNetwork => status == null;
  @override
  String toString() => message;
}

/// Token truy cập (15 phút) chỉ giữ trong bộ nhớ; refresh token lưu trong secure storage (Keychain/Keystore).
class TokenStore {
  TokenStore() : _secure = const FlutterSecureStorage();
  final FlutterSecureStorage _secure;
  static const _kRefresh = 'refresh_token';
  String? accessToken;

  Future<String?> readRefresh() async {
    try {
      return await _secure.read(key: _kRefresh);
    } catch (_) {
      return null;
    }
  }

  Future<void> save(String access, String refresh) async {
    accessToken = access;
    await _secure.write(key: _kRefresh, value: refresh);
  }

  Future<void> clear() async {
    accessToken = null;
    try {
      await _secure.delete(key: _kRefresh);
    } catch (_) {}
  }
}

typedef SessionExpired = void Function();

class ApiClient {
  ApiClient({required String baseUrl, required this.tokens, this.onSessionExpired})
      : dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: AppConfig.connectTimeout,
          receiveTimeout: AppConfig.receiveTimeout,
          sendTimeout: const Duration(minutes: 3),
          headers: {'Accept': 'application/json'},
        )) {
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (o, h) {
        final t = tokens.accessToken;
        if (t != null && o.headers['Authorization'] == null) o.headers['Authorization'] = 'Bearer $t';
        h.next(o);
      },
      onError: (e, h) async {
        final res = e.response;
        final retried = e.requestOptions.extra['retried'] == true;
        if (res?.statusCode == 401 && !retried && !e.requestOptions.path.contains('/auth/')) {
          if (await _refresh()) {
            final o = e.requestOptions
              ..extra['retried'] = true
              ..headers['Authorization'] = 'Bearer ${tokens.accessToken}';
            try {
              return h.resolve(await dio.fetch(o));
            } on DioException catch (e2) {
              return h.next(e2);
            }
          }
          onSessionExpired?.call();
        }
        h.next(e);
      },
    ));
  }

  final Dio dio;
  final TokenStore tokens;
  SessionExpired? onSessionExpired;
  String get baseUrl => dio.options.baseUrl;

  /// Đường dẫn tương đối của máy chủ (/tiles/…, /api/mobile/files/…) → URL đầy đủ.
  String url(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    return '$baseUrl${path.startsWith('/') ? '' : '/'}$path';
  }

  Map<String, String> get authHeaders => tokens.accessToken == null ? {} : {'Authorization': 'Bearer ${tokens.accessToken}'};

  Completer<bool>? _refreshing;
  Future<bool> _refresh() async {
    if (_refreshing != null) return _refreshing!.future; // one refresh at a time
    final c = _refreshing = Completer<bool>();
    try {
      final rt = await tokens.readRefresh();
      if (rt == null) {
        c.complete(false);
      } else {
        final r = await dio.post('/api/mobile/auth/refresh', data: {'refresh_token': rt});
        await tokens.save(r.data['access_token'] as String, r.data['refresh_token'] as String);
        c.complete(true);
      }
    } catch (_) {
      await tokens.clear();
      c.complete(false);
    } finally {
      _refreshing = null;
    }
    return c.future;
  }

  Future<bool> refreshSession() => _refresh();

  ApiException _wrap(Object e) {
    if (e is DioException) {
      final r = e.response;
      if (r == null) return ApiException('Không kết nối được máy chủ. Kiểm tra mạng hoặc địa chỉ máy chủ.');
      final d = r.data;
      if (d is Map) {
        return ApiException((d['error'] ?? 'Lỗi ${r.statusCode}').toString(), code: d['code']?.toString(), status: r.statusCode, data: Map<String, dynamic>.from(d));
      }
      return ApiException('Lỗi máy chủ (${r.statusCode})', status: r.statusCode);
    }
    return ApiException(e.toString(), status: 0);
  }

  Future<T> _do<T>(Future<Response> Function() f) async {
    try {
      final r = await f();
      return r.data as T;
    } catch (e) {
      throw _wrap(e);
    }
  }

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _do<T>(() => dio.get(path, queryParameters: query));
  Future<T> post<T>(String path, [Object? body]) => _do<T>(() => dio.post(path, data: body ?? const {}));
  Future<T> patch<T>(String path, [Object? body]) => _do<T>(() => dio.patch(path, data: body ?? const {}));

  /// Tải tệp theo URL ký một lần (presign): máy chủ kiểm tra loại tệp, dung lượng; ảnh được mã hoá lại, bỏ EXIF.
  Future<String> uploadBytes(Uint8List bytes, String mime, {required String ownerKind, double? lat, double? lon, double? accuracy, DateTime? capturedAt}) async {
    final ticket = await post<Map<String, dynamic>>('/api/mobile/uploads/presign', {'mime': mime, 'bytes': bytes.length, 'owner_kind': ownerKind});
    final q = <String, dynamic>{
      'lat': ?lat,
      'lon': ?lon,
      'accuracy': ?accuracy,
      if (capturedAt != null) 'captured_at': capturedAt.toUtc().toIso8601String(),
    };
    final res = await _do<Map<String, dynamic>>(() => dio.put(
          ticket['upload_url'] as String,
          data: Stream.fromIterable([bytes]),
          queryParameters: q,
          options: Options(headers: {'Content-Type': mime, Headers.contentLengthHeader: bytes.length}),
        ));
    return res['object_key'] as String;
  }
}
