import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/data.dart';
import '../../core/outbox.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';

/// M14 – Cá nhân / cài đặt: hồ sơ, thông báo, dữ liệu ngoại tuyến – đồng bộ, cài đặt, hỗ trợ, đăng xuất.
class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    final u = s.user;
    final o = ref.watch(outboxProvider);
    final notif = ref.watch(notificationsProvider).asData?.value;
    final unread = ((notif?['items'] as List?) ?? []).where((n) => n['read'] != true).length;

    Widget item(IconData i, String t, VoidCallback onTap, {String? trailing, int badge = 0, Color? color}) => ListTile(
          leading: Icon(i, color: color ?? AppColors.navy),
          title: Text(t, style: TextStyle(color: color)),
          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
            if (badge > 0) Badge(label: Text('$badge')),
            if (trailing != null) Text(trailing, style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
            const Icon(Icons.chevron_right, color: AppColors.muted),
          ]),
          onTap: onTap,
        );

    return Scaffold(
      appBar: AppBar(title: const Text('Cá nhân')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        Card(
          child: ListTile(
            contentPadding: const EdgeInsets.all(14),
            leading: CircleAvatar(radius: 28, backgroundColor: AppColors.forestLight, child: Text((u?.name ?? 'K').characters.first.toUpperCase(), style: const TextStyle(fontSize: 22, color: AppColors.forest, fontWeight: FontWeight.w800))),
            title: Text(u?.name ?? 'Khách', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
            subtitle: Text(u == null ? 'Chưa đăng nhập – chỉ xem thông tin công khai' : '${u.roleLabel}\n${u.raw['email'] ?? u.raw['phone'] ?? u.username}${u.scope != null ? '\nĐịa bàn: ${s.communeName(u.scope)}' : ''}'),
            isThreeLine: u != null,
            onTap: u == null ? () => context.go('/login') : () => _account(context, ref, u),
          ),
        ),
        const SizedBox(height: 10),
        Card(
          child: Column(children: [
            if (u != null) item(Icons.person_outline, 'Thông tin cá nhân', () => _account(context, ref, u)),
            item(Icons.campaign_outlined, 'Quản lý phản ánh của tôi', () => context.push('/reports')),
            if (u != null && (u.role == 'specialist' || u.role == 'leader')) item(Icons.assignment_outlined, 'Nhiệm vụ hiện trường', () => context.push('/tasks')),
            if (u?.can('field.review') == true) item(Icons.fact_check_outlined, 'Duyệt kết quả xác minh', () => context.push('/review')),
            item(Icons.notifications_none, 'Thông báo', () => context.push('/notifications'), badge: unread),
            item(Icons.sync, 'Dữ liệu ngoại tuyến & đồng bộ', () => context.push('/sync'), badge: o.waiting + o.conflicts, trailing: o.online ? null : 'Ngoại tuyến'),
          ]),
        ),
        const SizedBox(height: 10),
        Card(
          child: Column(children: [
            item(Icons.settings_outlined, 'Cài đặt (ngôn ngữ, cỡ chữ, máy chủ…)', () => context.push('/settings'), trailing: 'Tiếng Việt'),
            if (s.demoLogin) item(Icons.switch_account_outlined, 'Đăng nhập nhanh / đổi vai trò', () => showQuickLogin(context, ref), color: AppColors.orange),
            item(Icons.menu_book_outlined, 'Hướng dẫn sử dụng', () => launchUrl(Uri.parse(ref.read(apiProvider).url('/huong-dan/mobile')), mode: LaunchMode.externalApplication)),
            item(Icons.support_agent, 'Hỗ trợ – đường dây nóng', () => _support(context, s)),
            item(Icons.info_outline, 'Về ứng dụng', () => _about(context)),
          ]),
        ),
        const SizedBox(height: 14),
        if (u != null)
          FilledButton.tonalIcon(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFFDECEA), foregroundColor: AppColors.fire, minimumSize: const Size.fromHeight(48)),
            icon: const Icon(Icons.logout),
            label: const Text('Đăng xuất'),
            onPressed: () => _logout(context, ref),
          )
        else
          FilledButton.icon(icon: const Icon(Icons.login), label: const Text('Đăng nhập / Đăng ký'), onPressed: () => context.go('/login')),
      ]),
    );
  }

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final waiting = ref.read(outboxProvider).waiting;
    var all = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, set) => AlertDialog(
          title: const Text('Đăng xuất?'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (waiting > 0) Padding(padding: const EdgeInsets.only(bottom: 8), child: NoticeBox('Còn $waiting bản ghi chưa gửi. Bản ghi vẫn được giữ trên máy và gửi khi bạn đăng nhập lại.', warn: true)),
            const Text('Token đăng nhập bị thu hồi và dữ liệu nghiệp vụ lưu tạm trên máy sẽ bị xoá.'),
            CheckboxListTile(contentPadding: EdgeInsets.zero, value: all, onChanged: (v) => set(() => all = v ?? false), title: const Text('Đăng xuất trên mọi thiết bị', style: TextStyle(fontSize: 13.5))),
          ]),
          actions: [TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Huỷ')), FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Đăng xuất'))],
        ),
      ),
    );
    if (ok == true) {
      await ref.read(sessionProvider.notifier).logout(allDevices: all);
      if (context.mounted) context.go('/login');
    }
  }

  void _account(BuildContext context, WidgetRef ref, AppUser u) {
    final cur = TextEditingController(), nw = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Thông tin cá nhân', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          KV('Họ tên', u.name),
          KV('Tài khoản', u.username),
          KV('Vai trò', u.roleLabel),
          KV('Quyền', u.permissions.where((p) => p.startsWith('field') || p.startsWith('tasks') || p.startsWith('reports')).join(', ')),
          const Divider(),
          const Text('Đổi mật khẩu', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          TextField(controller: cur, obscureText: true, decoration: const InputDecoration(hintText: 'Mật khẩu hiện tại', isDense: true)),
          const SizedBox(height: 6),
          TextField(controller: nw, obscureText: true, decoration: InputDecoration(hintText: 'Mật khẩu mới (≥ ${u.role == 'citizen' ? 8 : 10} ký tự)', isDense: true)),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: () async {
              try {
                final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/api/mobile/auth/password', {'current': cur.text, 'password': nw.text});
                await ref.read(apiProvider).tokens.save(r['access_token'] as String, r['refresh_token'] as String);
                if (context.mounted) {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Đã đổi mật khẩu; các thiết bị khác đã bị đăng xuất.')));
                }
              } on ApiException catch (e) {
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
              }
            },
            child: const Text('Cập nhật mật khẩu'),
          ),
        ]),
      ),
    );
  }

  void _support(BuildContext context, SessionState s) {
    final c = (s.bootstrap['contact'] as Map?) ?? {};
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Hỗ trợ'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(c['unit']?.toString() ?? 'Chi cục Kiểm lâm'),
          const SizedBox(height: 6),
          Text('Đường dây nóng: ${c['hotline'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(c['note']?.toString() ?? ''),
        ]),
        actions: [
          if (c['hotline'] != null) TextButton(onPressed: () => launchUrl(Uri.parse('tel:${c['hotline'].toString().replaceAll(' ', '')}')), child: const Text('Gọi')),
          TextButton(onPressed: () => launchUrl(Uri.parse('tel:114')), child: const Text('Gọi 114')),
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Đóng')),
        ],
      ),
    );
  }

  Future<void> _about(BuildContext context) async {
    String v = '1.0.0';
    try {
      final p = await PackageInfo.fromPlatform();
      v = '${p.version}+${p.buildNumber}';
    } catch (_) {}
    if (!context.mounted) return;
    showAboutDialog(
      context: context,
      applicationName: 'MobileGIS Kon Tum',
      applicationVersion: 'Phiên bản $v',
      applicationIcon: Image.asset('assets/images/logo.png', width: 48),
      children: const [
        Text('Ứng dụng di động của hệ thống giám sát tài nguyên rừng và cảnh báo cháy rừng khu vực Kon Tum. Hiển thị sản phẩm đã công bố, gửi dữ liệu khảo sát và nhận thông báo; xử lý chuyên môn thực hiện bằng Python trên máy chủ.'),
      ],
    );
  }
}
