import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

Future<void> shareText(BuildContext context, String text) async {
  final box = context.findRenderObject();
  final origin = box is RenderBox && box.hasSize
      ? box.localToGlobal(Offset.zero) & box.size
      : const Rect.fromLTWH(0, 0, 1, 1);
  try {
    // iPad yêu cầu vùng neo hợp lệ cho popover chia sẻ.
    await SharePlus.instance.share(ShareParams(text: text, sharePositionOrigin: origin));
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Chưa chia sẻ được. Vui lòng thử lại.')));
    }
  }
}
