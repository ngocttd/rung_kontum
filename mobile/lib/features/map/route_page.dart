import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../core/format.dart';
import '../../core/location.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';

/// Đích đến cho màn hình chỉ đường.
class RouteArgs {
  const RouteArgs(this.to, {required this.title});
  final LatLng to;
  final String title;
}

/// Chỉ đường ngắn nhất từ vị trí hiện tại tới điểm cháy/phản ánh/nhiệm vụ trên mạng đường OpenStreetMap
/// (máy chủ tính – GET /api/public/tools/route). Đoạn cuối không có đường trên OSM vẽ nét đứt (đi bộ đường thẳng).
/// Kèm khoảng cách tới khu dân cư và cơ sở ứng cứu gần đích (GET /api/public/tools/nearest).
class RoutePage extends ConsumerStatefulWidget {
  const RoutePage({super.key, required this.args});
  final RouteArgs args;
  @override
  ConsumerState<RoutePage> createState() => _RoutePageState();
}

class _RoutePageState extends ConsumerState<RoutePage> {
  Fix? _from;
  Map<String, dynamic>? _route;
  Map<String, dynamic>? _near;
  String? _error;
  bool _busy = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _busy = true; _error = null; });
    final api = ref.read(apiProvider);
    final to = widget.args.to;
    // khu dân cư gần đích: không cần GPS
    () async {
      try {
        final v = await api.get<Map<String, dynamic>>('/api/public/tools/nearest', query: {'lon': to.longitude, 'lat': to.latitude});
        if (mounted) setState(() => _near = v);
      } catch (_) {/* không bắt buộc */}
    }();
    try {
      final fix = await LocationService.current();
      final r = await api.get<Map<String, dynamic>>('/api/public/tools/route', query: {'from': '${fix.point.longitude},${fix.point.latitude}', 'to': '${to.longitude},${to.latitude}'});
      if (!mounted) return;
      setState(() { _from = fix; _route = r; _busy = false; });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e is LocationException ? e.message : 'Không tính được đường đi: ${e.toString().replaceFirst('Exception: ', '')}'; _busy = false; });
    }
  }

  List<LatLng> _coords(Map f) => ((f['geometry'] as Map)['coordinates'] as List).map((c) => LatLng(((c as List)[1] as num).toDouble(), (c[0] as num).toDouble())).toList();

  String _dist(num? m) => m == null ? '—' : m >= 1000 ? '${fmtNum(m / 1000, 1)} km' : '${fmtNum(m)} m';
  String _dur(num? min) => min == null ? '—' : min >= 60 ? '${min ~/ 60} giờ ${min % 60} phút' : '$min phút';

  @override
  Widget build(BuildContext context) {
    final to = widget.args.to;
    final bms = ((ref.read(sessionProvider).map['basemaps'] as List?) ?? const []).cast<Map>();
    final tiles = (bms.firstOrNull?['url'] ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png') as String;
    final feats = ((_route?['features'] as List?) ?? const []).cast<Map>();
    final s = (_route?['summary'] as Map?)?.cast<String, dynamic>();
    final all = <LatLng>[to, if (_from != null) _from!.point, for (final f in feats) ..._coords(f)];
    return Scaffold(
      appBar: AppBar(title: const Text('Chỉ đường'), actions: [IconButton(tooltip: 'Tính lại', icon: const Icon(Icons.refresh), onPressed: _busy ? null : _load)]),
      body: Column(children: [
        Expanded(
          child: _busy
              ? const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [CircularProgressIndicator(), SizedBox(height: 10), Text('Đang lấy vị trí và tính đường đi…')]))
              : FlutterMap(
                  key: ValueKey(all.length),
                  options: MapOptions(
                    initialCenter: to,
                    initialZoom: 13,
                    initialCameraFit: all.length > 1 ? CameraFit.bounds(bounds: LatLngBounds.fromPoints(all), padding: const EdgeInsets.all(48)) : null,
                  ),
                  children: [
                    TileLayer(urlTemplate: tiles, userAgentPackageName: 'vn.gov.kontum.mobilegis', maxNativeZoom: 19),
                    PolylineLayer(polylines: [
                      for (final f in feats)
                        if ((f['properties'] as Map)['kind'] == 'road')
                          Polyline(points: _coords(f), color: const Color(0xFF1565D8), strokeWidth: 5, borderColor: Colors.white, borderStrokeWidth: 1.5)
                        else
                          Polyline(points: _coords(f), color: const Color(0xFFFF6F00), strokeWidth: 3, pattern: const StrokePattern.dotted()),
                    ]),
                    MarkerLayer(markers: [
                      if (_from != null) Marker(point: _from!.point, width: 22, height: 22, child: Container(decoration: BoxDecoration(color: AppColors.blue, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3)))),
                      Marker(point: to, width: 36, height: 36, alignment: Alignment.topCenter, child: const Icon(Icons.location_on, color: AppColors.fire, size: 36)),
                    ]),
                  ],
                ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(widget.args.title, style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.navy, fontSize: 15.5), maxLines: 2),
              const SizedBox(height: 6),
              if (_error != null) NoticeBox(_error!, warn: true),
              if (s != null) ...[
                Row(children: [
                  const Icon(Icons.directions_car_filled_outlined, color: AppColors.blue),
                  const SizedBox(width: 8),
                  Text('${_dist(s['distance_m'] as num?)} · khoảng ${_dur(s['duration_min'] as num?)}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                ]),
                if (((s['walk_end_m'] as num?) ?? 0) > 50) Text('Gồm ${_dist(s['walk_end_m'] as num?)} đi bộ từ đường gần nhất tới đích (OSM không có đường).', style: const TextStyle(fontSize: 12.5, color: AppColors.orange)),
                if (_from?.poor == true) Text('Vị trí hiện tại: ${_from!.label}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
              ],
              if (_near != null && ((_near!['settlements'] as List?) ?? const []).isNotEmpty) ...[
                const SizedBox(height: 6),
                KV('Dân cư gần đích', () { final st = ((_near!['settlements'] as List).first as Map); return '${st['name']} (${st['kind']}) · ${_dist(st['distance_m'] as num?)}'; }()),
                if (((_near!['facilities'] as List?) ?? const []).isNotEmpty)
                  KV('Cơ sở ứng cứu', () { final f = ((_near!['facilities'] as List).first as Map); return '${f['name']} · ${_dist(f['distance_m'] as num?)}'; }()),
              ],
              SourceNote((s?['note'] ?? 'Mạng đường OpenStreetMap (dữ liệu cộng đồng) – cần kiểm tra thực tế.').toString()),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                icon: const Icon(Icons.open_in_new),
                label: const Text('Mở bằng ứng dụng bản đồ khác'),
                onPressed: () => launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${to.latitude},${to.longitude}'), mode: LaunchMode.externalApplication),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}
