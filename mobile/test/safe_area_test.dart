// Thiết bị thật (Android 15 edge-to-edge): thanh điều hướng hệ thống đè lên nội dung.
// AppFrame phải đẩy mọi nút ở đáy (trang chi tiết, bottom sheet) lên trên vùng thanh điều hướng.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kontum_mobilegis/app/frame.dart';

const navBar = 48.0;

Widget phone(Widget home) => MediaQuery(
      data: const MediaQueryData(size: Size(400, 860), padding: EdgeInsets.only(top: 24, bottom: navBar), viewPadding: EdgeInsets.only(top: 24, bottom: navBar)),
      child: MaterialApp(builder: (c, child) => AppFrame(child: child!), home: home),
    );

void main() {
  testWidgets('nút cuối trang chi tiết không bị thanh điều hướng che', (t) async {
    await t.pumpWidget(phone(Scaffold(
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const SizedBox(height: 900),
        FilledButton(key: const Key('last'), onPressed: () {}, child: const Text('Xác minh tại hiện trường')),
      ]),
    )));
    await t.scrollUntilVisible(find.byKey(const Key('last')), 200);
    await t.pumpAndSettle();
    final r = t.getRect(find.byKey(const Key('last')));
    expect(r.bottom, lessThanOrEqualTo(860 - navBar));
  });

  testWidgets('nút ghim ở đáy màn hình (bottomNavigationBar) nằm trên thanh điều hướng', (t) async {
    await t.pumpWidget(phone(Scaffold(
      body: const SizedBox.expand(),
      bottomNavigationBar: Padding(padding: const EdgeInsets.all(8), child: FilledButton(key: const Key('send'), onPressed: () {}, child: const Text('Gửi'))),
    )));
    expect(t.getRect(find.byKey(const Key('send'))).bottom, lessThanOrEqualTo(860 - navBar));
  });

  testWidgets('bottom sheet không bị thanh điều hướng che', (t) async {
    await t.pumpWidget(phone(Builder(builder: (c) => Scaffold(
      body: Center(child: TextButton(onPressed: () => showModalBottomSheet(context: c, builder: (_) => Column(mainAxisSize: MainAxisSize.min, children: [FilledButton(key: const Key('pick'), onPressed: () {}, child: const Text('Chọn'))])), child: const Text('mở'))),
    ))));
    await t.tap(find.text('mở'));
    await t.pumpAndSettle();
    expect(t.getRect(find.byKey(const Key('pick'))).bottom, lessThanOrEqualTo(860 - navBar));
  });
}
