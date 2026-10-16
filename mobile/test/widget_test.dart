// Kiểm thử đơn vị các quy tắc không phụ thuộc máy chủ: định dạng số/ngày, chọn xã theo toạ độ,
// diện tích đa giác, mùa khảo sát (rừng khộp), mô hình hàng đợi ngoại tuyến.
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:kontum_mobilegis/core/data.dart';
import 'package:kontum_mobilegis/core/format.dart';
import 'package:kontum_mobilegis/core/outbox.dart';
import 'package:kontum_mobilegis/features/map/map_page.dart';
import 'package:latlong2/latlong.dart';

void main() {
  setUpAll(() => initializeDateFormatting('vi'));

  test('định dạng số kiểu Việt Nam', () {
    expect(fmtNum(616153.8), '616.154');
    expect(fmtHa(1200), '1.200 ha');
    expect(fmtNum(null), '—');
  });

  test('giờ hiển thị theo UTC+7', () {
    expect(fmtDateTime('2026-10-16T05:46:00Z'), '12:46 16/10/2026');
  });

  test('mùa khô Tây Nguyên: tháng 11 – tháng 4', () {
    expect(seasonOf(DateTime(2026, 1, 10)), 'dry');
    expect(seasonOf(DateTime(2026, 11, 2)), 'dry');
    expect(seasonOf(DateTime(2026, 7, 2)), 'wet');
  });

  test('điểm trong đa giác (kể cả lỗ)', () {
    final g = {
      'type': 'Polygon',
      'coordinates': [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
      ],
    };
    expect(pointInGeometry(1, 1, g), isTrue);
    expect(pointInGeometry(5, 5, g), isFalse); // trong lỗ
    expect(pointInGeometry(11, 5, g), isFalse);
  });

  test('diện tích vùng khoảng 1 ha', () {
    const d = 0.000898; // ~100 m ở vĩ độ 14.5
    final a = polygonAreaM2([const LatLng(14.5, 108), const LatLng(14.5, 108 + d * 1.033), const LatLng(14.5 + d, 108 + d * 1.033), const LatLng(14.5 + d, 108)]);
    expect(a, closeTo(10000, 600));
  });

  test('bản ghi hàng đợi giữ nguyên khi lưu/đọc (TC11)', () {
    final it = OutboxItem(clientUuid: 'u-1', entity: 'report', operation: 'create', title: 't', payload: {'a': 1}, attachments: [OutboxAttachment(path: 'p', mime: 'image/jpeg', lat: 14.6)]);
    final back = OutboxItem.fromJson(it.toJson());
    expect(back.clientUuid, 'u-1');
    expect(back.attachments.single.lat, 14.6);
    expect(back.status, OutboxStatus.pending);
  });
}
