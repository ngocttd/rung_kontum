import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/format.dart';
import '../../core/outbox.dart';
import '../../widgets/common.dart';

/// M17 – Đồng bộ ngoại tuyến: hàng đợi, trạng thái từng bản ghi, gửi lại, xử lý xung đột (không ghi đè âm thầm).
class SyncPage extends ConsumerWidget {
  const SyncPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final o = ref.watch(outboxProvider);
    final n = ref.read(outboxProvider.notifier);
    return Scaffold(
      appBar: AppBar(title: const Text('Đồng bộ ngoại tuyến'), actions: [
        if (o.items.any((i) => i.status == OutboxStatus.done)) TextButton(onPressed: n.clearDone, child: const Text('Xoá đã gửi')),
      ]),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        Card(
          color: o.online ? AppColors.forestLight : const Color(0xFFFFF4E5),
          child: ListTile(
            leading: Icon(o.online ? Icons.cloud_done_outlined : Icons.cloud_off_outlined, color: o.online ? AppColors.forest : AppColors.orange, size: 32),
            title: Text(o.online ? 'Đang có mạng' : 'Đang ngoại tuyến', style: const TextStyle(fontWeight: FontWeight.w800)),
            subtitle: Text('${o.waiting} chờ gửi · ${o.conflicts} xung đột\nLần đồng bộ gần nhất: ${o.lastSync == null ? '—' : fmtDateTime(o.lastSync!.toUtc().toIso8601String())}'),
            isThreeLine: true,
          ),
        ),
        const SizedBox(height: 10),
        FilledButton.icon(
          onPressed: o.syncing
              ? null
              : () async {
                  final r = await n.sync();
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r.summary)));
                },
          icon: o.syncing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.sync),
          label: Text(o.syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'),
        ),
        const SizedBox(height: 6),
        const SourceNote('Mỗi bản ghi có mã duy nhất (client_uuid): gửi lại nhiều lần không tạo hồ sơ trùng. Khi dữ liệu trên máy chủ đã thay đổi, hệ thống không tự ghi đè – bạn chọn cách xử lý.'),
        const SizedBox(height: 10),
        if (o.items.isEmpty) const EmptyView('Không có bản ghi nào trong hàng đợi', icon: Icons.cloud_done_outlined),
        for (final it in o.items) _ItemCard(it),
      ]),
    );
  }
}

class _ItemCard extends ConsumerWidget {
  const _ItemCard(this.it);
  final OutboxItem it;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final n = ref.read(outboxProvider.notifier);
    final (label, color) = switch (it.status) {
      OutboxStatus.pending => ('Chờ gửi', AppColors.orange),
      OutboxStatus.sending => ('Đang gửi', AppColors.blue),
      OutboxStatus.done => ('Đã gửi', AppColors.forest),
      OutboxStatus.conflict => ('Xung đột', AppColors.purple),
      OutboxStatus.failed => ('Bị từ chối / lỗi', AppColors.fire),
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(it.title, style: const TextStyle(fontWeight: FontWeight.w700))),
            StatusChip(label, color: color, dense: true),
          ]),
          const SizedBox(height: 4),
          Text('Tạo lúc ${fmtDateTime(it.createdAt.toUtc().toIso8601String())} · ${it.attachments.length} tệp · lần gửi: ${it.attempts}${it.serverId != null ? ' · mã: ${it.serverId}' : ''}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          if (it.message != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(it.message!, style: TextStyle(fontSize: 12.5, color: it.status == OutboxStatus.done ? AppColors.forest : AppColors.fire))),
          if (it.status == OutboxStatus.conflict) ...[
            const SizedBox(height: 8),
            const NoticeBox('Dữ liệu trên máy chủ đã được người khác thay đổi sau khi bạn tải về. Chọn giữ bản trên máy chủ, hoặc áp dụng thay đổi của bạn lên phiên bản mới nhất.', warn: true),
            const SizedBox(height: 6),
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: () => _resolve(context, n, 'keep_server'), child: const Text('Giữ bản máy chủ'))),
              const SizedBox(width: 8),
              Expanded(child: FilledButton(onPressed: () => _resolve(context, n, 'apply_mine'), child: const Text('Áp dụng của tôi'))),
            ]),
          ],
          if (it.status == OutboxStatus.failed || it.status == OutboxStatus.pending)
            Row(mainAxisAlignment: MainAxisAlignment.end, children: [
              TextButton.icon(
                onPressed: () async {
                  final ok = await showDialog<bool>(context: context, builder: (_) => AlertDialog(title: const Text('Xoá bản ghi chưa gửi?'), content: const Text('Bản ghi và tệp đính kèm trên máy sẽ bị xoá.'), actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Huỷ')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Xoá'))]));
                  if (ok == true) await n.remove(it);
                },
                icon: const Icon(Icons.delete_outline),
                label: const Text('Xoá'),
              ),
              TextButton.icon(onPressed: () => n.retry(it), icon: const Icon(Icons.refresh), label: const Text('Gửi lại')),
            ]),
        ]),
      ),
    );
  }

  Future<void> _resolve(BuildContext context, Outbox n, String action) async {
    try {
      await n.resolve(it, action);
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }
}
