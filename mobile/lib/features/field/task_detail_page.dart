import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/outbox.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/items.dart';
import '../map/map_page.dart';
import 'verification_page.dart';

/// M15 – Chi tiết nhiệm vụ: đối tượng cần xác minh, vị trí, hạn; nhận / bắt đầu; mở biểu mẫu xác minh / khảo sát.
/// Máy chủ từ chối nếu nhiệm vụ ngoài địa bàn hoặc không được giao (TC05).
class TaskDetailPage extends ConsumerWidget {
  const TaskDetailPage({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final v = ref.watch(assignmentProvider(id));
    final u = ref.watch(sessionProvider).user;
    return Scaffold(
      appBar: AppBar(title: const Text('Chi tiết nhiệm vụ'), actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(assignmentProvider(id)))]),
      body: AsyncView(
        value: v,
        onRetry: () => ref.invalidate(assignmentProvider(id)),
        builder: (Loaded<J> l) {
          final a = l.data;
          final status = a['status'] as String;
          final pt = a['lat'] == null ? null : LatLng((a['lat'] as num).toDouble(), (a['lon'] as num).toDouble());
          final target = a['target'] as Map?;
          final vers = ((a['verifications'] as List?) ?? []).cast<Map>();
          final mine = u != null && (a['assignee_id'] == u.id || a['assignee_id'] == null);
          final canAct = u?.can('field.survey') == true && mine;
          final hist = ((a['history'] as List?) ?? []).cast<Map>();
          return ListView(padding: const EdgeInsets.all(14), children: [
            Row(children: [
              Text(a['code'].toString(), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: AppColors.navy)),
              const SizedBox(width: 8),
              StatusChip(a['statusLabel']?.toString() ?? status, color: StatusChip.toneOf(status)),
            ]),
            const SizedBox(height: 4),
            Text(a['title'].toString(), style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            SectionCard(child: Column(children: [
              KV('Loại', TaskTile.kinds[a['kind']]),
              KV('Địa bàn', ref.read(sessionProvider).communeName(a['scope_id'] as String?)),
              KV('Người thực hiện', a['assignee_name']?.toString() ?? a['assignee']?.toString() ?? 'Cán bộ địa bàn nhận'),
              KV('Người giao', a['created_by']?.toString()),
              KV('Hạn', a['due_at'] == null ? 'Không đặt hạn' : fmtDateTime(a['due_at']), valueWidget: a['overdue'] == true ? Text('${fmtDateTime(a['due_at'])} – quá hạn', style: const TextStyle(color: AppColors.fire, fontWeight: FontWeight.w700)) : null),
              if (a['instructions'] != null) KV('Hướng dẫn', a['instructions'].toString()),
            ])),
            if (pt != null) ...[
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(
                  height: 180,
                  child: FlutterMap(
                    options: MapOptions(initialCenter: pt, initialZoom: 14, interactionOptions: const InteractionOptions(flags: InteractiveFlag.none)),
                    children: [
                      TileLayer(urlTemplate: (((ref.read(sessionProvider).map['basemaps'] as List?) ?? []).cast<Map>().firstOrNull?['url'] ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png') as String, userAgentPackageName: 'vn.gov.kontum.mobilegis'),
                      MarkerLayer(markers: [Marker(point: pt, width: 34, height: 40, alignment: Alignment.topCenter, child: Image.asset('assets/markers/survey.png'))]),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Row(children: [
                Expanded(child: OutlinedButton.icon(icon: const Icon(Icons.directions), label: const Text('Chỉ đường'), onPressed: () => launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${pt.latitude},${pt.longitude}'), mode: LaunchMode.externalApplication))),
                const SizedBox(width: 8),
                Expanded(child: OutlinedButton.icon(icon: const Icon(Icons.map_outlined), label: const Text('Mở bản đồ'), onPressed: () => context.go('/map', extra: MapFocus(pt, zoom: 15)))),
              ]),
            ],
            if (target != null) ...[
              const SizedBox(height: 10),
              SectionCard(
                title: 'Đối tượng cần xác minh',
                child: Column(children: [
                  if (a['kind'] == 'hotspot') ...[
                    KV('Thời gian phát hiện', fmtDateTime(target['utc'])),
                    KV('Vệ tinh', target['sensorLabel']?.toString()),
                    KV('Độ tin cậy / FRP', '${target['confidence']} · ${target['frp'] ?? '—'} MW'),
                    KV('Trạng thái hiện tại', target['statusLabel']?.toString()),
                  ],
                  if (a['kind'] == 'candidate') ...[
                    KV('Diện tích', fmtHa(target['area_ha'] as num?)),
                    KV('ΔNDVI / ΔNBR', '${target['mean_dndvi']} / ${target['mean_dnbr']}'),
                    KV('Kỳ so sánh', target['window']?.toString()),
                    if (target['seasonal_leaf_fall_possible'] == true) const KV('Lưu ý', 'Có thể là rụng lá mùa khô – kiểm tra kỹ loại rừng'),
                  ],
                  if (a['kind'] == 'report') ...[
                    KV('Loại', target['typeLabel']?.toString()),
                    KV('Nội dung', target['description']?.toString()),
                    KV('Gửi lúc', fmtDateTime(target['created_at'])),
                  ],
                ]),
              ),
            ],
            if (vers.isNotEmpty) ...[
              const SizedBox(height: 10),
              SectionCard(
                title: 'Kết quả đã nộp',
                child: Column(children: [
                  for (final x in vers)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text('${x['code']} · ${x['verdict']}', style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text('${x['verifier']} · ${fmtDateTime(x['verified_at'])}'),
                      trailing: StatusChip({'pending': 'Chờ duyệt', 'approved': 'Đã duyệt', 'rejected': 'Trả lại'}[x['review_status']] ?? '', color: StatusChip.toneOf(x['review_status'] as String?), dense: true),
                    ),
                ]),
              ),
            ],
            const SizedBox(height: 14),
            if (canAct && status == 'assigned') FilledButton.icon(onPressed: () => _act(context, ref, a, 'accept'), icon: const Icon(Icons.how_to_reg), label: const Text('Nhận nhiệm vụ')),
            if (canAct && ['accepted', 'returned'].contains(status)) FilledButton.icon(onPressed: () => _act(context, ref, a, 'start'), icon: const Icon(Icons.play_arrow), label: const Text('Bắt đầu thực hiện')),
            if (canAct && ['accepted', 'in_progress', 'returned'].contains(status)) ...[
              const SizedBox(height: 8),
              if (a['kind'] != 'survey')
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: AppColors.orange),
                  onPressed: () => context.push('/verify', extra: VerifyArgs(kind: a['kind'] as String, alertId: a['ref_id'].toString(), title: a['title'].toString(), point: pt, assignmentId: a['id'] as String)),
                  icon: const Icon(Icons.fact_check_outlined),
                  label: const Text('Nộp kết quả xác minh'),
                ),
              const SizedBox(height: 8),
              OutlinedButton.icon(onPressed: () => context.push('/survey', extra: a), icon: const Icon(Icons.edit_location_alt_outlined), label: Text(a['kind'] == 'survey' ? 'Nộp khảo sát hiện trạng' : 'Bổ sung khảo sát hiện trạng')),
            ],
            if (hist.isNotEmpty) ...[
              const SizedBox(height: 14),
              const Text('Lịch sử', style: TextStyle(fontWeight: FontWeight.w800)),
              for (final h in hist.reversed) Padding(padding: const EdgeInsets.only(top: 4), child: Text('${fmtDateTime(h['at'])} · ${h['by']} · ${h['status'] ?? h['note'] ?? ''}', style: const TextStyle(fontSize: 12, color: AppColors.muted))),
            ],
          ]);
        },
      ),
    );
  }

  /// Nhận / bắt đầu đi qua hàng đợi đồng bộ (kèm base_version) để dùng được khi mất mạng; máy chủ phát hiện xung đột.
  Future<void> _act(BuildContext context, WidgetRef ref, J a, String op) async {
    await ref.read(outboxProvider.notifier).add(entity: 'assignment', operation: op, title: '${op == 'accept' ? 'Nhận' : 'Bắt đầu'} nhiệm vụ ${a['code']}', payload: {'id': a['id']}, baseVersion: a['version'] as int?, sendNow: false);
    final r = await ref.read(outboxProvider.notifier).sync();
    ref.invalidate(assignmentProvider(id));
    ref.invalidate(assignmentsProvider);
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r.conflicts > 0 ? 'Nhiệm vụ đã thay đổi trên máy chủ – xem mục Đồng bộ để xử lý.' : r.summary)));
  }
}

