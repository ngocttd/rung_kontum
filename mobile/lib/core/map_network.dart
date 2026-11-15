import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

final mapConnectivityProvider = StreamProvider<List<ConnectivityResult>>(
  (ref) => Connectivity().onConnectivityChanged,
);
final mapHttpClientFactoryProvider = Provider<http.Client Function()>(
  (ref) => http.Client.new,
);

enum MapLoadFailure { connection, access, server }

/// Giới hạn yêu cầu mới sau lỗi mạng. Không đổi URL, token hoặc gửi sang nhà cung cấp khác.
/// NetworkTileProvider vẫn đọc cache trước khi gọi client này.
class MapTileClient extends http.BaseClient {
  MapTileClient(
    this._inner, {
    required this.onFailure,
    this.allowMissingTiles = false,
  });

  final http.Client _inner;
  final void Function(MapLoadFailure) onFailure;
  final bool allowMissingTiles;
  DateTime? _blockedUntil;
  bool _closed = false;

  void retry() => _blockedUntil = null;

  void _connectionFailure(Object error) {
    if (_closed || error is http.RequestAbortedException) return;
    _blockedUntil = DateTime.now().add(const Duration(seconds: 10));
    onFailure(MapLoadFailure.connection);
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (_closed) throw http.ClientException('Tile client closed');
    if (_blockedUntil?.isAfter(DateTime.now()) == true) {
      throw http.ClientException('Tile requests paused until retry');
    }
    final http.StreamedResponse response;
    try {
      response = await _inner.send(request);
    } catch (error) {
      _connectionFailure(error);
      rethrow;
    }
    if (!_closed &&
        response.statusCode >= 400 &&
        !(allowMissingTiles && response.statusCode == 404)) {
      onFailure(
        response.statusCode == 401 || response.statusCode == 403
            ? MapLoadFailure.access
            : MapLoadFailure.server,
      );
    }
    return http.StreamedResponse(
      _body(response.stream),
      response.statusCode,
      headers: response.headers,
      contentLength: response.contentLength,
      request: response.request,
      isRedirect: response.isRedirect,
      persistentConnection: response.persistentConnection,
      reasonPhrase: response.reasonPhrase,
    );
  }

  Stream<List<int>> _body(Stream<List<int>> stream) => stream.transform(
    StreamTransformer.fromHandlers(
      handleError: (error, stack, sink) {
        _connectionFailure(error);
        sink.addError(error, stack);
      },
    ),
  );

  @override
  void close() {
    _closed = true;
    _inner.close();
    super.close();
  }
}
