import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/outbox.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/items.dart';

/// Lịch sử phản ánh: hồ sơ của tôi (đã đăng nhập), bản ghi chờ gửi trên máy, tra cứu theo mã hồ sơ.
class MyReportsPage extends StatelessWidget {
  const MyReportsPage({super.key, this.code});
  final String? code;
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Phản ánh của tôi')), body: MyReportsBody(code: code));
}

class MyReportsBody extends ConsumerStatefulWidget {
  const MyReportsBody({super.key, this.code});
  final String? code;
  @override
  ConsumerState<MyReportsBody> createState() => _MyReportsBodyState();
}

class _MyReportsBodyState extends ConsumerState<MyReportsBody> {
  late final lookup = TextEditingController(text: widget.code ?? '');

  @override
  void initState() {
    super.initState();
    if (widget.code != null) WidgetsBinding.instance.addPostFrameCallback((_) => _find());
  }

  Future<void> _find() async {
    final c = lookup.text.trim().toUpperCase();
    if (c.isEmpty) return;
    try {
      final r = await ref.read(apiProvider).get<Map<String, dynamic>>('/api/mobile/reports/$c');
      if (mounted) _detail(r);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  void _detail(Map<String, dynamic> r) => showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: .65,
          builder: (_, sc) => ListView(controller: sc, padding: const EdgeInsets.fromLTRB(16, 0, 16, 20), children: [
            Text('${r['code']} · ${r['typeLabel'] ?? ''}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            StatusChip(r['statusLabel']?.toString() ?? '', color: StatusChip.toneOf(r['status'] as String?)),
            const SizedBox(height: 10),
            KV('Địa bàn', r['commune_name']?.toString()),
            KV('Gửi lúc', fmtDateTime(r['created_at'])),
            KV('Nội dung', r['description']?.toString()),
            if (r['response'] != null) KV('Phản hồi của cơ quan', r['response']?.toString()),
            if ((r['photos'] as List?)?.isNotEmpty == true) ...[
              const SizedBox(height: 8),
              SizedBox(height: 96, child: ListView(scrollDirection: Axis.horizontal, children: [for (final p in (r['photos'] as List)) Padding(padding: const EdgeInsets.only(right: 6), child: ClipRRect(borderRadius: BorderRadius.circular(8), child: NetImage(p as String, width: 96, height: 96)))])),
            ],
            const SizedBox(height: 12),
            const Text('Tiến độ xử lý', style: TextStyle(fontWeight: FontWeight.w800)),
            for (final t in ((r['timeline'] as List?) ?? []).cast<Map>())
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: Icon(Icons.circle, size: 12, color: StatusChip.toneOf(t['status'] as String?)),
                title: Text(t['label']?.toString() ?? t['status'].toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text('${fmtDateTime(t['at'])}${t['note'] != null ? '\n${t['note']}' : ''}'),
              ),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final queued = ref.watch(outboxProvider.select((o) => o.items.where((i) => i.entity == 'report' && i.status != OutboxStatus.done).toList()));
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(myReportsProvider),
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          Expanded(child: TextField(controller: lookup, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(hintText: 'Tra cứu mã hồ sơ (PA-2026-0001)', isDense: true), onSubmitted: (_) => _find())),
          const SizedBox(width: 8),
          FilledButton(onPressed: _find, child: const Text('Tra cứu')),
        ]),
        if (queued.isNotEmpty) ...[
          const SizedBox(height: 14),
          SectionCard(
            title: 'Chờ gửi trên máy (${queued.length})',
            icon: Icons.cloud_queue,
            trailing: TextButton(onPressed: () => context.push('/sync'), child: const Text('Đồng bộ')),
            child: Column(children: [
              for (final q in queued)
                ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text(q.title), subtitle: Text(q.message ?? 'Chưa gửi'), trailing: StatusChip(q.status == OutboxStatus.failed ? 'Lỗi' : 'Chưa gửi', color: q.status == OutboxStatus.failed ? AppColors.fire : AppColors.orange, dense: true)),
            ]),
          ),
        ],
        const SizedBox(height: 14),
        if (!s.signedIn)
          const NoticeBox('Đăng nhập (tài khoản người dân) để xem toàn bộ phản ánh đã gửi. Khách có thể tra cứu bằng mã hồ sơ.')
        else
          AsyncView(
            value: ref.watch(myReportsProvider),
            onRetry: () => ref.invalidate(myReportsProvider),
            builder: (Loaded<J> l) {
              final items = ((l.data['items'] as List?) ?? []).cast<Map>();
              if (items.isEmpty) return const EmptyView('Bạn chưa gửi phản ánh nào');
              return Card(child: Column(children: [for (final r in items) ReportTile(r.cast<String, dynamic>(), onTap: () => _detail(r.cast<String, dynamic>()))]));
            },
          ),
      ]),
    );
  }
}
