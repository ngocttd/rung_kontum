import 'dart:async';
import 'dart:ui' as ui;

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kontum_mobilegis/core/map_network.dart';
import 'package:kontum_mobilegis/widgets/network_map.dart';
import 'package:latlong2/latlong.dart';

class _BrokenBodyClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async =>
      http.StreamedResponse(
        Stream.error(http.ClientException('Connection closed during download')),
        200,
      );
}

class _TestOverlayImage extends ImageProvider<_TestOverlayImage> {
  const _TestOverlayImage(this.offline);
  final ValueNotifier<bool> offline;
  @override
  Future<_TestOverlayImage> obtainKey(ImageConfiguration configuration) async =>
      this;
  @override
  ImageStreamCompleter loadImage(
    _TestOverlayImage key,
    ImageDecoderCallback decode,
  ) => OneFrameImageStreamCompleter(_load());
  Future<ImageInfo> _load() async {
    if (offline.value) {
      throw http.ClientException(
        'Failed host lookup: kontum.humgsoftware.pro.vn',
      );
    }
    final codec = await ui.instantiateImageCodec(TileProvider.transparentImage);
    final frame = await codec.getNextFrame();
    codec.dispose();
    return ImageInfo(image: frame.image);
  }
}

void main() {
  setUp(() {
    PaintingBinding.instance.imageCache.clear();
    PaintingBinding.instance.imageCache.clearLiveImages();
  });
  test('DNS lỗi tạm dừng yêu cầu mới; retry tải lại và giữ header', () async {
    var offline = true;
    var requests = 0;
    final failures = <MapLoadFailure>[];
    final client = MapTileClient(
      MockClient((request) async {
        requests++;
        expect(request.headers['authorization'], 'Bearer test-token');
        if (offline) {
          throw http.ClientException('Failed host lookup: api.mapbox.com');
        }
        return http.Response('ok', 200);
      }),
      onFailure: failures.add,
    );
    addTearDown(client.close);
    final uri = Uri.parse('https://api.mapbox.com/tile.png');
    const headers = {'Authorization': 'Bearer test-token'};
    await expectLater(
      client.get(uri, headers: headers),
      throwsA(isA<http.ClientException>()),
    );
    for (var i = 0; i < 30; i++) {
      await expectLater(
        client.get(uri, headers: headers),
        throwsA(isA<http.ClientException>()),
      );
    }
    expect(requests, 1);
    expect(failures, [MapLoadFailure.connection]);
    offline = false;
    client.retry();
    expect((await client.get(uri, headers: headers)).body, 'ok');
    expect(requests, 2);
  });

  test('huỷ tile khi kéo bản đồ không bị coi là mất mạng', () async {
    final failures = <MapLoadFailure>[];
    final client = MapTileClient(
      MockClient((_) async => throw http.RequestAbortedException()),
      onFailure: failures.add,
    );
    addTearDown(client.close);
    await expectLater(
      client.get(Uri.parse('https://tiles.test/cancel')),
      throwsA(isA<http.RequestAbortedException>()),
    );
    expect(failures, isEmpty);
  });

  test('phân biệt máy chủ từ chối và tile raster ngoài vùng dữ liệu', () async {
    final failures = <MapLoadFailure>[];
    final client = MapTileClient(
      MockClient(
        (request) async =>
            http.Response('', int.parse(request.url.pathSegments.last)),
      ),
      onFailure: failures.add,
      allowMissingTiles: true,
    );
    addTearDown(client.close);
    for (final status in [404, 403, 503]) {
      await client.get(Uri.parse('https://tiles.test/$status'));
    }
    expect(failures, [MapLoadFailure.access, MapLoadFailure.server]);
  });

  test('mất kết nối trong lúc đọc body cũng được xử lý', () async {
    final failures = <MapLoadFailure>[];
    final client = MapTileClient(_BrokenBodyClient(), onFailure: failures.add);
    addTearDown(client.close);
    await expectLater(
      client.get(Uri.parse('https://tiles.test/broken')),
      throwsA(isA<http.ClientException>()),
    );
    expect(failures, [MapLoadFailure.connection]);
  });

  Future<void> showMap(
    WidgetTester tester, {
    required http.Client Function() clientFactory,
    Stream<List<ConnectivityResult>>? connectivity,
    bool raster = false,
    ImageProvider? overlay,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          mapHttpClientFactoryProvider.overrideWithValue(clientFactory),
          mapConnectivityProvider.overrideWith(
            (ref) => connectivity ?? const Stream.empty(),
          ),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: NetworkMap(
              options: const MapOptions(
                initialCenter: LatLng(14.65, 107.95),
                initialZoom: 10,
              ),
              children: [
                if (overlay == null)
                  const MapTileLayer(
                    urlTemplate: 'https://api.mapbox.test/{z}/{x}/{y}.png',
                    cachingProvider: DisabledMapCachingProvider(),
                  ),
                if (raster)
                  const MapTileLayer(
                    urlTemplate: 'https://api.kontum.test/{z}/{x}/{y}.png',
                    cachingProvider: DisabledMapCachingProvider(),
                  ),
                if (overlay != null)
                  OverlayImageLayer(
                    overlayImages: [
                      MapOverlayImage(
                        bounds: LatLngBounds(
                          const LatLng(14.5, 107.8),
                          const LatLng(14.8, 108.1),
                        ),
                        imageProvider: overlay,
                      ),
                    ],
                  ),
                const MarkerLayer(
                  markers: [
                    Marker(
                      point: LatLng(14.65, 107.95),
                      child: Text('Vị trí đã lưu'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'hai nguồn DNS lỗi chỉ hiện một thông báo; retry tải ảnh thật và giữ marker',
    (tester) async {
      var offline = true;
      var requests = 0;
      var loaded = 0;
      final logs = <String>[];
      final originalPrint = debugPrint;
      debugPrint = (message, {wrapWidth}) {
        if (message != null) logs.add(message);
      };
      try {
        await showMap(
          tester,
          raster: true,
          clientFactory: () => MockClient((_) async {
            requests++;
            if (offline) throw http.ClientException('Failed host lookup');
            loaded++;
            return http.Response.bytes(
              TileProvider.transparentImage,
              200,
              headers: {'content-type': 'image/png'},
            );
          }),
        );
        expect(find.text('Thử lại'), findsOneWidget);
        expect(find.text('Vị trí đã lưu'), findsOneWidget);
        expect(tester.takeException(), isNull);
        expect(
          logs.where(
            (l) =>
                l.contains('ClientException') ||
                l.contains('Failed host lookup'),
          ),
          isEmpty,
        );
        final before = requests;
        offline = false;
        await tester.tap(find.text('Thử lại'));
        await tester.pumpAndSettle();
        expect(requests, greaterThan(before));
        expect(loaded, greaterThan(0));
        expect(find.text('Thử lại'), findsNothing);
        expect(find.text('Vị trí đã lưu'), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      } finally {
        debugPrint = originalPrint;
      }
    },
  );

  testWidgets('sự kiện kết nối trở lại tự tải lại lớp lỗi', (tester) async {
    final connectivity = StreamController<List<ConnectivityResult>>.broadcast();
    addTearDown(connectivity.close);
    var offline = true;
    var loaded = 0;
    await showMap(
      tester,
      connectivity: connectivity.stream,
      clientFactory: () => MockClient((_) async {
        if (offline) throw http.ClientException('Failed host lookup');
        loaded++;
        return http.Response.bytes(TileProvider.transparentImage, 200);
      }),
    );
    expect(find.text('Thử lại'), findsOneWidget);
    connectivity.add([ConnectivityResult.none]);
    await tester.pumpAndSettle();
    expect(find.text('Thử lại'), findsOneWidget);
    offline = false;
    connectivity.add([ConnectivityResult.wifi]);
    await tester.pumpAndSettle();
    expect(loaded, greaterThan(0));
    expect(find.text('Thử lại'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('mở lại app tự thử tải lớp bị lỗi', (tester) async {
    var offline = true;
    var loaded = 0;
    await showMap(
      tester,
      clientFactory: () => MockClient((_) async {
        if (offline) throw http.ClientException('Failed host lookup');
        loaded++;
        return http.Response.bytes(TileProvider.transparentImage, 200);
      }),
    );
    expect(find.text('Thử lại'), findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    offline = false;
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(loaded, greaterThan(0));
    expect(find.text('Thử lại'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('thoát bản đồ khi đang tải không báo lỗi sau dispose', (
    tester,
  ) async {
    final pending = Completer<http.Response>();
    await showMap(
      tester,
      clientFactory: () => MockClient((_) => pending.future),
    );
    await tester.pumpWidget(const SizedBox.shrink());
    pending.completeError(http.ClientException('Failed host lookup'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('ảnh phủ cũ xử lý DNS lỗi và có thể thử lại', (tester) async {
    final offline = ValueNotifier(true);
    addTearDown(offline.dispose);
    await showMap(
      tester,
      overlay: _TestOverlayImage(offline),
      clientFactory: () => MockClient((_) async => http.Response('', 200)),
    );
    expect(find.text('Thử lại'), findsOneWidget);
    expect(tester.takeException(), isNull);
    offline.value = false;
    await tester.tap(find.text('Thử lại'));
    await tester.pumpAndSettle();
    expect(find.text('Thử lại'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
