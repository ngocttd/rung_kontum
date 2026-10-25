import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/notify_local.dart';
import '../core/notify_open.dart';
import '../core/outbox.dart';
import '../core/push.dart';
import '../core/realtime.dart';
import '../core/session.dart';
import '../features/auth/login_page.dart';
import '../features/auth/splash_page.dart';
import '../features/documents/documents_page.dart';
import '../features/field/review_page.dart';
import '../features/field/survey_page.dart';
import '../features/field/task_detail_page.dart';
import '../features/field/tasks_page.dart';
import '../features/field/verification_page.dart';
import '../features/fire/fire_page.dart';
import '../features/forest/forest_page.dart';
import '../features/home/home_page.dart';
import '../features/imagery/imagery_page.dart';
import '../features/map/map_page.dart';
import '../features/map/object_page.dart';
import '../features/news/news_page.dart';
import '../features/profile/notifications_page.dart';
import '../features/profile/profile_page.dart';
import '../features/profile/settings_page.dart';
import '../features/profile/sync_page.dart';
import '../features/reports/my_reports_page.dart';
import '../features/reports/report_form_page.dart';
import '../features/weather/weather_page.dart';
import 'theme.dart';

/// Cầu nối Riverpod → GoRouter.refreshListenable (điều hướng lại khi đăng nhập/đăng xuất).
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen(sessionProvider, (a, b) {
      if (a?.ready != b.ready || a?.entered != b.entered || a?.user?.id != b.user?.id) notifyListeners();
    });
  }
}

final _rootKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final listen = _SessionListenable(ref);
  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/splash',
    refreshListenable: listen,
    redirect: (context, state) {
      final s = ref.read(sessionProvider);
      final loc = state.matchedLocation;
      if (!s.ready) return loc == '/splash' ? null : '/splash';
      if (loc == '/splash') return s.entered ? '/home' : '/login';
      final open = loc == '/login' || loc == '/register';
      if (!s.entered && !open) return '/login';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashPage()),
      GoRoute(path: '/login', builder: (_, _) => const LoginPage()),
      GoRoute(path: '/register', builder: (_, _) => const LoginPage(register: true)),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => _Shell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, _) => const HomePage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/map', builder: (_, s) => MapPage(focus: s.extra))]),
          StatefulShellBranch(routes: [GoRoute(path: '/fire', builder: (_, _) => const FirePage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/work', builder: (_, _) => const _WorkTab())]),
          StatefulShellBranch(routes: [GoRoute(path: '/me', builder: (_, _) => const ProfilePage())]),
        ],
      ),
      GoRoute(path: '/object', parentNavigatorKey: _rootKey, builder: (_, s) => ObjectPage(data: s.extra as ObjectRef)),
      GoRoute(path: '/forest', parentNavigatorKey: _rootKey, builder: (_, _) => const ForestPage()),
      GoRoute(path: '/imagery', parentNavigatorKey: _rootKey, builder: (_, _) => const ImageryPage()),
      GoRoute(path: '/news', parentNavigatorKey: _rootKey, builder: (_, _) => const NewsPage(standalone: true)),
      GoRoute(path: '/news/:slug', parentNavigatorKey: _rootKey, builder: (_, s) => NewsDetailPage(slug: s.pathParameters['slug']!)),
      GoRoute(path: '/report', parentNavigatorKey: _rootKey, builder: (_, s) => ReportFormPage(initial: s.extra as Map<String, dynamic>?)),
      GoRoute(path: '/reports', parentNavigatorKey: _rootKey, builder: (_, s) => MyReportsPage(code: s.uri.queryParameters['ma'])),
      GoRoute(path: '/weather', parentNavigatorKey: _rootKey, builder: (_, _) => const WeatherPage()),
      GoRoute(path: '/documents', parentNavigatorKey: _rootKey, builder: (_, _) => const DocumentsPage()),
      GoRoute(path: '/notifications', parentNavigatorKey: _rootKey, builder: (_, _) => const NotificationsPage()),
      GoRoute(path: '/sync', parentNavigatorKey: _rootKey, builder: (_, _) => const SyncPage()),
      GoRoute(path: '/settings', parentNavigatorKey: _rootKey, builder: (_, _) => const SettingsPage()),
      GoRoute(path: '/tasks', parentNavigatorKey: _rootKey, builder: (_, _) => const TasksPage(standalone: true)),
      GoRoute(path: '/tasks/:id', parentNavigatorKey: _rootKey, builder: (_, s) => TaskDetailPage(id: s.pathParameters['id']!)),
      GoRoute(path: '/survey', parentNavigatorKey: _rootKey, builder: (_, s) => SurveyPage(assignment: s.extra as Map<String, dynamic>?)),
      GoRoute(path: '/verify', parentNavigatorKey: _rootKey, builder: (_, s) => VerificationPage(args: s.extra as VerifyArgs)),
      GoRoute(path: '/review', parentNavigatorKey: _rootKey, builder: (_, _) => const ReviewPage()),
    ],
  );
});

/// Tab thứ 4: cán bộ/lãnh đạo là "Nhiệm vụ", người dân/khách là "Tin tức" (theo prototype).
class _WorkTab extends ConsumerWidget {
  const _WorkTab();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final u = ref.watch(sessionProvider.select((s) => s.user));
    return u != null && (u.role == 'specialist' || u.role == 'leader') ? const TasksPage() : const NewsPage();
  }
}

class _Shell extends ConsumerStatefulWidget {
  const _Shell({required this.shell});
  final StatefulNavigationShell shell;
  @override
  ConsumerState<_Shell> createState() => _ShellState();
}

class _ShellState extends ConsumerState<_Shell> {
  StatefulNavigationShell get shell => widget.shell;

  @override
  void initState() {
    super.initState();
    // thông báo: Socket.IO khi mở ứng dụng + Firebase Cloud Messaging khi ở nền/đã đóng
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(realtimeProvider.notifier).connect();
      ref.read(pushProvider.notifier).enable();
      // chạm thông báo lúc ứng dụng đã đóng: nội dung đến trước khi khung ứng dụng sẵn sàng → mở ngay bây giờ
      _openTapped();
    });
    LocalNotifs.tapped.addListener(_openTapped);
  }

  @override
  void dispose() {
    LocalNotifs.tapped.removeListener(_openTapped);
    super.dispose();
  }

  void _openTapped() {
    final d = LocalNotifs.tapped.value;
    if (d == null || !mounted) return;
    LocalNotifs.tapped.value = null;
    if (ref.read(sessionProvider).signedIn && d['id'] != null) {
      ref.read(apiProvider).post('/api/mobile/notifications/read', {'ids': [d['id']]}).catchError((_) => <String, dynamic>{});
    }
    openNotificationLink(context, ref, d);
  }

  @override
  Widget build(BuildContext context) {
    // đổi người dùng (đăng nhập/đăng xuất/đổi vai trò) → kết nối lại với danh tính mới, đăng ký lại thiết bị
    ref.listen(sessionProvider.select((s) => s.user?.id), (a, b) {
      ref.read(realtimeProvider.notifier).connect();
      ref.read(pushProvider.notifier).enable();
    });
    final u = ref.watch(sessionProvider.select((s) => s.user));
    final field = u != null && (u.role == 'specialist' || u.role == 'leader');
    final pending = ref.watch(outboxProvider.select((o) => o.waiting + o.conflicts));
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        height: 66,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Trang chủ'),
          const NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map_rounded), label: 'Bản đồ'),
          const NavigationDestination(icon: Icon(Icons.local_fire_department_outlined), selectedIcon: Icon(Icons.local_fire_department, color: AppColors.fire), label: 'Cảnh báo'),
          field
              ? const NavigationDestination(icon: Icon(Icons.assignment_outlined), selectedIcon: Icon(Icons.assignment_rounded), label: 'Nhiệm vụ')
              : const NavigationDestination(icon: Icon(Icons.article_outlined), selectedIcon: Icon(Icons.article_rounded), label: 'Tin tức'),
          NavigationDestination(
            icon: Badge(isLabelVisible: pending > 0, label: Text('$pending'), child: const Icon(Icons.person_outline)),
            selectedIcon: const Icon(Icons.person_rounded),
            label: 'Cá nhân',
          ),
        ],
      ),
    );
  }
}
