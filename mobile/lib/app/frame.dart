import 'package:flutter/material.dart';

/// Khung chung của mọi màn hình (MaterialApp.builder): chừa vùng thanh điều hướng hệ thống ở đáy và hai bên
/// (Android 15+ edge-to-edge, 3 nút hoặc cử chỉ, cả khi xoay ngang) để nút, danh sách, bottom sheet không bị che.
/// Phía trên để AppBar/ảnh đầu trang tự xử lý thanh trạng thái. Nền trắng trùng màu NavigationBar của ứng dụng.
class AppFrame extends StatelessWidget {
  const AppFrame({super.key, required this.child, this.textScale = 1.0});
  final Widget child;
  final double textScale;

  @override
  Widget build(BuildContext context) => ColoredBox(
        color: Colors.white,
        child: SafeArea(
          top: false,
          child: MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)), child: child),
        ),
      );
}
