import 'dart:convert';

import 'package:flutter/foundation.dart';

/// GeoJSON lớn được mã hóa/giải mã ở isolate, không chiếm luồng dựng giao diện.
Future<String> encodeCacheEntry(Map<String, dynamic> entry, {bool background = false}) =>
    background ? compute(_encode, entry, debugLabel: 'cache.encode') : Future.value(_encode(entry));

Future<Map<String, dynamic>> decodeCacheEntry(String raw, {bool background = false}) =>
    background ? compute(_decode, raw, debugLabel: 'cache.decode') : Future.value(_decode(raw));

String _encode(Map<String, dynamic> entry) => jsonEncode(entry);
Map<String, dynamic> _decode(String raw) => (jsonDecode(raw) as Map).cast<String, dynamic>();
