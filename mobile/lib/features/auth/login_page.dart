import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../profile/settings_page.dart';

/// M02 – Đăng nhập / Đăng ký. Xác thực ở máy chủ; giới hạn đăng nhập sai; token lưu an toàn.
class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key, this.register = false});
  final bool register;
  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> with SingleTickerProviderStateMixin {
  late final TabController tabs = TabController(length: 2, vsync: this, initialIndex: widget.register ? 1 : 0);
  final user = TextEditingController();
  final pass = TextEditingController();
  final name = TextEditingController();
  final contact = TextEditingController();
  final pass2 = TextEditingController();
  bool remember = true, busy = false, hide = true, agree = false;
  String? error;

  @override
  void initState() {
    super.initState();
    user.text = ref.read(prefsProvider).getString('remember_username') ?? '';
    final e = ref.read(sessionProvider).error;
    if (e != null && e.contains('hết hạn')) error = e;
  }

  Future<void> _login() async {
    if (user.text.trim().isEmpty || pass.text.isEmpty) return setState(() => error = 'Nhập tên đăng nhập và mật khẩu.');
    setState(() => [busy = true, error = null]);
    try {
      await ref.read(sessionProvider.notifier).login(user.text.trim(), pass.text);
      final p = ref.read(prefsProvider);
      remember ? await p.setString('remember_username', user.text.trim()) : await p.remove('remember_username');
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _register() async {
    final c = contact.text.trim();
    if (!agree) return setState(() => error = 'Vui lòng đồng ý chính sách bảo vệ dữ liệu cá nhân.');
    if (pass.text != pass2.text) return setState(() => error = 'Mật khẩu nhập lại không khớp.');
    setState(() => [busy = true, error = null]);
    try {
      await ref.read(sessionProvider.notifier).register(name: name.text.trim(), phone: c.contains('@') ? null : c, email: c.contains('@') ? c : null, password: pass.text);
      if (mounted) context.go('/home');
    } on ApiException catch (e) {
      setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _forgot() async {
    final api = ref.read(apiProvider);
    try {
      final r = await api.post<Map<String, dynamic>>('/api/mobile/auth/forgot', {'username': user.text.trim()});
      if (mounted) showDialog(context: context, builder: (_) => AlertDialog(title: const Text('Quên mật khẩu'), content: Text(r['message'] as String), actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Đóng'))]));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 8, 20, 24), children: [
          Align(
            alignment: Alignment.centerRight,
            child: IconButton(tooltip: 'Địa chỉ máy chủ', icon: const Icon(Icons.dns_outlined, color: AppColors.muted), onPressed: () => showServerDialog(context, ref)),
          ),
          Image.asset('assets/images/logo-full.png', height: 190, semanticLabel: 'WebGIS Kon Tum – Giám sát tài nguyên rừng và cảnh báo cháy rừng'),
          const SizedBox(height: 14),
          TabBar(controller: tabs, tabs: const [Tab(text: 'Đăng nhập'), Tab(text: 'Đăng ký')], onTap: (_) => setState(() => error = null)),
          const SizedBox(height: 16),
          if (s.error != null && !s.signedIn && error == null && s.bootstrap.isEmpty) NoticeBox('Không kết nối được máy chủ: ${s.error}. Kiểm tra mạng hoặc địa chỉ máy chủ (biểu tượng góc trên).', warn: true),
          AnimatedBuilder(
            animation: tabs,
            builder: (_, _) => tabs.index == 0 ? _loginForm() : _registerForm(),
          ),
          if (error != null) Padding(padding: const EdgeInsets.only(top: 10), child: NoticeBox(error!, warn: true)),
          const SizedBox(height: 14),
          Row(children: const [Expanded(child: Divider()), Padding(padding: EdgeInsets.symmetric(horizontal: 8), child: Text('hoặc', style: TextStyle(color: AppColors.muted))), Expanded(child: Divider())]),
          const SizedBox(height: 6),
          OutlinedButton.icon(
            onPressed: busy ? null : () async {
              await ref.read(sessionProvider.notifier).continueAsGuest();
              if (context.mounted) context.go('/home');
            },
            icon: const Icon(Icons.travel_explore),
            label: const Text('Tiếp tục với vai trò Khách'),
          ),
          if (s.demoLogin) ...[const SizedBox(height: 14), const Card(child: QuickLoginPanel())],
          const SizedBox(height: 14),
          const Text('Thông tin công khai xem được không cần đăng nhập. Tài khoản cán bộ do đơn vị cấp.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: AppColors.muted)),
        ]),
      ),
    );
  }

  Widget _loginForm() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(controller: user, textInputAction: TextInputAction.next, decoration: const InputDecoration(prefixIcon: Icon(Icons.person_outline), hintText: 'Tên đăng nhập, số điện thoại hoặc email')),
        const SizedBox(height: 10),
        TextField(
          controller: pass,
          obscureText: hide,
          onSubmitted: (_) => _login(),
          decoration: InputDecoration(prefixIcon: const Icon(Icons.lock_outline), hintText: 'Mật khẩu', suffixIcon: IconButton(icon: Icon(hide ? Icons.visibility_outlined : Icons.visibility_off_outlined), onPressed: () => setState(() => hide = !hide))),
        ),
        Row(children: [
          Checkbox(value: remember, onChanged: (v) => setState(() => remember = v ?? true)),
          const Text('Ghi nhớ đăng nhập'),
          const Spacer(),
          TextButton(onPressed: _forgot, child: const Text('Quên mật khẩu?')),
        ]),
        FilledButton(onPressed: busy ? null : _login, child: busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Đăng nhập')),
      ]);

  Widget _registerForm() => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const NoticeBox('Đăng ký dành cho người dân muốn theo dõi phản ánh của mình. Cán bộ dùng tài khoản do đơn vị cấp.'),
        const SizedBox(height: 10),
        TextField(controller: name, decoration: const InputDecoration(prefixIcon: Icon(Icons.badge_outlined), hintText: 'Họ và tên')),
        const SizedBox(height: 10),
        TextField(controller: contact, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(prefixIcon: Icon(Icons.phone_outlined), hintText: 'Số điện thoại hoặc email')),
        const SizedBox(height: 10),
        TextField(controller: pass, obscureText: true, decoration: const InputDecoration(prefixIcon: Icon(Icons.lock_outline), hintText: 'Mật khẩu (tối thiểu 8 ký tự)')),
        const SizedBox(height: 10),
        TextField(controller: pass2, obscureText: true, decoration: const InputDecoration(prefixIcon: Icon(Icons.lock_outline), hintText: 'Nhập lại mật khẩu')),
        CheckboxListTile(
          value: agree,
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          onChanged: (v) => setState(() => agree = v ?? false),
          title: const Text('Tôi đồng ý chính sách: thông tin cá nhân chỉ cán bộ xử lý xem, không công khai.', style: TextStyle(fontSize: 13)),
        ),
        FilledButton(onPressed: busy ? null : _register, child: busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Text('Đăng ký')),
      ]);
}
