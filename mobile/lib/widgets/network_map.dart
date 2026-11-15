import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/map_network.dart';

class _MapLoads extends ChangeNotifier {
  final failures = <Object, MapLoadFailure>{};
  final retries = StreamController<Set<Object>>.broadcast();
  bool _disposed = false;
  bool _pending = false;

  void fail(Object source, MapLoadFailure failure) {
    if (_disposed || failures[source] == failure) return;
    failures[source] = failure;
    _notifyLater();
  }

  void remove(Object source) {
    if (_disposed || failures.remove(source) == null) return;
    _notifyLater();
  }

  // Lỗi ảnh có thể được trả đồng bộ khi đang build hoặc khi tháo một lớp.
  void _notifyLater() {
    if (_pending) return;
    _pending = true;
    scheduleMicrotask(() {
      _pending = false;
      if (!_disposed) notifyListeners();
    });
  }

  void retry() {
    if (_disposed || failures.isEmpty) return;
    final sources = failures.keys.toSet();
    failures.clear();
    retries.add(sources);
    _notifyLater();
  }

  @override
  void dispose() {
    _disposed = true;
    retries.close();
    super.dispose();
  }
}

class _MapLoadScope extends InheritedWidget {
  const _MapLoadScope({required this.loads, required super.child});
  final _MapLoads loads;
  static _MapLoads of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_MapLoadScope>()!.loads;
  @override
  bool updateShouldNotify(_MapLoadScope oldWidget) => loads != oldWidget.loads;
}

/// Một thông báo cho toàn bản đồ; giữ các lớp vector và ô ảnh đã tải khi mất mạng.
class NetworkMap extends ConsumerStatefulWidget {
  const NetworkMap({
    super.key,
    this.mapController,
    required this.options,
    required this.children,
    this.noticeBottom = 8,
  });
  final MapController? mapController;
  final MapOptions options;
  final List<Widget> children;
  final double noticeBottom;
  @override
  ConsumerState<NetworkMap> createState() => _NetworkMapState();
}

class _NetworkMapState extends ConsumerState<NetworkMap>
    with WidgetsBindingObserver {
  final loads = _MapLoads();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) loads.retry();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    loads.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Có Wi-Fi không đảm bảo DNS/Internet hoạt động. Chỉ dùng sự kiện để thử lại
    // các lớp từng lỗi; kết quả tải ảnh mới quyết định hiển thị thông báo.
    ref.listen(mapConnectivityProvider, (_, next) {
      final result = next.asData?.value;
      if (result != null && result.any((r) => r != ConnectivityResult.none)) {
        loads.retry();
      }
    });
    return _MapLoadScope(
      loads: loads,
      child: Stack(
        children: [
          FlutterMap(
            mapController: widget.mapController,
            options: widget.options,
            children: widget.children,
          ),
          Positioned(
            left: 8,
            right: 8,
            bottom: widget.noticeBottom,
            child: ListenableBuilder(
              listenable: loads,
              builder: (context, _) {
                if (loads.failures.isEmpty) return const SizedBox.shrink();
                final message =
                    loads.failures.containsValue(MapLoadFailure.connection)
                    ? 'Chưa tải được ảnh bản đồ. Kiểm tra kết nối mạng rồi thử lại.'
                    : loads.failures.containsValue(MapLoadFailure.access)
                    ? 'Máy chủ từ chối tải ảnh bản đồ. Kiểm tra quyền truy cập hoặc chọn nền khác.'
                    : 'Một số ảnh bản đồ chưa tải được từ máy chủ.';
                return Material(
                  color: const Color(0xFFFFF4D6),
                  elevation: 2,
                  borderRadius: BorderRadius.circular(10),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(10, 4, 4, 4),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.cloud_off_outlined,
                          size: 20,
                          color: Color(0xFF7A5B00),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            message,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF7A5B00),
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: loads.retry,
                          child: const Text('Thử lại'),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Xử lý lỗi ở từng nguồn ảnh, không chuyển sang OSM khi cả thiết bị đang mất mạng.
class MapTileLayer extends ConsumerStatefulWidget {
  const MapTileLayer({
    super.key,
    required this.urlTemplate,
    this.headers = const {},
    this.minNativeZoom = 0,
    this.maxNativeZoom = 19,
    this.allowMissingTiles = false,
    this.cachingProvider,
  });
  final String urlTemplate;
  final Map<String, String> headers;
  final int minNativeZoom;
  final int maxNativeZoom;
  final bool allowMissingTiles;
  final MapCachingProvider? cachingProvider;
  @override
  ConsumerState<MapTileLayer> createState() => _MapTileLayerState();
}

class _MapTileLayerState extends ConsumerState<MapTileLayer> {
  final reset = StreamController<void>.broadcast();
  late final client = MapTileClient(
    ref.read(mapHttpClientFactoryProvider)(),
    onFailure: (failure) => loads.fail(this, failure),
    allowMissingTiles: widget.allowMissingTiles,
  );
  late final provider = NetworkTileProvider(
    headers: Map.of(widget.headers),
    httpClient: client,
    cachingProvider: widget.cachingProvider,
    silenceExceptions: true,
    attemptDecodeOfHttpErrorResponses: false,
  );
  late _MapLoads loads;
  StreamSubscription<Set<Object>>? retries;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    loads = _MapLoadScope.of(context);
    retries ??= loads.retries.stream.listen((sources) {
      if (!mounted || !sources.contains(this)) return;
      client.retry();
      reset.add(null);
    });
  }

  @override
  void didUpdateWidget(MapTileLayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.urlTemplate != widget.urlTemplate ||
        !mapEquals(oldWidget.headers, widget.headers)) {
      loads.remove(this);
      client.retry();
      provider.headers
        ..clear()
        ..addAll(widget.headers)
        ..['User-Agent'] = 'vn.gov.kontum.mobilegis';
      scheduleMicrotask(() {
        if (mounted) reset.add(null);
      });
    }
  }

  @override
  void dispose() {
    retries?.cancel();
    loads.remove(this);
    client.close();
    reset.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TileLayer(
    urlTemplate: widget.urlTemplate,
    tileProvider: provider,
    userAgentPackageName: 'vn.gov.kontum.mobilegis',
    minNativeZoom: widget.minNativeZoom,
    maxNativeZoom: widget.maxNativeZoom,
    reset: reset.stream,
  );
}

/// Bảo vệ cả lớp ảnh phủ cũ (không dùng tile) khi URL không truy cập được.
class MapOverlayImage extends OverlayImage {
  const MapOverlayImage({
    super.key,
    required super.bounds,
    required super.imageProvider,
    super.opacity,
  });
  Widget placeImage(BuildContext context, Image image) =>
      layout(context, child: image);
  @override
  Widget build(BuildContext context) => _OverlayLoader(overlay: this);
}

class _OverlayLoader extends StatefulWidget {
  const _OverlayLoader({required this.overlay});
  final MapOverlayImage overlay;
  @override
  State<_OverlayLoader> createState() => _OverlayLoaderState();
}

class _OverlayLoaderState extends State<_OverlayLoader> {
  late _MapLoads loads;
  StreamSubscription<Set<Object>>? retries;
  int generation = 0;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    loads = _MapLoadScope.of(context);
    retries ??= loads.retries.stream.listen((sources) async {
      if (!sources.contains(this)) return;
      await widget.overlay.imageProvider.evict();
      if (mounted) setState(() => generation++);
    });
  }

  @override
  void didUpdateWidget(_OverlayLoader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.overlay.imageProvider != widget.overlay.imageProvider) {
      loads.remove(this);
    }
  }

  @override
  void dispose() {
    retries?.cancel();
    loads.remove(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.overlay.placeImage(
    context,
    Image(
      key: ValueKey(generation),
      image: widget.overlay.imageProvider,
      fit: BoxFit.fill,
      opacity: AlwaysStoppedAnimation(widget.overlay.opacity),
      errorBuilder: (_, error, _) {
        loads.fail(
          this,
          error is NetworkImageLoadException
              ? MapLoadFailure.server
              : MapLoadFailure.connection,
        );
        return const SizedBox.shrink();
      },
    ),
  );
}
