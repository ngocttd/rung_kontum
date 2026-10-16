import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';

final _mem = <String, Uint8List>{};

Future<String> persistAttachment(XFile f, String id) async {
  _mem[id] = await f.readAsBytes();
  return id;
}

Future<Uint8List?> readAttachment(String path) async => _mem[path];

Future<void> deleteAttachment(String path) async => _mem.remove(path);
