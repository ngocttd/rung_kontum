import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kontum_mobilegis/features/map/map_page.dart';

import 'responsive_test.dart' as fixtures;

void main() {
  testWidgets('khung chọn tab đầu tiên phản hồi trước khi dựng FlutterMap', (tester) async {
    await tester.pumpWidget(await fixtures.screen(const MapPage()));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.byType(FlutterMap), findsNothing);
    // Thoát trước khung sau: không khởi tạo map hoặc controller sau khi dispose.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
