import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kontum_mobilegis/core/api.dart';
import 'package:kontum_mobilegis/core/data.dart';
import 'package:kontum_mobilegis/core/session.dart';
import 'package:shared_preferences/shared_preferences.dart';

class MemoryAdapter implements HttpClientAdapter {
  MemoryAdapter(this.payload);
  final Map<String, dynamic> payload;
  bool offline = false;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    if (offline) throw DioException.connectionError(requestOptions: options, reason: 'test offline');
    return ResponseBody.fromString(jsonEncode(payload), 200, headers: {Headers.contentTypeHeader: ['application/json']});
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('cache GeoJSON lớn ghi nền và đọc lại được khi mất mạng', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final data = <String, dynamic>{'type': 'FeatureCollection', 'features': [
      for (var i = 0; i < 2000; i++) {'id': i, 'name': 'Xã kiểm thử 🌳 $i', 'coordinates': [107.9, 14.5]},
    ]};
    final adapter = MemoryAdapter(data);
    final api = ApiClient(baseUrl: 'https://cache.example.test', tokens: TokenStore());
    api.dio.httpClientAdapter = adapter;
    final container = ProviderContainer(overrides: [apiProvider.overrideWithValue(api), prefsProvider.overrideWithValue(prefs)]);
    addTearDown(() { container.dispose(); api.dio.close(); });
    final cached = FutureProvider((ref) => cachedGet<J>(ref, '/test/geojson', backgroundCache: true));
    final online = await container.read(cached.future);
    expect(online.offline, isFalse);
    expect(online.data, data);
    expect(prefs.getString('pub:/test/geojson?'), isNotNull);
    adapter.offline = true;
    container.invalidate(cached);
    final restored = await container.read(cached.future);
    expect(restored.offline, isTrue);
    expect(restored.cachedAt, isNotNull);
    expect(restored.data, data);
  });
}
