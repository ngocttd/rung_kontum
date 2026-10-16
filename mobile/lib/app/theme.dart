import 'package:flutter/material.dart';

/// Bảng màu theo prototype MobileGIS (xanh rừng, đỏ cảnh báo) và thang cấp nguy cơ cháy (cấp I–V).
class AppColors {
  AppColors._();
  static const forest = Color(0xFF0B6B3A);
  static const forestDark = Color(0xFF064A28);
  static const forestLight = Color(0xFFE6F3EC);
  static const leaf = Color(0xFF75BB25);
  static const navy = Color(0xFF17324D);
  static const muted = Color(0xFF6B7C8C);
  static const line = Color(0xFFE2E8EE);
  static const bg = Color(0xFFF4F7F6);
  static const fire = Color(0xFFE53935);
  static const orange = Color(0xFFF57C00);
  static const yellow = Color(0xFFF8CE42);
  static const blue = Color(0xFF1677D2);
  static const purple = Color(0xFF7B3FB5);

  /// Cấp nguy cơ cháy (P Nesterov) 1–5
  static const danger = <int, Color>{
    1: Color(0xFF0E8A4B),
    2: Color(0xFF75BB25),
    3: Color(0xFFF8CE42),
    4: Color(0xFFF57C00),
    5: Color(0xFFE53935),
  };
  static Color dangerOf(num? level) => danger[(level ?? 0).toInt()] ?? const Color(0xFFB0BEC5);
}

ThemeData buildTheme({bool highContrast = false}) {
  final scheme = ColorScheme.fromSeed(
    seedColor: AppColors.forest,
    primary: AppColors.forest,
    secondary: AppColors.leaf,
    error: AppColors.fire,
    surface: Colors.white,
    contrastLevel: highContrast ? 1.0 : 0.0,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, scaffoldBackgroundColor: AppColors.bg);
  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: AppColors.navy,
      elevation: 0,
      scrolledUnderElevation: 1,
      centerTitle: false,
      titleTextStyle: TextStyle(color: AppColors.navy, fontSize: 18, fontWeight: FontWeight.w700),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: AppColors.line)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.forest, width: 1.6)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.forest,
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.forest,
        minimumSize: const Size(48, 46),
        side: const BorderSide(color: AppColors.forest),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    tabBarTheme: const TabBarThemeData(
      labelColor: AppColors.forest,
      unselectedLabelColor: AppColors.muted,
      indicatorColor: AppColors.forest,
      labelStyle: TextStyle(fontWeight: FontWeight.w700),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: AppColors.forestLight,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(fontSize: 11.5, fontWeight: s.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500, color: s.contains(WidgetState.selected) ? AppColors.forest : AppColors.muted),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(side: const BorderSide(color: AppColors.line)),
  );
}
