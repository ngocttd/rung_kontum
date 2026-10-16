import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../app/theme.dart';
import '../core/format.dart';
import '../core/location.dart';
import '../core/session.dart';
import 'common.dart';

/// Ô vị trí dùng chung cho phản ánh / khảo sát / xác minh: GPS (kèm sai số) hoặc chọn trên bản đồ / nhập tay.
class LocationField extends StatefulWidget {
  const LocationField({super.key, required this.value, required this.onChanged, this.autoGps = true});
  final Fix? value;
  final ValueChanged<Fix?> onChanged;
  final bool autoGps;
  @override
  State<LocationField> createState() => _LocationFieldState();
}

class _LocationFieldState extends State<LocationField> {
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
      widget.onChanged(await LocationService.current());
    } on LocationException catch (e) {
      setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _pick() async {
    final p = await Navigator.of(context).push<LatLng>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => LocationPickerPage(initial: widget.value?.point)));
    if (p != null) widget.onChanged(Fix(p, source: 'map'));
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
    if (m != null) widget.onChanged(Fix(LatLng(double.parse(m.group(1)!), double.parse(m.group(2)!)), source: 'manual'));
  }

  @override
  Widget build(BuildContext context) {
    final v = widget.value;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(v == null ? Icons.location_searching : Icons.location_on, color: v == null ? AppColors.muted : (v.poor ? AppColors.orange : AppColors.forest)),
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

/// Bản đồ chọn vị trí: kéo bản đồ để đặt tâm vào điểm cần chọn.
class LocationPickerPage extends ConsumerStatefulWidget {
  const LocationPickerPage({super.key, this.initial});
  final LatLng? initial;
  @override
  ConsumerState<LocationPickerPage> createState() => _LocationPickerPageState();
}

class _LocationPickerPageState extends ConsumerState<LocationPickerPage> {
  final map = MapController();
  late LatLng center = widget.initial ?? const LatLng(14.65, 107.95);
  @override
  Widget build(BuildContext context) {
    final bms = ((ref.watch(sessionProvider).map['basemaps'] as List?) ?? []).cast<Map>();
    final url = bms.isEmpty ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : bms.first['url'] as String;
    return Scaffold(
      appBar: AppBar(title: const Text('Chọn vị trí'), actions: [TextButton(onPressed: () => Navigator.pop(context, center), child: const Text('Xong'))]),
      body: Stack(children: [
        FlutterMap(
          mapController: map,
          options: MapOptions(initialCenter: center, initialZoom: widget.initial == null ? 9 : 15, onPositionChanged: (c, _) => setState(() => center = c.center)),
          children: [TileLayer(urlTemplate: url, userAgentPackageName: 'vn.gov.kontum.mobilegis')],
        ),
        const Center(child: Padding(padding: EdgeInsets.only(bottom: 36), child: Icon(Icons.location_on, size: 44, color: AppColors.fire))),
        Positioned(left: 12, right: 12, bottom: 16, child: Card(child: Padding(padding: const EdgeInsets.all(12), child: Text('Tâm bản đồ: ${fmtCoord(center.latitude, center.longitude)}', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700))))),
        Positioned(
          right: 12,
          top: 12,
          child: FloatingActionButton.small(
            heroTag: 'gps',
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
        ),
        const Positioned(left: 12, top: 12, right: 70, child: NoticeBox('Kéo bản đồ để đặt điểm đỏ vào vị trí cần chọn.')),
      ]),
    );
  }
}
