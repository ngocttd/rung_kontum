import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../app/theme.dart';
import '../../core/session.dart';

/// M01 – Khởi động: giới thiệu, phiên bản, kiểm tra mạng và phiên đăng nhập; ngoại tuyến vẫn vào được dữ liệu đã lưu.
class SplashPage extends ConsumerStatefulWidget {
  const SplashPage({super.key});
  @override
  ConsumerState<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends ConsumerState<SplashPage> {
  String version = '';

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((p) => mounted ? setState(() => version = 'Phiên bản ${p.version}') : null).catchError((_) {});
    Future.microtask(() => ref.read(sessionProvider.notifier).start());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(fit: StackFit.expand, children: [
        Image.asset('assets/images/mobile-splash.webp', fit: BoxFit.cover),
        Container(decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xCC0B3D24), Color(0x660B6B3A), Color(0xEE064A28)]))),
        SafeArea(
          child: Column(children: [
            const Spacer(flex: 2),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle, boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 18)]),
              child: Image.asset('assets/images/logo.png', width: 132, height: 132),
            ),
            const SizedBox(height: 18),
            const Text('WebGIS KON TUM', style: TextStyle(color: Colors.white, fontSize: 30, fontWeight: FontWeight.w900, letterSpacing: .5)),
            const SizedBox(height: 6),
            const Text('Giám sát tài nguyên rừng\nvà cảnh báo cháy rừng', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 16, height: 1.35)),
            const Spacer(flex: 3),
            const Text('Bảo vệ rừng\nvì tương lai Kon Tum', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700, height: 1.3)),
            const SizedBox(height: 22),
            const SizedBox(width: 26, height: 26, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.4)),
            const SizedBox(height: 10),
            Text('Đang kiểm tra kết nối… $version', style: const TextStyle(color: Colors.white70, fontSize: 12)),
            const SizedBox(height: 26),
          ]),
        ),
      ]),
      backgroundColor: AppColors.forestDark,
    );
  }
}
