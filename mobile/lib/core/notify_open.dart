import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../features/map/object_page.dart';
import 'data.dart';

/// Mở đúng màn hình chi tiết của một thông báo (chạm trên khay hệ thống – FCM hoặc thông báo cục bộ –
/// và chạm trong danh sách Thông báo). `link` = trường `data` máy chủ gửi kèm (src/services/notifier.js):
///  - screen=hotspot (id, lat, lon): trang chi tiết điểm nóng/điểm cháy;
///  - screen=report (code): hồ sơ phản ánh;
///  - screen=task (id | code): nhiệm vụ hiện trường;
///  - screen=fire (commune): tab Cảnh báo; screen=notifications hoặc không rõ: danh sách Thông báo.
Future<void> openNotificationLink(BuildContext context, WidgetRef ref, Map link, {bool fromList = false}) async {
  final screen = link['screen']?.toString();
  final router = GoRouter.of(context);
  switch (screen) {
    case 'task':
      final id = link['id']?.toString();
      id != null && id.isNotEmpty ? router.push('/tasks/$id') : router.push('/tasks');
      return;
    case 'report':
      router.push('/reports?ma=${link['code'] ?? ''}');
      return;
    case 'hotspot':
      final id = link['id']?.toString();
      Map<String, dynamic>? props;
      LatLng? pt;
      try {
        ref.invalidate(hotspotsProvider); // lấy trạng thái mới nhất (vừa xác minh)
        final g = (await ref.read(hotspotsProvider.future)).data;
        for (final f in ((g['features'] as List?) ?? const []).cast<Map>()) {
          final p = (f['properties'] as Map).cast<String, dynamic>();
          if (p['id']?.toString() != id) continue;
          final c = (f['geometry'] as Map)['coordinates'] as List;
          props = p;
          pt = LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble());
          break;
        }
      } catch (_) {/* ngoại tuyến → dùng toạ độ gửi kèm thông báo */}
      final lat = double.tryParse('${link['lat']}');
      final lon = double.tryParse('${link['lon']}');
      if (props == null && lat != null && lon != null) {
        pt = LatLng(lat, lon);
        props = {'id': id, 'statusLabel': 'Xem trạng thái mới nhất ở tab Cảnh báo', 'commune': link['commune']};
      }
      if (props != null && pt != null && context.mounted) {
        router.push('/object', extra: ObjectRef(kind: 'hotspot', id: id ?? '', props: props, point: pt));
      } else {
        router.go('/fire');
      }
      return;
    case 'fire':
      router.go('/fire');
      return;
    default:
      if (link['code'] != null) {
        router.push('/reports?ma=${link['code']}');
      } else if (!fromList) {
        router.push('/notifications');
      }
  }
}
