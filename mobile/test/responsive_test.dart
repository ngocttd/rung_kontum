import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:kontum_mobilegis/app/frame.dart';
import 'package:kontum_mobilegis/app/layout.dart';
import 'package:kontum_mobilegis/app/theme.dart';
import 'package:kontum_mobilegis/core/data.dart';
import 'package:kontum_mobilegis/core/outbox.dart';
import 'package:kontum_mobilegis/core/session.dart';
import 'package:kontum_mobilegis/features/auth/login_page.dart';
import 'package:kontum_mobilegis/features/documents/documents_page.dart';
import 'package:kontum_mobilegis/features/forest/forest_page.dart';
import 'package:kontum_mobilegis/features/home/home_page.dart';
import 'package:kontum_mobilegis/features/imagery/imagery_page.dart';
import 'package:kontum_mobilegis/features/news/news_page.dart';
import 'package:kontum_mobilegis/features/profile/profile_page.dart';
import 'package:kontum_mobilegis/features/profile/settings_page.dart';
import 'package:kontum_mobilegis/features/weather/weather_page.dart';
import 'package:kontum_mobilegis/widgets/items.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TestSession extends SessionController {
  @override
  SessionState build() => const SessionState(ready: true, guest: true, bootstrap: {
    'catalogs': {'news_categories': {'news': 'Tin tức và hoạt động'}},
    'communes': [{'code': '01', 'name': 'Xã kiểm thử'}],
  });
}

class TestOutbox extends Outbox {
  @override
  OutboxState build() => const OutboxState();
}

const news = {'slug': 'test', 'title': 'Bảo vệ tài nguyên rừng và phòng chống cháy rừng tại địa phương', 'published_at': '2026-11-01', 'status': 'pending'};
const summary = {'established_forest_ha': 616153.8, 'cover_percent_computed': 63.7, 'as_of': '2025-12-31', 'planning_ha': 700000, 'special_use_ha': 100000, 'protection_ha': 200000, 'production_ha': 400000};
const forest = {'summary': summary, 'communes': []};
const weather = {'code': '01', 'fullName': 'Xã kiểm thử', 'current': {'temp': 31.5, 'humidity': 85, 'wind_ms': 4.5, 'rain1h': 12, 'description': 'Mưa rào và có dông rải rác trong khu vực', 'dt': '2026-11-01T00:00:00Z'}};
const weatherDetail = {'forecast': {'days': [
  {'date': '2026-11-01', 'tmax': 32, 'tmin': 21, 'rain': 12, 'rh_min': 65},
  {'date': '2026-11-02', 'tmax': 30, 'tmin': 22, 'rain': 8, 'rh_min': 60},
]}};

Future<Widget> screen(Widget child, {double scale = 1, TargetPlatform platform = TargetPlatform.android}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  return ProviderScope(
    overrides: [
      prefsProvider.overrideWithValue(prefs),
      sessionProvider.overrideWith(TestSession.new),
      outboxProvider.overrideWith(TestOutbox.new),
      homeProvider.overrideWith((ref) async => const Loaded<J>({'forest': summary, 'news': [news], 'alerts': []})),
      notificationsProvider.overrideWith((ref) async => {'items': []}),
      forestSummaryProvider.overrideWith((ref) async => const Loaded<J>(forest)),
      forestChangeProvider.overrideWith((ref) async => const Loaded<J>({'items': []})),
      weatherProvider.overrideWith((ref) async => const Loaded<List>([weather])),
      weatherDetailProvider('01').overrideWith((ref) async => const Loaded<J>(weatherDetail)),
      newsProvider('').overrideWith((ref) async => const Loaded<J>({'items': [news]})),
      documentsProvider('').overrideWith((ref) async => const Loaded<J>({'items': []})),
      imageryProvider.overrideWith((ref) async => const Loaded<J>({'products': [
        {'id': 'before', 'title': 'Ảnh vệ tinh trước biến động'},
        {'id': 'after', 'title': 'Ảnh vệ tinh sau biến động'},
      ], 'monthly': []})),
    ],
    child: MaterialApp(
      theme: buildTheme().copyWith(platform: platform),
      locale: const Locale('vi'),
      supportedLocales: const [Locale('vi')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      builder: (_, child) => AppFrame(textScale: scale, child: child!),
      home: child,
    ),
  );
}

void main() {
  setUpAll(() => initializeDateFormatting('vi'));

  const sizes = [
    Size(320, 568), Size(360, 640), Size(375, 667), Size(430, 932),
    Size(390, 844), Size(667, 375), Size(744, 1133), Size(1024, 1366), Size(1366, 1024), Size(320, 768), Size(507, 1024),
  ];
  for (final size in sizes) {
    testWidgets('các màn hình chính vừa ${size.width.toInt()}×${size.height.toInt()}', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = size;
      tester.view.padding = const FakeViewPadding(top: 24, bottom: 34);
      tester.view.viewPadding = const FakeViewPadding(top: 24, bottom: 34);
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
        tester.view.resetPadding();
        tester.view.resetViewPadding();
      });
      final scale = size.width < 400 ? 1.4 : 1.0;
      for (final page in const <Widget>[
        LoginPage(), HomePage(), ForestPage(), WeatherPage(), ProfilePage(),
        SettingsPage(), NewsPage(), DocumentsPage(), ImageryPage(),
      ]) {
        await tester.pumpWidget(await screen(page, scale: scale));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '${page.runtimeType} at $size');
        if (page is LoginPage) {
          final form = tester.getRect(find.byType(ResponsiveScaffold));
          final field = tester.getRect(find.descendant(of: find.byType(LoginPage), matching: find.byType(ListView)).first);
          expect(field.width, lessThanOrEqualTo(480));
          expect(field.center.dx, closeTo(form.center.dx, 1));
        }
        if (page is ImageryPage) {
          await tester.tap(find.text('So sánh'));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: 'So sánh ảnh at $size');
        }
        await tester.pumpWidget(const SizedBox.shrink());
      }
    });
  }

  testWidgets('mục nhiệm vụ, phản ánh và tin tức dài vừa điện thoại nhỏ', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 568);
    addTearDown(() { tester.view.resetPhysicalSize(); tester.view.resetDevicePixelRatio(); });
    await tester.pumpWidget(await screen(const ResponsiveScaffold(body: SingleChildScrollView(child: Column(children: [
      TaskTile({'id': 't1', 'code': 'NV-2026-001234', 'kind': 'hotspot', 'title': 'Xác minh nguy cơ cháy rừng trên địa bàn', 'status': 'in_progress', 'statusLabel': 'Đang thực hiện', 'due_at': '2026-11-01T00:00:00Z'}),
      ReportTile({'code': 'PA-2026-001234', 'typeLabel': 'Phản ánh hiện trường', 'status': 'verifying', 'statusLabel': 'Đang xác minh', 'commune_name': 'Xã kiểm thử', 'created_at': '2026-11-01T00:00:00Z'}),
      NewsTile(news),
    ]))), scale: 1.4));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
