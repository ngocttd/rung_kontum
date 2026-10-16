import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../widgets/charts.dart';
import '../../widgets/common.dart';
import '../map/object_page.dart';

/// M06 – Tài nguyên rừng: hiện trạng, cơ cấu loại rừng, thống kê theo xã, biến động.
/// Rừng khộp là lớp riêng; NDVI thấp mùa khô không đồng nghĩa mất rừng.
class ForestPage extends ConsumerWidget {
  const ForestPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(title: const Text('Tài nguyên rừng'), bottom: const TabBar(tabs: [Tab(text: 'Tổng quan'), Tab(text: 'Phân loại'), Tab(text: 'Biến động')])),
        body: TabBarView(children: [
          AsyncView(value: ref.watch(forestSummaryProvider), onRetry: () => ref.invalidate(forestSummaryProvider), builder: (Loaded<J> l) => _Overview(l.data)),
          AsyncView(value: ref.watch(forestSummaryProvider), onRetry: () => ref.invalidate(forestSummaryProvider), builder: (Loaded<J> l) => _Types(l.data)),
          AsyncView(value: ref.watch(forestChangeProvider), onRetry: () => ref.invalidate(forestChangeProvider), builder: (Loaded<J> l) => _Change(l.data)),
        ]),
      ),
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview(this.d);
  final J d;
  @override
  Widget build(BuildContext context) {
    final s = (d['summary'] as Map).cast<String, dynamic>();
    final communes = ((d['communes'] as List?) ?? []).cast<Map>().toList()
      ..sort((a, b) => ((b['official']?['established_forest_ha'] ?? 0) as num).compareTo((a['official']?['established_forest_ha'] ?? 0) as num));
    return ListView(padding: const EdgeInsets.all(14), children: [
      ClipRRect(borderRadius: BorderRadius.circular(14), child: Image.asset('assets/images/p03-forest-small.webp', height: 120, fit: BoxFit.cover)),
      const SizedBox(height: 10),
      GridView.count(
        crossAxisCount: 2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 1.75,
        children: [
          KpiTile(icon: Icons.forest, value: fmtHa(s['established_forest_ha'] as num?), label: 'Tổng diện tích có rừng'),
          KpiTile(icon: Icons.donut_large, value: '${fmtNum(s['cover_percent_computed'] as num?, 1)} %', label: 'Tỷ lệ có rừng', color: AppColors.leaf),
          KpiTile(icon: Icons.park, value: fmtHa(s['natural_forest_ha'] as num?), label: 'Rừng tự nhiên', color: AppColors.forestDark),
          KpiTile(icon: Icons.grass, value: fmtHa(s['plantation_ha'] as num?), label: 'Rừng trồng', color: AppColors.orange),
        ],
      ),
      SourceNote('Hiện trạng đến ${fmtDate(s['as_of'])} theo QĐ ${s['decision'] ?? ''}. ${s['scope'] ?? ''}'),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Cơ cấu quy hoạch 3 loại rừng',
        child: DonutChart(center: '${fmtNum(s['planning_ha'] as num?)}\nha', items: [
          ('Rừng đặc dụng', (s['special_use_ha'] ?? 0) as num, AppColors.forestDark),
          ('Rừng phòng hộ', (s['protection_ha'] ?? 0) as num, AppColors.leaf),
          ('Rừng sản xuất', (s['production_ha'] ?? 0) as num, AppColors.yellow),
        ]),
      ),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Diện tích có rừng theo xã',
        child: Column(children: [
          for (final c in communes.take(40))
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(children: [
                Expanded(flex: 4, child: Text(c['name'].toString(), style: const TextStyle(fontSize: 12.5))),
                Expanded(
                  flex: 5,
                  child: LinearProgressIndicator(
                    value: (((c['official']?['established_forest_ha'] ?? 0) as num) / ((communes.first['official']?['established_forest_ha'] ?? 1) as num)).clamp(0, 1).toDouble(),
                    minHeight: 8,
                    borderRadius: BorderRadius.circular(4),
                    color: AppColors.forest,
                    backgroundColor: AppColors.forestLight,
                  ),
                ),
                SizedBox(width: 74, child: Text(fmtNum((c['official']?['established_forest_ha']) as num?), textAlign: TextAlign.right, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
              ]),
            ),
        ]),
      ),
    ]);
  }
}

class _Types extends StatelessWidget {
  const _Types(this.d);
  final J d;
  @override
  Widget build(BuildContext context) {
    final lc = d['landcover'] as Map?;
    final years = lc == null ? <String>[] : ((lc['years'] as List?) ?? (lc['by_year'] as Map?)?.keys.toList() ?? []).map((e) => e.toString()).toList();
    final byYear = (lc?['by_year'] as Map?) ?? {};
    final classes = (lc?['classes'] as Map?) ?? {};
    final types = [
      ('Rừng lá rộng thường xanh', 'Chiếm phần lớn vùng núi cao Ngọc Linh, Kon Plông; xanh quanh năm.', 'assets/images/evergreen-small.webp', false),
      ('Rừng khộp (rụng lá theo mùa)', 'Phân bố vùng thấp phía Tây (Sa Thầy, Ia H’Drai). Mùa khô rụng lá, NDVI giảm mạnh nhưng KHÔNG phải mất rừng – theo dõi riêng, xác minh bằng khảo sát mùa mưa.', 'assets/images/dipterocarp-small.webp', true),
      ('Rừng trồng', 'Keo, thông, cao su…; khai thác theo chu kỳ nên mất tán cây không đồng nhất với mất rừng tự nhiên.', 'assets/images/forest-patrol-small.webp', false),
    ];
    return ListView(padding: const EdgeInsets.all(14), children: [
      for (final t in types)
        Card(
          margin: const EdgeInsets.only(bottom: 10),
          color: t.$4 ? const Color(0xFFFFFBEA) : null,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.asset(t.$3, width: 92, height: 76, fit: BoxFit.cover)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [Expanded(child: Text(t.$1, style: const TextStyle(fontWeight: FontWeight.w800))), if (t.$4) const StatusChip('Lớp riêng', color: Color(0xFFB8860B), dense: true)]),
                  const SizedBox(height: 4),
                  Text(t.$2, style: const TextStyle(fontSize: 12.5, height: 1.35)),
                ]),
              ),
            ]),
          ),
        ),
      if (byYear.isNotEmpty)
        SectionCard(
          title: 'Lớp phủ 1991 – 2014 – 2023 (dữ liệu dự án, 15 m)',
          child: Column(children: [
            for (final k in classes.keys)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  Expanded(child: Text((classes[k] is Map ? classes[k]['label'] ?? classes[k]['name'] : classes[k]).toString(), style: const TextStyle(fontSize: 12.5))),
                  for (final y in years) SizedBox(width: 78, child: Text(fmtNum((byYear[y] as Map?)?[k] as num?), textAlign: TextAlign.right, style: const TextStyle(fontSize: 12))),
                ]),
              ),
            Row(children: [const Expanded(child: SizedBox()), for (final y in years) SizedBox(width: 78, child: Text(y, textAlign: TextAlign.right, style: const TextStyle(fontSize: 11, color: AppColors.muted)))]),
            const SourceNote('Đơn vị: ha. Phân loại từ ảnh vệ tinh – lớp “Rừng” là lớp phủ, chưa phải hiện trạng rừng pháp lý.'),
          ]),
        ),
    ]);
  }
}

class _Change extends StatelessWidget {
  const _Change(this.d);
  final J d;
  @override
  Widget build(BuildContext context) {
    final h = (d['history'] as Map?) ?? {};
    final annual = ((h['aoi_annual_loss_ha'] as Map?) ?? {}).cast<String, dynamic>();
    final years = annual.keys.toList()..sort();
    final fc = (d['forecast'] as Map?) ?? {};
    final v = (fc['validation'] as Map?) ?? {};
    final cand = ((d['candidates'] as Map?)?['items'] as List? ?? []).cast<Map>();
    return ListView(padding: const EdgeInsets.all(14), children: [
      SectionCard(
        title: 'Mất tán cây hằng năm 2001–2024 (ha)',
        child: Column(children: [
          SimpleBars(labels: [for (final y in years) y.length > 2 ? y.substring(2) : y], values: [for (final y in years) (annual[y] ?? 0) as num], color: AppColors.fire, unit: ' ha'),
          SourceNote('${h['source'] ?? 'Hansen GFC'} – mất tán cây mọi nguyên nhân (gồm khai thác rừng trồng), không đồng nhất với mất rừng pháp lý.'),
        ]),
      ),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Dự báo nguy cơ mất rừng ${fc['horizon'] ?? '2025–2026'}',
        child: Column(children: [
          KV('Mô hình', fc['model']?.toString()),
          KV('AUC kiểm định', v['auc'] == null ? null : fmtNum(v['auc'] as num, 3)),
          KV('Trạng thái', fc['status']?.toString() ?? 'Chưa được cơ quan chuyên môn phê duyệt'),
          const SourceNote('Dùng để ưu tiên kiểm tra thực địa, không phải kết luận mất rừng.'),
        ]),
      ),
      const SizedBox(height: 12),
      SectionCard(
        title: 'Biến động nghi vấn mới nhất',
        trailing: TextButton(onPressed: () => context.go('/map'), child: const Text('Bản đồ')),
        child: cand.isEmpty
            ? const EmptyView('Không có điểm nghi vấn')
            : Column(children: [
                for (final c in cand.take(30))
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    leading: Icon(Icons.park, color: StatusChip.toneOf(c['status'] as String?)),
                    title: Text('${c['id']} · ${c['commune_name'] ?? ''}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text('${fmtNum(c['area_ha'] as num?, 1)} ha · ΔNDVI ${c['mean_dndvi']}${c['seasonal_leaf_fall_possible'] == true ? ' · có thể rụng lá mùa khô' : ''}'),
                    trailing: StatusChip(c['statusLabel']?.toString() ?? '', color: StatusChip.toneOf(c['status'] as String?), dense: true),
                    onTap: () => context.push('/object', extra: ObjectRef(kind: 'candidate', id: c['id'].toString(), props: c.cast<String, dynamic>(), point: LatLng((c['lat'] as num).toDouble(), (c['lon'] as num).toDouble()))),
                  ),
              ]),
      ),
    ]);
  }
}
