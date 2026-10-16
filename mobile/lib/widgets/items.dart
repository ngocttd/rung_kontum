import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../app/theme.dart';
import '../core/data.dart' show J;
import '../core/format.dart';
import '../features/map/object_page.dart';
import 'common.dart';

/// Một mục cảnh báo: phân biệt dự báo tự động / điểm nóng chưa xác minh / sự kiện đã xác minh – phê duyệt.
class AlertTile extends StatelessWidget {
  const AlertTile(this.a, {super.key});
  final J a;
  @override
  Widget build(BuildContext context) {
    final type = a['type'];
    final official = a['official'] == true;
    final color = type == 'fire_danger' ? AppColors.dangerOf(a['level'] as num?) : type == 'hotspot' ? AppColors.fire : AppColors.orange;
    final tag = type == 'fire_danger'
        ? (official ? 'Cảnh báo đã phê duyệt' : 'Dự báo tự động')
        : type == 'hotspot'
            ? (a['verification_label'] ?? (official ? 'Đã xác nhận cháy' : 'Điểm nóng vệ tinh'))
            : 'Biến động nghi vấn';
    return InkWell(
      onTap: () {
        if (a['lat'] != null && a['lon'] != null) {
          context.push('/object', extra: ObjectRef(kind: type == 'hotspot' ? 'hotspot' : 'alert', id: a['id'].toString(), props: a, point: LatLng((a['lat'] as num).toDouble(), (a['lon'] as num).toDouble())));
        } else {
          context.go('/fire');
        }
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(10)),
            child: Icon(type == 'forest_change' ? Icons.park_outlined : Icons.local_fire_department, color: color),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(a['title']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
              const SizedBox(height: 2),
              Text(a['detail']?.toString() ?? '', style: const TextStyle(fontSize: 12, color: AppColors.muted), maxLines: 2, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 4),
              Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                StatusChip(tag.toString(), color: official ? AppColors.forest : color, dense: true),
                Text(fmtAgo(a['time']), style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

class NewsTile extends StatelessWidget {
  const NewsTile(this.n, {super.key});
  final J n;
  @override
  Widget build(BuildContext context) => InkWell(
        onTap: () => context.push('/news/${n['slug']}'),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 7),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ClipRRect(borderRadius: BorderRadius.circular(8), child: NetImage(n['image'] as String?, width: 92, height: 66, fallback: 'assets/images/forest-patrol-small.webp')),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(n['title']?.toString() ?? '', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, height: 1.25)),
                const SizedBox(height: 4),
                Row(children: [
                  const Icon(Icons.schedule, size: 13, color: AppColors.muted),
                  const SizedBox(width: 3),
                  Text(fmtDate(n['published_at']), style: const TextStyle(fontSize: 11.5, color: AppColors.muted)),
                  if (n['status'] != null && n['status'] != 'published') ...[const SizedBox(width: 6), const StatusChip('Chờ duyệt', color: AppColors.orange, dense: true)],
                ]),
              ]),
            ),
          ]),
        ),
      );
}

class ReportTile extends StatelessWidget {
  const ReportTile(this.r, {super.key, this.onTap});
  final J r;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 4),
        leading: CircleAvatar(backgroundColor: AppColors.forestLight, child: Icon(Icons.campaign_outlined, color: StatusChip.toneOf(r['status'] as String?))),
        title: Text('${r['code']} · ${r['typeLabel'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
        subtitle: Text('${r['commune_name'] ?? ''} · ${fmtDateTime(r['created_at'])}', style: const TextStyle(fontSize: 12)),
        trailing: StatusChip(r['statusLabel']?.toString() ?? '', color: StatusChip.toneOf(r['status'] as String?), dense: true),
      );
}

class TaskTile extends StatelessWidget {
  const TaskTile(this.t, {super.key});
  final J t;
  static const kinds = {'hotspot': 'Xác minh điểm nóng', 'candidate': 'Xác minh biến động', 'report': 'Xác minh phản ánh', 'survey': 'Khảo sát hiện trạng'};
  static const icons = {'hotspot': Icons.local_fire_department, 'candidate': Icons.park_outlined, 'report': Icons.campaign_outlined, 'survey': Icons.edit_location_alt_outlined};
  @override
  Widget build(BuildContext context) {
    final status = t['status'] as String?;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => context.push('/tasks/${t['id']}'),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icons[t['kind']] ?? Icons.assignment, color: t['kind'] == 'hotspot' ? AppColors.fire : AppColors.forest, size: 30),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Text(t['code']?.toString() ?? '', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.navy)),
                  const SizedBox(width: 6),
                  Expanded(child: Text(kinds[t['kind']] ?? '', style: const TextStyle(fontSize: 12, color: AppColors.muted), overflow: TextOverflow.ellipsis)),
                ]),
                const SizedBox(height: 3),
                Text(t['title']?.toString() ?? '', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                const SizedBox(height: 5),
                Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  StatusChip(t['statusLabel']?.toString() ?? status ?? '', color: StatusChip.toneOf(status), dense: true),
                  if (t['due_at'] != null) Text('Hạn ${fmtDateTime(t['due_at'])}', style: TextStyle(fontSize: 11.5, color: t['overdue'] == true ? AppColors.fire : AppColors.muted, fontWeight: t['overdue'] == true ? FontWeight.w700 : null)),
                  if (t['assignee'] == null) const Text('Chưa có người nhận', style: TextStyle(fontSize: 11.5, color: AppColors.orange)),
                ]),
              ]),
            ),
            const Icon(Icons.chevron_right, color: AppColors.muted),
          ]),
        ),
      ),
    );
  }
}
