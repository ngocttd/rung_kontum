import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../field/verification_page.dart';
import 'map_page.dart';

/// Đối tượng được chọn trên bản đồ/danh sách.
class ObjectRef {
  const ObjectRef({required this.kind, required this.id, required this.props, required this.point});
  final String kind; // hotspot | candidate | report | commune | alert
  final String id;
  final Map<String, dynamic> props;
  final LatLng point;
}

/// M05 – Chi tiết đối tượng: thuộc tính, nguồn, ngày cập nhật, ảnh, lịch sử, chỉ đường.
/// Luôn phân biệt kết quả phân tích tự động / chưa xác minh với thông tin đã xác minh.
class ObjectPage extends ConsumerWidget {
  const ObjectPage({super.key, required this.data});
  final ObjectRef data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final p = data.props;
    final u = s.user;
    final canVerify = u?.can('field.verify') == true && ['hotspot', 'candidate', 'report'].contains(data.kind);
    final (title, image, chip, chipColor) = switch (data.kind) {
      'hotspot' => (
          'Điểm nóng cháy ${p['sensorLabel'] ?? ''}',
          'assets/images/wildfire-small.webp',
          (p['verification_label'] ?? p['statusLabel'] ?? 'Chưa xác minh').toString(),
          StatusChip.toneOf(p['status'] as String?)
        ),
      'candidate' => ('Biến động rừng ${p['id']}', 'assets/images/logging-report-small.webp', (p['statusLabel'] ?? 'Nghi vấn – chưa xác minh').toString(), StatusChip.toneOf(p['status'] as String?)),
      'report' => ('Phản ánh ${p['code']}', 'assets/images/smoke-report-small.webp', (p['statusLabel'] ?? '').toString(), StatusChip.toneOf(p['status'] as String?)),
      'commune' => (p['fullName']?.toString() ?? 'Xã/phường', 'assets/images/evergreen-small.webp', 'Đơn vị hành chính', AppColors.blue),
      _ => (p['title']?.toString() ?? 'Đối tượng', 'assets/images/p04-fire-small.webp', (p['statusLabel'] ?? '').toString(), AppColors.orange),
    };

    return Scaffold(
      body: CustomScrollView(slivers: [
        SliverAppBar(
          pinned: true,
          expandedHeight: 210,
          backgroundColor: AppColors.forestDark,
          foregroundColor: Colors.white,
          actions: [
            IconButton(
              tooltip: 'Chia sẻ',
              icon: const Icon(Icons.share_outlined),
              onPressed: () => SharePlus.instance.share(ShareParams(text: '$title\nToạ độ: ${fmtCoord(data.point.latitude, data.point.longitude)}\nhttps://maps.google.com/?q=${data.point.latitude},${data.point.longitude}')),
            ),
          ],
          flexibleSpace: FlexibleSpaceBar(
            background: Stack(fit: StackFit.expand, children: [
              Image.asset(image, fit: BoxFit.cover),
              const DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Colors.black26, Colors.black54]))),
              const Positioned(right: 10, bottom: 10, child: StatusChip('Ảnh minh hoạ', color: Colors.white, dense: true)),
            ]),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: AppColors.navy)),
              const SizedBox(height: 6),
              if (chip.isNotEmpty) StatusChip(chip, color: chipColor),
              const SizedBox(height: 12),
              ..._body(context, s),
              const SizedBox(height: 14),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.directions_outlined),
                    label: const Text('Chỉ đường'),
                    onPressed: () => launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${data.point.latitude},${data.point.longitude}'), mode: LaunchMode.externalApplication),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    icon: const Icon(Icons.map_outlined),
                    label: const Text('Xem khu vực'),
                    onPressed: () => context.go('/map', extra: MapFocus(data.point, zoom: data.kind == 'commune' ? 11.5 : 15, layer: data.kind == 'candidate' ? 'candidates' : data.kind == 'report' ? 'reports' : null)),
                  ),
                ),
              ]),
              const SizedBox(height: 10),
              if (canVerify)
                FilledButton.icon(
                  style: FilledButton.styleFrom(backgroundColor: AppColors.orange),
                  icon: const Icon(Icons.fact_check_outlined),
                  label: const Text('Xác minh tại hiện trường'),
                  onPressed: () => context.push('/verify', extra: VerifyArgs(kind: data.kind, alertId: data.kind == 'report' ? (p['code'] ?? data.id).toString() : data.id, title: title, point: data.point)),
                )
              else if (data.kind != 'report')
                OutlinedButton.icon(
                  icon: const Icon(Icons.campaign_outlined),
                  label: const Text('Gửi phản ánh tại vị trí này'),
                  onPressed: () => context.push('/report', extra: {'lat': data.point.latitude, 'lon': data.point.longitude, 'type': data.kind == 'hotspot' ? 'chay-rung' : 'pha-rung'}),
                ),
            ]),
          ),
        ),
      ]),
    );
  }

  List<Widget> _body(BuildContext context, SessionState s) {
    final p = data.props;
    final coord = fmtCoord(data.point.latitude, data.point.longitude);
    switch (data.kind) {
      case 'hotspot':
        final ctx = p['context'] as Map?;
        return [
          SectionCard(child: Column(children: [
            KV('Mã điểm nóng', p['id']?.toString()),
            KV('Thời gian phát hiện', fmtDateTime(p['utc'])),
            KV('Vệ tinh / cảm biến', '${p['sensorLabel'] ?? p['sensor']} (NASA FIRMS)'),
            KV('Độ tin cậy', p['confidence']?.toString()),
            KV('Công suất bức xạ (FRP)', p['frp'] == null ? null : '${p['frp']} MW'),
            KV('Vị trí', coord),
            KV('Địa bàn', p['commune']?.toString() ?? 'Ngoài ranh 40 xã'),
            if (ctx != null) KV('Lớp phủ tại điểm', '${ctx['landcover'] ?? '—'}${ctx['in_forest'] == true ? ' (trong vùng rừng)' : ''}'),
          ])),
          const SizedBox(height: 10),
          const NoticeBox('Điểm nóng là điểm nhiệt bất thường do vệ tinh phát hiện – chưa phải cháy rừng đã xác nhận. Có thể là đốt nương rẫy, đốt phụ phẩm. Trạng thái xác minh do cán bộ cập nhật.', warn: true),
        ];
      case 'candidate':
        return [
          SectionCard(child: Column(children: [
            KV('Mã', p['id']?.toString()),
            KV('Xã/phường', p['commune_name']?.toString()),
            KV('Diện tích', fmtHa(p['area_ha'] as num?)),
            KV('ΔNDVI / ΔNBR', '${p['mean_dndvi']} / ${p['mean_dnbr']}'),
            KV('Kỳ so sánh', p['window']?.toString()),
            KV('Vị trí', coord),
            if (p['seasonal_leaf_fall_possible'] == true) const KV('Lưu ý', 'Có thể là rụng lá mùa khô (rừng khộp)'),
          ])),
          const SizedBox(height: 10),
          const NoticeBox('Kết quả phân tích tự động từ ảnh Sentinel-2 (100 m). NDVI giảm mùa khô ở rừng khộp không đồng nghĩa mất rừng; cần xác minh hiện trường.', warn: true),
          SourceNote(p['evidence']?.toString() ?? ''),
        ];
      case 'report':
        final tl = ((p['timeline'] as List?) ?? []).cast<Map>();
        return [
          SectionCard(child: Column(children: [
            KV('Loại', p['typeLabel']?.toString()),
            KV('Địa bàn', p['commune_name']?.toString()),
            KV('Thời gian gửi', fmtDateTime(p['created_at'])),
            KV('Vị trí (làm tròn)', coord),
            KV('Nội dung', p['description']?.toString()),
            if (p['response'] != null) KV('Phản hồi', p['response']?.toString()),
          ])),
          if (tl.isNotEmpty) ...[const SizedBox(height: 10), SectionCard(title: 'Lịch sử xử lý', child: Column(children: [for (final t in tl) KV(fmtDateTime(t['at']), '${t['label'] ?? t['status']}${t['note'] != null ? ' – ${t['note']}' : ''}')]))],
          const SizedBox(height: 10),
          const NoticeBox('Thông tin người gửi luôn được bảo mật; chỉ hiển thị phản ánh cán bộ cho phép công khai.'),
        ];
      case 'commune':
        return [
          SectionCard(title: 'Tài nguyên rừng (QĐ công bố 2025)', child: Column(children: [
            KV('Diện tích tự nhiên', p['areaKm2'] == null ? null : '${fmtNum(p['areaKm2'] as num, 1)} km²'),
            KV('Diện tích có rừng', fmtHa(p['forest_ha'] as num?)),
            KV('Rừng tự nhiên', fmtHa(p['natural_forest_ha'] as num?)),
            KV('Rừng trồng', fmtHa(p['plantation_ha'] as num?)),
            KV('Tỷ lệ che phủ', p['cover'] == null ? null : '${fmtNum(p['cover'] as num, 1)} %'),
            KV('Quy hoạch ĐD / PH / SX', '${fmtNum(p['special_ha'] as num?)} / ${fmtNum(p['protection_ha'] as num?)} / ${fmtNum(p['production_ha'] as num?)} ha'),
          ])),
          const SizedBox(height: 10),
          SectionCard(title: 'Cảnh báo – dự báo', child: Column(children: [
            KV('Cấp nguy cơ cháy hôm nay', p['danger_cls'] == null ? null : 'Cấp ${p['danger_cls']} (P = ${fmtNum(p['danger_p'] as num?)})', valueWidget: p['danger_cls'] == null ? null : StatusChip('Cấp ${p['danger_cls']}', color: AppColors.dangerOf(p['danger_cls'] as num))),
            KV('Cấp cao nhất 7 ngày tới', p['danger_max7']?.toString()),
            KV('Điểm nóng 7 ngày', p['hotspots_7d']?.toString()),
            KV('Mất tán cây 2024', fmtHa(p['loss_2024'] as num?)),
            KV('Xác suất mất rừng TB 2025–26', p['risk_mean'] == null ? null : '${fmtNum((p['risk_mean'] as num) * 100, 2)} %'),
          ])),
          const SourceNote('Cấp nguy cơ cháy và xác suất mất rừng là kết quả mô hình tự động, chưa phải cảnh báo chính thức trừ khi được phê duyệt.'),
        ];
      default:
        return [SectionCard(child: Column(children: [KV('Nội dung', p['detail']?.toString()), KV('Thời gian', fmtDateTime(p['time'])), KV('Vị trí', coord)]))];
    }
  }
}
