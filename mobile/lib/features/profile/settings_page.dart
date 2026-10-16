import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/config.dart';
import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/api.dart';
import '../../core/outbox.dart';
import '../../core/push.dart';
import '../../core/realtime.dart';
import '../../core/session.dart';
import '../../main.dart';
import '../../widgets/common.dart';

/// Đổi địa chỉ máy chủ (đội kiểm thử dùng IP LAN của máy chạy backend).
Future<void> showServerDialog(BuildContext context, WidgetRef ref) async {
  final c = TextEditingController(text: ref.read(serverUrlProvider));
  final v = await showDialog<String>(
    context: context,
    builder: (_) => AlertDialog(
      title: const Text('Địa chỉ máy chủ'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: c, keyboardType: TextInputType.url, decoration: const InputDecoration(hintText: 'https://webgis.kontum.gov.vn')),
        const SizedBox(height: 8),
        Text('Mặc định: ${AppConfig.defaultApiBase}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, AppConfig.defaultApiBase), child: const Text('Mặc định')),
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Huỷ')),
        FilledButton(onPressed: () => Navigator.pop(context, c.text), child: const Text('Lưu')),
      ],
    ),
  );
  if (v == null || v.trim().isEmpty) return;
  await ref.read(serverUrlProvider.notifier).set(v);
  await ref.read(sessionProvider.notifier).start();
}

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final scale = ref.watch(textScaleProvider);
    final contrast = ref.watch(highContrastProvider);
    final o = ref.watch(outboxProvider);
    final prefs = ref.watch(prefsProvider);
    final subs = prefs.getStringList('subscribed_communes') ?? const <String>[];
    return Scaffold(
      appBar: AppBar(title: const Text('Cài đặt')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        SectionCard(
          title: 'Hiển thị',
          child: Column(children: [
            ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.language), title: const Text('Ngôn ngữ'), trailing: const Text('Tiếng Việt')),
            Row(children: [
              const Icon(Icons.format_size),
              const SizedBox(width: 12),
              const Text('Cỡ chữ'),
              Expanded(child: Slider(value: scale, min: .9, max: 1.4, divisions: 5, label: '${(scale * 100).round()}%', onChanged: (v) => ref.read(textScaleProvider.notifier).set(v))),
            ]),
            SwitchListTile(contentPadding: EdgeInsets.zero, secondary: const Icon(Icons.contrast), title: const Text('Tương phản cao'), value: contrast, onChanged: (v) => ref.read(highContrastProvider.notifier).set(v)),
          ]),
        ),
        const SizedBox(height: 10),
        const _PushCard(),
        const SizedBox(height: 10),
        SectionCard(
          title: 'Thông báo theo địa bàn',
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(subs.isEmpty ? 'Đang nhận thông báo toàn vùng' : 'Đang theo dõi ${subs.length} xã/phường', style: const TextStyle(color: AppColors.muted)),
            const SizedBox(height: 6),
            OutlinedButton.icon(
              icon: const Icon(Icons.edit_location_alt_outlined),
              label: const Text('Chọn xã/phường theo dõi'),
              onPressed: () async {
                final sel = {...subs};
                await showModalBottomSheet(
                  context: context,
                  isScrollControlled: true,
                  showDragHandle: true,
                  builder: (_) => StatefulBuilder(
                    builder: (context, set) => DraggableScrollableSheet(
                      expand: false,
                      initialChildSize: .8,
                      builder: (_, sc) => ListView(controller: sc, children: [
                        for (final c in s.communes)
                          CheckboxListTile(dense: true, value: sel.contains(c['code']), title: Text(c['name'].toString()), onChanged: (v) => set(() => v == true ? sel.add(c['code'] as String) : sel.remove(c['code']))),
                      ]),
                    ),
                  ),
                );
                await prefs.setStringList('subscribed_communes', sel.toList());
                ref.invalidate(notificationsProvider);
                ref.read(realtimeProvider.notifier).subscribe(sel.toList());
                await ref.read(sessionProvider.notifier).registerDevice();
                await ref.read(sessionProvider.notifier).reloadBootstrap().catchError((_) {});
              },
            ),
            const SourceNote('Chỉ nhận cảnh báo đã phê duyệt / sự kiện đã xác minh, không nhận điểm nóng chưa xác minh.'),
          ]),
        ),
        const SizedBox(height: 10),
        SectionCard(
          title: 'Dữ liệu ngoại tuyến',
          child: Column(children: [
            SwitchListTile(contentPadding: EdgeInsets.zero, secondary: const Icon(Icons.sync), title: const Text('Tự động gửi khi có mạng'), value: o.autoSync, onChanged: (v) => ref.read(outboxProvider.notifier).setAutoSync(v)),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.cleaning_services_outlined),
              title: const Text('Xoá dữ liệu công khai lưu tạm'),
              subtitle: const Text('Bản đồ, thống kê đã lưu để xem khi mất mạng'),
              onTap: () async {
                for (final k in prefs.getKeys().where((k) => k.startsWith('pub:')).toList()) {
                  await prefs.remove(k);
                }
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Đã xoá dữ liệu lưu tạm')));
              },
            ),
          ]),
        ),
        const SizedBox(height: 10),
        SectionCard(
          title: 'Kết nối',
          child: ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.dns_outlined), title: const Text('Địa chỉ máy chủ'), subtitle: Text(ref.watch(serverUrlProvider)), onTap: () => showServerDialog(context, ref)),
        ),
      ]),
    );
  }
}


/// Trạng thái kênh thông báo: Socket.IO (khi mở) + push theo nền tảng (APNs / UnifiedPush) – không Firebase.
class _PushCard extends ConsumerWidget {
  const _PushCard();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rt = ref.watch(realtimeProvider);
    final push = ref.watch(pushProvider);
    final signed = ref.watch(sessionProvider.select((s) => s.signedIn));
    return SectionCard(
      title: 'Thông báo',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(rt.connected ? Icons.bolt : Icons.bolt_outlined, color: rt.connected ? AppColors.forest : AppColors.muted),
          title: const Text('Thời gian thực (Socket.IO)'),
          subtitle: Text(rt.connected ? 'Đang kết nối – nhận ngay khi ứng dụng mở' : 'Chưa kết nối'),
        ),
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(push.registered ? Icons.notifications_active_outlined : Icons.notifications_off_outlined, color: push.registered ? AppColors.forest : AppColors.orange),
          title: const Text('Khi ứng dụng ở nền / đã đóng'),
          subtitle: Text(push.label),
        ),
        if (push.message != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: NoticeBox(push.message!, warn: !push.registered)),
        Wrap(spacing: 8, runSpacing: 6, children: [
          if (push.channel == PushChannel.unifiedpush || push.channel == PushChannel.apns)
            OutlinedButton.icon(onPressed: () => ref.read(pushProvider.notifier).enable(interactive: true), icon: const Icon(Icons.notifications_active_outlined), label: const Text('Bật / đăng ký lại')),
          if (push.channel == PushChannel.unifiedpush)
            OutlinedButton.icon(
              icon: const Icon(Icons.hub_outlined),
              label: const Text('Chọn ứng dụng phân phối'),
              onPressed: () async {
                final list = await ref.read(pushProvider.notifier).distributors();
                if (!context.mounted) return;
                final picked = await showDialog<String>(
                  context: context,
                  builder: (_) => SimpleDialog(title: const Text('Ứng dụng phân phối UnifiedPush'), children: [
                    if (list.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Chưa cài ứng dụng phân phối. Cài “ntfy” (Google Play/F-Droid) rồi quay lại – không cần tài khoản Google.')),
                    for (final d in list) SimpleDialogOption(onPressed: () => Navigator.pop(context, d), child: Text(d)),
                  ]),
                );
                if (picked != null) await ref.read(pushProvider.notifier).useDistributor(picked);
              },
            ),
          if (signed)
            OutlinedButton.icon(
              icon: const Icon(Icons.send_outlined),
              label: const Text('Gửi thông báo thử'),
              onPressed: () async {
                try {
                  await ref.read(apiProvider).post('/api/mobile/notifications/test');
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Đã gửi – thông báo sẽ hiện trong vài giây.')));
                } on ApiException catch (e) {
                  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
                }
              },
            ),
          if (push.registered) TextButton(onPressed: () => ref.read(pushProvider.notifier).disable(), child: const Text('Tắt push')),
        ]),
        const SourceNote('Không dùng Firebase. iOS nhận qua APNs của Apple; Android qua UnifiedPush (chuẩn mở, cần ứng dụng phân phối như ntfy); khi ứng dụng mở nhận trực tiếp qua Socket.IO. Lịch sử thông báo lưu trên máy chủ (PostgreSQL).'),
      ]),
    );
  }
}
