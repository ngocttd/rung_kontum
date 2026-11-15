import 'package:latlong2/latlong.dart';

/// Dữ liệu thuần Dart, chuyển được giữa các isolate; không chứa widget hay Canvas.
class PolygonGeometry {
  const PolygonGeometry({required this.rings, required this.properties});
  final List<List<LatLng>> rings;
  final Map<String, dynamic> properties;
}

List<LatLng> _ring(List coordinates) => [
  for (final c in coordinates)
    LatLng(((c as List)[1] as num).toDouble(), (c[0] as num).toDouble()),
];

List<PolygonGeometry> preparePolygons(Map<String, dynamic> geo) {
  final result = <PolygonGeometry>[];
  for (final feature in (geo['features'] as List? ?? const []).cast<Map>()) {
    final geometry = feature['geometry'] as Map?;
    if (geometry == null) continue;
    final coordinates = geometry['coordinates'] as List;
    final polygons = switch (geometry['type']) {
      'Polygon' => [coordinates],
      'MultiPolygon' => coordinates.cast<List>(),
      _ => const <List>[],
    };
    final properties = Map<String, dynamic>.from(feature['properties'] as Map? ?? const {});
    for (final polygon in polygons) {
      final rings = [for (final ring in polygon.cast<List>()) _ring(ring)];
      if (rings.isNotEmpty && rings.first.length >= 3) {
        result.add(PolygonGeometry(rings: rings, properties: properties));
      }
    }
  }
  return result;
}

List<List<LatLng>> prepareLines(Map<String, dynamic> geo) {
  final result = <List<LatLng>>[];
  for (final feature in (geo['features'] as List? ?? const []).cast<Map>()) {
    final geometry = feature['geometry'] as Map?;
    if (geometry == null) continue;
    final c = geometry['coordinates'] as List;
    final rings = switch (geometry['type']) {
      'Polygon' || 'MultiLineString' => c.cast<List>(),
      'MultiPolygon' => [for (final polygon in c.cast<List>()) ...polygon.cast<List>()],
      'LineString' => [c],
      _ => const <List>[],
    };
    for (final ring in rings) {
      if (ring.length >= 2) result.add(_ring(ring));
    }
  }
  return result;
}
