import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/layout.dart';
import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';

/// Xem bằng chứng chi tiết của một bản ghi xác minh hiện trường.
Future<void> showVerificationDetailSheet(BuildContext context, WidgetRef ref, String id) async {
  try {
    final v = await ref.read(apiProvider).get<Map<String, dynamic>>('/api/mobile/verifications/$id');
    if (!context.mounted) return;
    final ev = (v['evidence'] as Map?) ?? {};
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => SafeDraggableSheet(
        expand: false,
        initialChildSize: .72,
        builder: (_, sc) => ListView(controller: sc, padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
          Text('${v['code']} – ${v['verdict_label'] ?? v['verdict']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.navy)),
          const SizedBox(height: 8),
          KV('Đối tượng', '${{'hotspot': 'Điểm nóng', 'candidate': 'Biến động', 'report': 'Phản ánh'}[v['alert_kind']] ?? v['alert_kind']} · ${v['alert_id']}'),
          KV('Người xác minh', '${v['verifier']} · ${fmtDateTime(v['verified_at'])}'),
          KV('Mô tả', ev['description']?.toString()),
          KV('Mùa', ev['season'] == 'dry' ? 'Mùa khô' : ev['season'] == 'wet' ? 'Mùa mưa' : null),
          KV('Loại rừng', v['forest_type']?.toString()),
          KV('Mức độ', v['severity']?.toString()),
          KV('DT cháy', v['burned_area_ha'] == null ? null : '${v['burned_area_ha']} ha'),
          if (ev['loss_evidence'] != null) KV('Bằng chứng mất rừng', ev['loss_evidence'].toString()),
          KV('Kiến nghị', v['recommendation']?.toString()),
          KV('Toạ độ', v['lat'] == null ? null : '${fmtCoord((v['lat'] as num).toDouble(), (v['lon'] as num).toDouble())} (±${v['gps_accuracy'] ?? '?'} m, ${ev['location_source'] ?? 'gps'})'),
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final a in ((v['attachments'] as List?) ?? []).cast<Map>())
              (a['mime'] as String).startsWith('image/')
                  ? ClipRRect(borderRadius: BorderRadius.circular(8), child: NetImage(a['url'] as String, width: 110, height: 110))
                  : Container(width: 110, height: 110, decoration: BoxDecoration(color: AppColors.navy, borderRadius: BorderRadius.circular(8)), child: const Icon(Icons.videocam, color: Colors.white)),
          ]),
        ]),
      ),
    );
  } on ApiException catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
  }
}

/// Duyệt hoặc trả lại một bản ghi xác minh hiện trường.
Future<bool> reviewVerificationDialog(BuildContext context, WidgetRef ref, String id, String decision) async {
  final note = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (_) => AlertDialog(
      title: Text(decision == 'approved' ? 'Duyệt kết quả xác minh' : 'Trả lại kết quả xác minh'),
      content: TextField(controller: note, maxLines: 3, decoration: InputDecoration(hintText: decision == 'rejected' ? 'Lý do trả lại (bắt buộc)' : 'Ý kiến phê duyệt (tuỳ chọn)')),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Huỷ')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Xác nhận'))],
    ),
  );
  if (ok != true) return false;
  if (decision == 'rejected' && note.text.trim().isEmpty) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cần ghi lý do trả lại cho cán bộ.')));
    return false;
  }
  try {
    await ref.read(apiProvider).post('/api/mobile/verifications/$id/review', {'decision': decision, 'note': note.text.trim()});
    ref.invalidate(pendingVerificationsProvider);
    ref.invalidate(assignmentsProvider);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(decision == 'approved' ? 'Đã duyệt – trạng thái cảnh báo được cập nhật.' : 'Đã trả lại cho cán bộ thực hiện lại.')));
    }
    return true;
  } on ApiException catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    return false;
  }
}

/// Xem chi tiết một bản ghi khảo sát hiện trạng.
Future<void> showSurveyDetailSheet(BuildContext context, WidgetRef ref, String id) async {
  try {
    final s = await ref.read(apiProvider).get<Map<String, dynamic>>('/api/mobile/surveys/$id');
    if (!context.mounted) return;
    const geomNames = {'point': 'Điểm', 'line': 'Đường', 'polygon': 'Vùng'};
    const leafNames = {'full': 'Đủ lá', 'partial': 'Rụng một phần', 'leafless': 'Rụng hết lá', 'unknown': 'Không xác định'};
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => SafeDraggableSheet(
        expand: false,
        initialChildSize: .72,
        builder: (_, sc) => ListView(controller: sc, padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
          Row(children: [
            Expanded(child: Text('${s['code']} – ${s['forest_type_label'] ?? s['forest_type'] ?? 'Khảo sát'}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.navy))),
            if (s['is_dipterocarp'] == true) const StatusChip('Rừng khộp', color: Color(0xFFB8860B), dense: true),
          ]),
          const SizedBox(height: 8),
          KV('Người khảo sát', '${s['surveyor']} · ${fmtDateTime(s['observed_at'])}'),
          KV('Hình học', geomNames[s['geom_type']] ?? s['geom_type']?.toString()),
          if (s['area_ha'] != null) KV('Diện tích vùng', fmtHa(s['area_ha'] as num?)),
          if (s['length_m'] != null) KV('Chiều dài tuyến', '${fmtNum(s['length_m'] as num?)} m'),
          KV('Mùa / tán lá', '${s['season'] == 'dry' ? 'Mùa khô' : 'Mùa mưa'} · ${leafNames[s['leaf_state']] ?? '—'}'),
          if (s['canopy_cover'] != null) KV('Độ che phủ tán', '${s['canopy_cover']}%'),
          if (s['change_cause'] != null) KV('Nguyên nhân biến động', s['change_cause'].toString()),
          KV('Sai số GPS', s['gps_accuracy'] == null ? null : '±${(s['gps_accuracy'] as num).round()} m (${s['location_source'] ?? 'gps'})'),
          KV('Ghi chú', s['notes']?.toString()),
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final a in ((s['attachments'] as List?) ?? []).cast<Map>())
              (a['mime'] as String).startsWith('image/')
                  ? ClipRRect(borderRadius: BorderRadius.circular(8), child: NetImage(a['url'] as String, width: 110, height: 110))
                  : Container(width: 110, height: 110, decoration: BoxDecoration(color: AppColors.navy, borderRadius: BorderRadius.circular(8)), child: const Icon(Icons.videocam, color: Colors.white)),
          ]),
        ]),
      ),
    );
  } on ApiException catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
  }
}

/// Duyệt hoặc từ chối một bản ghi khảo sát hiện trạng.
Future<bool> reviewSurveyDialog(BuildContext context, WidgetRef ref, String id, String decision) async {
  final note = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (_) => AlertDialog(
      title: Text(decision == 'approved' ? 'Chấp thuận khảo sát' : 'Từ chối / Trả lại khảo sát'),
      content: TextField(controller: note, maxLines: 3, decoration: InputDecoration(hintText: decision == 'rejected' ? 'Lý do trả lại (bắt buộc)' : 'Ý kiến duyệt (tuỳ chọn)')),
      actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Huỷ')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Xác nhận'))],
    ),
  );
  if (ok != true) return false;
  if (decision == 'rejected' && note.text.trim().isEmpty) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Cần ghi lý do từ chối/trả lại.')));
    return false;
  }
  try {
    await ref.read(apiProvider).post('/api/mobile/surveys/$id/review', {'decision': decision, 'note': note.text.trim()});
    ref.invalidate(pendingSurveysProvider);
    ref.invalidate(mySurveysProvider);
    ref.invalidate(assignmentsProvider);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(decision == 'approved' ? 'Đã chấp thuận khảo sát hiện trạng.' : 'Đã trả lại khảo sát cho cán bộ.')));
    }
    return true;
  } on ApiException catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    return false;
  }
}

/// Quy trình 6.2 & 6.3 – Người có thẩm quyền duyệt kết quả xác minh & khảo sát hiện trạng (không tự duyệt của mình).
class ReviewPage extends ConsumerWidget {
  const ReviewPage({super.key, this.initialTab = 0});
  final int initialTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ver = ref.watch(pendingVerificationsProvider);
    final surv = ref.watch(pendingSurveysProvider);
    final me = ref.watch(sessionProvider).user;
    final forestTypes = ((ref.watch(sessionProvider).catalogs['forest_types'] as Map?) ?? {}).cast<String, dynamic>();
    final vCount = ((ver.asData?.value['items'] as List?) ?? []).length;
    final sCount = ((surv.asData?.value['items'] as List?) ?? []).length;

    return DefaultTabController(
      length: 2,
      initialIndex: initialTab.clamp(0, 1),
      child: ResponsiveScaffold(
        maxWidth: 760,
        appBar: AppBar(
          title: const Text('Duyệt kết quả hiện trường'),
          actions: [
            IconButton(
              tooltip: 'Tải lại',
              icon: const Icon(Icons.refresh),
              onPressed: () {
                ref.invalidate(pendingVerificationsProvider);
                ref.invalidate(pendingSurveysProvider);
              },
            ),
          ],
          bottom: TabBar(tabs: [
            Tab(text: 'Xác minh${vCount > 0 ? ' ($vCount)' : ''}'),
            Tab(text: 'Khảo sát${sCount > 0 ? ' ($sCount)' : ''}'),
          ]),
        ),
        body: TabBarView(children: [
          AsyncView(
            value: ver,
            onRetry: () => ref.invalidate(pendingVerificationsProvider),
            builder: (J d) {
              final items = ((d['items'] as List?) ?? []).cast<Map>();
              if (items.isEmpty) return const EmptyView('Không có kết quả xác minh chờ duyệt', icon: Icons.task_alt);
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(pendingVerificationsProvider),
                child: ListView(padding: const EdgeInsets.all(14), children: [
                  for (final x in items)
                    Card(
                      margin: const EdgeInsets.only(bottom: 10),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(x['code'].toString(), style: const TextStyle(fontWeight: FontWeight.w900, color: AppColors.navy)),
                            const SizedBox(width: 6),
                            Expanded(child: Text(x['verdict_label']?.toString() ?? x['verdict'].toString(), style: const TextStyle(fontWeight: FontWeight.w700))),
                          ]),
                          const SizedBox(height: 4),
                          Text('${{'hotspot': 'Điểm nóng', 'candidate': 'Biến động', 'report': 'Phản ánh'}[x['alert_kind']]} · ${x['alert_id']}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                          Text('${x['verifier']} · ${fmtDateTime(x['verified_at'])}${x['severity'] != null ? ' · mức độ ${x['severity']}' : ''}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 8, runSpacing: 6, alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, children: [
                            TextButton.icon(onPressed: () => showVerificationDetailSheet(context, ref, x['id'] as String), icon: const Icon(Icons.photo_library_outlined, size: 18), label: const Text('Xem bằng chứng')),
                            if (x['verifier'] != me?.username)
                              Row(mainAxisSize: MainAxisSize.min, children: [
                                OutlinedButton(onPressed: () => reviewVerificationDialog(context, ref, x['id'] as String, 'rejected'), child: const Text('Trả lại')),
                                const SizedBox(width: 8),
                                FilledButton(onPressed: () => reviewVerificationDialog(context, ref, x['id'] as String, 'approved'), child: const Text('Duyệt')),
                              ])
                            else
                              const Text('Kết quả của bạn', style: TextStyle(fontSize: 12, color: AppColors.muted)),
                          ]),
                        ]),
                      ),
                    ),
                ]),
              );
            },
          ),
          AsyncView(
            value: surv,
            onRetry: () => ref.invalidate(pendingSurveysProvider),
            builder: (J d) {
              final items = ((d['items'] as List?) ?? []).cast<Map>();
              if (items.isEmpty) return const EmptyView('Không có khảo sát hiện trạng chờ duyệt', icon: Icons.task_alt);
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(pendingSurveysProvider),
                child: ListView(padding: const EdgeInsets.all(14), children: [
                  for (final s in items)
                    Card(
                      margin: const EdgeInsets.only(bottom: 10),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Text(s['code'].toString(), style: const TextStyle(fontWeight: FontWeight.w900, color: AppColors.navy)),
                            const SizedBox(width: 6),
                            Expanded(child: Text((forestTypes[s['forest_type']] ?? s['forest_type'] ?? 'Khảo sát hiện trạng').toString(), style: const TextStyle(fontWeight: FontWeight.w700))),
                            if (s['is_dipterocarp'] == true) const StatusChip('Rừng khộp', color: Color(0xFFB8860B), dense: true),
                          ]),
                          const SizedBox(height: 4),
                          Text(
                            [
                              {'point': 'Điểm', 'line': 'Đường', 'polygon': 'Vùng'}[s['geom_type']] ?? s['geom_type'],
                              if (s['area_ha'] != null) fmtHa(s['area_ha'] as num?),
                              if (s['length_m'] != null) '${fmtNum(s['length_m'] as num?)} m',
                              s['season'] == 'dry' ? 'Mùa khô' : 'Mùa mưa',
                            ].join(' · '),
                            style: const TextStyle(fontSize: 12, color: AppColors.muted),
                          ),
                          Text('${s['surveyor']} · ${fmtDateTime(s['observed_at'])}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 8, runSpacing: 6, alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, children: [
                            TextButton.icon(onPressed: () => showSurveyDetailSheet(context, ref, s['id'] as String), icon: const Icon(Icons.visibility_outlined, size: 18), label: const Text('Xem chi tiết')),
                            if (s['surveyor'] != me?.username)
                              Row(mainAxisSize: MainAxisSize.min, children: [
                                OutlinedButton(onPressed: () => reviewSurveyDialog(context, ref, s['id'] as String, 'rejected'), child: const Text('Từ chối')),
                                const SizedBox(width: 8),
                                FilledButton(onPressed: () => reviewSurveyDialog(context, ref, s['id'] as String, 'approved'), child: const Text('Chấp thuận')),
                              ])
                            else
                              const Text('Khảo sát của bạn', style: TextStyle(fontSize: 12, color: AppColors.muted)),
                          ]),
                        ]),
                      ),
                    ),
                ]),
              );
            },
          ),
        ]),
      ),
    );
  }
}
