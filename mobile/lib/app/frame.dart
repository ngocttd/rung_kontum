import 'package:flutter/material.dart';

/// Giữ nguyên insets đáy để Scaffold, NavigationBar và bottom sheet tự xử lý.
/// MediaQuery cập nhật khi đổi chế độ điều hướng, bàn phím hoặc xoay màn hình.
class AppFrame extends StatelessWidget {
  const AppFrame({super.key, required this.child, this.textScale = 1.0});
  final Widget child;
  final double textScale;

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: Colors.white,
        child: SafeArea(
          top: false,
          bottom: false,
          child: MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)), child: child),
        ),
      );
}
