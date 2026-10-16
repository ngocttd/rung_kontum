import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../widgets/charts.dart';
import '../../widgets/common.dart';
import '../map/map_page.dart';

/// M08 – Ảnh vệ tinh: sản phẩm đã xử lý trên máy chủ (Python), chỉ số NDVI/NDMI/NBR theo tháng, so sánh trước–sau.
/// Ứng dụng không chạy xử lý ảnh nặng.
class ImageryPage extends ConsumerWidget {
  const ImageryPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final v = ref.watch(imageryProvider);
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(title: const Text('Ảnh vệ tinh'), bottom: const TabBar(tabs: [Tab(text: 'Ảnh vệ tinh'), Tab(text: 'Chỉ số thực vật'), Tab(text: 'So sánh')])),
        body: AsyncView(
          value: v,
          onRetry: () => ref.invalidate(imageryProvider),
          builder: (Loaded<J> l) {
            final products = ((l.data['products'] as List?) ?? []).cast<Map>();
            final monthly = ((l.data['monthly'] as List?) ?? []).cast<Map>();
            return TabBarView(children: [
              ListView(padding: const EdgeInsets.all(14), children: [
                NoticeBox(l.data['satellite']?.toString() ?? 'Sentinel-2'),
                const SizedBox(height: 10),
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisSpacing: 8,
                  mainAxisSpacing: 8,
                  childAspectRatio: .82,
                  children: [
                    for (final p in products)
                      Card(
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: () => context.go('/map', extra: MapFocus(const LatLng(14.65, 107.95), zoom: 8.3, layer: p['id'] as String)),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                            Expanded(child: Container(color: const Color(0xFF0F2A1C), child: NetImage((p['image'] as Map?)?['url'] as String?, fit: BoxFit.contain))),
                            Padding(padding: const EdgeInsets.all(8), child: Text(p['title'].toString(), maxLines: 2, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700))),
                          ]),
                        ),
                      ),
                  ],
                ),
                const SourceNote('Chạm một ảnh để mở trên bản đồ. Ảnh tổng hợp median theo tháng/mùa, đã che mây.'),
              ]),
              ListView(padding: const EdgeInsets.all(14), children: [
                SectionCard(
                  title: 'Chỉ số trung bình toàn vùng theo tháng',
                  child: SimpleLines(
                    labels: [for (final m in monthly) (m['month'] as String).substring(2)],
                    series: [
                      ('NDVI', [for (final m in monthly) m['ndvi'] as num?], AppColors.forest),
                      ('NDMI', [for (final m in monthly) m['ndmi'] as num?], AppColors.blue),
                      ('NBR', [for (final m in monthly) m['nbr'] as num?], AppColors.orange),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  title: 'Tỷ lệ điểm ảnh không mây',
                  child: SimpleBars(labels: [for (final m in monthly) (m['month'] as String).substring(5)], values: [for (final m in monthly) (((m['valid_fraction'] ?? 0) as num) * 100)], color: AppColors.blue, unit: '%', height: 140),
                ),
                const SourceNote('NDVI giảm mùa khô ở rừng khộp là rụng lá theo mùa, không phải mất rừng. Tháng nhiều mây có giá trị kém tin cậy.'),
              ]),
              _Compare(products: products),
            ]);
          },
        ),
      ),
    );
  }
}

class _Compare extends StatefulWidget {
  const _Compare({required this.products});
  final List<Map> products;
  @override
  State<_Compare> createState() => _CompareState();
}

class _CompareState extends State<_Compare> {
  late String a = widget.products.length > 1 ? widget.products[1]['id'] as String : '';
  late String b = widget.products.isNotEmpty ? widget.products.first['id'] as String : '';
  @override
  Widget build(BuildContext context) {
    if (widget.products.length < 2) return const EmptyView('Chưa đủ sản phẩm ảnh để so sánh');
    Map pick(String id) => widget.products.firstWhere((p) => p['id'] == id, orElse: () => widget.products.first);
    Widget side(String label, String id, ValueChanged<String> on) => Expanded(
          child: Column(children: [
            DropdownButton<String>(
              value: id,
              isExpanded: true,
              items: [for (final p in widget.products) DropdownMenuItem(value: p['id'] as String, child: Text(p['title'].toString(), overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)))],
              onChanged: (v) => on(v!),
            ),
            Text(label, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
            const SizedBox(height: 4),
            AspectRatio(aspectRatio: .8, child: Container(color: const Color(0xFF0F2A1C), child: NetImage((pick(id)['image'] as Map?)?['url'] as String?, fit: BoxFit.contain))),
          ]),
        );
    return ListView(padding: const EdgeInsets.all(14), children: [
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [side('Trước', a, (v) => setState(() => a = v)), const SizedBox(width: 8), side('Sau', b, (v) => setState(() => b = v))]),
      const SourceNote('So sánh trực quan hai sản phẩm cùng phạm vi. Phát hiện biến động định lượng do máy chủ tính (mục Biến động).'),
    ]);
  }
}
