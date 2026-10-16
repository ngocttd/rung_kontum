import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../app/theme.dart';
import '../core/format.dart';

/// Biểu đồ tròn có tổng ở giữa và chú giải bên phải.
class DonutChart extends StatelessWidget {
  const DonutChart({super.key, required this.items, this.center, this.size = 150});
  final List<(String, num, Color)> items;
  final String? center;
  final double size;
  @override
  Widget build(BuildContext context) {
    final total = items.fold<num>(0, (a, e) => a + e.$2);
    return Row(children: [
      SizedBox(
        width: size,
        height: size,
        child: Stack(alignment: Alignment.center, children: [
          PieChart(PieChartData(
            sectionsSpace: 1.5,
            centerSpaceRadius: size * .3,
            sections: [for (final e in items) PieChartSectionData(value: e.$2.toDouble(), color: e.$3, radius: size * .17, showTitle: false)],
          )),
          if (center != null) Text(center!, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, color: AppColors.navy)),
        ]),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          for (final e in items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Container(width: 10, height: 10, decoration: BoxDecoration(color: e.$3, shape: BoxShape.circle)),
                const SizedBox(width: 6),
                Expanded(child: Text(e.$1, style: const TextStyle(fontSize: 12))),
                Text(total == 0 ? '' : '${fmtNum(e.$2 * 100 / total, 1)}%', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
              ]),
            ),
        ]),
      ),
    ]);
  }
}

/// Biểu đồ cột đơn giản: nhãn trục X + giá trị, màu theo từng cột.
class SimpleBars extends StatelessWidget {
  const SimpleBars({super.key, required this.labels, required this.values, this.colors, this.color = AppColors.forest, this.height = 180, this.unit = ''});
  final List<String> labels;
  final List<num> values;
  final List<Color>? colors;
  final Color color;
  final double height;
  final String unit;
  @override
  Widget build(BuildContext context) {
    final maxV = values.isEmpty ? 1.0 : values.reduce((a, b) => a > b ? a : b).toDouble();
    final step = labels.length > 12 ? (labels.length / 8).ceil() : 1;
    return SizedBox(
      height: height,
      child: BarChart(BarChartData(
        maxY: maxV <= 0 ? 1 : maxV * 1.15,
        gridData: const FlGridData(drawVerticalLine: false),
        borderData: FlBorderData(show: false),
        barTouchData: BarTouchData(touchTooltipData: BarTouchTooltipData(getTooltipItem: (g, _, r, _) => BarTooltipItem('${labels[g.x]}\n${fmtNum(r.toY, r.toY < 10 ? 1 : 0)}$unit', const TextStyle(color: Colors.white, fontSize: 12)))),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(),
          rightTitles: const AxisTitles(),
          leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 40, getTitlesWidget: (v, m) => Text(fmtNum(v), style: const TextStyle(fontSize: 10, color: AppColors.muted)))),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 22,
              getTitlesWidget: (v, m) => v.toInt() % step == 0 && v.toInt() < labels.length ? Padding(padding: const EdgeInsets.only(top: 4), child: Text(labels[v.toInt()], style: const TextStyle(fontSize: 10, color: AppColors.muted))) : const SizedBox.shrink(),
            ),
          ),
        ),
        barGroups: [
          for (var i = 0; i < values.length; i++)
            BarChartGroupData(x: i, barRods: [BarChartRodData(toY: values[i].toDouble(), color: colors?[i] ?? color, width: labels.length > 20 ? 5 : 14, borderRadius: BorderRadius.circular(3))]),
        ],
      )),
    );
  }
}

/// Biểu đồ đường nhiều chuỗi.
class SimpleLines extends StatelessWidget {
  const SimpleLines({super.key, required this.labels, required this.series, this.height = 190});
  final List<String> labels;
  final List<(String, List<num?>, Color)> series;
  final double height;
  @override
  Widget build(BuildContext context) {
    final step = (labels.length / 6).ceil().clamp(1, 999);
    return Column(children: [
      SizedBox(
        height: height,
        child: LineChart(LineChartData(
          gridData: const FlGridData(drawVerticalLine: false),
          borderData: FlBorderData(show: false),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(),
            rightTitles: const AxisTitles(),
            leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 34, getTitlesWidget: (v, m) => Text(v.toStringAsFixed(1), style: const TextStyle(fontSize: 10, color: AppColors.muted)))),
            bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 22, interval: 1, getTitlesWidget: (v, m) => v.toInt() % step == 0 && v.toInt() < labels.length ? Text(labels[v.toInt()], style: const TextStyle(fontSize: 9.5, color: AppColors.muted)) : const SizedBox.shrink())),
          ),
          lineBarsData: [
            for (final s in series)
              LineChartBarData(
                spots: [for (var i = 0; i < s.$2.length; i++) if (s.$2[i] != null) FlSpot(i.toDouble(), s.$2[i]!.toDouble())],
                color: s.$3,
                barWidth: 2.2,
                isCurved: true,
                dotData: const FlDotData(show: false),
              ),
          ],
        )),
      ),
      Wrap(spacing: 12, children: [
        for (final s in series)
          Row(mainAxisSize: MainAxisSize.min, children: [Container(width: 14, height: 3, color: s.$3), const SizedBox(width: 4), Text(s.$1, style: const TextStyle(fontSize: 11.5))]),
      ]),
    ]);
  }
}
