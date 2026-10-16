import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../widgets/charts.dart';
import '../../widgets/common.dart';

/// M12 – Thời tiết và khí hậu: nhiệt độ, độ ẩm, mưa, gió, dự báo 7 ngày, chỉ số nguy cơ cháy.
/// Dữ liệu khí tượng tham khảo, không thay cảnh báo chính thức.
class WeatherPage extends ConsumerStatefulWidget {
  const WeatherPage({super.key});
  @override
  ConsumerState<WeatherPage> createState() => _WeatherPageState();
}

class _WeatherPageState extends ConsumerState<WeatherPage> {
  String? code;

  @override
  Widget build(BuildContext context) {
    final list = ref.watch(weatherProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Thời tiết, khí hậu')),
      body: AsyncView(
        value: list,
        onRetry: () => ref.invalidate(weatherProvider),
        builder: (Loaded<List> l) {
          final all = l.data.cast<Map>();
          if (all.isEmpty) return const EmptyView('Chưa có dữ liệu thời tiết');
          final sel = all.firstWhere((c) => c['code'] == code, orElse: () => all.first);
          final cur = (sel['current'] as Map?) ?? {};
          final detail = ref.watch(weatherDetailProvider(sel['code'] as String));
          return ListView(padding: const EdgeInsets.all(14), children: [
            DropdownButtonFormField<String>(
              initialValue: sel['code'] as String,
              isExpanded: true,
              decoration: const InputDecoration(prefixIcon: Icon(Icons.place_outlined)),
              items: [for (final c in all) DropdownMenuItem(value: c['code'] as String, child: Text(c['fullName'].toString()))],
              onChanged: (v) => setState(() => code = v),
            ),
            const SizedBox(height: 10),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(children: [
                  Icon(_icon(cur['icon']?.toString()), size: 64, color: AppColors.orange),
                  const SizedBox(width: 12),
                  Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${fmtNum(cur['temp'] as num?)}°C', style: const TextStyle(fontSize: 38, fontWeight: FontWeight.w800, color: AppColors.navy)),
                    Text(cur['description']?.toString() ?? '', style: const TextStyle(color: AppColors.muted)),
                  ]),
                  const Spacer(),
                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    _mini(Icons.water_drop_outlined, '${cur['humidity'] ?? '—'}%', 'Độ ẩm'),
                    _mini(Icons.air, '${fmtNum(((cur['wind_ms'] ?? 0) as num) * 3.6)} km/h', 'Gió'),
                    _mini(Icons.umbrella_outlined, '${cur['rain1h'] ?? 0} mm', 'Mưa 1 giờ'),
                  ]),
                ]),
              ),
            ),
            SourceNote('Quan trắc lúc ${fmtDateTime(cur['dt'])} (OpenWeather). Dự báo: Open-Meteo (CC BY 4.0).'),
            const SizedBox(height: 12),
            AsyncView(
              value: detail,
              loading: const LinearProgressIndicator(),
              builder: (Loaded<J> d) {
                final days = (((d.data['forecast'] as Map?)?['days'] as List?) ?? []).cast<Map>();
                final danger = d.data['danger'] as Map?;
                final ddays = danger == null ? <Map>[] : [danger['current'], ...((danger['forecast'] as List?) ?? [])].whereType<Map>().toList();
                return Column(children: [
                  SectionCard(
                    title: 'Dự báo 7 ngày',
                    child: SizedBox(
                      height: 118,
                      child: ListView(scrollDirection: Axis.horizontal, children: [
                        for (final x in days)
                          Container(
                            width: 78,
                            margin: const EdgeInsets.only(right: 6),
                            padding: const EdgeInsets.all(6),
                            decoration: BoxDecoration(color: AppColors.bg, borderRadius: BorderRadius.circular(10)),
                            child: Column(children: [
                              Text(fmtDate(x['date']).substring(0, 5), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12)),
                              Icon(((x['rain'] ?? 0) as num) > 1 ? Icons.grain : Icons.wb_sunny_outlined, color: ((x['rain'] ?? 0) as num) > 1 ? AppColors.blue : AppColors.orange),
                              Text('${fmtNum(x['tmax'] as num?)}° / ${fmtNum(x['tmin'] as num?)}°', style: const TextStyle(fontSize: 12)),
                              Text('${x['rain'] ?? 0} mm', style: const TextStyle(fontSize: 11, color: AppColors.blue)),
                              Text('ẩm ${x['rh_min'] ?? '—'}%', style: const TextStyle(fontSize: 10.5, color: AppColors.muted)),
                            ]),
                          ),
                      ]),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (ddays.isNotEmpty)
                    SectionCard(
                      title: 'Chỉ số nguy cơ cháy rừng (FWI)',
                      child: Column(children: [
                        SimpleBars(labels: [for (final x in ddays) fmtDate(x['date']).substring(0, 5)], values: [for (final x in ddays) (x['fwi'] ?? 0) as num], colors: [for (final x in ddays) AppColors.dangerOf(x['cls'] as num?)], height: 150),
                        const SourceNote('Màu cột theo cấp dự báo cháy (chỉ số P Nesterov). Kết quả tự động – tham khảo.'),
                      ]),
                    ),
                ]);
              },
            ),
          ]);
        },
      ),
    );
  }

  Widget _mini(IconData i, String v, String l) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(i, size: 16, color: AppColors.blue), const SizedBox(width: 4), Text(v, style: const TextStyle(fontWeight: FontWeight.w700)), Text(' $l', style: const TextStyle(fontSize: 11, color: AppColors.muted))]),
      );

  IconData _icon(String? c) {
    if (c == null) return Icons.wb_cloudy_outlined;
    if (c.startsWith('01')) return Icons.wb_sunny_rounded;
    if (c.startsWith('02') || c.startsWith('03') || c.startsWith('04')) return Icons.wb_cloudy_rounded;
    if (c.startsWith('09') || c.startsWith('10')) return Icons.grain;
    if (c.startsWith('11')) return Icons.thunderstorm_outlined;
    return Icons.wb_cloudy_outlined;
  }
}
