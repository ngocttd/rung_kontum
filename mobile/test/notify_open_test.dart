// Chạm vào thông báo phải mở đúng màn hình chi tiết (không chỉ tab chung).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:kontum_mobilegis/core/data.dart';
import 'package:kontum_mobilegis/core/notify_open.dart';
import 'package:kontum_mobilegis/features/map/object_page.dart';

Future<void> tapLink(WidgetTester t, Map link) async {
  final router = GoRouter(routes: [
    GoRoute(path: '/', builder: (_, _) => Consumer(builder: (c, ref, _) => TextButton(onPressed: () => openNotificationLink(c, ref, link), child: const Text('chạm')))),
    GoRoute(path: '/object', builder: (_, s) { final o = s.extra as ObjectRef; return Text('object:${o.kind}:${o.id}:${o.props['status']}:${o.point.latitude}'); }),
    GoRoute(path: '/reports', builder: (_, s) => Text('report:${s.uri.queryParameters['ma']}')),
    GoRoute(path: '/tasks', builder: (_, _) => const Text('tasks')),
    GoRoute(path: '/tasks/:id', builder: (_, s) => Text('task:${s.pathParameters['id']}')),
    GoRoute(path: '/fire', builder: (_, _) => const Text('fire')),
    GoRoute(path: '/notifications', builder: (_, _) => const Text('notifications')),
  ]);
  await t.pumpWidget(ProviderScope(
    overrides: [
      hotspotsProvider.overrideWith((ref) async => const Loaded<J>({
            'features': [
              {'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [107.9, 14.5]}, 'properties': {'id': 'J1_VIIRS-x', 'status': 'confirmed', 'statusLabel': 'Xác nhận cháy'}},
            ],
          })),
    ],
    child: MaterialApp.router(routerConfig: router),
  ));
  await t.tap(find.text('chạm'));
  await t.pumpAndSettle();
}

void main() {
  testWidgets('cháy đã xác minh → trang chi tiết điểm cháy với trạng thái mới nhất', (t) async {
    await tapLink(t, {'screen': 'hotspot', 'id': 'J1_VIIRS-x', 'lat': '14.5', 'lon': '107.9'});
    expect(find.text('object:hotspot:J1_VIIRS-x:confirmed:14.5'), findsOneWidget);
  });
  testWidgets('điểm đã rời danh sách → vẫn mở chi tiết theo toạ độ gửi kèm', (t) async {
    await tapLink(t, {'screen': 'hotspot', 'id': 'man-CH-2026-0009', 'lat': '14.2', 'lon': '108.0'});
    expect(find.textContaining('object:hotspot:man-CH-2026-0009'), findsOneWidget);
  });
  testWidgets('phản ánh → hồ sơ phản ánh theo mã', (t) async {
    await tapLink(t, {'screen': 'report', 'code': 'PA-2026-0012'});
    expect(find.text('report:PA-2026-0012'), findsOneWidget);
  });
  testWidgets('nhiệm vụ → chi tiết nhiệm vụ', (t) async {
    await tapLink(t, {'screen': 'task', 'id': 'abc-123'});
    expect(find.text('task:abc-123'), findsOneWidget);
  });
  testWidgets('cảnh báo nguy cơ cháy → tab Cảnh báo', (t) async {
    await tapLink(t, {'screen': 'fire', 'commune': '23284'});
    expect(find.text('fire'), findsOneWidget);
  });
}
