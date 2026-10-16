import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/config.dart';
import 'app/router.dart';
import 'app/theme.dart';
import 'core/notify_local.dart';
import 'core/push.dart';
import 'core/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('vi');
  final prefs = await SharedPreferences.getInstance();
  // thông báo không Firebase: hiển thị cục bộ + callback UnifiedPush (Android) đăng ký sớm
  await LocalNotifs.init();
  await PushService.initCallbacks();
  runApp(ProviderScope(
    overrides: [prefsProvider.overrideWithValue(prefs)],
    // không tự gọi lại API khi lỗi; màn hình có nút "Thử lại"
    retry: (retryCount, error) => null,
    child: const MobileGisApp(),
  ));
}

/// Cỡ chữ lớn / tương phản cao (đặc tả mục 9) – chỉnh trong Cài đặt.
final textScaleProvider = NotifierProvider<_TextScale, double>(_TextScale.new);
final highContrastProvider = NotifierProvider<_HighContrast, bool>(_HighContrast.new);

class _TextScale extends Notifier<double> {
  @override
  double build() => ref.read(prefsProvider).getDouble('text_scale') ?? 1.0;
  void set(double v) {
    ref.read(prefsProvider).setDouble('text_scale', v);
    state = v;
  }
}

class _HighContrast extends Notifier<bool> {
  @override
  bool build() => ref.read(prefsProvider).getBool('high_contrast') ?? false;
  void set(bool v) {
    ref.read(prefsProvider).setBool('high_contrast', v);
    state = v;
  }
}

class MobileGisApp extends ConsumerWidget {
  const MobileGisApp({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final scale = ref.watch(textScaleProvider);
    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: buildTheme(highContrast: ref.watch(highContrastProvider)),
      routerConfig: router,
      locale: const Locale('vi'),
      supportedLocales: const [Locale('vi'), Locale('en')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)), child: child!),
    );
  }
}
