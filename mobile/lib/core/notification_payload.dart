import 'dart:convert';

/// Giữ riêng ID thông báo và ID đối tượng cần mở (nhiệm vụ/điểm cháy).
Map<String, dynamic> notificationPayload(Map<String, dynamic> data) {
  Map<String, dynamic> link = {};
  final raw = data['link'] ?? data['data'];
  try {
    final decoded = raw is String ? jsonDecode(raw) : raw;
    if (decoded is Map) link = decoded.cast<String, dynamic>();
  } on FormatException {
    // Vẫn mở được các trường điều hướng phẳng khi link không hợp lệ.
  }
  return {
    ...data,
    ...link,
    'notification_id': data['notification_id'] ?? data['id'],
  }..remove('link');
}

/// Socket.IO và FCM có thể giao cùng một bản tin gần như đồng thời.
class NotificationDeduplicator {
  final Set<String> _seen = {};

  bool claim(Object? id) {
    if (id == null || id.toString().isEmpty) return true;
    final key = id.toString();
    if (!_seen.add(key)) return false;
    if (_seen.length > 200) _seen.remove(_seen.first);
    return true;
  }

  void forget(Object? id) => _seen.remove(id?.toString());
}
