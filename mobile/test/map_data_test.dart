import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kontum_mobilegis/core/data.dart';
import 'package:kontum_mobilegis/features/map/map_data.dart';
import 'package:kontum_mobilegis/features/map/map_geometry.dart';

const outer = [[107.0, 14.0], [108.0, 14.0], [108.0, 15.0], [107.0, 14.0]];
const hole = [[107.2, 14.2], [107.3, 14.2], [107.3, 14.3], [107.2, 14.2]];
Map<String, dynamic> fixture({int level = 3}) => {
  'type': 'FeatureCollection',
  'features': [
    {'type': 'Feature', 'properties': {'code': 'A', 'danger_cls': level}, 'geometry': {'type': 'Polygon', 'coordinates': [outer, hole]}},
    {'type': 'Feature', 'properties': {'code': 'B'}, 'geometry': {'type': 'MultiPolygon', 'coordinates': [[outer], [hole]]}},
  ],
};

void main() {
  test('chuẩn bị Polygon/MultiPolygon ở isolate giữ lỗ và thuộc tính', () async {
    final input = fixture();
    final result = await compute(preparePolygons, input);
    expect(result.length, 3);
    expect(result.first.rings.length, 2);
    expect(result.first.rings.first.first.latitude, 14);
    expect(result.first.rings.first.first.longitude, 107);
    expect(result.first.rings[1].first.latitude, 14.2);
    expect(result.first.properties, {'code': 'A', 'danger_cls': 3});
    expect(result[1].properties['code'], 'B');
    expect(input, fixture());
  });

  test('đường biên chuẩn bị ở isolate giữ đủ các vòng', () async {
    final result = await compute(prepareLines, fixture());
    expect(result.length, 4);
    expect(result.fold<int>(0, (sum, ring) => sum + ring.length), 16);
    expect(result.first.first.longitude, 107);
  });

  test('geometry được tái sử dụng và cập nhật khi nguồn GeoJSON đổi', () async {
    var level = 3;
    var requests = 0;
    final container = ProviderContainer(overrides: [
      communesGeoProvider.overrideWith((ref) async { requests++; return Loaded<J>(fixture(level: level)); }),
    ]);
    addTearDown(container.dispose);
    final first = await container.read(communeMapGeometryProvider.future);
    final again = await container.read(communeMapGeometryProvider.future);
    expect(identical(first, again), isTrue);
    expect(requests, 1);
    level = 5;
    container.invalidate(communesGeoProvider);
    final updated = await container.read(communeMapGeometryProvider.future);
    expect(identical(first, updated), isFalse);
    expect(updated.first.properties['danger_cls'], 5);
    expect(requests, 2);
  });
}
