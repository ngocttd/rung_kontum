import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:kontum_mobilegis/app/frame.dart';
import 'package:kontum_mobilegis/app/theme.dart';
import 'package:kontum_mobilegis/core/data.dart';
import 'package:kontum_mobilegis/core/outbox.dart';
import 'package:kontum_mobilegis/core/session.dart';
import 'package:kontum_mobilegis/features/field/review_page.dart';
import 'package:kontum_mobilegis/features/field/task_detail_page.dart';
import 'package:kontum_mobilegis/features/field/tasks_page.dart';
import 'package:kontum_mobilegis/features/reports/my_reports_page.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _LeaderSession extends SessionController {
  @override
  SessionState build() => SessionState(
        ready: true,
        user: AppUser({
          'id': 'u-ld',
          'username': 'lanhdao1',
          'name': 'Lãnh đạo thử nghiệm',
          'role': 'leader',
          'permissions': ['tasks.assign', 'field.review', 'reports.own'],
        }),
        bootstrap: const {
          'catalogs': {
            'forest_types': {'rung-khop': 'Rừng khộp (rụng lá theo mùa)'},
            'report_types': [
              {'key': 'chay-rung', 'label': 'Cháy rừng', 'marker': 'fire-investigating'},
            ],
          },
          'communes': [
            {'code': '23392', 'name': 'Xã Sa Loong', 'center': [107.72, 14.66]},
          ],
          'map': {'basemaps': []},
        },
      );
}

class _IdleOutbox extends Outbox {
  @override
  OutboxState build() => const OutboxState();
}

Future<Widget> _wrap(Widget home) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  return ProviderScope(
    overrides: [
      prefsProvider.overrideWithValue(prefs),
      sessionProvider.overrideWith(_LeaderSession.new),
      outboxProvider.overrideWith(_IdleOutbox.new),
      myReportsProvider.overrideWith((ref) async => const Loaded<J>({
            'items': [
              {
                'code': 'PA-2026-0008',
                'type': 'chay-rung',
                'typeLabel': 'Cháy rừng',
                'status': 'verifying',
                'statusLabel': 'Đang xác minh',
                'commune_name': 'Xã Sa Loong',
                'lat': 14.6612,
                'lon': 107.7201,
                'gps_accuracy': 6,
                'location_text': 'Tiểu khu 201',
                'description': 'Phát hiện khói tại bìa rừng',
                'created_at': '2026-11-26T00:00:00Z',
                'timeline': [],
              },
            ],
          })),
      publicReportsProvider.overrideWith((ref) async => const Loaded<J>({
            'items': [
              {
                'code': 'PA-2026-0005',
                'type': 'chay-rung',
                'typeLabel': 'Cháy rừng',
                'status': 'processing',
                'statusLabel': 'Đang xử lý',
                'commune_name': 'Xã Sa Loong',
                'lat': 14.66,
                'lon': 107.72,
                'description': 'Phản ánh công khai thử nghiệm',
                'created_at': '2026-11-25T02:00:00Z',
                'timeline': [],
              },
            ],
          })),
      provinceGeoProvider.overrideWith((ref) async => const Loaded<J>({'features': []})),
      communesGeoProvider.overrideWith((ref) async => const Loaded<J>({'features': []})),
      assignmentsProvider.overrideWith((ref) async => const Loaded<J>({
            'items': [
              {
                'id': 'asg-1',
                'code': 'NV-2026-0001',
                'kind': 'hotspot',
                'title': 'Xác minh điểm nóng tại Xã Sa Loong',
                'status': 'submitted',
                'statusLabel': 'Đã nộp kết quả',
                'scope_id': '23392',
              },
            ],
          })),
      assignmentProvider('asg-1').overrideWith((ref) async => const Loaded<J>({
            'id': 'asg-1',
            'code': 'NV-2026-0001',
            'kind': 'hotspot',
            'ref_id': 'hs-1',
            'title': 'Xác minh điểm nóng tại Xã Sa Loong',
            'status': 'submitted',
            'statusLabel': 'Đã nộp kết quả',
            'scope_id': '23392',
            'verifications': [
              {
                'id': 'v-1',
                'code': 'XM-2026-0001',
                'verdict': 'fire_not_forest',
                'verdict_label': 'Đốt nương rẫy ngoài rừng',
                'verifier': 'canbo1',
                'verified_at': '2026-11-26T00:30:00Z',
                'review_status': 'pending',
              },
            ],
            'surveys': [
              {
                'id': 's-1',
                'code': 'KS-2026-0001',
                'forest_type': 'rung-khop',
                'surveyor': 'canbo1',
                'observed_at': '2026-11-26T00:35:00Z',
                'status': 'pending_review',
              },
            ],
            'history': [],
          })),
      pendingVerificationsProvider.overrideWith((ref) async => {
            'items': [
              {
                'id': 'v-1',
                'code': 'XM-2026-0001',
                'alert_kind': 'hotspot',
                'alert_id': 'hs-1',
                'verdict': 'fire_not_forest',
                'verdict_label': 'Đốt nương rẫy ngoài rừng',
                'verifier': 'canbo1',
                'verified_at': '2026-11-26T00:30:00Z',
              },
            ],
          }),
      pendingSurveysProvider.overrideWith((ref) async => {
            'items': [
              {
                'id': 's-1',
                'code': 'KS-2026-0001',
                'geom_type': 'polygon',
                'area_ha': 2.4,
                'forest_type': 'rung-khop',
                'is_dipterocarp': true,
                'season': 'dry',
                'surveyor': 'canbo1',
                'observed_at': '2026-11-26T00:35:00Z',
              },
            ],
          }),
    ],
    child: MaterialApp(
      theme: buildTheme(),
      locale: const Locale('vi'),
      supportedLocales: const [Locale('vi')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      builder: (_, child) => AppFrame(child: child!),
      home: home,
    ),
  );
}

void main() {
  setUpAll(() => initializeDateFormatting('vi'));

  testWidgets('Phản ánh hiện trường có cả tab Của tôi, chi tiết toạ độ và tab Bản đồ công khai + Chú giải', (tester) async {
    await tester.pumpWidget(await _wrap(const MyReportsPage()));
    await tester.pumpAndSettle();
    expect(find.text('PA-2026-0008 · Cháy rừng'), findsOneWidget);

    await tester.tap(find.text('PA-2026-0008 · Cháy rừng'));
    await tester.pumpAndSettle();
    expect(find.textContaining('14.66120, 107.72010'), findsOneWidget);
    expect(find.text('Tiểu khu 201'), findsOneWidget);
    await tester.ensureVisible(find.text('Xem trên bản đồ'));
    expect(find.text('Xem trên bản đồ'), findsOneWidget);
    Navigator.of(tester.element(find.text('Xem trên bản đồ'))).pop();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Bản đồ công khai'));
    await tester.pumpAndSettle();
    expect(find.text('Chú giải loại phản ánh'), findsOneWidget);
    expect(find.text('PA-2026-0005 · Cháy rừng'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Duyệt kết quả hiện trường hiển thị đủ cả 2 tab Xác minh và Khảo sát', (tester) async {
    await tester.pumpWidget(await _wrap(const ReviewPage()));
    await tester.pumpAndSettle();
    expect(find.text('XM-2026-0001'), findsOneWidget);

    await tester.tap(find.textContaining('Khảo sát'));
    await tester.pumpAndSettle();
    expect(find.text('KS-2026-0001'), findsOneWidget);
    expect(find.text('Rừng khộp'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Chi tiết nhiệm vụ hiển thị cả Xác minh và Khảo sát kèm nút Duyệt/Chấp thuận; Giao nhiệm vụ kiểm tra vị trí', (tester) async {
    await tester.pumpWidget(await _wrap(const TaskDetailPage(id: 'asg-1')));
    await tester.pumpAndSettle();
    expect(find.textContaining('XM-2026-0001'), findsOneWidget);
    expect(find.textContaining('KS-2026-0001'), findsOneWidget);
    expect(find.text('Duyệt'), findsOneWidget);
    expect(find.text('Chấp thuận'), findsOneWidget);

    await tester.pumpWidget(await _wrap(const TasksPage()));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Giao khảo sát'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Giao nhiệm vụ'));
    await tester.tap(find.text('Giao nhiệm vụ'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Vui lòng chọn vị trí khảo sát'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
