import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;

import 'data.dart';
import 'notify_local.dart';
import 'session.dart';

/// Kết nối Socket.IO tới máy chủ (namespace /mobile) khi ứng dụng đang mở:
///  - "notification": thông báo mới (lưu ở PostgreSQL) → hiện trong ứng dụng/khay hệ thống và xác nhận (ack) để máy chủ
///    không gửi push nền tảng trùng;
///  - "changed": dữ liệu web/mobile thay đổi → làm mới màn hình liên quan ngay (đồng bộ tức thời).
class RealtimeState {
  const RealtimeState({this.connected = false, this.lastNotification});
  final bool connected;
  final Map<String, dynamic>? lastNotification;
}

class Realtime extends Notifier<RealtimeState> {
  sio.Socket? _socket;
  String? _identity; // user id hoặc 'guest' của kết nối hiện tại

  @override
  RealtimeState build() {
    ref.onDispose(() => _socket?.dispose());
    return const RealtimeState();
  }

  /// Kết nối (hoặc kết nối lại khi đổi người dùng / máy chủ).
  void connect() {
    final s = ref.read(sessionProvider);
    if (!s.ready) return;
    final api = ref.read(apiProvider);
    final id = '${api.baseUrl}|${s.user?.id ?? 'guest'}';
    if (_socket != null && _identity == id) {
      if (!_socket!.connected) _socket!.connect();
      return;
    }
    _socket?.dispose();
    _identity = id;
    final rt = (s.bootstrap['realtime'] as Map?) ?? const {'path': '/socket.io', 'namespace': '/mobile'};
    final socket = sio.io(
      '${api.baseUrl}${rt['namespace'] ?? '/mobile'}',
      sio.OptionBuilder()
          .setTransports(['websocket'])
          .setPath(rt['path']?.toString() ?? '/socket.io')
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(2000)
          .setReconnectionDelayMax(30000)
          // token mới nhất ở mỗi lần (kết nối lại) – token truy cập chỉ sống 15 phút
          .setAuthFn((cb) => cb({
                if (api.tokens.accessToken != null) 'token': api.tokens.accessToken,
                'device_id': ref.read(deviceIdProvider),
                'communes': ref.read(prefsProvider).getStringList('subscribed_communes') ?? const <String>[],
              }))
          .build(),
    );
    socket.onConnect((_) => state = RealtimeState(connected: true, lastNotification: state.lastNotification));
    socket.onDisconnect((_) => state = RealtimeState(connected: false, lastNotification: state.lastNotification));
    socket.onConnectError((e) async {
      state = RealtimeState(connected: false, lastNotification: state.lastNotification);
      if ('$e'.contains('TOKEN_EXPIRED') && await api.refreshSession()) socket.connect();
    });
    socket.on('notification', (data) {
      Map<String, dynamic>? n;
      if (data is List && data.isNotEmpty) {
        n = (data.first as Map).cast<String, dynamic>();
        if (data.last is Function) (data.last as Function)({'ok': true}); // xác nhận đã nhận
      } else if (data is Map) {
        n = data.cast<String, dynamic>();
      }
      if (n == null) return;
      state = RealtimeState(connected: true, lastNotification: n);
      ref.invalidate(notificationsProvider);
      _refreshFor(n['kind'] as String?);
      if (!kIsWeb) unawaited(LocalNotifs.show(n));
    });
    socket.on('changed', (data) {
      final c = (data is Map ? data['collection'] : data is List && data.isNotEmpty ? (data.first as Map)['collection'] : null)?.toString();
      _refreshCollection(c);
    });
    _socket = socket;
    socket.connect();
  }

  /// Đổi danh sách xã theo dõi mà không phải kết nối lại.
  void subscribe(List<String> communes) => _socket?.emit('subscribe', communes);

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _identity = null;
    state = const RealtimeState();
  }

  void _refreshFor(String? kind) {
    switch (kind) {
      case 'report':
        ref.invalidate(myReportsProvider);
      case 'assignment':
      case 'verification':
        ref.invalidate(assignmentsProvider);
        ref.invalidate(pendingVerificationsProvider);
      case 'fire_danger':
      case 'fire_confirmed':
        ref.invalidate(homeProvider);
        ref.invalidate(hotspotsProvider);
        ref.invalidate(fireAlertsProvider);
    }
  }

  void _refreshCollection(String? c) {
    switch (c) {
      case 'reports':
        ref.invalidate(myReportsProvider);
        ref.invalidate(publicReportsProvider);
      case 'alerts':
        ref.invalidate(hotspotsProvider);
        ref.invalidate(fireAlertsProvider);
        ref.invalidate(candidatesProvider);
        ref.invalidate(homeProvider);
      case 'assignments':
        ref.invalidate(assignmentsProvider);
      case 'verifications':
        ref.invalidate(pendingVerificationsProvider);
        ref.invalidate(assignmentsProvider);
      case 'surveys':
        ref.invalidate(mySurveysProvider);
      case 'news':
        ref.invalidate(newsProvider);
        ref.invalidate(homeProvider);
      case 'documents':
        ref.invalidate(documentsProvider);
      case 'layers':
        ref.invalidate(layersProvider);
    }
  }
}

final realtimeProvider = NotifierProvider<Realtime, RealtimeState>(Realtime.new);
