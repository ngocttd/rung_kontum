import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/data.dart';
import 'map_geometry.dart';

// Chỉ chuẩn bị lại khi nguồn GeoJSON thay đổi; tìm kiếm, đổi tab và camera không
// chuyển đổi hàng nghìn tọa độ hoặc khởi động isolate thêm lần nữa.
final communeMapGeometryProvider = FutureProvider<List<PolygonGeometry>>((ref) async {
  final geo = await ref.watch(communesGeoProvider.future);
  return compute(preparePolygons, geo.data, debugLabel: 'map.communes.geometry');
});

final provinceMapGeometryProvider = FutureProvider<List<List<LatLng>>>((ref) async {
  final geo = await ref.watch(provinceGeoProvider.future);
  return compute(prepareLines, geo.data, debugLabel: 'map.province.geometry');
});
