import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api.dart';
import 'session.dart';

/// Kết quả có cờ "dữ liệu lưu sẵn" khi đọc từ bộ nhớ đệm do mất mạng.
class Loaded<T> {
  const Loaded(this.data, {this.cachedAt});
  final T data;
  final DateTime? cachedAt;
  bool get offline => cachedAt != null;
}

/// GET có bộ đệm: dữ liệu công khai (lớp bản đồ, thống kê, cảnh báo, tin) được lưu để dùng khi mất mạng.
/// Dữ liệu nghiệp vụ cá nhân dùng khoá "cache:" và bị xoá khi đăng xuất.
Future<Loaded<T>> cachedGet<T>(Ref ref, String path, {Map<String, dynamic>? query, bool personal = false}) async {
  final api = ref.read(apiProvider);
  final prefs = ref.read(prefsProvider);
  final key = '${personal ? 'cache:' : 'pub:'}$path?${query == null ? '' : jsonEncode(query)}';
  try {
    final data = await api.get<T>(path, query: query);
    prefs.setString(key, jsonEncode({'at': DateTime.now().toIso8601String(), 'data': data}));
    return Loaded<T>(data);
  } on ApiException catch (e) {
    if (!e.isNetwork) rethrow;
    final raw = prefs.getString(key);
    if (raw == null) rethrow;
    final j = jsonDecode(raw) as Map;
    return Loaded<T>(j['data'] as T, cachedAt: DateTime.tryParse(j['at'] as String));
  }
}

typedef J = Map<String, dynamic>;

final homeProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/home'));
final layersProvider = FutureProvider<Loaded<J>>((ref) {
  ref.watch(sessionProvider.select((s) => s.user?.role));
  return cachedGet<J>(ref, '/api/mobile/layers');
});
final communesGeoProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/public/boundaries/communes'));
final provinceGeoProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/public/boundaries/province'));
final hotspotsProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/fire/hotspots'));
final candidatesProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/public/forest/candidates'));
final publicReportsProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/reports/public', query: {'limit': 100}));
final fireAlertsProvider = FutureProvider.family<Loaded<J>, String>((ref, type) => cachedGet<J>(ref, '/api/mobile/fire/alerts', query: {'limit': 100, if (type.isNotEmpty) 'type': type}));
final dangerProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/fire/danger'));
final fireHistoryProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/fire/history'));
final forestSummaryProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/forest/summary'));
final forestChangeProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/forest/change', query: {'limit': 50}));
final imageryProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/imagery/products'));
final weatherProvider = FutureProvider<Loaded<List>>((ref) => cachedGet<List>(ref, '/api/mobile/weather'));
final weatherDetailProvider = FutureProvider.family<Loaded<J>, String>((ref, code) => cachedGet<J>(ref, '/api/mobile/weather/$code'));
final newsProvider = FutureProvider.family<Loaded<J>, String>((ref, cat) => cachedGet<J>(ref, '/api/mobile/news', query: {'limit': 50, if (cat.isNotEmpty) 'category': cat}));
final newsDetailProvider = FutureProvider.family<Loaded<J>, String>((ref, slug) => cachedGet<J>(ref, '/api/mobile/news/$slug'));
final documentsProvider = FutureProvider.family<Loaded<J>, String>((ref, cat) => cachedGet<J>(ref, '/api/mobile/documents', query: {'limit': 100, if (cat.isNotEmpty) 'category': cat}));

// ---------- dữ liệu cá nhân / nghiệp vụ (cần đăng nhập) ----------
final myReportsProvider = FutureProvider<Loaded<J>>((ref) {
  ref.watch(sessionProvider.select((s) => s.user?.id));
  return cachedGet<J>(ref, '/api/mobile/reports/mine', query: {'limit': 100}, personal: true);
});
final assignmentsProvider = FutureProvider<Loaded<J>>((ref) {
  ref.watch(sessionProvider.select((s) => s.user?.id));
  return cachedGet<J>(ref, '/api/mobile/assignments', query: {'limit': 100}, personal: true);
});
final assignmentProvider = FutureProvider.family<Loaded<J>, String>((ref, id) => cachedGet<J>(ref, '/api/mobile/assignments/$id', personal: true));
final pendingVerificationsProvider = FutureProvider<J>((ref) => ref.read(apiProvider).get<J>('/api/mobile/verifications', query: {'review_status': 'pending', 'limit': 100}));
final mySurveysProvider = FutureProvider<Loaded<J>>((ref) => cachedGet<J>(ref, '/api/mobile/surveys', query: {'limit': 100}, personal: true));
final notificationsProvider = FutureProvider<J>((ref) {
  ref.watch(sessionProvider.select((s) => s.user?.id));
  final communes = ref.read(prefsProvider).getStringList('subscribed_communes') ?? const [];
  return ref.read(apiProvider).get<J>('/api/mobile/notifications', query: {'limit': 100, if (communes.isNotEmpty) 'communes': communes.join(',')});
});

/// Chuyển GeoJSON (Polygon/MultiPolygon/Point/LineString) thành danh sách toạ độ tiện vẽ bản đồ.
List<List<List<double>>> ringsOf(Map geometry) {
  final t = geometry['type'];
  final c = geometry['coordinates'] as List;
  List<List<double>> ring(List r) => r.map((p) => [(p[0] as num).toDouble(), (p[1] as num).toDouble()]).toList();
  if (t == 'Polygon') return c.map((r) => ring(r as List)).toList();
  if (t == 'MultiPolygon') return [for (final poly in c) ...(poly as List).map((r) => ring(r as List))];
  if (t == 'LineString') return [ring(c)];
  if (t == 'MultiLineString') return c.map((r) => ring(r as List)).toList();
  return const [];
}

/// Điểm trong đa giác (ray casting) – chọn xã khi chạm bản đồ.
bool pointInGeometry(double lon, double lat, Map geometry) {
  final t = geometry['type'];
  final polys = t == 'Polygon' ? [geometry['coordinates'] as List] : t == 'MultiPolygon' ? (geometry['coordinates'] as List).cast<List>() : const <List>[];
  for (final poly in polys) {
    var inside = false;
    for (var r = 0; r < poly.length; r++) {
      final ring = poly[r] as List;
      var hit = false;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        final xi = (ring[i][0] as num).toDouble(), yi = (ring[i][1] as num).toDouble();
        final xj = (ring[j][0] as num).toDouble(), yj = (ring[j][1] as num).toDouble();
        if (((yi > lat) != (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) hit = !hit;
      }
      if (r == 0) {
        inside = hit;
      } else if (hit) {
        inside = false; // nằm trong lỗ
      }
    }
    if (inside) return true;
  }
  return false;
}
