import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

Future<void> openAccountLink(BuildContext context, String url) async {
  final uri = Uri.tryParse(url);
  try {
    if (uri != null && uri.scheme == 'https' && uri.host.isNotEmpty &&
        await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      return;
    }
  } catch (_) {}
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Chưa mở được trang. Vui lòng kiểm tra kết nối và thử lại.')));
  }
}
