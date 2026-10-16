import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/theme.dart';
import '../../core/location.dart';
import '../../core/outbox.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/location_picker.dart';
import '../../widgets/media_picker.dart';
import 'my_reports_page.dart';

/// M11 – Phản ánh hiện trạng: chọn loại, mô tả, GPS/chọn vị trí, ảnh/video, gửi và theo dõi trạng thái.
/// Bản nháp được lưu liên tục (mất mạng/tắt ứng dụng không mất – TC11); gửi qua hàng đợi ngoại tuyến (TC04).
class ReportFormPage extends ConsumerStatefulWidget {
  const ReportFormPage({super.key, this.initial});
  final Map<String, dynamic>? initial;
  @override
  ConsumerState<ReportFormPage> createState() => _ReportFormPageState();
}

class _ReportFormPageState extends ConsumerState<ReportFormPage> {
  static const _draftKey = 'draft:report';
  String type = 'chay-rung';
  final desc = TextEditingController();
  final place = TextEditingController();
  final name = TextEditingController();
  final phone = TextEditingController();
  Fix? fix;
  List<PickedMedia> media = [];
  bool busy = false;

  @override
  void initState() {
    super.initState();
    final i = widget.initial;
    final d = _draft();
    if (i != null) {
      type = i['type'] as String? ?? type;
      if (i['lat'] != null) fix = Fix(LatLng((i['lat'] as num).toDouble(), (i['lon'] as num).toDouble()), source: 'map');
    } else if (d != null) {
      type = d['type'] as String? ?? type;
      desc.text = d['description'] as String? ?? '';
      place.text = d['location_text'] as String? ?? '';
      if (d['lat'] != null) fix = Fix(LatLng((d['lat'] as num).toDouble(), (d['lon'] as num).toDouble()), accuracy: (d['gps_accuracy'] as num?)?.toDouble(), source: d['location_source'] as String? ?? 'gps');
    }
    for (final c in [desc, place, name, phone]) {
      c.addListener(_saveDraft);
    }
  }

  Map<String, dynamic>? _draft() {
    final s = ref.read(prefsProvider).getString(_draftKey);
    return s == null ? null : (jsonDecode(s) as Map).cast<String, dynamic>();
  }

  void _saveDraft() => ref.read(prefsProvider).setString(_draftKey, jsonEncode({'type': type, 'description': desc.text, 'location_text': place.text, ...?fix?.toJson()}));

  Future<void> _submit() async {
    final s = ref.read(sessionProvider);
    if (desc.text.trim().length < 10) return _msg('Vui lòng mô tả hiện trạng (ít nhất 10 ký tự).');
    if (fix == null) return _msg('Cần vị trí: dùng GPS hoặc chọn trên bản đồ.');
    setState(() => busy = true);
    final labels = {for (final t in ((s.catalogs['report_types'] as List?) ?? []).cast<Map>()) t['key']: t['label']};
    final item = await ref.read(outboxProvider.notifier).add(
          entity: 'report',
          title: 'Phản ánh: ${labels[type] ?? type}',
          payload: {
            'type': type,
            'description': desc.text.trim(),
            'location_text': place.text.trim(),
            'observed_at': DateTime.now().toUtc().toIso8601String(),
            ...fix!.toJson(),
            if (!s.signedIn) 'name': name.text.trim(),
            if (!s.signedIn) 'phone': phone.text.trim(),
          },
          files: [for (final m in media) (m.file, m.meta)],
          sendNow: false,
        );
    final r = await ref.read(outboxProvider.notifier).sync();
    await ref.read(prefsProvider).remove(_draftKey);
    if (!mounted) return;
    setState(() => busy = false);
    final sent = ref.read(outboxProvider).items.firstWhere((x) => x.clientUuid == item.clientUuid, orElse: () => item);
    await showDialog(
      context: context,
      builder: (_) => AlertDialog(
        icon: Icon(sent.status == OutboxStatus.done ? Icons.check_circle : Icons.cloud_queue, color: sent.status == OutboxStatus.done ? AppColors.forest : AppColors.orange, size: 46),
        title: Text(sent.status == OutboxStatus.done ? 'Đã gửi phản ánh' : sent.status == OutboxStatus.failed ? 'Chưa gửi được' : 'Đã lưu, chờ gửi'),
        content: Text(sent.status == OutboxStatus.done
            ? 'Mã hồ sơ: ${sent.serverId}\nTrạng thái: Đã tiếp nhận. Lưu mã để tra cứu tiến độ.'
            : sent.status == OutboxStatus.failed
                ? sent.message ?? 'Máy chủ từ chối.'
                : r.summary),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Đóng'))],
      ),
    );
    if (mounted) context.pop();
  }

  void _msg(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final types = ((s.catalogs['report_types'] as List?) ?? []).cast<Map>();
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(title: const Text('Phản ánh hiện trạng'), bottom: const TabBar(tabs: [Tab(text: 'Gửi phản ánh'), Tab(text: 'Lịch sử phản ánh')])),
        body: TabBarView(children: [
          ListView(padding: const EdgeInsets.all(14), children: [
            DropdownButtonFormField<String>(
              initialValue: types.any((t) => t['key'] == type) ? type : null,
              decoration: const InputDecoration(labelText: 'Chọn loại phản ánh *'),
              items: [for (final t in types) DropdownMenuItem(value: t['key'] as String, child: Text(t['label'].toString()))],
              onChanged: (v) => setState(() {
                type = v!;
                _saveDraft();
              }),
            ),
            const SizedBox(height: 12),
            TextField(controller: desc, maxLines: 5, maxLength: 3000, decoration: const InputDecoration(labelText: 'Mô tả hiện trạng *', hintText: 'Hiện tượng quan sát được, thời gian, quy mô…', alignLabelWithHint: true)),
            const SizedBox(height: 4),
            const Text('Vị trí *', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            LocationField(value: fix, autoGps: widget.initial == null, onChanged: (f) => setState(() {
              fix = f;
              _saveDraft();
            })),
            const SizedBox(height: 8),
            TextField(controller: place, decoration: const InputDecoration(labelText: 'Mô tả địa điểm (thôn, tiểu khu…) – không bắt buộc')),
            const SizedBox(height: 14),
            const Text('Thêm hình ảnh / video', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            MediaPicker(items: media, fix: fix, onChanged: (m) => setState(() => media = m)),
            const SourceNote('Tối đa 5 tệp; ảnh ≤ 15 MB, video ≤ 60 MB. Ảnh được loại bỏ thông tin EXIF trên máy chủ.'),
            if (!s.signedIn) ...[
              const SizedBox(height: 14),
              const Text('Thông tin liên hệ (không công khai, không bắt buộc)', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              TextField(controller: name, decoration: const InputDecoration(labelText: 'Họ tên')),
              const SizedBox(height: 8),
              TextField(controller: phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Số điện thoại')),
            ],
            const SizedBox(height: 14),
            const NoticeBox('Thông tin người phản ánh được bảo mật, chỉ cán bộ xử lý xem. Khi thấy cháy rừng đang lan, gọi ngay 114 hoặc kiểm lâm địa bàn.'),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: busy ? null : _submit,
              icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Icon(Icons.send),
              label: const Text('Gửi phản ánh'),
            ),
            const SizedBox(height: 6),
            const Text('Mất mạng? Phản ánh được lưu trên máy và tự gửi khi có mạng.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: AppColors.muted)),
          ]),
          const MyReportsBody(),
        ]),
      ),
    );
  }
}
