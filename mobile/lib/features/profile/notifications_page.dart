import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';

/// Thông báo: chỉ cảnh báo đã phê duyệt / sự kiện đã xác minh, cập nhật hồ sơ của tôi, nhiệm vụ mới.
/// Không phát cảnh báo khẩn cấp từ điểm nóng chưa xác minh (đặc tả mục 9).
class NotificationsPage extends ConsumerWidget {
  const NotificationsPage({super.key});
  static const icons = {'fire_danger': Icons.local_fire_department, 'fire_confirmed': Icons.whatshot, 'report': Icons.campaign_outlined, 'assignment': Icons.assignment_outlined, 'report_new': Icons.campaign, 'fire_report': Icons.local_fire_department_outlined};

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final v = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Thông báo'), actions: [
        TextButton(
          onPressed: () async {
            final ids = ((v.asData?.value['items'] as List?) ?? []).map((n) => n['id']).toList();
            if (ref.read(sessionProvider).signedIn && ids.isNotEmpty) await ref.read(apiProvider).post('/api/mobile/notifications/read', {'ids': ids});
            ref.invalidate(notificationsProvider);
          },
          child: const Text('Đánh dấu đã đọc'),
        ),
      ]),
      body: AsyncView(
        value: v,
        onRetry: () => ref.invalidate(notificationsProvider),
        builder: (J d) {
          final items = ((d['items'] as List?) ?? []).cast<Map>();
          if (items.isEmpty) return const EmptyView('Chưa có thông báo', icon: Icons.notifications_off_outlined);
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(notificationsProvider),
            child: ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final n = items[i];
                final link = (n['link'] as Map?) ?? {};
                return ListTile(
                  tileColor: n['read'] == true ? null : AppColors.forestLight.withValues(alpha: .5),
                  leading: Icon(icons[n['kind']] ?? Icons.notifications, color: n['kind'] == 'assignment' ? AppColors.forest : AppColors.fire),
                  title: Text(n['title'].toString(), style: TextStyle(fontWeight: n['read'] == true ? FontWeight.w500 : FontWeight.w800, fontSize: 14)),
                  subtitle: Text('${n['body'] ?? ''}\n${fmtAgo(n['at'])}', maxLines: 3, overflow: TextOverflow.ellipsis),
                  isThreeLine: true,
                  onTap: () async {
                    if (ref.read(sessionProvider).signedIn) ref.read(apiProvider).post('/api/mobile/notifications/read', {'ids': [n['id']]}).catchError((_) => <String, dynamic>{});
                    switch (link['screen']) {
                      case 'task':
                        context.push('/tasks');
                      case 'report':
                        context.push('/reports?ma=${link['code']}');
                      default:
                        context.go('/fire');
                    }
                  },
                );
              },
            ),
          );
        },
      ),
    );
  }
}
