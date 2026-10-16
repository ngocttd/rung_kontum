import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import 'api.dart';
import 'platform/files.dart';
import 'session.dart';

/// Hàng đợi ngoại tuyến (M17, quy trình 6.4):
///  - mọi phản ánh / khảo sát / xác minh được ghi vào hàng đợi trước, kèm client_uuid (khoá idempotency);
///  - khi có mạng: tải tệp đính kèm (URL ký một lần) → gửi /sync/batch (hoặc /reports khi là khách);
///  - kết quả: đã áp dụng / trùng (đã gửi trước đó) / xung đột (chờ người dùng xử lý) / bị từ chối (hiện lỗi);
///  - không bao giờ ghi đè âm thầm dữ liệu máy chủ.
class OutboxAttachment {
  OutboxAttachment({required this.path, required this.mime, this.key, this.lat, this.lon, this.accuracy, this.capturedAt});
  final String path;
  final String mime;
  String? key; // object_key sau khi tải lên
  final double? lat, lon, accuracy;
  final String? capturedAt;
  bool get isVideo => mime.startsWith('video/');

  Map<String, dynamic> toJson() => {'path': path, 'mime': mime, 'key': key, 'lat': lat, 'lon': lon, 'accuracy': accuracy, 'captured_at': capturedAt};
  factory OutboxAttachment.fromJson(Map<String, dynamic> j) => OutboxAttachment(
        path: j['path'] as String,
        mime: j['mime'] as String,
        key: j['key'] as String?,
        lat: (j['lat'] as num?)?.toDouble(),
        lon: (j['lon'] as num?)?.toDouble(),
        accuracy: (j['accuracy'] as num?)?.toDouble(),
        capturedAt: j['captured_at'] as String?,
      );
}

enum OutboxStatus { pending, sending, done, conflict, failed }

class OutboxItem {
  OutboxItem({
    required this.clientUuid,
    required this.entity,
    required this.operation,
    required this.title,
    required this.payload,
    this.baseVersion,
    List<OutboxAttachment>? attachments,
    this.status = OutboxStatus.pending,
    this.message,
    this.serverId,
    this.conflictId,
    DateTime? createdAt,
    this.attempts = 0,
  })  : attachments = attachments ?? [],
        createdAt = createdAt ?? DateTime.now();

  final String clientUuid;
  final String entity; // report | survey | verification | assignment
  final String operation; // create | update | accept | start
  final String title;
  final Map<String, dynamic> payload;
  final int? baseVersion;
  final List<OutboxAttachment> attachments;
  OutboxStatus status;
  String? message;
  String? serverId;
  String? conflictId;
  final DateTime createdAt;
  int attempts;

  String get ownerKind => entity == 'verification' ? 'verification' : entity == 'survey' ? 'survey' : 'report';

  Map<String, dynamic> toJson() => {
        'client_uuid': clientUuid, 'entity': entity, 'operation': operation, 'title': title, 'payload': payload, 'base_version': baseVersion,
        'attachments': attachments.map((a) => a.toJson()).toList(), 'status': status.name, 'message': message, 'server_id': serverId,
        'conflict_id': conflictId, 'created_at': createdAt.toIso8601String(), 'attempts': attempts,
      };
  factory OutboxItem.fromJson(Map<String, dynamic> j) => OutboxItem(
        clientUuid: j['client_uuid'] as String,
        entity: j['entity'] as String,
        operation: j['operation'] as String,
        title: j['title'] as String? ?? '',
        payload: (j['payload'] as Map).cast<String, dynamic>(),
        baseVersion: j['base_version'] as int?,
        attachments: ((j['attachments'] as List?) ?? []).map((e) => OutboxAttachment.fromJson((e as Map).cast<String, dynamic>())).toList(),
        status: OutboxStatus.values.firstWhere((s) => s.name == j['status'], orElse: () => OutboxStatus.pending),
        message: j['message'] as String?,
        serverId: j['server_id'] as String?,
        conflictId: j['conflict_id'] as String?,
        createdAt: DateTime.tryParse(j['created_at'] as String? ?? ''),
        attempts: j['attempts'] as int? ?? 0,
      );
}

class OutboxState {
  const OutboxState({this.items = const [], this.syncing = false, this.online = true, this.lastSync, this.autoSync = true});
  final List<OutboxItem> items;
  final bool syncing;
  final bool online;
  final DateTime? lastSync;
  final bool autoSync;
  int get waiting => items.where((i) => i.status == OutboxStatus.pending || i.status == OutboxStatus.failed || i.status == OutboxStatus.sending).length;
  int get conflicts => items.where((i) => i.status == OutboxStatus.conflict).length;
  OutboxState copy({List<OutboxItem>? items, bool? syncing, bool? online, DateTime? lastSync, bool? autoSync}) =>
      OutboxState(items: items ?? this.items, syncing: syncing ?? this.syncing, online: online ?? this.online, lastSync: lastSync ?? this.lastSync, autoSync: autoSync ?? this.autoSync);
}

class Outbox extends Notifier<OutboxState> {
  static const _key = 'outbox_v1';
  StreamSubscription<List<ConnectivityResult>>? _net;

  @override
  OutboxState build() {
    final p = ref.read(prefsProvider);
    final raw = p.getString(_key);
    final items = <OutboxItem>[];
    if (raw != null) {
      try {
        for (final e in jsonDecode(raw) as List) {
          final it = OutboxItem.fromJson((e as Map).cast<String, dynamic>());
          if (it.status == OutboxStatus.sending) it.status = OutboxStatus.pending; // app closed while sending
          items.add(it);
        }
      } catch (_) {}
    }
    _net = Connectivity().onConnectivityChanged.listen((r) {
      final online = !r.contains(ConnectivityResult.none) || r.isEmpty;
      state = state.copy(online: online);
      if (online && state.autoSync) Future.delayed(const Duration(seconds: 2), sync);
    });
    ref.onDispose(() => _net?.cancel());
    return OutboxState(items: items, autoSync: p.getBool('auto_sync') ?? true, lastSync: DateTime.tryParse(p.getString('last_sync') ?? ''));
  }

  Future<void> _save() async => ref.read(prefsProvider).setString(_key, jsonEncode(state.items.map((i) => i.toJson()).toList()));
  void _emit() {
    state = state.copy(items: [...state.items]);
    _save();
  }

  Future<void> setAutoSync(bool v) async {
    await ref.read(prefsProvider).setBool('auto_sync', v);
    state = state.copy(autoSync: v);
  }

  /// Thêm bản ghi: tệp đính kèm được chép vào bộ nhớ ứng dụng ngay, để mất mạng hay tắt ứng dụng cũng không mất (TC11).
  Future<OutboxItem> add({
    required String entity,
    String operation = 'create',
    required String title,
    required Map<String, dynamic> payload,
    int? baseVersion,
    List<(XFile, Map<String, dynamic>)> files = const [],
    bool sendNow = true,
  }) async {
    final id = const Uuid().v4();
    final atts = <OutboxAttachment>[];
    for (final (f, meta) in files) {
      final path = await persistAttachment(f, '${id}_${atts.length}');
      atts.add(OutboxAttachment(
        path: path,
        mime: f.mimeType ?? _mimeOf(f.name),
        lat: (meta['lat'] as num?)?.toDouble(),
        lon: (meta['lon'] as num?)?.toDouble(),
        accuracy: (meta['accuracy'] as num?)?.toDouble(),
        capturedAt: DateTime.now().toUtc().toIso8601String(),
      ));
    }
    final item = OutboxItem(clientUuid: id, entity: entity, operation: operation, title: title, payload: {...payload, 'client_uuid': id}, baseVersion: baseVersion, attachments: atts);
    state = state.copy(items: [item, ...state.items]);
    await _save();
    if (sendNow) unawaited(sync());
    return item;
  }

  Future<void> remove(OutboxItem it) async {
    for (final a in it.attachments) {
      await deleteAttachment(a.path);
    }
    state = state.copy(items: state.items.where((x) => x.clientUuid != it.clientUuid).toList());
    await _save();
  }

  Future<void> clearDone() async {
    for (final it in state.items.where((i) => i.status == OutboxStatus.done).toList()) {
      await remove(it);
    }
  }

  /// Gửi các bản ghi chờ. Lỗi mạng: giữ nguyên để gửi lại; lỗi nghiệp vụ: đánh dấu, hiện thông báo.
  Future<SyncReport> sync() async {
    if (state.syncing) return SyncReport();
    final api = ref.read(apiProvider);
    final session = ref.read(sessionProvider);
    final queue = state.items.where((i) => i.status == OutboxStatus.pending || i.status == OutboxStatus.failed).toList().reversed.toList();
    if (queue.isEmpty) return SyncReport();
    state = state.copy(syncing: true);
    final report = SyncReport();
    try {
      final batch = <OutboxItem>[];
      for (final it in queue) {
        // nhóm theo thứ tự tạo; tệp đính kèm tải trước
        it.status = OutboxStatus.sending;
        it.attempts++;
        _emit();
        try {
          for (final a in it.attachments.where((a) => a.key == null)) {
            final bytes = await readAttachment(a.path);
            if (bytes == null) throw ApiException('Tệp đính kèm không còn trên máy', status: 0);
            a.key = await api.uploadBytes(bytes, a.mime, ownerKind: it.ownerKind, lat: a.lat, lon: a.lon, accuracy: a.accuracy, capturedAt: DateTime.tryParse(a.capturedAt ?? ''));
            _emit();
          }
          if (!session.signedIn) {
            // khách: gửi phản ánh trực tiếp (máy chủ chống trùng theo client_uuid)
            if (it.entity != 'report') throw ApiException('Cần đăng nhập để gửi loại dữ liệu này', status: 403);
            final r = await api.post<Map<String, dynamic>>('/api/mobile/reports', _payloadOf(it));
            _done(it, (r['report'] as Map)['code'] as String, r['duplicate'] == true ? 'Đã gửi trước đó' : null);
            report.applied++;
          } else {
            batch.add(it);
          }
        } on ApiException catch (e) {
          if (e.isNetwork) {
            it.status = OutboxStatus.pending;
            it.message = 'Chưa có mạng – sẽ gửi lại';
            report.offline = true;
          } else {
            it.status = OutboxStatus.failed;
            it.message = e.message;
            report.rejected++;
          }
          _emit();
          if (e.isNetwork) break;
        }
      }
      if (batch.isNotEmpty && !report.offline) {
        try {
          final r = await api.post<Map<String, dynamic>>('/api/mobile/sync/batch', {
            'device_id': ref.read(deviceIdProvider),
            'items': batch.map((it) => {'client_uuid': it.clientUuid, 'entity': it.entity, 'operation': it.operation, 'base_version': it.baseVersion, 'payload': _payloadOf(it)}).toList(),
          });
          for (final res in (r['results'] as List).cast<Map>()) {
            final it = batch.firstWhere((b) => b.clientUuid == res['client_uuid']);
            switch (res['result']) {
              case 'applied':
              case 'duplicate':
                final warn = (res['warnings'] as List?)?.join(' ');
                _done(it, res['server_id']?.toString(), res['result'] == 'duplicate' ? 'Đã đồng bộ trước đó' : (warn?.isNotEmpty == true ? warn : null));
                report.applied++;
              case 'conflict':
                it.status = OutboxStatus.conflict;
                it.message = res['message']?.toString() ?? 'Dữ liệu trên máy chủ đã thay đổi';
                report.conflicts++;
              default:
                it.status = OutboxStatus.failed;
                it.message = res['message']?.toString() ?? 'Máy chủ từ chối bản ghi';
                report.rejected++;
            }
          }
        } on ApiException catch (e) {
          for (final it in batch) {
            it.status = e.isNetwork ? OutboxStatus.pending : OutboxStatus.failed;
            it.message = e.isNetwork ? 'Chưa có mạng – sẽ gửi lại' : e.message;
          }
          if (e.isNetwork) report.offline = true;
        }
      }
    } finally {
      final now = DateTime.now();
      if (!report.offline) await ref.read(prefsProvider).setString('last_sync', now.toIso8601String());
      state = state.copy(syncing: false, lastSync: report.offline ? state.lastSync : now, items: [...state.items]);
      await _save();
    }
    return report;
  }

  Map<String, dynamic> _payloadOf(OutboxItem it) => {
        ...it.payload,
        if (it.attachments.isNotEmpty) 'attachments': it.attachments.where((a) => a.key != null).map((a) => a.key).toList(),
      };

  void _done(OutboxItem it, String? serverId, String? note) {
    it.status = OutboxStatus.done;
    it.serverId = serverId;
    it.message = note;
    for (final a in it.attachments) {
      deleteAttachment(a.path);
    }
    _emit();
  }

  /// Người dùng chọn cách xử lý xung đột (TC09) – gọi API máy chủ với id xung đột tương ứng.
  Future<void> resolve(OutboxItem it, String action) async {
    final api = ref.read(apiProvider);
    final list = await api.get<List>('/api/mobile/sync/conflicts');
    final c = list.cast<Map>().firstWhere((x) => x['client_uuid'] == it.clientUuid, orElse: () => {});
    if (c.isNotEmpty) await api.post('/api/mobile/sync/conflicts/${c['id']}/resolve', {'action': action});
    _done(it, it.serverId, action == 'keep_server' ? 'Đã giữ bản trên máy chủ' : 'Đã áp dụng thay đổi của bạn');
  }

  Future<void> retry(OutboxItem it) async {
    it.status = OutboxStatus.pending;
    it.message = null;
    _emit();
    await sync();
  }
}

class SyncReport {
  int applied = 0, conflicts = 0, rejected = 0;
  bool offline = false;
  String get summary => offline
      ? 'Chưa có mạng – dữ liệu được giữ trên máy và sẽ tự gửi khi có mạng.'
      : 'Đã gửi $applied bản ghi${conflicts > 0 ? ', $conflicts xung đột cần xử lý' : ''}${rejected > 0 ? ', $rejected bị từ chối' : ''}.';
}

final outboxProvider = NotifierProvider<Outbox, OutboxState>(Outbox.new);

String _mimeOf(String name) {
  final n = name.toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.heic')) return 'image/heic';
  if (n.endsWith('.mp4')) return 'video/mp4';
  if (n.endsWith('.mov')) return 'video/quicktime';
  return 'image/jpeg';
}
