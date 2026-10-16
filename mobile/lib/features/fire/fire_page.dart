import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../widgets/charts.dart';
import '../../widgets/common.dart';
import '../../widgets/items.dart';

/// M07 – Cảnh báo cháy rừng: điểm nóng FIRMS (kèm trạng thái xác minh), cấp nguy cơ theo chỉ số P/FWI
/// 7 ngày tới, lịch sử; lọc theo thời gian và cấp cảnh báo.
class FirePage extends ConsumerStatefulWidget {
  const FirePage({super.key});
  @override
  ConsumerState<FirePage> createState() => _FirePageState();
}

class _FirePageState extends ConsumerState<FirePage> {
  int minLevel = 0;
  String? commune;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Cảnh báo cháy rừng'),
          actions: [IconButton(tooltip: 'Tải lại', icon: const Icon(Icons.refresh), onPressed: () => [ref.invalidate(fireAlertsProvider), ref.invalidate(dangerProvider), ref.invalidate(fireHistoryProvider)])],
          bottom: const TabBar(tabs: [Tab(text: 'Hiện tại'), Tab(text: 'Dự báo'), Tab(text: 'Lịch sử')]),
        ),
        body: TabBarView(children: [_current(), _forecast(), _history()]),
      ),
    );
  }

  Widget _current() {
    final all = ref.watch(fireAlertsProvider(''));
    return AsyncView(
      value: all,
      onRetry: () => ref.invalidate(fireAlertsProvider),
      builder: (Loaded<J> l) {
        final items = ((l.data['items'] as List?) ?? []).cast<Map>().map((e) => e.cast<String, dynamic>()).where((a) => a['type'] != 'forest_change').toList();
        final official = items.where((a) => a['type'] == 'fire_danger' && a['official'] == true).toList();
        final filtered = items.where((a) => minLevel == 0 || ((a['level'] ?? 0) as num) >= minLevel).toList();
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(fireAlertsProvider),
          child: ListView(padding: const EdgeInsets.all(14), children: [
            if (official.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: const Color(0xFFFDECEA), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFF5B7B1))),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Icon(Icons.local_fire_department, color: AppColors.fire, size: 30),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Cảnh báo nguy cơ cháy rừng đã phê duyệt tại: ${official.map((a) => a['commune']).toSet().join(', ')}', style: const TextStyle(color: Color(0xFF9B1C1C), fontWeight: FontWeight.w700))),
                ]),
              )
            else
              const NoticeBox('Chưa có cảnh báo cháy rừng chính thức nào được phê duyệt. Dự báo tự động và điểm nóng vệ tinh bên dưới chỉ để tham khảo, theo dõi.'),
            const SizedBox(height: 10),
            Wrap(spacing: 6, children: [
              for (final f in const [(0, 'Tất cả'), (3, 'Cấp III+'), (4, 'Cấp IV+')]) ChoiceChip(label: Text(f.$2), selected: minLevel == f.$1, onSelected: (_) => setState(() => minLevel = f.$1)),
            ]),
            const SizedBox(height: 6),
            SectionCard(
              title: 'Điểm cháy & cảnh báo gần đây',
              child: filtered.isEmpty ? const EmptyView('Không có cảnh báo phù hợp bộ lọc', icon: Icons.verified_outlined) : Column(children: [for (final a in filtered) AlertTile(a)]),
            ),
            const SourceNote('Điểm nóng: NASA FIRMS (VIIRS 375 m, MODIS 1 km), cập nhật 30 phút/lần. Nhãn “Chưa xác minh” nghĩa là chưa có kết quả kiểm tra hiện trường.'),
          ]),
        );
      },
    );
  }

  Widget _forecast() {
    final d = ref.watch(dangerProvider);
    return AsyncView(
      value: d,
      onRetry: () => ref.invalidate(dangerProvider),
      builder: (Loaded<J> l) {
        final cs = ((l.data['communes'] as List?) ?? []).cast<Map>();
        if (cs.isEmpty) return const EmptyView('Chưa có dữ liệu dự báo');
        final sel = cs.firstWhere((c) => c['code'] == commune, orElse: () => cs.first);
        final days = [sel['current'], ...((sel['forecast'] as List?) ?? [])].whereType<Map>().toList();
        final ranked = [...cs]..sort((a, b) => _max(b).compareTo(_max(a)));
        return ListView(padding: const EdgeInsets.all(14), children: [
          DropdownButtonFormField<String>(
            initialValue: sel['code'] as String,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Xã/phường', prefixIcon: Icon(Icons.place_outlined)),
            items: [for (final c in cs) DropdownMenuItem(value: c['code'] as String, child: Text(c['name'].toString()))],
            onChanged: (v) => setState(() => commune = v),
          ),
          const SizedBox(height: 10),
          SectionCard(
            title: 'Chỉ số P (Nesterov) – hôm nay và 7 ngày tới',
            child: Column(children: [
              SimpleBars(
                labels: [for (final x in days) fmtDate(x['date']).substring(0, 5)],
                values: [for (final x in days) (x['p'] ?? 0) as num],
                colors: [for (final x in days) AppColors.dangerOf(x['cls'] as num?)],
              ),
              Wrap(spacing: 8, runSpacing: 4, children: [
                for (final e in const [(1, 'I Thấp'), (2, 'II Trung bình'), (3, 'III Cao'), (4, 'IV Nguy hiểm'), (5, 'V Cực kỳ nguy hiểm')])
                  Row(mainAxisSize: MainAxisSize.min, children: [Container(width: 10, height: 10, color: AppColors.dangerOf(e.$1)), const SizedBox(width: 3), Text(e.$2, style: const TextStyle(fontSize: 11))]),
              ]),
              const SizedBox(height: 8),
              for (final x in days)
                KV(fmtDate(x['date']), 'Cấp ${x['cls']} · P ${fmtNum(x['p'] as num?)} · FWI ${x['fwi']} · ${x['T']}°C, ẩm ${x['H']}%, mưa ${x['rain']} mm',
                    valueWidget: Row(children: [StatusChip('Cấp ${x['cls']}', color: AppColors.dangerOf(x['cls'] as num?), dense: true), const SizedBox(width: 6), Expanded(child: Text('P ${fmtNum(x['p'] as num?)} · FWI ${x['fwi']} · ${x['T']}°C · ${x['H']}% · mưa ${x['rain']} mm', style: const TextStyle(fontSize: 12)))])),
            ]),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Xã có cấp cao nhất trong 7 ngày',
            child: Column(children: [
              for (final c in ranked.take(10))
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(c['name'].toString()),
                  trailing: StatusChip('Cấp ${_max(c)}', color: AppColors.dangerOf(_max(c)), dense: true),
                  onTap: () => setState(() => commune = c['code'] as String),
                ),
            ]),
          ),
          SourceNote('${(l.data['method'] as Map?)?['nesterov'] ?? 'Chỉ số P Nesterov theo ND 156/2018'}. Dữ liệu khí tượng tham khảo (ERA5-Land, Open-Meteo); kết quả tự động, không thay cảnh báo chính thức.'),
        ]);
      },
    );
  }

  int _max(Map c) => [c['current'], ...((c['forecast'] as List?) ?? [])].whereType<Map>().fold<int>(0, (a, d) => ((d['cls'] ?? 0) as num).toInt() > a ? ((d['cls'] ?? 0) as num).toInt() : a);

  Widget _history() {
    final h = ref.watch(fireHistoryProvider);
    return AsyncView(
      value: h,
      onRetry: () => ref.invalidate(fireHistoryProvider),
      builder: (Loaded<J> l) {
        final hs = (l.data['hotspots'] as Map?) ?? {};
        final monthly = ((hs['monthly'] as Map?) ?? {}).cast<String, dynamic>();
        final months = monthly.keys.toList()..sort();
        final byC = ((hs['byCommune'] as Map?) ?? {}).cast<String, dynamic>().entries.toList()..sort((a, b) => (b.value as num).compareTo(a.value as num));
        return ListView(padding: const EdgeInsets.all(14), children: [
          SectionCard(
            title: 'Điểm nóng theo tháng (${months.isEmpty ? '' : '${months.first} – ${months.last}'})',
            child: Column(children: [
              SimpleBars(labels: [for (final m in months) m.substring(5)], values: [for (final m in months) (monthly[m] ?? 0) as num], color: AppColors.fire),
              SourceNote('${hs['source'] ?? ''} – điểm ảnh dị thường nhiệt, chưa xác minh.'),
            ]),
          ),
          const SizedBox(height: 12),
          SectionCard(
            title: 'Xã có nhiều điểm nóng nhất',
            child: Consumer(builder: (context, ref, _) {
              final geo = ref.watch(communesGeoProvider).asData?.value.data;
              final names = {for (final f in ((geo?['features'] as List?) ?? []).cast<Map>()) (f['properties'] as Map)['code']: (f['properties'] as Map)['fullName']};
              return Column(children: [for (final e in byC.take(10)) KV(names[e.key]?.toString() ?? e.key, '${e.value} điểm')]);
            }),
          ),
        ]);
      },
    );
  }
}
