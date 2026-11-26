import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../app/theme.dart';
import '../core/data.dart';
import '../core/format.dart';
import '../core/location.dart';
import '../core/session.dart';
import 'common.dart';
import 'network_map.dart';

/// true/false khi đã có ranh giới tỉnh; null khi chưa tải được (khi đó không cảnh báo).
bool? insideProvince(WidgetRef ref, LatLng p) {
  final g = ref.read(provinceGeoProvider).asData?.value.data;
  if (g == null) return null;
  for (final f in (g['features'] as List).cast<Map>()) {
    if (pointInGeometry(p.longitude, p.latitude, f['geometry'] as Map)) return true;
  }
  return false;
}

const _outsideMsg = 'Vị trí nằm ngoài ranh giới vùng giám sát (Kon Tum cũ) – phản ánh sẽ không gán được xã/phường. Kiểm tra lại vị trí.';

/// Ô vị trí dùng chung cho phản ánh / khảo sát / xác minh: GPS (kèm sai số) hoặc chọn trên bản đồ / nhập tay.
class LocationField extends ConsumerStatefulWidget {
  const LocationField({super.key, required this.value, required this.onChanged, this.autoGps = true});
  final Fix? value;
  final ValueChanged<Fix?> onChanged;
  final bool autoGps;
  @override
  ConsumerState<LocationField> createState() => _LocationFieldState();
}

class _LocationFieldState extends ConsumerState<LocationField> {
  bool busy = false;
  String? error;

  @override
  void initState() {
    super.initState();
    if (widget.autoGps && widget.value == null) WidgetsBinding.instance.addPostFrameCallback((_) => _gps());
  }

  Future<void> _gps() async {
    setState(() => [busy = true, error = null]);
    try {
      final f = await LocationService.current();
      if (mounted) widget.onChanged(f);
    } on LocationException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _pick() async {
    final p = await Navigator.of(context).push<LatLng>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => LocationPickerPage(initial: widget.value?.point)));
    if (p != null && mounted) widget.onChanged(Fix(p, source: 'map'));
  }

  Future<void> _manual() async {
    final c = TextEditingController(text: widget.value == null ? '' : '${widget.value!.point.latitude}, ${widget.value!.point.longitude}');
    final r = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Nhập toạ độ (WGS84)'),
        content: TextField(controller: c, decoration: const InputDecoration(hintText: 'vĩ độ, kinh độ – VD: 14.6512, 107.9821'), keyboardType: TextInputType.text),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Huỷ')), FilledButton(onPressed: () => Navigator.pop(context, c.text), child: const Text('Dùng'))],
      ),
    );
    final m = RegExp(r'(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)').firstMatch(r ?? '');
    if (m == null || !mounted) return;
    var lat = double.parse(m.group(1)!), lon = double.parse(m.group(2)!);
    if (lat > 90 && lon <= 90) (lat, lon) = (lon, lat); // người dùng nhập "kinh độ, vĩ độ"
    if (lat.abs() > 90 || lon.abs() > 180) {
      setState(() => error = 'Toạ độ không hợp lệ (vĩ độ −90…90, kinh độ −180…180).');
      return;
    }
    setState(() => error = null);
    widget.onChanged(Fix(LatLng(lat, lon), source: 'manual'));
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(provinceGeoProvider); // tải ranh giới để kiểm tra vị trí nằm trong vùng giám sát
    final v = widget.value;
    final outside = v != null && insideProvince(ref, v.point) == false;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(v == null ? Icons.location_searching : Icons.location_on, color: v == null ? AppColors.muted : (v.poor || outside ? AppColors.orange : AppColors.forest)),
            const SizedBox(width: 8),
            Expanded(
              child: busy
                  ? const Text('Đang lấy vị trí GPS…')
                  : v == null
                      ? const Text('Chưa có vị trí', style: TextStyle(color: AppColors.muted))
                      : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(fmtCoord(v.point.latitude, v.point.longitude), style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text(v.label, style: TextStyle(fontSize: 12, color: v.poor ? AppColors.orange : AppColors.muted)),
                        ]),
            ),
            if (busy) const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
          ]),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(error!, style: const TextStyle(color: AppColors.orange, fontSize: 12))),
          if (v != null && v.poor) const Padding(padding: EdgeInsets.only(top: 6), child: Text('Tín hiệu GPS yếu – nên chọn vị trí trên bản đồ cho chính xác.', style: TextStyle(color: AppColors.orange, fontSize: 12))),
          if (outside) const Padding(padding: EdgeInsets.only(top: 6), child: Text(_outsideMsg, style: TextStyle(color: AppColors.orange, fontSize: 12))),
          const SizedBox(height: 6),
          Wrap(spacing: 6, children: [
            ActionChip(avatar: const Icon(Icons.gps_fixed, size: 16), label: const Text('GPS'), onPressed: busy ? null : _gps),
            ActionChip(avatar: const Icon(Icons.map_outlined, size: 16), label: const Text('Chọn trên bản đồ'), onPressed: _pick),
            ActionChip(avatar: const Icon(Icons.edit_location_alt_outlined, size: 16), label: const Text('Nhập toạ độ'), onPressed: _manual),
          ]),
        ]),
      ),
    );
  }
}

/// Bản đồ chọn vị trí: kéo bản đồ để đặt tâm vào điểm cần chọn. Có nền vệ tinh/đường phố, ranh giới vùng giám sát
/// và cảnh báo khi điểm chọn nằm ngoài ranh giới.
class LocationPickerPage extends ConsumerStatefulWidget {
  const LocationPickerPage({super.key, this.initial});
  final LatLng? initial;
  @override
  ConsumerState<LocationPickerPage> createState() => _LocationPickerPageState();
}

class _LocationPickerPageState extends ConsumerState<LocationPickerPage> {
  final map = MapController();
  late LatLng center = widget.initial ?? const LatLng(14.65, 107.95);
  String? basemapId; // null = vệ tinh nếu có, ngược lại nền đầu tiên

  Future<void> _done() async {
    if (insideProvince(ref, center) == false) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          icon: const Icon(Icons.warning_amber_rounded, color: AppColors.orange, size: 40),
          title: const Text('Vị trí ngoài vùng giám sát'),
          content: const Text(_outsideMsg),
          actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Chọn lại')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Vẫn dùng'))],
        ),
      );
      if (ok != true) return;
    }
    if (mounted) Navigator.pop(context, center);
  }

  @override
  Widget build(BuildContext context) {
    final bms = ((ref.watch(sessionProvider).map['basemaps'] as List?) ?? []).cast<Map>();
    final cur = bms.isEmpty ? null : bms.firstWhere((b) => b['id'] == (basemapId ?? 'satellite'), orElse: () => bms.first);
    final url = cur == null ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : cur['url'] as String;
    final province = ref.watch(provinceGeoProvider).asData?.value.data;
    final outside = insideProvince(ref, center) == false;
    final lines = <Polyline>[];
    if (province != null) {
      for (final f in (province['features'] as List).cast<Map>()) {
        for (final ring in ringsOf(f['geometry'] as Map)) {
          lines.add(Polyline(points: ring.map((p) => LatLng(p[1], p[0])).toList(), color: const Color(0xFF9B4DFF), strokeWidth: 2.6));
        }
      }
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Chọn vị trí'), actions: [TextButton(onPressed: _done, child: const Text('Xong'))]),
      body: Stack(children: [
        NetworkMap(
          noticeBottom: 80,
          mapController: map,
          options: MapOptions(initialCenter: center, initialZoom: widget.initial == null ? 9 : 15, onPositionChanged: (c, _) => setState(() => center = c.center)),
          children: [
            MapTileLayer(urlTemplate: url),
            PolylineLayer(polylines: lines),
          ],
        ),
        const Center(child: Padding(padding: EdgeInsets.only(bottom: 36), child: Icon(Icons.location_on, size: 44, color: AppColors.fire))),
        Positioned(
          left: 12,
          right: 12,
          bottom: 16,
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text('Tâm bản đồ: ${fmtCoord(center.latitude, center.longitude)}', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700)),
                if (outside) const Padding(padding: EdgeInsets.only(top: 4), child: Text('Ngoài ranh giới vùng giám sát', textAlign: TextAlign.center, style: TextStyle(color: AppColors.orange, fontSize: 12, fontWeight: FontWeight.w700))),
              ]),
            ),
          ),
        ),
        Positioned(
          right: 12,
          top: 12,
          child: Column(children: [
            FloatingActionButton.small(
              heroTag: 'gps',
              tooltip: 'Vị trí của tôi',
              onPressed: () async {
                try {
                  final f = await LocationService.current();
                  map.move(f.point, 16);
                } on LocationException catch (e) {
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
                }
              },
              child: const Icon(Icons.my_location),
            ),
            if (bms.length > 1) ...[
              const SizedBox(height: 8),
              FloatingActionButton.small(
                heroTag: 'basemap',
                tooltip: 'Đổi bản đồ nền',
                onPressed: () => setState(() {
                  final i = bms.indexWhere((b) => b['id'] == cur?['id']);
                  basemapId = bms[(i + 1) % bms.length]['id'] as String;
                }),
                child: const Icon(Icons.layers_outlined),
              ),
            ],
          ]),
        ),
        const Positioned(left: 12, top: 12, right: 70, child: NoticeBox('Kéo bản đồ để đặt điểm đỏ vào vị trí cần chọn. Đường tím là ranh giới vùng giám sát.')),
      ]),
    );
  }
}
