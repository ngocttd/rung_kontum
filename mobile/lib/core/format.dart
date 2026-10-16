import 'package:intl/intl.dart';

final _num = NumberFormat.decimalPattern('vi');

String fmtNum(num? v, [int digits = 0]) {
  if (v == null) return '—';
  if (digits == 0) return _num.format(v.round());
  return NumberFormat.decimalPatternDigits(locale: 'vi', decimalDigits: digits).format(v);
}

String fmtHa(num? v) => v == null ? '—' : '${fmtNum(v)} ha';

DateTime? parseTime(Object? v) {
  if (v == null) return null;
  if (v is DateTime) return v;
  return DateTime.tryParse(v.toString());
}

/// Giờ Việt Nam (UTC+7) bất kể múi giờ thiết bị.
DateTime toVn(DateTime d) => d.toUtc().add(const Duration(hours: 7));

String fmtDateTime(Object? v) {
  final d = parseTime(v);
  if (d == null) return '—';
  return DateFormat('HH:mm dd/MM/yyyy').format(toVn(d));
}

String fmtDate(Object? v) {
  final d = parseTime(v);
  if (d == null) return v?.toString() ?? '—';
  return DateFormat('dd/MM/yyyy').format(v.toString().length == 10 ? d : toVn(d));
}

String fmtAgo(Object? v) {
  final d = parseTime(v);
  if (d == null) return '—';
  final m = DateTime.now().difference(d).inMinutes;
  if (m < 1) return 'vừa xong';
  if (m < 60) return '$m phút trước';
  if (m < 1440) return '${m ~/ 60} giờ trước';
  if (m < 43200) return '${m ~/ 1440} ngày trước';
  return fmtDate(v);
}

String fmtBytes(num? b) {
  if (b == null) return '';
  if (b < 1024 * 1024) return '${(b / 1024).toStringAsFixed(0)} KB';
  return '${(b / 1024 / 1024).toStringAsFixed(1)} MB';
}

String fmtCoord(double lat, double lon) => '${lat.toStringAsFixed(5)}, ${lon.toStringAsFixed(5)}';

/// Mùa khô Tây Nguyên: tháng 11 – tháng 4 (dùng mặc định cho khảo sát rừng khộp).
String seasonOf(DateTime d) => (d.month >= 11 || d.month <= 4) ? 'dry' : 'wet';
