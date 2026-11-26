import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/layout.dart';
import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/outbox.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/items.dart';
import '../../widgets/network_map.dart';
import '../map/map_page.dart';
import '../map/route_page.dart';

const reportTypeIcons = {
  'chay-rung': 'fire-investigating',
  'pha-rung': 'forest-violation',
  'lan-chiem': 'land-encroachment',
  'van-chuyen': 'timber-transport',
  'dong-vat': 'wildlife',
  'khac': 'report-other',
};

const reportTypeLabels = {
  'chay-rung': 'Cháy rừng',
  'pha-rung': 'Phá rừng, khai thác trái phép',
  'lan-chiem': 'Xâm lấn đất rừng',
  'van-chuyen': 'Vận chuyển lâm sản trái phép',
  'dong-vat': 'Động vật hoang dã',
  'khac': 'Khác',
};

/// Hiển thị chi tiết một hồ sơ phản ánh (của tôi, tra cứu theo mã hoặc phản ánh công khai) kèm vị trí & bản đồ.
void showReportDetailSheet(BuildContext context, WidgetRef ref, Map<String, dynamic> r) {
  final lat = (r['lat'] as num?)?.toDouble();
  final lon = (r['lon'] as num?)?.toDouble();
  final pt = lat != null && lon != null ? LatLng(lat, lon) : null;
  final bms = ((ref.read(sessionProvider).map['basemaps'] as List?) ?? []).cast<Map>();
  final tileUrl = (bms.firstOrNull?['url'] ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').toString();
  final icon = reportTypeIcons[r['type']] ?? 'report-other';
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetCtx) => SafeDraggableSheet(
      expand: false,
      initialChildSize: .74,
      maxChildSize: .94,
      builder: (_, sc) => ListView(controller: sc, padding: const EdgeInsets.fromLTRB(16, 0, 16, 24), children: [
        Text('${r['code']} · ${r['typeLabel'] ?? reportTypeLabels[r['type']] ?? ''}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.navy)),
        const SizedBox(height: 6),
        Align(alignment: Alignment.centerLeft, child: StatusChip(r['statusLabel']?.toString() ?? '', color: StatusChip.toneOf(r['status'] as String?))),
        const SizedBox(height: 10),
        KV('Địa bàn', r['commune_name']?.toString() ?? '—'),
        KV(
          'Vị trí',
          pt == null
              ? '—'
              : '${fmtCoord(pt.latitude, pt.longitude)}${r['gps_accuracy'] != null ? ' (±${(r['gps_accuracy'] as num).round()} m)' : ' (toạ độ công khai làm tròn)'}',
        ),
        if ((r['location_text'] ?? '').toString().trim().isNotEmpty) KV('Mô tả địa điểm', r['location_text'].toString()),
        KV('Gửi lúc', fmtDateTime(r['created_at'])),
        KV('Nội dung', r['description']?.toString()),
        if (r['response'] != null) KV('Phản hồi của cơ quan', r['response']?.toString()),
        if (((r['same_location_count'] as num?) ?? 0) > 0)
          KV('Cùng vị trí', '${(r['same_location_count'] as num) + 1} người đã phản ánh sự việc tại khu vực này – cơ quan xử lý gộp thông tin'),
        if (pt != null) ...[
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              height: 156,
              child: NetworkMap(
                options: MapOptions(initialCenter: pt, initialZoom: 13.5, interactionOptions: const InteractionOptions(flags: InteractiveFlag.none)),
                children: [
                  MapTileLayer(urlTemplate: tileUrl),
                  MarkerLayer(markers: [Marker(point: pt, width: 32, height: 38, alignment: Alignment.topCenter, child: Image.asset('assets/markers/$icon.png'))]),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                icon: const Icon(Icons.directions_outlined),
                label: const Text('Chỉ đường'),
                onPressed: () {
                  Navigator.pop(sheetCtx);
                  context.push('/route', extra: RouteArgs(pt, title: '${r['code']} · ${r['typeLabel'] ?? 'Phản ánh'}'));
                },
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                icon: const Icon(Icons.map_outlined),
                label: const Text('Xem trên bản đồ'),
                onPressed: () {
                  Navigator.pop(sheetCtx);
                  context.go('/map', extra: MapFocus(pt, zoom: 14, layer: 'reports'));
                },
              ),
            ),
          ]),
        ],
        if ((r['photos'] as List?)?.isNotEmpty == true) ...[
          const SizedBox(height: 10),
          SizedBox(
            height: 96,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [for (final p in (r['photos'] as List)) Padding(padding: const EdgeInsets.only(right: 6), child: ClipRRect(borderRadius: BorderRadius.circular(8), child: NetImage(p as String, width: 96, height: 96)))],
            ),
          ),
        ],
        const SizedBox(height: 12),
        const Text('Tiến độ xử lý', style: TextStyle(fontWeight: FontWeight.w800)),
        for (final t in ((r['timeline'] as List?) ?? []).cast<Map>())
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.circle, size: 12, color: StatusChip.toneOf(t['status'] as String?)),
            title: Text(t['label']?.toString() ?? t['status'].toString(), style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${fmtDateTime(t['at'])}${t['note'] != null ? '\n${t['note']}' : ''}'),
          ),
      ]),
    ),
  );
}

/// M11 – Quản lý phản ánh của tôi, tra cứu theo mã và xem Bản đồ phản ánh công khai.
class MyReportsPage extends StatelessWidget {
  const MyReportsPage({super.key, this.code});
  final String? code;
  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 2,
        child: ResponsiveScaffold(
          maxWidth: 760,
          appBar: AppBar(
            title: const Text('Phản ánh hiện trường'),
            actions: [
              IconButton(tooltip: 'Gửi phản ánh mới', icon: const Icon(Icons.add_comment_outlined), onPressed: () => context.push('/report')),
            ],
            bottom: const TabBar(tabs: [Tab(text: 'Của tôi & Tra cứu'), Tab(text: 'Bản đồ công khai')]),
          ),
          body: TabBarView(children: [MyReportsBody(code: code), const PublicReportsBody()]),
        ),
      );
}

class MyReportsBody extends ConsumerStatefulWidget {
  const MyReportsBody({super.key, this.code});
  final String? code;
  @override
  ConsumerState<MyReportsBody> createState() => _MyReportsBodyState();
}

class _MyReportsBodyState extends ConsumerState<MyReportsBody> {
  late final lookup = TextEditingController(text: widget.code ?? '');

  @override
  void initState() {
    super.initState();
    if (widget.code != null && widget.code!.isNotEmpty) WidgetsBinding.instance.addPostFrameCallback((_) => _find());
  }

  @override
  void dispose() {
    lookup.dispose();
    super.dispose();
  }

  Future<void> _find() async {
    final c = lookup.text.trim().toUpperCase();
    if (c.isEmpty) return;
    try {
      final r = await ref.read(apiProvider).get<Map<String, dynamic>>('/api/mobile/reports/$c');
      if (mounted) showReportDetailSheet(context, ref, r);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final queued = ref.watch(outboxProvider.select((o) => o.items.where((i) => i.entity == 'report' && i.status != OutboxStatus.done).toList()));
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(myReportsProvider);
        ref.invalidate(publicReportsProvider);
      },
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Row(children: [
          Expanded(child: TextField(controller: lookup, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(hintText: 'Tra cứu mã hồ sơ (PA-2026-0001)', isDense: true), onSubmitted: (_) => _find())),
          const SizedBox(width: 8),
          FilledButton(onPressed: _find, child: const Text('Tra cứu')),
        ]),
        if (queued.isNotEmpty) ...[
          const SizedBox(height: 14),
          SectionCard(
            title: 'Chờ gửi trên máy (${queued.length})',
            icon: Icons.cloud_queue,
            trailing: TextButton(onPressed: () => context.push('/sync'), child: const Text('Đồng bộ')),
            child: Column(children: [
              for (final q in queued)
                ListTile(dense: true, contentPadding: EdgeInsets.zero, title: Text(q.title), subtitle: Text(q.message ?? 'Chưa gửi'), trailing: StatusChip(q.status == OutboxStatus.failed ? 'Lỗi' : 'Chưa gửi', color: q.status == OutboxStatus.failed ? AppColors.fire : AppColors.orange, dense: true)),
            ]),
          ),
        ],
        const SizedBox(height: 14),
        if (!s.signedIn)
          const NoticeBox('Đăng nhập (tài khoản người dân) để xem toàn bộ phản ánh đã gửi. Khách có thể tra cứu bằng mã hồ sơ hoặc chuyển sang tab Bản đồ công khai.')
        else
          AsyncView(
            value: ref.watch(myReportsProvider),
            onRetry: () => ref.invalidate(myReportsProvider),
            builder: (Loaded<J> l) {
              final items = ((l.data['items'] as List?) ?? []).cast<Map>();
              if (items.isEmpty) return const EmptyView('Bạn chưa gửi phản ánh nào');
              return Card(child: Column(children: [for (final r in items) ReportTile(r.cast<String, dynamic>(), onTap: () => showReportDetailSheet(context, ref, r.cast<String, dynamic>()))]));
            },
          ),
      ]),
    );
  }
}

/// Bản đồ & danh sách phản ánh công khai (đồng bộ với trang /phan-anh trên WebGIS).
class PublicReportsBody extends ConsumerStatefulWidget {
  const PublicReportsBody({super.key});
  @override
  ConsumerState<PublicReportsBody> createState() => _PublicReportsBodyState();
}

class _PublicReportsBodyState extends ConsumerState<PublicReportsBody> {
  final map = MapController();
  String selectedType = '';
  String? basemapId;
  bool showLegend = true;

  @override
  void dispose() {
    map.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final pub = ref.watch(publicReportsProvider);
    final province = ref.watch(provinceGeoProvider).asData?.value.data;
    final bms = ((s.map['basemaps'] as List?) ?? []).cast<Map>();
    final cur = bms.isEmpty ? null : bms.firstWhere((b) => b['id'] == (basemapId ?? 'satellite'), orElse: () => bms.first);
    final tileUrl = cur == null ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : cur['url'] as String;
    final types = ((s.catalogs['report_types'] as List?) ?? []).cast<Map>();
    final typeMap = {for (final e in reportTypeLabels.entries) e.key: e.value, for (final t in types) t['key'].toString(): t['label'].toString()};
    final bounds = LatLngBounds(const LatLng(13.91, 107.33), const LatLng(15.43, 108.56));
    final borderLines = <Polyline>[];
    if (province != null) {
      for (final f in (province['features'] as List).cast<Map>()) {
        for (final ring in ringsOf(f['geometry'] as Map)) {
          borderLines.add(Polyline(points: ring.map((p) => LatLng(p[1], p[0])).toList(), color: const Color(0xFF9B4DFF), strokeWidth: 2.3));
        }
      }
    }

    return AsyncView(
      value: pub,
      onRetry: () => ref.invalidate(publicReportsProvider),
      builder: (Loaded<J> l) {
        final all = ((l.data['items'] as List?) ?? []).cast<Map>().map((e) => e.cast<String, dynamic>()).toList();
        final filtered = selectedType.isEmpty ? all : all.where((r) => r['type'] == selectedType).toList();
        final markers = <Marker>[
          for (final r in filtered)
            if (r['lat'] != null && r['lon'] != null)
              Marker(
                point: LatLng((r['lat'] as num).toDouble(), (r['lon'] as num).toDouble()),
                width: 30,
                height: 36,
                alignment: Alignment.topCenter,
                child: GestureDetector(
                  onTap: () => showReportDetailSheet(context, ref, r),
                  child: Image.asset('assets/markers/${reportTypeIcons[r['type']] ?? 'report-other'}.png'),
                ),
              ),
        ];

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(publicReportsProvider),
          child: ListView(padding: const EdgeInsets.all(14), children: [
            SizedBox(
              height: 40,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                Padding(padding: const EdgeInsets.only(right: 6), child: ChoiceChip(label: Text('Tất cả (${all.length})'), selected: selectedType.isEmpty, onSelected: (_) => setState(() => selectedType = ''))),
                for (final e in reportTypeIcons.entries)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: ChoiceChip(
                      label: Text(typeMap[e.key] ?? e.key),
                      selected: selectedType == e.key,
                      onSelected: (_) => setState(() => selectedType = e.key),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: SizedBox(
                height: 280,
                child: Stack(children: [
                  NetworkMap(
                    mapController: map,
                    options: MapOptions(initialCameraFit: CameraFit.bounds(bounds: bounds, padding: const EdgeInsets.all(18)), minZoom: 6, maxZoom: 17),
                    children: [
                      MapTileLayer(urlTemplate: tileUrl),
                      PolylineLayer(polylines: borderLines),
                      MarkerLayer(markers: markers),
                    ],
                  ),
                  Positioned(
                    right: 8,
                    top: 8,
                    child: Column(children: [
                      Material(
                        color: showLegend ? AppColors.forest : Colors.white,
                        elevation: 2,
                        borderRadius: BorderRadius.circular(8),
                        child: IconButton(
                          visualDensity: VisualDensity.compact,
                          tooltip: 'Chú giải loại phản ánh',
                          icon: Icon(Icons.legend_toggle, size: 20, color: showLegend ? Colors.white : AppColors.navy),
                          onPressed: () => setState(() => showLegend = !showLegend),
                        ),
                      ),
                      if (bms.length > 1) ...[
                        const SizedBox(height: 6),
                        Material(
                          color: Colors.white,
                          elevation: 2,
                          borderRadius: BorderRadius.circular(8),
                          child: IconButton(
                            visualDensity: VisualDensity.compact,
                            tooltip: 'Đổi bản đồ nền',
                            icon: const Icon(Icons.public, size: 20, color: AppColors.navy),
                            onPressed: () => setState(() {
                              final i = bms.indexWhere((b) => b['id'] == cur?['id']);
                              basemapId = bms[(i + 1) % bms.length]['id'] as String;
                            }),
                          ),
                        ),
                      ],
                      const SizedBox(height: 6),
                      Material(
                        color: Colors.white,
                        elevation: 2,
                        borderRadius: BorderRadius.circular(8),
                        child: IconButton(
                          visualDensity: VisualDensity.compact,
                          tooltip: 'Toàn vùng',
                          icon: const Icon(Icons.zoom_out_map, size: 20, color: AppColors.navy),
                          onPressed: () => map.fitCamera(CameraFit.bounds(bounds: bounds, padding: const EdgeInsets.all(18))),
                        ),
                      ),
                    ]),
                  ),
                  if (showLegend)
                    Positioned(
                      left: 8,
                      bottom: 8,
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 215),
                        child: Card(
                          color: Colors.white.withValues(alpha: .94),
                          margin: EdgeInsets.zero,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                              const Text('Chú giải loại phản ánh', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: AppColors.navy)),
                              const SizedBox(height: 3),
                              for (final e in reportTypeIcons.entries)
                                Padding(
                                  padding: const EdgeInsets.symmetric(vertical: 1),
                                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                                    Image.asset('assets/markers/${e.value}.png', height: 16),
                                    const SizedBox(width: 5),
                                    Flexible(child: Text(typeMap[e.key] ?? e.key, style: const TextStyle(fontSize: 10.5), overflow: TextOverflow.ellipsis)),
                                  ]),
                                ),
                            ]),
                          ),
                        ),
                      ),
                    ),
                ]),
              ),
            ),
            const SourceNote('Vị trí phản ánh công khai được làm tròn ~1 km và ẩn thông tin người gửi để bảo mật. Chạm biểu tượng trên bản đồ để xem chi tiết.'),
            const SizedBox(height: 10),
            SectionCard(
              title: 'Danh sách phản ánh công khai (${filtered.length})',
              icon: Icons.campaign_outlined,
              trailing: TextButton(onPressed: () => context.go('/map'), child: const Text('Bản đồ lớn')),
              child: filtered.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        'Chưa có phản ánh nào được duyệt công khai ở mục này. Phản ánh mới gửi sẽ xuất hiện sau khi cán bộ tiếp nhận kiểm tra và bật chế độ Công khai.',
                        style: TextStyle(fontSize: 12.5, color: AppColors.muted, height: 1.4),
                      ),
                    )
                  : Column(children: [for (final r in filtered) ReportTile(r, onTap: () => showReportDetailSheet(context, ref, r))]),
            ),
          ]),
        );
      },
    );
  }
}
