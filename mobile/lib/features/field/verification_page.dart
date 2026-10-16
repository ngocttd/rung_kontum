import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/location.dart';
import '../../core/outbox.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/location_picker.dart';
import '../../widgets/media_picker.dart';

class VerifyArgs {
  const VerifyArgs({required this.kind, required this.alertId, required this.title, this.point, this.assignmentId});
  final String kind; // hotspot | candidate | report
  final String alertId;
  final String title;
  final LatLng? point;
  final String? assignmentId;
}

/// M16 / quy trình 6.2 – Xác minh tại hiện trường: GPS, ảnh, mô tả, mức độ, loại rừng, kết luận có/không,
/// kiến nghị. Kết quả lưu bất biến, chờ người có thẩm quyền duyệt rồi mới cập nhật trạng thái cảnh báo.
class VerificationPage extends ConsumerStatefulWidget {
  const VerificationPage({super.key, required this.args});
  final VerifyArgs args;
  @override
  ConsumerState<VerificationPage> createState() => _VerificationPageState();
}

class _VerificationPageState extends ConsumerState<VerificationPage> {
  String? verdict;
  String? forestType;
  String season = seasonOf(DateTime.now());
  String severity = 'Trung bình';
  final area = TextEditingController();
  final desc = TextEditingController();
  final reco = TextEditingController();
  final lossEvidence = TextEditingController();
  Fix? fix;
  List<PickedMedia> media = [];
  bool busy = false;

  bool get _dipterocarpDry => forestType == 'rung-khop' && season == 'dry';

  Future<void> _submit() async {
    final a = widget.args;
    if (verdict == null) return _msg('Chọn kết luận xác minh.');
    if (fix == null) return _msg('Cần vị trí GPS tại hiện trường.');
    if (desc.text.trim().length < 10) return _msg('Mô tả hiện trường (ít nhất 10 ký tự).');
    if (media.isEmpty) return _msg('Cần ít nhất 1 ảnh bằng chứng.');
    if (a.kind == 'candidate' && verdict == 'loss_confirmed' && _dipterocarpDry && lossEvidence.text.trim().isEmpty) {
      return _msg('Rừng khộp mùa khô: cần bằng chứng mất rừng (gốc chặt, chuyển đổi đất…) hoặc chọn “Rụng lá theo mùa”.');
    }
    setState(() => busy = true);
    await ref.read(outboxProvider.notifier).add(
          entity: 'verification',
          title: 'Xác minh: ${a.title}',
          payload: {
            'alert_kind': a.kind, 'alert_id': a.alertId, if (a.assignmentId != null) 'assignment_id': a.assignmentId,
            'verdict': verdict, 'severity': a.kind == 'hotspot' ? severity : null, 'forest_type': forestType, 'season': season,
            'burned_area_ha': double.tryParse(area.text.replaceAll(',', '.')), 'description': desc.text.trim(), 'recommendation': reco.text.trim(),
            if (lossEvidence.text.trim().isNotEmpty) 'loss_evidence': lossEvidence.text.trim(),
            'lat': fix!.point.latitude, 'lon': fix!.point.longitude, 'gps_accuracy': fix!.accuracy, 'location_source': fix!.source,
            'verified_at': DateTime.now().toUtc().toIso8601String(),
          },
          files: [for (final m in media) (m.file, m.meta)],
          sendNow: false,
        );
    final r = await ref.read(outboxProvider.notifier).sync();
    ref.invalidate(assignmentsProvider);
    if (a.assignmentId != null) ref.invalidate(assignmentProvider(a.assignmentId!));
    if (!mounted) return;
    setState(() => busy = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r.offline ? r.summary : r.rejected > 0 ? 'Máy chủ từ chối – xem mục Đồng bộ.' : 'Đã nộp kết quả xác minh, chờ duyệt.')));
    context.pop();
  }

  void _msg(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(sessionProvider);
    final verdicts = (((s.catalogs['verdicts'] as Map?)?[widget.args.kind] as Map?) ?? {}).cast<String, dynamic>();
    final types = ((s.catalogs['forest_types'] as Map?) ?? {}).cast<String, dynamic>();
    return Scaffold(
      appBar: AppBar(title: const Text('Xác minh hiện trường')),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        Text(widget.args.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.navy)),
        const SizedBox(height: 4),
        Text('Mã đối tượng: ${widget.args.alertId}', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
        const SizedBox(height: 12),
        const Text('Vị trí tại hiện trường *', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        LocationField(value: fix, onChanged: (f) => setState(() => fix = f)),
        if (fix != null && widget.args.point != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('Cách vị trí cảnh báo ${fmtNum(const Distance().as(LengthUnit.Meter, fix!.point, widget.args.point!))} m', style: const TextStyle(fontSize: 12, color: AppColors.muted)),
          ),
        const SizedBox(height: 12),
        const Text('Kết luận *', style: TextStyle(fontWeight: FontWeight.w700)),
        RadioGroup<String>(
          groupValue: verdict,
          onChanged: (v) => setState(() => verdict = v),
          child: Column(children: [for (final e in verdicts.entries) RadioListTile<String>(dense: true, contentPadding: EdgeInsets.zero, value: e.key, title: Text(e.value.toString()))]),
        ),
        if (widget.args.kind == 'hotspot' && verdict == 'fire_confirmed') ...[
          DropdownButtonFormField<String>(
            initialValue: severity,
            decoration: const InputDecoration(labelText: 'Mức độ'),
            items: const [DropdownMenuItem(value: 'Nhẹ', child: Text('Nhẹ – cháy thảm mục, dập được')), DropdownMenuItem(value: 'Trung bình', child: Text('Trung bình')), DropdownMenuItem(value: 'Nghiêm trọng', child: Text('Nghiêm trọng – cháy tán, lan rộng'))],
            onChanged: (v) => setState(() => severity = v!),
          ),
          const SizedBox(height: 10),
          TextField(controller: area, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Diện tích bị cháy ước tính (ha)')),
          const SizedBox(height: 10),
        ],
        DropdownButtonFormField<String>(
          initialValue: forestType,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Loại rừng tại hiện trường'),
          items: [for (final e in types.entries) DropdownMenuItem(value: e.key, child: Text(e.value.toString()))],
          onChanged: (v) => setState(() => forestType = v),
        ),
        const SizedBox(height: 10),
        SegmentedButton<String>(segments: const [ButtonSegment(value: 'dry', label: Text('Mùa khô')), ButtonSegment(value: 'wet', label: Text('Mùa mưa'))], selected: {season}, onSelectionChanged: (v) => setState(() => season = v.first)),
        if (_dipterocarpDry) ...[
          const SizedBox(height: 10),
          const NoticeBox('Rừng khộp mùa khô rụng lá tự nhiên: KHÔNG kết luận mất rừng chỉ vì tán thưa/NDVI thấp. Chỉ xác nhận mất rừng khi có bằng chứng (gốc chặt, đất đã chuyển đổi, vết máy…).', warn: true),
          if (verdict == 'loss_confirmed') ...[const SizedBox(height: 8), TextField(controller: lossEvidence, maxLines: 2, decoration: const InputDecoration(labelText: 'Bằng chứng mất rừng *'))],
        ],
        const SizedBox(height: 12),
        TextField(controller: desc, maxLines: 4, decoration: const InputDecoration(labelText: 'Mô tả hiện trường *', alignLabelWithHint: true)),
        const SizedBox(height: 10),
        TextField(controller: reco, maxLines: 2, decoration: const InputDecoration(labelText: 'Kiến nghị xử lý')),
        const SizedBox(height: 12),
        const Text('Ảnh / video bằng chứng *', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        MediaPicker(items: media, fix: fix, max: 8, onChanged: (m) => setState(() => media = m)),
        const SizedBox(height: 14),
        const NoticeBox('Kết quả lưu kèm người xác minh, thời gian, toạ độ và sai số GPS; không sửa được sau khi nộp. Người có thẩm quyền duyệt rồi trạng thái cảnh báo mới thay đổi.'),
        const SizedBox(height: 14),
        FilledButton.icon(onPressed: busy ? null : _submit, icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)) : const Icon(Icons.send), label: const Text('Nộp kết quả xác minh')),
      ]),
    );
  }
}
