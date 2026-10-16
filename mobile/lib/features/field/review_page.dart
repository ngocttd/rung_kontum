import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';

/// Quy trình 6.2 – người có thẩm quyền duyệt kết quả xác minh (không tự duyệt kết quả của mình).
class ReviewPage extends ConsumerWidget {
  const ReviewPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final v = ref.watch(pendingVerificationsProvider);
    final me = ref.watch(sessionProvider).user;
    return Scaffold(
      appBar: AppBar(title: const Text('Duyệt kết quả xác minh')),
      body: AsyncView(
        value: v,
        onRetry: () => ref.invalidate(pendingVerificationsProvider),
        builder: (J d) {
          final items = ((d['items'] as List?) ?? []).cast<Map>();
          if (items.isEmpty) return const EmptyView('Không có kết quả chờ duyệt', icon: Icons.task_alt);
          return ListView(padding: const EdgeInsets.all(14), children: [
            for (final x in items)
              Card(
                margin: const EdgeInsets.only(bottom: 10),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Text(x['code'].toString(), style: const TextStyle(fontWeight: FontWeight.w900)),
                      const SizedBox(width: 6),
                      Expanded(child: Text(x['verdict_label']?.toString() ?? x['verdict'].toString(), style: const TextStyle(fontWeight: FontWeight.w700))),
                    ]),
                    const SizedBox(height: 4),
                    Text('${{'hotspot': 'Điểm nóng', 'candidate': 'Biến động', 'report': 'Phản ánh'}[x['alert_kind']]} · ${x['alert_id']}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                    Text('${x['verifier']} · ${fmtDateTime(x['verified_at'])}${x['severity'] != null ? ' · mức độ ${x['severity']}' : ''}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                    const SizedBox(height: 8),
                    Row(children: [
                      TextButton(onPressed: () => _detail(context, ref, x['id'] as String), child: const Text('Xem bằng chứng')),
                      const Spacer(),
                      if (x['verifier'] != me?.username) ...[
                        OutlinedButton(onPressed: () => _review(context, ref, x['id'] as String, 'rejected'), child: const Text('Trả lại')),
                        const SizedBox(width: 8),
                        FilledButton(onPressed: () => _review(context, ref, x['id'] as String, 'approved'), child: const Text('Duyệt')),
                      ] else
                        const Text('Kết quả của bạn', style: TextStyle(fontSize: 12, color: AppColors.muted)),
                    ]),
                  ]),
                ),
              ),
          ]);
        },
      ),
    );
  }

  Future<void> _review(BuildContext context, WidgetRef ref, String id, String decision) async {
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(decision == 'approved' ? 'Duyệt kết quả' : 'Trả lại kết quả'),
        content: TextField(controller: note, maxLines: 3, decoration: const InputDecoration(hintText: 'Ý kiến (bắt buộc khi trả lại)')),
        actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Huỷ')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Xác nhận'))],
      ),
    );
    if (ok != true) return;
    if (decision == 'rejected' && note.text.trim().isEmpty) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cần ghi lý do trả lại.')));
      return;
    }
    try {
      await ref.read(apiProvider).post('/api/mobile/verifications/$id/review', {'decision': decision, 'note': note.text.trim()});
      ref.invalidate(pendingVerificationsProvider);
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(decision == 'approved' ? 'Đã duyệt – trạng thái cảnh báo được cập nhật.' : 'Đã trả lại cho cán bộ.')));
    } on ApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _detail(BuildContext context, WidgetRef ref, String id) async {
    try {
      final v = await ref.read(apiProvider).get<Map<String, dynamic>>('/api/mobile/verifications/$id');
      if (!context.mounted) return;
      final ev = (v['evidence'] as Map?) ?? {};
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        showDragHandle: true,
        builder: (_) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: .7,
          builder: (_, sc) => ListView(controller: sc, padding: const EdgeInsets.fromLTRB(16, 0, 16, 20), children: [
            Text('${v['code']} – ${v['verdict_label']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            KV('Mô tả', ev['description']?.toString()),
            KV('Mùa', ev['season'] == 'dry' ? 'Mùa khô' : ev['season'] == 'wet' ? 'Mùa mưa' : null),
            KV('Loại rừng', v['forest_type']?.toString()),
            KV('DT cháy', v['burned_area_ha'] == null ? null : '${v['burned_area_ha']} ha'),
            KV('Kiến nghị', v['recommendation']?.toString()),
            KV('Toạ độ', v['lat'] == null ? null : '${fmtCoord((v['lat'] as num).toDouble(), (v['lon'] as num).toDouble())} (±${v['gps_accuracy'] ?? '?'} m, ${ev['location_source']})'),
            const SizedBox(height: 8),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final a in ((v['attachments'] as List?) ?? []).cast<Map>())
                (a['mime'] as String).startsWith('image/')
                    ? ClipRRect(borderRadius: BorderRadius.circular(8), child: NetImage(a['url'] as String, width: 110, height: 110))
                    : Container(width: 110, height: 110, color: AppColors.navy, child: const Icon(Icons.videocam, color: Colors.white)),
            ]),
          ]),
        ),
      );
    } on ApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}
