import 'package:flutter_test/flutter_test.dart';
import 'package:kontum_mobilegis/core/notification_payload.dart';

void main() {
  test('FCM tách ID thông báo khỏi ID nhiệm vụ để đánh dấu đã đọc đúng', () {
    final payload = notificationPayload({
      'id': 'notification-1',
      'kind': 'assignment',
      'link': '{"screen":"task","id":"task-9"}',
    });
    expect(payload['id'], 'task-9');
    expect(payload['notification_id'], 'notification-1');
    expect(payload['screen'], 'task');
  });

  test('Socket.IO và FCM tạo cùng payload điều hướng', () {
    final socket = notificationPayload({'id': 'n1', 'link': {'screen': 'hotspot', 'id': 'h1'}});
    final fcm = notificationPayload({'id': 'n1', 'link': '{"screen":"hotspot","id":"h1"}'});
    expect(socket, fcm);
  });

  test('link lỗi không làm mất các trường điều hướng phẳng', () {
    final payload = notificationPayload({'id': 'n1', 'link': '{bad', 'screen': 'fire'});
    expect(payload['screen'], 'fire');
    expect(payload['notification_id'], 'n1');
  });

  test('không báo trùng khi FCM và socket cùng giao một ID', () {
    final dedup = NotificationDeduplicator();
    expect(dedup.claim('n1'), isTrue);
    expect(dedup.claim('n1'), isFalse);
    expect(dedup.claim('n2'), isTrue);
    dedup.forget('n1'); // lỗi hiển thị: cho phép kênh còn lại giao lại
    expect(dedup.claim('n1'), isTrue);
  });

  test('bản tin không có ID vẫn hiển thị; bộ nhớ chống trùng có giới hạn', () {
    final dedup = NotificationDeduplicator();
    expect(dedup.claim(null), isTrue);
    expect(dedup.claim(null), isTrue);
    for (var i = 0; i <= 200; i++) {
      expect(dedup.claim('n$i'), isTrue);
    }
    expect(dedup.claim('n0'), isTrue);
  });
}
