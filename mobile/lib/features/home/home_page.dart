import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/outbox.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/items.dart';

/// M03 – Trang chủ: tổng quan đã công bố (kèm thời điểm cập nhật), lối tắt, cảnh báo gần đây, tin nổi bật.
class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final u = s.user;
    final home = ref.watch(homeProvider);
    final notif = ref.watch(notificationsProvider);
    final unread = notif.asData?.value['items'] is List ? (notif.asData!.value['items'] as List).where((n) => n['read'] != true).length : 0;
    final field = u != null && (u.role == 'specialist' || u.role == 'leader');

    final tiles = <(IconData, String, Color, String)>[
      (Icons.map_rounded, 'Bản đồ\nWebGIS', AppColors.blue, '/map'),
      (Icons.forest_rounded, 'Tài nguyên\nrừng', AppColors.forest, '/forest'),
      (Icons.local_fire_department_rounded, 'Cảnh báo\ncháy rừng', AppColors.fire, '/fire'),
      (Icons.satellite_alt_rounded, 'Ảnh vệ tinh', const Color(0xFF00897B), '/imagery'),
      (Icons.article_rounded, 'Tin tức', AppColors.purple, '/news'),
      (Icons.campaign_rounded, 'Phản ánh\nhiện trạng', AppColors.orange, '/report'),
      (Icons.wb_sunny_rounded, 'Thời tiết', const Color(0xFF29B6F6), '/weather'),
      (Icons.picture_as_pdf_rounded, 'Tài liệu\nbản đồ', const Color(0xFF00897B), '/documents'),
      field ? (Icons.assignment_rounded, 'Nhiệm vụ\nhiện trường', AppColors.forestDark, '/tasks') : (Icons.history_rounded, 'Phản ánh\ncủa tôi', AppColors.blue, '/reports'),
    ];

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 12,
        title: Row(children: [
          CircleAvatar(radius: 18, backgroundColor: AppColors.forestLight, child: Text((u?.name ?? 'K').characters.first.toUpperCase(), style: const TextStyle(color: AppColors.forest, fontWeight: FontWeight.w800))),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Xin chào, ${u?.name ?? 'Khách'}', style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
              Text(u?.roleLabel ?? 'Xem thông tin công khai', style: const TextStyle(fontSize: 11.5, color: AppColors.muted, fontWeight: FontWeight.w400)),
            ]),
          ),
        ]),
        actions: [
          if (s.demoLogin) IconButton(tooltip: 'Đăng nhập nhanh / đổi vai trò', icon: const Icon(Icons.switch_account_outlined), onPressed: () => showQuickLogin(context, ref)),
          IconButton(
            tooltip: 'Thông báo',
            icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.notifications_none_rounded)),
            onPressed: () => context.push('/notifications'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(homeProvider);
          ref.invalidate(notificationsProvider);
          await ref.read(homeProvider.future);
        },
        child: ListView(padding: const EdgeInsets.fromLTRB(14, 8, 14, 24), children: [
          _Banner(),
          const SizedBox(height: 12),
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            childAspectRatio: 1.15,
            children: [
              for (final t in tiles)
                Card(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(14),
                    onTap: () => t.$4 == '/map' || t.$4 == '/fire' ? context.go(t.$4) : context.push(t.$4),
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      Icon(t.$1, color: t.$3, size: 30),
                      const SizedBox(height: 6),
                      Text(t.$2, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.navy, height: 1.2)),
                    ]),
                  ),
                ),
            ],
          ),
          if (field) ...[const SizedBox(height: 12), const _WorkSummary()],
          const _PendingSync(),
          const SizedBox(height: 12),
          AsyncView(
            value: home,
            onRetry: () => ref.invalidate(homeProvider),
            builder: (Loaded<J> l) => _HomeData(l.data, offline: l.offline),
          ),
        ]),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(children: [
          Image.asset('assets/images/p01-home-small.webp', height: 132, width: double.infinity, fit: BoxFit.cover),
          Positioned.fill(child: Container(decoration: const BoxDecoration(gradient: LinearGradient(colors: [Color(0xCC064A28), Color(0x22064A28)])))),
          const Positioned(
            left: 16,
            top: 22,
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Kon Tum', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900)),
              Text('Vì rừng xanh bền vững', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
            ]),
          ),
        ]),
      );
}

class _HomeData extends StatelessWidget {
  const _HomeData(this.d, {this.offline = false});
  final J d;
  final bool offline;
  @override
  Widget build(BuildContext context) {
    final f = (d['forest'] as Map?)?.cast<String, dynamic>() ?? {};
    final danger = d['danger_today'] as Map?;
    final alerts = ((d['alerts'] as List?) ?? []).cast<Map>();
    final news = ((d['news'] as List?) ?? []).cast<Map>();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Row(children: [
        Expanded(child: KpiTile(icon: Icons.forest, value: fmtHa(f['established_forest_ha'] as num?), label: 'Diện tích có rừng', sub: 'đến ${fmtDate(f['as_of'])}')),
        const SizedBox(width: 8),
        Expanded(child: KpiTile(icon: Icons.donut_large, value: '${fmtNum(f['cover_percent_computed'] as num?, 1)} %', label: 'Tỷ lệ có rừng / DT tự nhiên', color: AppColors.leaf)),
      ]),
      const SizedBox(height: 8),
      Row(children: [
        Expanded(child: KpiTile(icon: Icons.whatshot, value: '${d['hotspots_7d'] ?? 0}', label: 'Điểm nóng vệ tinh 7 ngày', sub: '${d['hotspots_unverified'] ?? 0} chưa xác minh', color: AppColors.fire)),
        const SizedBox(width: 8),
        Expanded(child: KpiTile(icon: Icons.thermostat, value: danger == null ? '—' : 'Cấp ${danger['max_level']}', label: 'Cấp nguy cơ cháy cao nhất hôm nay', sub: 'chỉ số P – tự động', color: AppColors.dangerOf(danger?['max_level'] as num?))),
      ]),
      SourceNote('Số liệu rừng theo QĐ ${f['decision'] ?? ''}. Điểm nóng NASA FIRMS chưa phải cháy rừng đã xác nhận.'),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Cảnh báo gần đây',
        icon: Icons.notifications_active_outlined,
        trailing: TextButton(onPressed: () => context.go('/fire'), child: const Text('Xem tất cả')),
        child: alerts.isEmpty ? const EmptyView('Không có cảnh báo') : Column(children: [for (final a in alerts.take(4)) AlertTile(a.cast<String, dynamic>())]),
      ),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Tin nổi bật',
        icon: Icons.article_outlined,
        trailing: TextButton(onPressed: () => context.push('/news'), child: const Text('Xem tất cả')),
        child: news.isEmpty ? const EmptyView('Chưa có tin') : Column(children: [for (final n in news.take(3)) NewsTile(n.cast<String, dynamic>())]),
      ),
      SourceNote('Cập nhật: điểm nóng ${fmtAgo((d['freshness'] as Map?)?['firms'])}, dự báo cháy ${fmtAgo((d['freshness'] as Map?)?['fireDanger'])}, biến động rừng ${fmtAgo((d['freshness'] as Map?)?['forestChange'])}.'),
    ]);
  }
}

class _WorkSummary extends ConsumerWidget {
  const _WorkSummary();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final a = ref.watch(assignmentsProvider);
    final items = ((a.asData?.value.data['items'] as List?) ?? []).cast<Map>();
    final open = items.where((x) => !['approved', 'cancelled', 'submitted'].contains(x['status'])).length;
    final overdue = items.where((x) => x['overdue'] == true).length;
    return Card(
      color: AppColors.forestDark,
      child: ListTile(
        onTap: () => context.go('/work'),
        leading: const Icon(Icons.assignment_turned_in_rounded, color: Colors.white, size: 30),
        title: Text('$open nhiệm vụ hiện trường đang mở', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        subtitle: Text(overdue > 0 ? '$overdue nhiệm vụ quá hạn' : 'Nhận nhiệm vụ, khảo sát và xác minh tại hiện trường', style: const TextStyle(color: Colors.white70, fontSize: 12)),
        trailing: const Icon(Icons.chevron_right, color: Colors.white),
      ),
    );
  }
}

class _PendingSync extends ConsumerWidget {
  const _PendingSync();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final o = ref.watch(outboxProvider);
    if (o.waiting == 0 && o.conflicts == 0) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Card(
        color: const Color(0xFFFFF4E5),
        child: ListTile(
          onTap: () => context.push('/sync'),
          leading: Icon(o.conflicts > 0 ? Icons.sync_problem : Icons.cloud_upload_outlined, color: AppColors.orange),
          title: Text('${o.waiting} bản ghi chưa gửi${o.conflicts > 0 ? ' · ${o.conflicts} xung đột' : ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
          subtitle: Text(o.online ? 'Chạm để đồng bộ ngay' : 'Đang ngoại tuyến – sẽ tự gửi khi có mạng', style: const TextStyle(fontSize: 12)),
          trailing: const Icon(Icons.chevron_right),
        ),
      ),
    );
  }
}
