import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app/theme.dart';
import 'session.dart';

/// Kiểm tra phiên bản MobileGIS mới (GET /api/mobile/app-version?current=x.y.z) – quản trị khai báo ở
/// Quản trị › Cài đặt › Phiên bản ứng dụng. `force` = bản đang dùng thấp hơn phiên bản tối thiểu.
final appUpdateProvider = FutureProvider<Map<String, dynamic>?>((ref) async {
  try {
    final info = await PackageInfo.fromPlatform();
    final r = await ref.read(apiProvider).get<Map<String, dynamic>>('/api/mobile/app-version', query: {'current': info.version});
    return {...r, 'current': info.version};
  } catch (_) {
    return null; // ngoại tuyến: bỏ qua
  }
});

String? updateUrl(Map link) {
  final android = link['android_url']?.toString();
  final ios = link['ios_url']?.toString();
  if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) return (ios != null && ios.isNotEmpty) ? ios : android;
  return (android != null && android.isNotEmpty) ? android : ios;
}

Future<void> openUpdate(Map link) async {
  final u = updateUrl(link);
  if (u != null && u.isNotEmpty) await launchUrl(Uri.parse(u), mode: LaunchMode.externalApplication);
}

/// Thẻ "Có phiên bản mới" ở Trang chủ (ẩn được với bản không bắt buộc; nhớ theo số phiên bản).
class AppUpdateBanner extends ConsumerStatefulWidget {
  const AppUpdateBanner({super.key});
  @override
  ConsumerState<AppUpdateBanner> createState() => _AppUpdateBannerState();
}

class _AppUpdateBannerState extends ConsumerState<AppUpdateBanner> {
  bool hidden = false;
  @override
  Widget build(BuildContext context) {
    final u = ref.watch(appUpdateProvider).asData?.value;
    if (u == null || u['update'] != true) return const SizedBox.shrink();
    final force = u['force'] == true;
    final prefs = ref.read(prefsProvider);
    if (!force && (hidden || prefs.getString('update_dismissed') == u['latest'])) return const SizedBox.shrink();
    return Card(
      color: force ? const Color(0xFFFFEBEE) : const Color(0xFFE8F5E9),
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 6, 6),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(force ? Icons.system_update : Icons.new_releases_outlined, color: force ? AppColors.fire : AppColors.forest),
            const SizedBox(width: 8),
            Expanded(child: Text(force ? 'Cần cập nhật lên phiên bản ${u['latest']}' : 'Có phiên bản mới ${u['latest']}', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.navy))),
          ]),
          if ((u['notes'] ?? '').toString().isNotEmpty) Padding(padding: const EdgeInsets.only(top: 4), child: Text(u['notes'].toString(), style: const TextStyle(fontSize: 13))),
          Text('Bạn đang dùng ${u['current']}${force ? ' – phiên bản này không còn được hỗ trợ đầy đủ.' : ''}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          Row(mainAxisAlignment: MainAxisAlignment.end, children: [
            if (!force) TextButton(onPressed: () { prefs.setString('update_dismissed', u['latest'].toString()); setState(() => hidden = true); }, child: const Text('Để sau')),
            if (updateUrl(u) != null) FilledButton.icon(onPressed: () => openUpdate(u), icon: const Icon(Icons.download), label: const Text('Cập nhật')),
          ]),
        ]),
      ),
    );
  }
}
