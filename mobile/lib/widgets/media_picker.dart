import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../app/theme.dart';
import '../core/location.dart';

/// Ảnh/video bằng chứng (tối đa [max] tệp). Mỗi tệp ghi kèm toạ độ, sai số tại thời điểm chụp nếu có.
class PickedMedia {
  PickedMedia(this.file, {this.fix, this.video = false});
  final XFile file;
  final Fix? fix;
  final bool video;
  Map<String, dynamic> get meta => {if (fix != null) 'lat': fix!.point.latitude, if (fix != null) 'lon': fix!.point.longitude, if (fix?.accuracy != null) 'accuracy': fix!.accuracy};
}

class MediaPicker extends StatefulWidget {
  const MediaPicker({super.key, required this.items, required this.onChanged, this.max = 5, this.fix, this.allowVideo = true});
  final List<PickedMedia> items;
  final ValueChanged<List<PickedMedia>> onChanged;
  final int max;
  final Fix? fix;
  final bool allowVideo;
  @override
  State<MediaPicker> createState() => _MediaPickerState();
}

class _MediaPickerState extends State<MediaPicker> {
  final picker = ImagePicker();

  Future<void> _add(String how) async {
    try {
      XFile? f;
      if (how == 'camera') f = await picker.pickImage(source: ImageSource.camera, imageQuality: 85, maxWidth: 2400);
      if (how == 'gallery') f = await picker.pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 2400);
      if (how == 'video') f = await picker.pickVideo(source: ImageSource.camera, maxDuration: const Duration(seconds: 60));
      if (f == null) return;
      if (how == 'video' && await f.length() > 60 * 1024 * 1024) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Video vượt 60 MB, hãy quay ngắn hơn.')));
        return;
      }
      widget.onChanged([...widget.items, PickedMedia(f, fix: widget.fix, video: how == 'video')]);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Không mở được camera/thư viện: $e')));
    }
  }

  void _menu() => showModalBottomSheet(
        context: context,
        builder: (_) => SafeArea(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Chụp ảnh'), onTap: () => [Navigator.pop(context), _add('camera')]),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Chọn ảnh có sẵn'), onTap: () => [Navigator.pop(context), _add('gallery')]),
            if (widget.allowVideo) ListTile(leading: const Icon(Icons.videocam_outlined), title: const Text('Quay video (≤ 60 giây)'), onTap: () => [Navigator.pop(context), _add('video')]),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Wrap(spacing: 8, runSpacing: 8, children: [
      for (final m in widget.items)
        Stack(children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: SizedBox(
              width: 92,
              height: 92,
              child: m.video
                  ? Container(color: AppColors.navy, child: const Icon(Icons.play_circle_outline, color: Colors.white, size: 38))
                  : kIsWeb
                      ? Image.network(m.file.path, fit: BoxFit.cover)
                      : FutureBuilder<Uint8List>(future: m.file.readAsBytes(), builder: (_, s) => s.hasData ? Image.memory(s.data!, fit: BoxFit.cover) : Container(color: AppColors.forestLight)),
            ),
          ),
          Positioned(
            right: 2,
            top: 2,
            child: InkWell(
              onTap: () => widget.onChanged(widget.items.where((x) => x != m).toList()),
              child: const CircleAvatar(radius: 12, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 15, color: Colors.white)),
            ),
          ),
        ]),
      if (widget.items.length < widget.max)
        InkWell(
          onTap: _menu,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            width: 92,
            height: 92,
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: AppColors.line, width: 1.5), color: Colors.white),
            child: const Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(Icons.add_a_photo_outlined, color: AppColors.muted), Text('Thêm', style: TextStyle(fontSize: 12, color: AppColors.muted))]),
          ),
        ),
    ]);
  }
}
