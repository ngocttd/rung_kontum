import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/location.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import 'object_page.dart';

/// Vị trí cần mở bản đồ tới (từ tin, cảnh báo, nhiệm vụ…).
class MapFocus {
  const MapFocus(this.point, {this.zoom = 14, this.layer});
  final LatLng point;
  final double zoom;
  final String? layer;
}

/// M04 – Bản đồ: tìm địa danh/toạ độ, GPS (hiện sai số), đổi nền, bật/tắt lớp, chọn đối tượng,
/// đo khoảng cách/diện tích, lọc điểm nóng theo thời gian. Lớp raster lấy tile theo vùng/mức zoom từ máy chủ.
class MapPage extends ConsumerStatefulWidget {
  const MapPage({super.key, this.focus});
  final Object? focus;
  @override
  ConsumerState<MapPage> createState() => _MapPageState();
}

enum Measure { none, distance, area }

class _MapPageState extends ConsumerState<MapPage> {
  final map = MapController();
  final search = TextEditingController();
  String basemap = 'satellite';
  final on = <String>{'province', 'communes', 'hotspots'};
  final opacity = <String, double>{};
  String choro = ''; // '', danger_cls, cover
  int hotspotHours = 168;
  Fix? me;
  Measure measure = Measure.none;
  final pts = <LatLng>[];
  List<Map<String, dynamic>> results = [];

  @override
  void initState() {
    super.initState();
    final s = ref.read(sessionProvider);
    if (s.user != null && (s.user!.role == 'specialist' || s.user!.role == 'leader')) on.add('tasks');
  }

  @override
  void didUpdateWidget(MapPage old) {
    super.didUpdateWidget(old);
    if (widget.focus != old.focus) _applyFocus();
  }

  void _applyFocus() {
    final f = widget.focus;
    if (f is MapFocus) {
      if (f.layer != null) setState(() => on.add(f.layer!));
      WidgetsBinding.instance.addPostFrameCallback((_) => map.move(f.point, f.zoom));
    }
  }

  LatLngBounds get _aoi {
    final b = (ref.read(sessionProvider).map['bounds'] as List?)?.cast<num>() ?? [107.33, 13.91, 108.56, 15.43];
    return LatLngBounds(LatLng(b[1].toDouble(), b[0].toDouble()), LatLng(b[3].toDouble(), b[2].toDouble()));
  }

  Future<void> _locate() async {
    try {
      final f = await LocationService.current();
      setState(() => me = f);
      map.move(f.point, math.max(map.camera.zoom, 14));
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Vị trí của bạn: ${fmtCoord(f.point.latitude, f.point.longitude)} – ${f.label}')));
    } on LocationException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  void _search(String q) {
    final t = q.trim();
    final m = RegExp(r'^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$').firstMatch(t);
    if (m != null) {
      var a = double.parse(m.group(1)!), b = double.parse(m.group(2)!);
      if (a > 90) (a, b) = (b, a); // người dùng nhập "kinh độ, vĩ độ"
      setState(() => results = [{'name': 'Toạ độ $a, $b', 'lat': a, 'lon': b}]);
      return;
    }
    final n = _norm(t);
    final list = ref.read(sessionProvider).communes.where((c) => n.length >= 2 && _norm(c['name'] as String).contains(n)).map((c) {
      final ctr = (c['center'] as List?)?.cast<num>();
      return {'name': c['name'], 'lat': ctr?[1], 'lon': ctr?[0], 'code': c['code']};
    }).toList();
    setState(() => results = list.take(8).toList());
  }

  void _tap(TapPosition _, LatLng p) {
    if (measure != Measure.none) return setState(() => pts.add(p));
    final geo = ref.read(communesGeoProvider).asData?.value.data;
    if (geo == null || !on.contains('communes')) return;
    for (final f in (geo['features'] as List).cast<Map>()) {
      if (pointInGeometry(p.longitude, p.latitude, f['geometry'] as Map)) {
        final props = (f['properties'] as Map).cast<String, dynamic>();
        context.push('/object', extra: ObjectRef(kind: 'commune', id: props['code'].toString(), props: props, point: p));
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final layers = ref.watch(layersProvider).asData?.value.data;
    final basemaps = ((s.map['basemaps'] as List?) ?? []).cast<Map>();
    final bm = basemaps.firstWhere((b) => b['id'] == basemap, orElse: () => basemaps.isEmpty ? {'url': 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', 'attribution': '© OpenStreetMap'} : basemaps.first);
    final api = ref.watch(apiProvider);
    final rasters = ((layers?['raster'] as List?) ?? []).cast<Map>();

    final children = <Widget>[
      TileLayer(urlTemplate: bm['url'] as String, userAgentPackageName: 'vn.gov.kontum.mobilegis', maxNativeZoom: 19),
      for (final r in rasters.where((r) => on.contains(r['id'])))
        if (r['tiles'] != null)
          Opacity(
            opacity: opacity[r['id']] ?? 0.85,
            child: TileLayer(
              urlTemplate: api.url(r['tiles']['url'] as String),
              minNativeZoom: (r['tiles']['minzoom'] as num?)?.toInt() ?? 7,
              maxNativeZoom: (r['tiles']['maxzoom'] as num?)?.toInt() ?? 14,
              userAgentPackageName: 'vn.gov.kontum.mobilegis',
              tileProvider: NetworkTileProvider(headers: api.authHeaders),
            ),
          )
        else if (r['image']?['coordinates'] != null)
          OverlayImageLayer(overlayImages: [
            OverlayImage(
              bounds: _boundsOf(r['image']['coordinates'] as List),
              imageProvider: NetworkImage(api.url(r['image']['url'] as String)),
              opacity: opacity[r['id']] ?? 0.85,
            ),
          ]),
      if (on.contains('communes')) _CommunesLayer(choro: choro),
      if (on.contains('province')) const _ProvinceLayer(),
      if (on.contains('candidates')) const _CandidatesLayer(),
      if (on.contains('reports')) const _ReportsLayer(),
      if (on.contains('hotspots')) _HotspotsLayer(hours: hotspotHours),
      if (on.contains('tasks')) const _TasksLayer(),
      if (me != null) ...[
        CircleLayer(circles: [CircleMarker(point: me!.point, radius: me!.accuracy ?? 10, useRadiusInMeter: true, color: AppColors.blue.withValues(alpha: .15), borderColor: AppColors.blue, borderStrokeWidth: 1)]),
        MarkerLayer(markers: [Marker(point: me!.point, width: 22, height: 22, child: Container(decoration: BoxDecoration(color: AppColors.blue, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3))))]),
      ],
      if (pts.isNotEmpty) ...[
        if (measure == Measure.area && pts.length > 2) PolygonLayer(polygons: [Polygon(points: pts, color: AppColors.yellow.withValues(alpha: .25), borderColor: AppColors.yellow, borderStrokeWidth: 2)]),
        PolylineLayer(polylines: [Polyline(points: measure == Measure.area && pts.length > 2 ? [...pts, pts.first] : pts, color: AppColors.yellow, strokeWidth: 3)]),
        MarkerLayer(markers: [for (final p in pts) Marker(point: p, width: 12, height: 12, child: Container(decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle, border: Border.all(color: AppColors.orange, width: 2))))]),
      ],
      SimpleAttributionWidget(source: Text(bm['attribution'] as String? ?? ''), backgroundColor: Colors.white70),
    ];

    return Scaffold(
      body: Stack(children: [
        FlutterMap(
          mapController: map,
          options: MapOptions(
            initialCameraFit: CameraFit.bounds(bounds: _aoi, padding: const EdgeInsets.all(24)),
            minZoom: 6,
            maxZoom: 18,
            onTap: _tap,
            onMapReady: _applyFocus,
            interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
          ),
          children: children,
        ),
        // tìm kiếm
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Column(children: [
              Material(
                elevation: 3,
                borderRadius: BorderRadius.circular(12),
                child: TextField(
                  controller: search,
                  onChanged: _search,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Tìm xã/phường hoặc toạ độ (14.35, 108.0)',
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: search.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => [search.clear(), results = []])),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
              ),
              if (results.isNotEmpty)
                Card(
                  margin: const EdgeInsets.only(top: 4),
                  child: Column(children: [
                    for (final r in results)
                      ListTile(
                        dense: true,
                        leading: const Icon(Icons.place_outlined),
                        title: Text(r['name'] as String),
                        onTap: () {
                          FocusScope.of(context).unfocus();
                          if (r['lat'] != null) map.move(LatLng((r['lat'] as num).toDouble(), (r['lon'] as num).toDouble()), r['code'] != null ? 11.5 : 15);
                          setState(() => results = []);
                        },
                      ),
                  ]),
                ),
            ]),
          ),
        ),
        // công cụ bên phải
        Positioned(
          right: 12,
          top: MediaQuery.of(context).padding.top + 74,
          child: Column(children: [
            _btn(Icons.layers_outlined, 'Lớp dữ liệu', () => _layerSheet(rasters)),
            _btn(Icons.public, 'Bản đồ nền', () => _basemapSheet(basemaps)),
            _btn(Icons.my_location, 'Vị trí của tôi', _locate),
            _btn(Icons.straighten, 'Đo đạc', _measureMenu, active: measure != Measure.none),
            _btn(Icons.zoom_out_map, 'Toàn vùng', () => map.fitCamera(CameraFit.bounds(bounds: _aoi, padding: const EdgeInsets.all(24)))),
          ]),
        ),
        if (me != null && me!.poor)
          Positioned(
            left: 12,
            right: 70,
            top: MediaQuery.of(context).padding.top + 74,
            child: NoticeBox('Sai số GPS lớn (±${me!.accuracy!.round()} m). Khi gửi dữ liệu có thể chọn vị trí trên bản đồ.', warn: true),
          ),
        if (measure != Measure.none) Positioned(left: 12, right: 12, bottom: 84, child: _measureBar()),
        // nhóm lớp nhanh (prototype)
        Positioned(left: 8, right: 8, bottom: 8, child: _quickBar()),
      ]),
    );
  }

  Widget _btn(IconData i, String tip, VoidCallback f, {bool active = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Material(
          color: active ? AppColors.forest : Colors.white,
          elevation: 3,
          borderRadius: BorderRadius.circular(10),
          child: IconButton(tooltip: tip, icon: Icon(i, color: active ? Colors.white : AppColors.navy), onPressed: f),
        ),
      );

  Widget _quickBar() {
    final groups = <(String, IconData, List<String>)>[
      ('Hành chính', Icons.account_balance_outlined, ['province', 'communes']),
      ('Rừng', Icons.forest_outlined, ['lc-2023']),
      ('Điểm cháy', Icons.local_fire_department_outlined, ['hotspots']),
      ('Ảnh vệ tinh', Icons.satellite_alt_outlined, ['s2-latest']),
      ('Biến động', Icons.park_outlined, ['candidates']),
    ];
    return Card(
      elevation: 3,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          for (final g in groups)
            Expanded(
              child: InkWell(
                onTap: () => setState(() {
                  final all = g.$3.every(on.contains);
                  for (final id in g.$3) {
                    all ? on.remove(id) : on.add(id);
                  }
                }),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Icon(g.$2, color: g.$3.every(on.contains) ? AppColors.forest : AppColors.muted),
                    Text(g.$1, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: g.$3.every(on.contains) ? AppColors.forest : AppColors.muted)),
                  ]),
                ),
              ),
            ),
        ]),
      ),
    );
  }

  void _measureMenu() {
    if (measure != Measure.none) return setState(() => [measure = Measure.none, pts.clear()]);
    showModalBottomSheet(
      context: context,
      builder: (_) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.timeline), title: const Text('Đo khoảng cách'), subtitle: const Text('Chạm lần lượt các điểm trên bản đồ'), onTap: () => [Navigator.pop(context), setState(() => [measure = Measure.distance, pts.clear()])]),
          ListTile(leading: const Icon(Icons.pentagon_outlined), title: const Text('Đo diện tích'), subtitle: const Text('Chạm các đỉnh của vùng (≥ 3 điểm)'), onTap: () => [Navigator.pop(context), setState(() => [measure = Measure.area, pts.clear()])]),
        ]),
      ),
    );
  }

  Widget _measureBar() {
    const d = Distance();
    var len = 0.0;
    for (var i = 1; i < pts.length; i++) {
      len += d.as(LengthUnit.Meter, pts[i - 1], pts[i]);
    }
    final area = measure == Measure.area && pts.length > 2 ? polygonAreaM2(pts) : 0.0;
    final text = measure == Measure.distance
        ? 'Khoảng cách: ${len >= 1000 ? '${fmtNum(len / 1000, 2)} km' : '${fmtNum(len)} m'}'
        : 'Diện tích: ${area >= 10000 ? '${fmtNum(area / 10000, 2)} ha' : '${fmtNum(area)} m²'}';
    return Card(
      color: AppColors.navy,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 4, 4, 4),
        child: Row(children: [
          Expanded(child: Text(pts.isEmpty ? 'Chạm lên bản đồ để thêm điểm' : text, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
          IconButton(tooltip: 'Xoá điểm cuối', onPressed: pts.isEmpty ? null : () => setState(() => pts.removeLast()), icon: const Icon(Icons.undo, color: Colors.white)),
          IconButton(tooltip: 'Kết thúc', onPressed: () => setState(() => [measure = Measure.none, pts.clear()]), icon: const Icon(Icons.close, color: Colors.white)),
        ]),
      ),
    );
  }

  void _basemapSheet(List<Map> basemaps) => showModalBottomSheet(
        context: context,
        builder: (_) => SafeArea(
          child: RadioGroup<String>(
            groupValue: basemap,
            onChanged: (v) {
              setState(() => basemap = v!);
              Navigator.pop(context);
            },
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              const ListTile(title: Text('Bản đồ nền', style: TextStyle(fontWeight: FontWeight.w800))),
              for (final b in basemaps) RadioListTile<String>(value: b['id'] as String, title: Text(b['title'] as String)),
            ]),
          ),
        ),
      );

  void _layerSheet(List<Map> rasters) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => StatefulBuilder(builder: (context, setSheet) {
        void toggle(String id, bool v) {
          setState(() => v ? on.add(id) : on.remove(id));
          setSheet(() {});
        }

        Widget vec(String id, String title, IconData icon, {String? sub}) => SwitchListTile(dense: true, value: on.contains(id), onChanged: (v) => toggle(id, v), secondary: Icon(icon, color: AppColors.forest), title: Text(title), subtitle: sub == null ? null : Text(sub, style: const TextStyle(fontSize: 11.5)));
        final groups = <String, List<Map>>{};
        for (final r in rasters) {
          groups.putIfAbsent(r['group_label']?.toString() ?? 'Khác', () => []).add(r);
        }
        final staff = ref.read(sessionProvider).user;
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: .7,
          maxChildSize: .95,
          builder: (_, sc) => ListView(controller: sc, children: [
            const _H('HÀNH CHÍNH'),
            vec('province', 'Ranh giới Kon Tum (cũ)', Icons.border_outer),
            vec('communes', 'Ranh giới xã/phường', Icons.grid_on),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Wrap(spacing: 6, children: [
                for (final c in const [('', 'Không tô màu'), ('danger_cls', 'Cấp nguy cơ cháy hôm nay'), ('cover', 'Tỷ lệ che phủ rừng')])
                  ChoiceChip(label: Text(c.$2, style: const TextStyle(fontSize: 12)), selected: choro == c.$1, onSelected: (_) => [setState(() => choro = c.$1), setSheet(() {})]),
              ]),
            ),
            const _H('CẢNH BÁO CHÁY RỪNG'),
            vec('hotspots', 'Điểm nóng FIRMS', Icons.local_fire_department, sub: 'Chưa xác minh trừ khi ghi rõ'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Wrap(spacing: 6, children: [
                for (final h in const [(24, '24 giờ'), (48, '48 giờ'), (168, '7 ngày')])
                  ChoiceChip(label: Text(h.$2), selected: hotspotHours == h.$1, onSelected: (_) => [setState(() => hotspotHours = h.$1), setSheet(() {})]),
              ]),
            ),
            const _H('BIẾN ĐỘNG – HIỆN TRƯỜNG'),
            vec('candidates', 'Biến động rừng nghi vấn', Icons.park_outlined, sub: 'Sentinel-2, chưa xác minh hiện trường'),
            vec('reports', 'Phản ánh công khai', Icons.campaign_outlined),
            if (staff != null && (staff.role == 'specialist' || staff.role == 'leader')) vec('tasks', 'Nhiệm vụ hiện trường (nội bộ)', Icons.assignment_outlined),
            for (final e in groups.entries) ...[
              _H(e.key.toUpperCase()),
              for (final r in e.value)
                Column(children: [
                  SwitchListTile(
                    dense: true,
                    value: on.contains(r['id']),
                    onChanged: (v) => toggle(r['id'] as String, v),
                    secondary: Icon(r['tiles'] != null ? Icons.grid_view_rounded : Icons.image_outlined, color: AppColors.forest),
                    title: Text(r['title'] as String),
                    subtitle: Text([r['resolution'], r['source']].where((x) => x != null && x.toString().isNotEmpty).join(' · '), maxLines: 2, style: const TextStyle(fontSize: 11)),
                  ),
                  if (on.contains(r['id']))
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Row(children: [
                        const Text('Độ mờ', style: TextStyle(fontSize: 12)),
                        Expanded(child: Slider(value: opacity[r['id']] ?? .85, min: .1, max: 1, onChanged: (v) => [setState(() => opacity[r['id'] as String] = v), setSheet(() {})])),
                      ]),
                    ),
                  if (on.contains(r['id']) && (r['legend'] as List?)?.isNotEmpty == true) _Legend((r['legend'] as List).cast<Map>()),
                ]),
            ],
            const SizedBox(height: 20),
          ]),
        );
      }),
    );
  }
}

class _H extends StatelessWidget {
  const _H(this.t);
  final String t;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 4), child: Text(t, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: AppColors.forest, letterSpacing: .5)));
}

class _Legend extends StatelessWidget {
  const _Legend(this.items);
  final List<Map> items;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 16, 8),
        child: Wrap(spacing: 10, runSpacing: 4, children: [
          for (final l in items)
            Row(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 14, height: 10, decoration: BoxDecoration(color: _hex(l['color'] as String?), borderRadius: BorderRadius.circular(2))),
              const SizedBox(width: 4),
              Text((l['label'] ?? l['value']).toString(), style: const TextStyle(fontSize: 11)),
            ]),
        ]),
      );
}

Color _hex(String? h) {
  if (h == null || !h.startsWith('#') || h.length < 7) return Colors.grey;
  return Color(int.parse('FF${h.substring(1, 7)}', radix: 16));
}

LatLngBounds _boundsOf(List coords) {
  final c = coords.cast<List>();
  return LatLngBounds(LatLng((c[0][1] as num).toDouble(), (c[0][0] as num).toDouble()), LatLng((c[2][1] as num).toDouble(), (c[2][0] as num).toDouble()));
}

/// Diện tích đa giác trên mặt cầu (m²).
double polygonAreaM2(List<LatLng> p) {
  const r = 6378137.0;
  var s = 0.0;
  for (var i = 0; i < p.length; i++) {
    final a = p[i], b = p[(i + 1) % p.length];
    s += (b.longitudeInRad - a.longitudeInRad) * (2 + math.sin(a.latitudeInRad) + math.sin(b.latitudeInRad));
  }
  return (s * r * r / 2).abs();
}

// ---------- lớp vector ----------
class _ProvinceLayer extends ConsumerWidget {
  const _ProvinceLayer();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final g = ref.watch(provinceGeoProvider).asData?.value.data;
    if (g == null) return const SizedBox.shrink();
    final lines = <Polyline>[];
    for (final f in (g['features'] as List).cast<Map>()) {
      for (final ring in ringsOf(f['geometry'] as Map)) {
        lines.add(Polyline(points: ring.map((p) => LatLng(p[1], p[0])).toList(), color: const Color(0xFF9B4DFF), strokeWidth: 2.6));
      }
    }
    return PolylineLayer(polylines: lines);
  }
}

class _CommunesLayer extends ConsumerWidget {
  const _CommunesLayer({required this.choro});
  final String choro;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final g = ref.watch(communesGeoProvider).asData?.value.data;
    if (g == null) return const SizedBox.shrink();
    final polys = <Polygon>[];
    for (final f in (g['features'] as List).cast<Map>()) {
      final p = f['properties'] as Map;
      Color fill = Colors.transparent;
      if (choro == 'danger_cls' && p['danger_cls'] != null) fill = AppColors.dangerOf(p['danger_cls'] as num).withValues(alpha: .45);
      if (choro == 'cover' && p['cover'] != null) fill = Color.lerp(const Color(0xFFF5F0C8), AppColors.forestDark, ((p['cover'] as num) / 90).clamp(0, 1).toDouble())!.withValues(alpha: .55);
      final geom = f['geometry'] as Map;
      final polysCoords = geom['type'] == 'Polygon' ? [geom['coordinates'] as List] : (geom['coordinates'] as List).cast<List>();
      for (final poly in polysCoords) {
        final rings = poly.cast<List>().map((r) => r.map((c) => LatLng(((c as List)[1] as num).toDouble(), (c[0] as num).toDouble())).toList()).toList();
        polys.add(Polygon(points: rings.first, holePointsList: rings.length > 1 ? rings.sublist(1) : null, color: fill, borderColor: Colors.white.withValues(alpha: .85), borderStrokeWidth: 1.1));
      }
    }
    return PolygonLayer(polygons: polys);
  }
}

class _HotspotsLayer extends ConsumerWidget {
  const _HotspotsLayer({required this.hours});
  final int hours;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final g = ref.watch(hotspotsProvider).asData?.value.data;
    if (g == null) return const SizedBox.shrink();
    final since = DateTime.now().toUtc().subtract(Duration(hours: hours));
    final markers = <Marker>[];
    for (final f in (g['features'] as List).cast<Map>()) {
      final p = (f['properties'] as Map).cast<String, dynamic>();
      final t = DateTime.tryParse(p['utc']?.toString() ?? '');
      if (t != null && t.isBefore(since)) continue;
      final c = (f['geometry'] as Map)['coordinates'] as List;
      final pt = LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble());
      final icon = switch (p['status']) { 'confirmed' || 'handling' => 'fire-confirmed', 'rejected' => 'fire-rejected', 'verifying' || 'assigned' => 'fire-investigating', 'closed' => 'fire-resolved', _ => 'hotspot-unverified' };
      markers.add(Marker(
        point: pt,
        width: 34,
        height: 40,
        alignment: Alignment.topCenter,
        child: GestureDetector(onTap: () => context.push('/object', extra: ObjectRef(kind: 'hotspot', id: p['id'].toString(), props: p, point: pt)), child: Image.asset('assets/markers/$icon.png')),
      ));
    }
    return MarkerLayer(markers: markers);
  }
}

class _CandidatesLayer extends ConsumerWidget {
  const _CandidatesLayer();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final g = ref.watch(candidatesProvider).asData?.value.data;
    if (g == null) return const SizedBox.shrink();
    final markers = <Marker>[];
    for (final f in (g['features'] as List).cast<Map>()) {
      final p = (f['properties'] as Map).cast<String, dynamic>();
      if (p['lat'] == null) continue;
      final pt = LatLng((p['lat'] as num).toDouble(), (p['lon'] as num).toDouble());
      markers.add(Marker(
        point: pt,
        width: 26,
        height: 26,
        child: GestureDetector(
          onTap: () => context.push('/object', extra: ObjectRef(kind: 'candidate', id: p['id'].toString(), props: {...p, 'geometry': f['geometry']}, point: pt)),
          child: Container(decoration: BoxDecoration(color: StatusChip.toneOf(p['status'] as String?).withValues(alpha: .85), shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2)), child: const Icon(Icons.park, size: 14, color: Colors.white)),
        ),
      ));
    }
    return MarkerLayer(markers: markers);
  }
}

class _ReportsLayer extends ConsumerWidget {
  const _ReportsLayer();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = ref.watch(publicReportsProvider).asData?.value.data;
    if (d == null) return const SizedBox.shrink();
    final markers = <Marker>[];
    for (final r in ((d['items'] as List?) ?? []).cast<Map>()) {
      if (r['lat'] == null) continue;
      final pt = LatLng((r['lat'] as num).toDouble(), (r['lon'] as num).toDouble());
      final icon = {'chay-rung': 'fire-investigating', 'pha-rung': 'forest-violation', 'lan-chiem': 'land-encroachment', 'van-chuyen': 'timber-transport', 'dong-vat': 'wildlife'}[r['type']] ?? 'report-other';
      markers.add(Marker(point: pt, width: 30, height: 36, alignment: Alignment.topCenter, child: GestureDetector(onTap: () => context.push('/object', extra: ObjectRef(kind: 'report', id: r['code'].toString(), props: r.cast<String, dynamic>(), point: pt)), child: Image.asset('assets/markers/$icon.png'))));
    }
    return MarkerLayer(markers: markers);
  }
}

class _TasksLayer extends ConsumerWidget {
  const _TasksLayer();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = ref.watch(assignmentsProvider).asData?.value.data;
    if (d == null) return const SizedBox.shrink();
    final markers = <Marker>[];
    for (final t in ((d['items'] as List?) ?? []).cast<Map>()) {
      if (t['lat'] == null || ['approved', 'cancelled'].contains(t['status'])) continue;
      final pt = LatLng((t['lat'] as num).toDouble(), (t['lon'] as num).toDouble());
      markers.add(Marker(point: pt, width: 30, height: 36, alignment: Alignment.topCenter, child: GestureDetector(onTap: () => context.push('/tasks/${t['id']}'), child: Image.asset('assets/markers/survey.png'))));
    }
    return MarkerLayer(markers: markers);
  }
}

String _norm(String s) {
  const from = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
  const to = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
  final b = StringBuffer();
  for (final ch in s.toLowerCase().split('')) {
    final i = from.indexOf(ch);
    b.write(i >= 0 ? to[i] : ch);
  }
  return b.toString();
}
