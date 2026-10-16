import 'dart:io';
import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';

Future<String> persistAttachment(XFile f, String id) async {
  final dir = Directory('${(await getApplicationDocumentsDirectory()).path}/outbox');
  if (!await dir.exists()) await dir.create(recursive: true);
  final ext = f.name.contains('.') ? f.name.substring(f.name.lastIndexOf('.')) : '';
  final target = '${dir.path}/$id$ext';
  await File(f.path).copy(target);
  return target;
}

Future<Uint8List?> readAttachment(String path) async {
  final f = File(path);
  return await f.exists() ? f.readAsBytes() : null;
}

Future<void> deleteAttachment(String path) async {
  try {
    await File(path).delete();
  } catch (_) {}
}
