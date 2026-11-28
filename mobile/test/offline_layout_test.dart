import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:kontum_mobilegis/core/data.dart';
import 'package:kontum_mobilegis/features/home/home_page.dart';
import 'package:kontum_mobilegis/widgets/common.dart';

import 'responsive_test.dart' as fixtures;

void main() {
  setUpAll(() => initializeDateFormatting('vi'));
  final cached = Loaded<J>({'forest': fixtures.summary, 'alerts': [], 'news': []}, cachedAt: DateTime.utc(2026, 11, 1));

  testWidgets('AsyncView ngoại tuyến trong ListView không dùng Expanded theo chiều cao vô hạn', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ListView(children: [
      AsyncView<Loaded<J>>(
        value: AsyncData(cached),
        builder: (_) => const Column(children: [SizedBox(height: 1000), Text('Cuối nội dung')]),
      ),
    ]))));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.scrollUntilVisible(find.text('Cuối nội dung'), 300);
    expect(find.text('Cuối nội dung'), findsOneWidget);
  });

  testWidgets('AsyncView toàn trang vẫn dành chiều cao hữu hạn cho danh sách cuộn', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: AsyncView<Loaded<J>>(
      value: AsyncData(cached),
      builder: (_) => ListView.builder(itemCount: 100, itemBuilder: (_, i) => ListTile(title: Text('Mục $i'))),
    ))));
    await tester.pumpAndSettle();
    expect(find.byType(OfflineBanner), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Mục 30'), 300);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Trang chủ dùng cache ở chiều rộng 412 không lỗi layout sau restart', (tester) async {
    tester.view.devicePixelRatio = 3;
    tester.view.physicalSize = const Size(1236, 2700);
    addTearDown(() { tester.view.resetDevicePixelRatio(); tester.view.resetPhysicalSize(); });
    await tester.pumpWidget(await fixtures.screen(ProviderScope(
      overrides: [homeProvider.overrideWith((ref) async => cached)],
      child: const HomePage(),
    )));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.byType(OfflineBanner), 250, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.byType(OfflineBanner), findsOneWidget);
  });
}
