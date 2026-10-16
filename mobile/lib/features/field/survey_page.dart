import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/location.dart';
import '../../core/outbox.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/location_picker.dart';
import '../../widgets/media_picker.dart';
import '../map/map_page.dart' show polygonAreaM2;

/// M16 / quy trình 6.3 – Khảo sát, cập nhật hiện trạng: điểm / đường / vùng (chạm bản đồ hoặc đi bộ ghi GPS),
/// loại rừng, độ che phủ, mùa khảo sát, trạng thái lá (rừng khộp), nguyên nhân biến động, ảnh bằng chứng.
class SurveyPage extends ConsumerStatefulWidget {
  const SurveyPage({super.key, this.assignment});
  final Map<String, dynamic>? assignment;
  @override
  ConsumerState<SurveyPage> createState() => _SurveyPageState();
}

class _SurveyPageState extends ConsumerState<SurveyPage> {
  String geom = 'point';
  Fix? fix;
  final verts = <LatLng>[];
  double? worstAccuracy;
  StreamSubscription<Fix>? track;
  String? forestType;
  String season = seasonOf(DateTime.now());
  String leaf = 'full';
  double canopy = 60;
  String? cause;
  final notes = TextEditingController();
  List<PickedMedia> media = [];
  bool busy = false;

  @override
  void dispose() {
    track?.cancel();
    super.dispose();
  }

  bool get _khop => forestType == 'rung-khop';

  void _toggleTrack() {
    if (track != null) {
      track!.cancel();
      setState(() => track = null);
      return;
    }
    setState(() {
      track = LocationService.track().listen((f) => setState(() {
            verts.add(f.point);
            if (f.accuracy != null) worstAccuracy = worstAccuracy == null || f.accuracy! > worstAccuracy! ? f.accuracy : worstAccuracy;
          }), onError: (e) => _msg('$e'));
    });
  }

  Map<String, dynamic>? _geometry() {
    if (geom == 'point') return fix == null ? null : {'type': 'Point', 'coordinates': [fix!.point.longitude, fix!.point.latitude]};
    final c = [for (final p in verts) [p.longitude, p.latitude]];
    if (geom == 'line') return verts.length < 2 ? null : {'type': 'LineString', 'coordinates': c};
    return verts.length < 3 ? null : {'type': 'Polygon', 'coordinates': [[...c, c.first]]};
  }

  Future<void> _submit() async {
    final g = _geometry();
    if (g == null) return _msg(geom == 'point' ? 'Cần vị trí điểm khảo sát.' : 'Cần thêm điểm cho ${geom == 'line' ? 'đường (≥ 2)' : 'vùng (≥ 3)'}.');
    if (forestType == null) return _msg('Chọn loại rừng / hiện trạng.');
    setState(() => busy = true);
    final types = ((ref.read(sessionProvider).catalogs['forest_types'] as Map?) ?? {});
    await ref.read(outboxProvider.notifier).add(
          entity: 'survey',
          title: 'Khảo sát ${{'point': 'điểm', 'line': 'đường', 'polygon': 'vùng'}[geom]}: ${types[forestType] ?? forestType}',
          payload: {
            if (widget.assignment != null) 'assignment_id': widget.assignment!['id'],
            'geometry': g, 'forest_type': forestType, 'is_dipterocarp': _khop, 'season': season, 'leaf_state': leaf, 'canopy_cover': canopy.round(),
            'change_cause': cause, 'notes': notes.text.trim(), 'observed_at': DateTime.now().toUtc().toIso8601String(),
            'gps_accuracy': geom == 'point' ? fix?.accuracy : worstAccuracy, 'location_source': geom == 'point' ? fix?.source ?? 'gps' : (worstAccuracy != null ? 'gps' : 'map'),
          },
          files: [for (final m in media) (m.file, m.meta)],
          sendNow: false,
        );
    final r = await ref.read(outboxProvider.notifier).sync();
    ref.invalidate(assignmentsProvider);
    ref.invalidate(mySurveysProvider);
    final last = ref.read(outboxProvider).items.first;
    if (!mounted) return;
    setState(() => busy = false);
    await showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(last.status == OutboxStatus.done ? 'Đã nộp khảo sát ${last.serverId ?? ''}' : last.status == OutboxStatus.failed ? 'Chưa nộp được' : 'Đã lưu, chờ gửi'),
        content: Text(last.status == OutboxStatus.done ? 'Kết quả chờ người có thẩm quyền duyệt.${last.message != null ? '\n\nLưu ý từ máy chủ: ${last.message}' : ''}' : last.message ?? r.summary),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Đóng'))],
      ),
    );
    if (mounted) context.pop();
  }

  void _msg(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final types = ((s.catalogs['forest_types'] as Map?) ?? {}).cast<String, dynamic>();
    final causes = ((s.catalogs['change_causes'] as Map?) ?? {}).cast<String, dynamic>();
    final a = widget.assignment;
    final start = a?['lat'] != null ? LatLng((a!['lat'] as num).toDouble(), (a['lon'] as num).toDouble()) : (fix?.point ?? const LatLng(14.65, 107.95));
    final bms = ((s.map['basemaps'] as List?) ?? []).cast<Map>();
    final metric = geom == 'polygon' && verts.length > 2
        ? '${fmtNum(polygonAreaM2(verts) / 10000, 2)} ha'
        : geom == 'line' && verts.length > 1
            ? '${fmtNum(List.generate(verts.length - 1, (i) => const Distance().as(LengthUnit.Meter, verts[i], verts[i + 1])).fold<double>(0, (x, y) => x + y))} m'
            : '${verts.length} điểm';
    return Scaffold(
      appBar: AppBar(title: Text(a == null ? 'Khảo sát hiện trạng' : 'Khảo sát – ${a['code']}')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'point', icon: Icon(Icons.place_outlined), label: Text('Điểm')), ButtonSegment(value: 'line', icon: Icon(Icons.timeline), label: Text('Đường')), ButtonSegment(value: 'polygon', icon: Icon(Icons.pentagon_outlined), label: Text('Vùng'))],
          selected: {geom},
          onSelectionChanged: (v) => setState(() => [geom = v.first, verts.clear()]),
        ),
        const SizedBox(height: 10),
        if (geom == 'point')
          LocationField(value: fix, onChanged: (f) => setState(() => fix = f))
        else ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: SizedBox(
              height: 260,
              child: FlutterMap(
                options: MapOptions(initialCenter: start, initialZoom: a?['lat'] != null ? 15 : 10, onTap: (_, p) => setState(() => verts.add(p))),
                children: [
                  TileLayer(urlTemplate: bms.isEmpty ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : bms.first['url'] as String, userAgentPackageName: 'vn.gov.kontum.mobilegis'),
                  if (geom == 'polygon' && verts.length > 2) PolygonLayer(polygons: [Polygon(points: verts, color: AppColors.leaf.withValues(alpha: .3), borderColor: AppColors.yellow, borderStrokeWidth: 2)]),
                  if (verts.length > 1) PolylineLayer(polylines: [Polyline(points: verts, color: AppColors.yellow, strokeWidth: 3)]),
                  MarkerLayer(markers: [for (final p in verts) Marker(point: p, width: 12, height: 12, child: Container(decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle, border: Border.all(color: AppColors.orange, width: 2))))]),
                ],
              ),
            ),
          ),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: Text('Chạm bản đồ để thêm đỉnh hoặc đi bộ ghi GPS · $metric${worstAccuracy != null ? ' · GPS kém nhất ±${worstAccuracy!.round()} m' : ''}', style: const TextStyle(fontSize: 12, color: AppColors.muted))),
            IconButton(tooltip: 'Xoá đỉnh cuối', onPressed: verts.isEmpty ? null : () => setState(() => verts.removeLast()), icon: const Icon(Icons.undo)),
          ]),
          OutlinedButton.icon(onPressed: _toggleTrack, icon: Icon(track == null ? Icons.directions_walk : Icons.stop_circle_outlined), label: Text(track == null ? 'Đi bộ ghi theo GPS' : 'Dừng ghi GPS')),
        ],
        const SizedBox(height: 14),
        DropdownButtonFormField<String>(
          initialValue: forestType,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Loại rừng / hiện trạng *'),
          items: [for (final e in types.entries) DropdownMenuItem(value: e.key, child: Text(e.value.toString()))],
          onChanged: (v) => setState(() => forestType = v),
        ),
        const SizedBox(height: 10),
        SegmentedButton<String>(segments: const [ButtonSegment(value: 'dry', label: Text('Mùa khô')), ButtonSegment(value: 'wet', label: Text('Mùa mưa'))], selected: {season}, onSelectionChanged: (v) => setState(() => season = v.first)),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          initialValue: leaf,
          decoration: const InputDecoration(labelText: 'Trạng thái tán lá'),
          items: const [
            DropdownMenuItem(value: 'full', child: Text('Đủ lá')),
            DropdownMenuItem(value: 'partial', child: Text('Rụng một phần')),
            DropdownMenuItem(value: 'leafless', child: Text('Rụng hết lá')),
            DropdownMenuItem(value: 'unknown', child: Text('Không xác định')),
          ],
          onChanged: (v) => setState(() => leaf = v!),
        ),
        if (_khop && season == 'dry') ...[
          const SizedBox(height: 10),
          const NoticeBox('Rừng khộp mùa khô: rụng lá là tự nhiên. Ghi nhận trạng thái lá và nguyên nhân; không kết luận mất rừng từ một lần khảo sát mùa khô – hệ thống sẽ ghi chú cần khảo sát lại mùa mưa.', warn: true),
        ],
        const SizedBox(height: 10),
        Row(children: [const Text('Độ che phủ tán'), Expanded(child: Slider(value: canopy, max: 100, divisions: 20, label: '${canopy.round()}%', onChanged: (v) => setState(() => canopy = v))), Text('${canopy.round()}%')]),
        DropdownButtonFormField<String>(
          initialValue: cause,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Nguyên nhân biến động (nếu có)'),
          items: [const DropdownMenuItem<String>(value: null, child: Text('Không có biến động')), for (final e in causes.entries) DropdownMenuItem(value: e.key, child: Text(e.value.toString()))],
          onChanged: (v) => setState(() => cause = v),
        ),
        const SizedBox(height: 10),
        TextField(controller: notes, maxLines: 3, decoration: const InputDecoration(labelText: 'Ghi chú', alignLabelWithHint: true)),
        const SizedBox(height: 12),
        const Text('Ảnh bằng chứng', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        MediaPicker(items: media, fix: fix, max: 8, onChanged: (m) => setState(() => media = m)),
        const SizedBox(height: 12),
        const NoticeBox('Lưu tự động người khảo sát, thời gian, độ chính xác GPS; mọi chỉnh sửa sau đều có lịch sử phiên bản. Kết quả chờ duyệt trước khi cập nhật hiện trạng.'),
        const SizedBox(height: 14),
        FilledButton.icon(onPressed: busy ? null : _submit, icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Icon(Icons.cloud_upload_outlined), label: const Text('Nộp khảo sát')),
      ]),
    );
  }
}
