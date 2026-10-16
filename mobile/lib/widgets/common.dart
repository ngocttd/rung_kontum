import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme.dart';
import '../core/api.dart';
import '../core/data.dart';
import '../core/format.dart';
import '../core/session.dart';

/// Hiển thị AsyncValue: đang tải / lỗi (có nút thử lại) / dữ liệu (kèm nhãn "dữ liệu lưu sẵn" khi ngoại tuyến).
class AsyncView<T> extends StatelessWidget {
  const AsyncView({super.key, required this.value, required this.builder, this.onRetry, this.loading});
  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;
  final Widget? loading;

  @override
  Widget build(BuildContext context) => value.when(
        skipLoadingOnRefresh: true,
        data: (d) {
          final child = builder(d);
          if (d is Loaded && d.offline) {
            return Column(children: [OfflineBanner(at: d.cachedAt), Expanded(child: child)]);
          }
          return child;
        },
        error: (e, _) => ErrorView(message: e is ApiException ? e.message : 'Đã có lỗi: $e', onRetry: onRetry),
        loading: () => loading ?? const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator())),
      );
}

class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, this.at});
  final DateTime? at;
  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        color: const Color(0xFFFFF4D6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        child: Text('Đang ngoại tuyến – dữ liệu lưu lúc ${fmtDateTime(at?.toUtc().toIso8601String())}', style: const TextStyle(fontSize: 12, color: Color(0xFF7A5B00))),
      );
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_rounded, size: 46, color: AppColors.muted),
            const SizedBox(height: 10),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted)),
            if (onRetry != null) ...[const SizedBox(height: 12), OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Thử lại'))],
          ]),
        ),
      );
}

class EmptyView extends StatelessWidget {
  const EmptyView(this.text, {super.key, this.icon = Icons.inbox_outlined});
  final String text;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(icon, size: 40, color: AppColors.muted), const SizedBox(height: 8), Text(text, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.muted))]),
      );
}

class SectionCard extends StatelessWidget {
  const SectionCard({super.key, this.title, this.trailing, required this.child, this.padding = const EdgeInsets.all(14), this.icon});
  final String? title;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: padding,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(children: [
                  if (icon != null) ...[Icon(icon, size: 19, color: AppColors.forest), const SizedBox(width: 6)],
                  Expanded(child: Text(title!, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: AppColors.navy))),
                  ?trailing,
                ]),
              ),
            child,
          ]),
        ),
      );
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.label, {super.key, this.color = AppColors.muted, this.dense = false});
  final String label;
  final Color color;
  final bool dense;
  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.symmetric(horizontal: dense ? 6 : 9, vertical: dense ? 2 : 4),
        decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20), border: Border.all(color: color.withValues(alpha: .35))),
        child: Text(label, style: TextStyle(color: color, fontSize: dense ? 11 : 12, fontWeight: FontWeight.w700)),
      );

  /// Màu theo trạng thái nghiệp vụ (xác minh / phản ánh / nhiệm vụ)
  static Color toneOf(String? status) => switch (status) {
        'new' || 'unverified' || 'assigned' || 'received' => AppColors.fire,
        'verifying' || 'accepted' || 'in_progress' || 'pending' || 'pending_review' => AppColors.orange,
        'confirmed' || 'processing' || 'submitted' => AppColors.purple,
        'rejected' || 'closed' || 'cancelled' || 'dismissed' => AppColors.muted,
        'resolved' || 'approved' || 'handling' => AppColors.forest,
        'seasonal' => const Color(0xFFB8860B),
        _ => AppColors.blue,
      };
}

class KpiTile extends StatelessWidget {
  const KpiTile({super.key, required this.icon, required this.value, required this.label, this.color = AppColors.forest, this.sub});
  final IconData icon;
  final String value;
  final String label;
  final Color color;
  final String? sub;
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Icon(icon, color: color, size: 30),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(label, style: const TextStyle(fontSize: 11.5, color: AppColors.muted), maxLines: 2),
                FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: color))),
                if (sub != null) Text(sub!, style: const TextStyle(fontSize: 11, color: AppColors.muted)),
              ]),
            ),
          ]),
        ),
      );
}

class KV extends StatelessWidget {
  const KV(this.k, this.v, {super.key, this.valueWidget});
  final String k;
  final String? v;
  final Widget? valueWidget;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 128, child: Text(k, style: const TextStyle(color: AppColors.muted, fontSize: 13))),
          Expanded(child: valueWidget ?? Text(v ?? '—', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500))),
        ]),
      );
}

class SourceNote extends StatelessWidget {
  const SourceNote(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(top: 8), child: Text(text, style: const TextStyle(fontSize: 11.5, color: AppColors.muted, height: 1.35)));
}

/// Ghi chú phân biệt dữ liệu phân tích tự động / chưa xác minh với kết luận đã xác minh (M05, M07).
class NoticeBox extends StatelessWidget {
  const NoticeBox(this.text, {super.key, this.warn = false, this.icon});
  final String text;
  final bool warn;
  final IconData? icon;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: warn ? const Color(0xFFFFF4E5) : const Color(0xFFEAF4FD), borderRadius: BorderRadius.circular(10), border: Border.all(color: warn ? const Color(0xFFF3D19B) : const Color(0xFFBCD9F3))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon ?? (warn ? Icons.warning_amber_rounded : Icons.info_outline), size: 18, color: warn ? AppColors.orange : AppColors.blue),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(fontSize: 12.5, height: 1.35, color: warn ? const Color(0xFF7A4B00) : const Color(0xFF1D4D78)))),
        ]),
      );
}

/// Ảnh từ máy chủ (đường dẫn tương đối) – kèm token khi là tệp nội bộ.
class NetImage extends ConsumerWidget {
  const NetImage(this.path, {super.key, this.fit = BoxFit.cover, this.width, this.height, this.fallback});
  final String? path;
  final BoxFit fit;
  final double? width, height;
  final String? fallback;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final api = ref.watch(apiProvider);
    Widget fb() => fallback != null ? Image.asset(fallback!, fit: fit, width: width, height: height) : Container(width: width, height: height, color: AppColors.forestLight, child: const Icon(Icons.image_outlined, color: AppColors.muted));
    if (path == null || path!.isEmpty) return fb();
    return Image.network(api.url(path), fit: fit, width: width, height: height, headers: path!.contains('/api/mobile/files/') ? api.authHeaders : null, errorBuilder: (_, _, _) => fb());
  }
}

/// Đăng nhập nhanh theo vai trò – có ở màn hình khởi động, đăng nhập và Cá nhân (chuyển vai trò khi kiểm thử).
Future<void> showQuickLogin(BuildContext context, WidgetRef ref) async {
  final s = ref.read(sessionProvider);
  if (!s.demoLogin) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Máy chủ chưa bật đăng nhập nhanh (MOBILE_DEMO_LOGIN).')));
    return;
  }
  await showModalBottomSheet(context: context, showDragHandle: true, isScrollControlled: true, builder: (_) => const QuickLoginPanel(inSheet: true));
}

class QuickLoginPanel extends ConsumerStatefulWidget {
  const QuickLoginPanel({super.key, this.inSheet = false});
  final bool inSheet;
  @override
  ConsumerState<QuickLoginPanel> createState() => _QuickLoginPanelState();
}

class _QuickLoginPanelState extends ConsumerState<QuickLoginPanel> {
  String? busy;
  static const _icons = {'citizen': Icons.person_outline, 'specialist': Icons.forest_outlined, 'specialist_commune': Icons.location_city_outlined, 'leader': Icons.account_balance_outlined, 'admin': Icons.admin_panel_settings_outlined};
  static const _desc = {
    'citizen': 'Gửi, theo dõi phản ánh của mình',
    'specialist': 'Nhiệm vụ, khảo sát, xác minh – toàn vùng',
    'specialist_commune': 'Cán bộ giới hạn theo 1 xã (thử phân quyền địa bàn)',
    'leader': 'Xem tổng hợp, giao nhiệm vụ, duyệt kết quả',
    'admin': 'Quản trị hệ thống (không xác minh nghiệp vụ)',
  };

  Future<void> _go(String? key) async {
    setState(() => busy = key ?? 'guest');
    try {
      if (key == null) {
        await ref.read(sessionProvider.notifier).continueAsGuest();
      } else {
        await ref.read(sessionProvider.notifier).demoLogin(key);
      }
      if (!mounted) return;
      if (widget.inSheet) Navigator.of(context).pop();
      context.go('/home');
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final roles = s.demoRoles;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, widget.inSheet ? 0 : 12, 16, 12),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Row(children: [
            const Icon(Icons.bolt_rounded, color: AppColors.orange),
            const SizedBox(width: 6),
            const Expanded(child: Text('Đăng nhập nhanh theo vai trò', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: AppColors.navy))),
            const StatusChip('Môi trường thử nghiệm', color: AppColors.orange, dense: true),
          ]),
          const SizedBox(height: 4),
          const Text('Tài khoản demo do máy chủ cấp; tắt khi triển khai chính thức.', style: TextStyle(fontSize: 12, color: AppColors.muted)),
          const SizedBox(height: 8),
          _tile(null, Icons.travel_explore, 'Khách', 'Xem bản đồ, cảnh báo, tin tức công khai'),
          for (final r in roles) _tile(r['key'] as String, _icons[r['key']] ?? Icons.person, r['name'] as String, _desc[r['key']] ?? ''),
          if (s.user != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text('Đang đăng nhập: ${s.user!.name} – ${s.user!.roleLabel}', style: const TextStyle(fontSize: 12, color: AppColors.forest))),
        ]),
      ),
    );
  }

  Widget _tile(String? key, IconData icon, String title, String sub) {
    final current = ref.watch(sessionProvider.select((s) => key == null ? s.guest : s.user != null && s.demoRoles.any((r) => r['key'] == key && r['username'] == s.user!.username)));
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 3),
      color: current ? AppColors.forestLight : null,
      child: ListTile(
        dense: true,
        leading: CircleAvatar(backgroundColor: AppColors.forestLight, child: Icon(icon, color: AppColors.forest)),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text(sub, style: const TextStyle(fontSize: 12)),
        trailing: busy == (key ?? 'guest') ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.chevron_right),
        onTap: busy == null ? () => _go(key) : null,
      ),
    );
  }
}
