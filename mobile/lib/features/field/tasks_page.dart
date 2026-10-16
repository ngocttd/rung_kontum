import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/data.dart';
import '../../core/location.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/items.dart';
import '../../widgets/location_picker.dart';

/// M15 – Nhiệm vụ hiện trường: danh sách theo phân công / địa bàn, hạn xử lý.
class TasksPage extends ConsumerStatefulWidget {
  const TasksPage({super.key, this.standalone = false});
  final bool standalone;
  @override
  ConsumerState<TasksPage> createState() => _TasksPageState();
}

class _TasksPageState extends ConsumerState<TasksPage> {
  @override
  Widget build(BuildContext context) {
    final u = ref.watch(sessionProvider).user;
    final v = ref.watch(assignmentsProvider);
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Nhiệm vụ hiện trường'),
          automaticallyImplyLeading: widget.standalone,
          actions: [
            if (u?.can('field.review') == true) IconButton(tooltip: 'Duyệt kết quả', icon: const Icon(Icons.fact_check_outlined), onPressed: () => context.push('/review')),
            IconButton(tooltip: 'Tải lại', icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(assignmentsProvider)),
          ],
          bottom: const TabBar(tabs: [Tab(text: 'Cần làm'), Tab(text: 'Đã nộp'), Tab(text: 'Tất cả')]),
        ),
        floatingActionButton: u == null
            ? null
            : u.can('field.survey')
                ? FloatingActionButton.extended(onPressed: () => context.push('/survey'), icon: const Icon(Icons.add_location_alt_outlined), label: const Text('Khảo sát mới'))
                : u.can('tasks.assign')
                    ? FloatingActionButton.extended(onPressed: () => _assign(context), icon: const Icon(Icons.add_task), label: const Text('Giao khảo sát'))
                    : null,
        body: u == null || !(u.role == 'specialist' || u.role == 'leader')
            ? const EmptyView('Chức năng dành cho cán bộ chuyên môn / lãnh đạo.', icon: Icons.lock_outline)
            : AsyncView(
                value: v,
                onRetry: () => ref.invalidate(assignmentsProvider),
                builder: (Loaded<J> l) {
                  final all = ((l.data['items'] as List?) ?? []).cast<Map>().map((e) => e.cast<String, dynamic>()).toList();
                  final todo = all.where((t) => ['assigned', 'accepted', 'in_progress', 'returned'].contains(t['status'])).toList();
                  final done = all.where((t) => ['submitted', 'approved'].contains(t['status'])).toList();
                  Widget list(List<J> xs, String empty) => RefreshIndicator(
                        onRefresh: () async => ref.invalidate(assignmentsProvider),
                        child: xs.isEmpty
                            ? ListView(children: [EmptyView(empty, icon: Icons.task_alt)])
                            : ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 90), children: [
                                if (u.scope != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: NoticeBox('Bạn phụ trách địa bàn ${ref.read(sessionProvider).communeName(u.scope)}: chỉ thấy nhiệm vụ được giao hoặc thuộc xã này.')),
                                for (final t in xs) TaskTile(t),
                              ]),
                      );
                  return TabBarView(children: [list(todo, 'Không có nhiệm vụ cần làm'), list(done, 'Chưa có nhiệm vụ đã nộp'), list(all, 'Chưa có nhiệm vụ')]);
                },
              ),
      ),
    );
  }

  /// Lãnh đạo giao nhiệm vụ khảo sát tại một vị trí; cán bộ phụ trách xã nhận trên ứng dụng.
  Future<void> _assign(BuildContext context) async {
    final title = TextEditingController();
    final note = TextEditingController();
    Fix? fix;
    DateTime? due;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => StatefulBuilder(
        builder: (context, set) => Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewInsets.bottom + 16),
          child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('Giao nhiệm vụ khảo sát', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              TextField(controller: title, decoration: const InputDecoration(labelText: 'Nội dung khảo sát')),
              const SizedBox(height: 8),
              TextField(controller: note, maxLines: 3, decoration: const InputDecoration(labelText: 'Hướng dẫn cho cán bộ')),
              const SizedBox(height: 8),
              LocationField(value: fix, autoGps: false, onChanged: (f) => set(() => fix = f)),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.event),
                title: Text(due == null ? 'Chọn hạn hoàn thành' : 'Hạn: ${due!.day}/${due!.month}/${due!.year}'),
                onTap: () async {
                  final d = await showDatePicker(context: context, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)), initialDate: DateTime.now().add(const Duration(days: 3)));
                  if (d != null) set(() => due = DateTime(d.year, d.month, d.day, 17));
                },
              ),
              FilledButton(
                onPressed: () async {
                  if (fix == null) return;
                  try {
                    final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/api/mobile/assignments', {
                      'kind': 'survey', 'title': title.text.trim().isEmpty ? null : title.text.trim(), 'instructions': note.text.trim(),
                      'lat': fix!.point.latitude, 'lon': fix!.point.longitude, 'due_at': due?.toUtc().toIso8601String(),
                    });
                    ref.invalidate(assignmentsProvider);
                    if (context.mounted) {
                      Navigator.pop(context);
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Đã giao nhiệm vụ ${r['code']} cho cán bộ địa bàn.')));
                    }
                  } on ApiException catch (e) {
                    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
                  }
                },
                child: const Text('Giao nhiệm vụ'),
              ),
              const SourceNote('Giao xác minh điểm nóng / biến động / phản ánh thực hiện trên web quản trị (mục Cảnh báo, Phản ánh) – nhiệm vụ tự xuất hiện trên ứng dụng của cán bộ.'),
            ]),
          ),
        ),
      ),
    );
  }
}
