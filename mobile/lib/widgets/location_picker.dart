import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../app/theme.dart';
import '../core/data.dart';
import '../core/format.dart';
import '../core/location.dart';
import '../core/session.dart';
import 'network_map.dart';

const _konTumCenter = LatLng(14.65, 107.95);

bool _inKonTumBox(LatLng p) => p.latitude > 13 && p.latitude < 16.5 && p.longitude > 106.5 && p.longitude < 109.5;

/// true/false khi đã có ranh giới tỉnh; null khi chưa tải được (khi đó dùng khung toạ độ vùng Kon Tum).
bool? insideProvince(WidgetRef ref, LatLng p) {
  if (!_inKonTumBox(p)) return false;
  final g = ref.read(provinceGeoProvider).asData?.value.data;
  if (g == null) return null;
  for (final f in (g['features'] as List).cast<Map>()) {
    if (pointInGeometry(p.longitude, p.latitude, f['geometry'] as Map)) return true;
  }
  return false;
}

/// Tìm tên xã/phường chứa điểm [p] nếu dữ liệu ranh giới xã đã tải.
String? communeNameAt(WidgetRef ref, LatLng p) {
  final g = ref.read(communesGeoProvider).asData?.value.data;
  if (g == null) return null;
  for (final f in (g['features'] as List).cast<Map>()) {
    if (pointInGeometry(p.longitude, p.latitude, f['geometry'] as Map)) {
      final props = f['properties'] as Map;
      return (props['fullName'] ?? props['name'])?.toString();
    }
  }
  return null;
}

const _outsideMsg = 'Vị trí nằm ngoài ranh giới vùng giám sát (Kon Tum cũ) – máy chủ sẽ từ chối hoặc không gán được xã/phường. Hãy chọn điểm trong đường ranh màu tím.';

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
    if (widget.autoGps && widget.value == null) WidgetsBinding.instance.addPostFrameCallback((_) => _gps(manual: false));
  }

  Future<void> _gps({bool manual = true}) async {
    setState(() => [busy = true, error = null]);
    try {
      final f = await LocationService.current();
      if (!mounted) return;
      // Khi tự lấy GPS lúc mở biểu mẫu mà người dùng đang ở ngoài tỉnh Kon Tum, không gán sẵn toạ độ ngoài tỉnh
      // để khi bấm "Chọn trên bản đồ" sẽ mở thẳng vùng Kon Tum thay vì vị trí ở tỉnh khác.
      if (!manual && insideProvince(ref, f.point) == false) {
        setState(() => error = 'Thiết bị hiện ở ngoài vùng Kon Tum – hãy bấm "Chọn trên bản đồ" để chấm vị trí hiện trường.');
        return;
      }
      widget.onChanged(f);
    } on LocationException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _pick() async {
    final init = widget.value != null && _inKonTumBox(widget.value!.point) ? widget.value!.point : null;
    final p = await Navigator.of(context).push<LatLng>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => LocationPickerPage(initial: init)));
    if (p != null && mounted) {
      setState(() => error = null);
      widget.onChanged(Fix(p, source: 'map'));
    }
  }

  Future<void> _manual() async {
    final c = TextEditingController(text: widget.value == null ? '' : '${widget.value!.point.latitude.toStringAsFixed(6)}, ${widget.value!.point.longitude.toStringAsFixed(6)}');
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
    ref.watch(provinceGeoProvider);
    ref.watch(communesGeoProvider);
    final v = widget.value;
    final outside = v != null && insideProvince(ref, v.point) == false;
    final commune = v == null ? null : communeNameAt(ref, v.point);
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
                      ? const Text('Chưa chọn vị trí', style: TextStyle(color: AppColors.muted))
                      : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(fmtCoord(v.point.latitude, v.point.longitude), style: const TextStyle(fontWeight: FontWeight.w700)),
                          Text([?commune, v.label].join(' · '), style: TextStyle(fontSize: 12, color: v.poor ? AppColors.orange : AppColors.muted)),
                        ]),
            ),
            if (busy) const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
          ]),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(error!, style: const TextStyle(color: AppColors.orange, fontSize: 12))),
          if (v != null && v.poor) const Padding(padding: EdgeInsets.only(top: 6), child: Text('Tín hiệu GPS yếu – nên chọn vị trí trên bản đồ cho chính xác.', style: TextStyle(color: AppColors.orange, fontSize: 12))),
          if (outside) const Padding(padding: EdgeInsets.only(top: 6), child: Text(_outsideMsg, style: TextStyle(color: AppColors.orange, fontSize: 12))),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 4, children: [
            ActionChip(avatar: const Icon(Icons.gps_fixed, size: 16), label: const Text('GPS'), onPressed: busy ? null : () => _gps(manual: true)),
            ActionChip(avatar: const Icon(Icons.map_outlined, size: 16), label: const Text('Chọn trên bản đồ'), onPressed: _pick),
            ActionChip(avatar: const Icon(Icons.edit_location_alt_outlined, size: 16), label: const Text('Nhập toạ độ'), onPressed: _manual),
          ]),
        ]),
      ),
    );
  }
}

/// Bản đồ chọn vị trí: kéo bản đồ hoặc chạm trực tiếp lên điểm cần chọn; có tìm kiếm xã/phường,
/// đổi bản đồ nền, vẽ ranh giới tỉnh + 40 xã/phường và nút quay nhanh về vùng Kon Tum.
class LocationPickerPage extends ConsumerStatefulWidget {
  const LocationPickerPage({super.key, this.initial});
  final LatLng? initial;
  @override
  ConsumerState<LocationPickerPage> createState() => _LocationPickerPageState();
}

class _LocationPickerPageState extends ConsumerState<LocationPickerPage> {
  final map = MapController();
  final search = TextEditingController();
  late LatLng center = widget.initial ?? _konTumCenter;
  String? basemapId;
  List<Map<String, dynamic>> matches = [];

  @override
  void dispose() {
    search.dispose();
    map.dispose();
    super.dispose();
  }

  void _onSearch(String q) {
    final t = _fold(q.trim());
    if (t.length < 2) return setState(() => matches = []);
    final cs = ref.read(sessionProvider).communes.where((c) => _fold(c['name'].toString()).contains(t)).take(6).toList();
    setState(() => matches = cs);
  }

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
    final communesGeo = ref.watch(communesGeoProvider).asData?.value.data;
    final outside = insideProvince(ref, center) == false;
    final commune = communeNameAt(ref, center);
    final lines = <Polyline>[];
    if (communesGeo != null) {
      for (final f in (communesGeo['features'] as List).cast<Map>()) {
        for (final ring in ringsOf(f['geometry'] as Map)) {
          lines.add(Polyline(points: ring.map((p) => LatLng(p[1], p[0])).toList(), color: Colors.white.withValues(alpha: .55), strokeWidth: 1.0));
        }
      }
    }
    if (province != null) {
      for (final f in (province['features'] as List).cast<Map>()) {
        for (final ring in ringsOf(f['geometry'] as Map)) {
          lines.add(Polyline(points: ring.map((p) => LatLng(p[1], p[0])).toList(), color: const Color(0xFF9B4DFF), strokeWidth: 2.6));
        }
      }
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chọn vị trí hiện trường'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: FilledButton(
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 38),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5),
              ),
              onPressed: _done,
              child: const Text('Chọn điểm này'),
            ),
          ),
        ],
      ),
      body: Stack(children: [
        NetworkMap(
          noticeBottom: 108,
          mapController: map,
          options: MapOptions(
            initialCenter: center,
            initialZoom: widget.initial == null ? 9.2 : 15,
            onPositionChanged: (c, _) => setState(() => center = c.center),
            onTap: (_, p) {
              FocusScope.of(context).unfocus();
              setState(() => [center = p, matches = []]);
              map.move(p, math.max(map.camera.zoom, 13.5));
            },
          ),
          children: [
            MapTileLayer(urlTemplate: url),
            PolylineLayer(polylines: lines),
          ],
        ),
        const IgnorePointer(child: Center(child: Padding(padding: EdgeInsets.only(bottom: 36), child: Icon(Icons.location_on, size: 44, color: AppColors.fire)))),
        Positioned(
          left: 12,
          top: 10,
          right: 68,
          child: Column(children: [
            Material(
              elevation: 3,
              borderRadius: BorderRadius.circular(10),
              child: TextField(
                controller: search,
                onChanged: _onSearch,
                decoration: InputDecoration(
                  isDense: true,
                  hintText: 'Tìm nhanh xã/phường ở Kon Tum…',
                  prefixIcon: const Icon(Icons.search, size: 20),
                  suffixIcon: search.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => [search.clear(), matches = []])),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                ),
              ),
            ),
            if (matches.isNotEmpty)
              Card(
                margin: const EdgeInsets.only(top: 4),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  for (final c in matches)
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.place_outlined, size: 18),
                      title: Text(c['name'].toString(), style: const TextStyle(fontSize: 13)),
                      onTap: () {
                        FocusScope.of(context).unfocus();
                        final ctr = (c['center'] as List?)?.cast<num>();
                        if (ctr != null && ctr.length >= 2) {
                          final pt = LatLng(ctr[1].toDouble(), ctr[0].toDouble());
                          setState(() => [center = pt, matches = [], search.text = c['name'].toString()]);
                          map.move(pt, 12.8);
                        }
                      },
                    ),
                ]),
              ),
          ]),
        ),
        Positioned(
          right: 12,
          top: 10,
          child: Column(children: [
            FloatingActionButton.small(
              heroTag: 'pick_gps',
              tooltip: 'Vị trí GPS của tôi',
              onPressed: () async {
                try {
                  final f = await LocationService.current();
                  setState(() => center = f.point);
                  map.move(f.point, 15.5);
                } on LocationException catch (e) {
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
                }
              },
              child: const Icon(Icons.my_location),
            ),
            const SizedBox(height: 8),
            FloatingActionButton.small(
              heroTag: 'pick_kontum',
              tooltip: 'Về toàn vùng Kon Tum',
              onPressed: () {
                setState(() => center = _konTumCenter);
                map.move(_konTumCenter, 9.2);
              },
              child: const Icon(Icons.zoom_out_map),
            ),
            if (bms.length > 1) ...[
              const SizedBox(height: 8),
              FloatingActionButton.small(
                heroTag: 'pick_basemap',
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
        Positioned(
          left: 12,
          right: 12,
          bottom: 14,
          child: Card(
            elevation: 4,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Text('Toạ độ chọn: ${fmtCoord(center.latitude, center.longitude)}', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 3),
                if (outside)
                  const Text('Ngoài ranh giới vùng giám sát Kon Tum – bấm biểu tượng khung toàn vùng để quay về Kon Tum', textAlign: TextAlign.center, style: TextStyle(color: AppColors.orange, fontSize: 12, fontWeight: FontWeight.w700))
                else
                  Text(commune != null ? 'Địa bàn: $commune · Chạm hoặc kéo bản đồ để chỉnh điểm đỏ' : 'Chạm hoặc kéo bản đồ để đặt ghim đỏ vào vị trí hiện trường', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.forest, fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Wrap(spacing: 12, runSpacing: 2, alignment: WrapAlignment.center, children: [
                  Row(mainAxisSize: MainAxisSize.min, children: [Container(width: 14, height: 3, color: const Color(0xFF9B4DFF)), const SizedBox(width: 4), const Text('Ranh vùng Kon Tum', style: TextStyle(fontSize: 10.5, color: AppColors.muted))]),
                  Row(mainAxisSize: MainAxisSize.min, children: [Container(width: 14, height: 1.5, color: Colors.grey), const SizedBox(width: 4), const Text('Ranh xã/phường', style: TextStyle(fontSize: 10.5, color: AppColors.muted))]),
                ]),
              ]),
            ),
          ),
        ),
      ]),
    );
  }
}

String _fold(String s) {
  const from = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
  const to = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
  final b = StringBuffer();
  for (final ch in s.toLowerCase().split('')) {
    final i = from.indexOf(ch);
    b.write(i >= 0 ? to[i] : ch);
  }
  return b.toString();
}
