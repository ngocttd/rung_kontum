import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kontum_mobilegis/app/frame.dart';
import 'package:kontum_mobilegis/app/layout.dart';
import 'package:kontum_mobilegis/app/theme.dart';

void display(WidgetTester tester, {Size size = const Size(360, 800), double bottom = 48}) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  tester.view.padding = FakeViewPadding(top: 24, bottom: bottom);
  tester.view.viewPadding = FakeViewPadding(top: 24, bottom: bottom);
}

Widget app(Widget child, {TargetPlatform platform = TargetPlatform.android}) => MaterialApp(
  theme: buildTheme().copyWith(platform: platform),
  builder: (_, child) => AppFrame(child: child!),
  home: child,
);

Widget tabs() => AppNavigationBar(
  selectedIndex: 0,
  onDestinationSelected: (_) {},
  destinations: const [
    NavigationDestination(icon: Icon(Icons.home), label: 'Trang chủ'),
    NavigationDestination(icon: Icon(Icons.map), label: 'Bản đồ'),
    NavigationDestination(icon: Icon(Icons.fireplace), label: 'Cảnh báo'),
    NavigationDestination(icon: Icon(Icons.article), label: 'Tin tức'),
    NavigationDestination(icon: Icon(Icons.person), label: 'Cá nhân'),
  ],
);

void main() {
  void reset(WidgetTester tester) => addTearDown(() {
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
    tester.view.resetPadding();
    tester.view.resetViewPadding();
    tester.view.resetViewInsets();
  });

  testWidgets('Android đổi 3 nút → vuốt → 3 nút: navbar luôn chạm đáy, nút tránh đúng inset', (tester) async {
    display(tester);
    reset(tester);
    await tester.pumpWidget(app(Scaffold(body: const SizedBox.expand(), bottomNavigationBar: tabs())));
    for (final inset in [48.0, 24.0, 0.0, 48.0]) {
      display(tester, bottom: inset);
      await tester.pumpAndSettle();
      final bar = tester.getRect(find.byType(NavigationBar));
      expect(bar.bottom, 800);
      expect(bar.height, 64 + inset);
      expect(tester.getRect(find.byIcon(Icons.home)).bottom, lessThanOrEqualTo(800 - inset));
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('iOS navbar gọn, chỉ chừa home indicator một lần', (tester) async {
    display(tester, size: const Size(375, 812), bottom: 34);
    reset(tester);
    await tester.pumpWidget(app(Scaffold(body: const SizedBox.expand(), bottomNavigationBar: tabs()), platform: TargetPlatform.iOS));
    final bar = tester.getRect(find.byType(NavigationBar));
    expect(bar.bottom, 812);
    expect(bar.height, 60 + 34);
    expect(tester.getRect(find.byIcon(Icons.home)).bottom, lessThanOrEqualTo(812 - 34));
    expect(tester.takeException(), isNull);
  });

  testWidgets('xoay ngang tránh thanh 3 nút nằm ở cạnh phải', (tester) async {
    display(tester, size: const Size(800, 360), bottom: 0);
    reset(tester);
    tester.view.padding = const FakeViewPadding(top: 24, right: 48);
    tester.view.viewPadding = const FakeViewPadding(top: 24, right: 48);
    await tester.pumpWidget(app(Scaffold(body: const SizedBox.expand(), bottomNavigationBar: tabs())));
    await tester.pumpAndSettle();
    final bar = tester.getRect(find.byType(NavigationBar));
    expect(bar.bottom, 360);
    expect(bar.right, lessThanOrEqualTo(800 - 48));
    expect(tester.getRect(find.byIcon(Icons.person)).right, lessThanOrEqualTo(800 - 48));
    expect(tester.takeException(), isNull);
  });

  testWidgets('bàn phím không đổi khoảng đệm của navbar', (tester) async {
    display(tester, bottom: 24);
    reset(tester);
    await tester.pumpWidget(app(Scaffold(body: const SizedBox.expand(), bottomNavigationBar: tabs())));
    final before = tester.getRect(find.byType(NavigationBar));
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    tester.view.padding = const FakeViewPadding(top: 24);
    await tester.pumpAndSettle();
    expect(tester.getRect(find.byType(NavigationBar)), before);
    expect(tester.takeException(), isNull);
  });

  testWidgets('nút cuối trang chi tiết cuộn lên trên thanh điều hướng Android', (tester) async {
    display(tester);
    reset(tester);
    await tester.pumpWidget(app(ResponsiveScaffold(body: ListView(padding: const EdgeInsets.all(16), children: [
      const SizedBox(height: 1100),
      FilledButton(key: const Key('last'), onPressed: () {}, child: const Text('Nộp xác minh hiện trường')),
    ]))));
    await tester.scrollUntilVisible(find.byKey(const Key('last')), 250);
    await tester.pumpAndSettle();
    expect(tester.getRect(find.byKey(const Key('last'))).bottom, lessThanOrEqualTo(800 - 48));
    expect(tester.takeException(), isNull);
  });

  testWidgets('form bottom sheet cuộn được khi mở bàn phím trên máy nhỏ', (tester) async {
    display(tester, size: const Size(320, 568));
    reset(tester);
    await tester.pumpWidget(app(ResponsiveScaffold(body: Builder(builder: (context) => Center(child: TextButton(
      onPressed: () => showModalBottomSheet(context: context, isScrollControlled: true, showDragHandle: true, builder: (_) => FormSheet(child: Column(mainAxisSize: MainAxisSize.min, children: [
        for (var i = 0; i < 6; i++) TextField(decoration: InputDecoration(labelText: 'Trường $i')),
        FilledButton(key: const Key('save'), onPressed: () {}, child: const Text('Lưu')),
      ]))),
      child: const Text('Mở'),
    ))))));
    await tester.tap(find.text('Mở'));
    await tester.pumpAndSettle();
    tester.view.viewInsets = const FakeViewPadding(bottom: 250);
    tester.view.padding = const FakeViewPadding(top: 24);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const Key('save')));
    await tester.pumpAndSettle();
    expect(tester.getRect(find.byKey(const Key('save'))).bottom, lessThanOrEqualTo(568 - 250));
    expect(tester.takeException(), isNull);
  });
}
