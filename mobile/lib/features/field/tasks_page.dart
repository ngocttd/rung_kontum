import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/layout.dart';
import '../../app/theme.dart';
import '../../core/api.dart';
import '../../core/data.dart';
import '../../core/location.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/items.dart';
import '../../widgets/location_picker.dart';

/// M15 – Nhiệm vụ hiện trường: danh sách theo phân công / địa bàn, hạn xử lý, xem trên bản đồ và duyệt kết quả.
class TasksPage extends ConsumerStatefulWidget {
  const TasksPage({super.key, this.standalone = false});
  final bool standalone;
  @override
  ConsumerState<TasksPage> createState() => _TasksPageState();
}

class _TasksPageState extends ConsumerState<TasksPage> {
  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final u = s.user;
    final v = ref.watch(assignmentsProvider);
    return DefaultTabController(
      length: 3,
      child: ResponsiveScaffold(
        maxWidth: 760,
        appBar: AppBar(
          title: const Text('Nhiệm vụ hiện trường'),
          automaticallyImplyLeading: widget.standalone,
          actions: [
            IconButton(tooltip: 'Xem trên bản đồ', icon: const Icon(Icons.map_outlined), onPressed: () => context.go('/map')),
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
        body: u == null || !u.isStaff
            ? const EmptyView('Chức năng dành cho cán bộ chuyên môn / lãnh đạo.', icon: Icons.lock_outline)
            : v.hasError && v.error is ApiException && (v.error as ApiException).status == 403
                ? const Padding(
                    padding: EdgeInsets.all(16),
                    child: NoticeBox('Tài khoản Quản trị hệ thống không trực tiếp thực hiện/phê duyệt xác minh nghiệp vụ. Để theo dõi tổng thể nhiệm vụ hiện trường, vui lòng xem trên cổng Quản trị Web (/quan-tri/hien-truong).'),
                  )
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
                                ? ListView(padding: const EdgeInsets.all(16), children: [
                                    if (u.scope != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: NoticeBox('Địa bàn phụ trách: ${s.communeName(u.scope)}.')),
                                    EmptyView(empty, icon: Icons.task_alt),
                                  ])
                                : ListView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 90), children: [
                                    if (u.scope != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: NoticeBox('Bạn phụ trách địa bàn ${s.communeName(u.scope)}: hiển thị nhiệm vụ được giao riêng hoặc thuộc xã này.')),
                                    for (final t in xs) TaskTile(t),
                                  ]),
                          );
                      return TabBarView(children: [list(todo, 'Không có nhiệm vụ cần làm'), list(done, 'Chưa có nhiệm vụ đã nộp'), list(all, 'Chưa có nhiệm vụ')]);
                    },
                  ),
      ),
    );
  }

  /// Lãnh đạo / cán bộ có quyền giao nhiệm vụ khảo sát tại một vị trí hoặc xã; cán bộ phụ trách xã nhận trên ứng dụng.
  Future<void> _assign(BuildContext context) async {
    final title = TextEditingController();
    final note = TextEditingController();
    final communes = ref.read(sessionProvider).communes;
    String? scopeCode;
    Fix? fix;
    DateTime? due;
    String? formErr;
    var submitting = false;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetCtx) => StatefulBuilder(
        builder: (ctx, set) => FormSheet(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Giao nhiệm vụ khảo sát hiện trường', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.navy)),
            const SizedBox(height: 10),
            TextField(controller: title, decoration: const InputDecoration(labelText: 'Tiêu đề khảo sát (để trống = tự sinh)')),
            const SizedBox(height: 8),
            TextField(controller: note, maxLines: 3, decoration: const InputDecoration(labelText: 'Hướng dẫn cho cán bộ thực địa')),
            if (communes.isNotEmpty) ...[
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: scopeCode,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Địa bàn xã/phường'),
                items: [
                  const DropdownMenuItem<String>(value: null, child: Text('Tự xác định theo vị trí chấm điểm')),
                  for (final c in communes) DropdownMenuItem(value: c['code'] as String, child: Text(c['name'].toString())),
                ],
                onChanged: (v) => set(() {
                  scopeCode = v;
                  formErr = null;
                  if (v != null && fix == null) {
                    final ctr = (communes.firstWhere((x) => x['code'] == v)['center'] as List?)?.cast<num>();
                    if (ctr != null && ctr.length >= 2) fix = Fix(LatLng(ctr[1].toDouble(), ctr[0].toDouble()), source: 'map');
                  }
                }),
              ),
            ],
            const SizedBox(height: 8),
            LocationField(
              value: fix,
              autoGps: false,
              onChanged: (f) => set(() {
                fix = f;
                formErr = null;
              }),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.event),
              title: Text(due == null ? 'Chọn hạn hoàn thành (tuỳ chọn)' : 'Hạn: ${due!.day}/${due!.month}/${due!.year} 17:00'),
              trailing: due == null ? null : IconButton(icon: const Icon(Icons.clear, size: 18), onPressed: () => set(() => due = null)),
              onTap: () async {
                final d = await showDatePicker(context: ctx, firstDate: DateTime.now(), lastDate: DateTime.now().add(const Duration(days: 365)), initialDate: DateTime.now().add(const Duration(days: 3)));
                if (d != null) set(() => due = DateTime(d.year, d.month, d.day, 17));
              },
            ),
            if (formErr != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: NoticeBox(formErr!, warn: true)),
            FilledButton.icon(
              onPressed: submitting
                  ? null
                  : () async {
                      if (fix == null) {
                        set(() => formErr = 'Vui lòng chọn vị trí khảo sát (trên bản đồ, GPS hoặc chọn xã/phường).');
                        return;
                      }
                      set(() => [submitting = true, formErr = null]);
                      try {
                        final r = await ref.read(apiProvider).post<Map<String, dynamic>>('/api/mobile/assignments', {
                          'kind': 'survey',
                          'title': title.text.trim().isEmpty ? null : title.text.trim(),
                          'instructions': note.text.trim(),
                          'lat': fix!.point.latitude,
                          'lon': fix!.point.longitude,
                          'scope_id': ?scopeCode,
                          'due_at': due?.toUtc().toIso8601String(),
                        });
                        ref.invalidate(assignmentsProvider);
                        if (sheetCtx.mounted) Navigator.pop(sheetCtx);
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Đã giao nhiệm vụ ${r['code']} cho địa bàn.')));
                        }
                      } on ApiException catch (e) {
                        set(() => [submitting = false, formErr = e.message]);
                      }
                    },
              icon: submitting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Icon(Icons.send),
              label: const Text('Giao nhiệm vụ'),
            ),
            const SourceNote('Để giao xác minh trực tiếp một Điểm nóng / Biến động / Phản ánh: chạm đối tượng đó trên Bản đồ hoặc tab Cảnh báo rồi bấm “Giao nhiệm vụ xác minh”.'),
          ]),
        ),
      ),
    );
  }
}
