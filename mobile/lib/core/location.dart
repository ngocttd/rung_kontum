import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

/// Vị trí kèm độ chính xác và nguồn (đặc tả mục 9: hiển thị và lưu sai số GPS; cho phép chọn tay khi tín hiệu kém).
class Fix {
  const Fix(this.point, {this.accuracy, this.source = 'gps', this.at});
  final LatLng point;
  final double? accuracy; // mét
  final String source; // gps | map | manual
  final DateTime? at;

  bool get poor => accuracy != null && accuracy! > 30;
  String get label => source == 'gps'
      ? (accuracy == null ? 'GPS' : 'GPS ±${accuracy!.round()} m${poor ? ' (tín hiệu yếu)' : ''}')
      : source == 'map'
          ? 'Chọn trên bản đồ'
          : 'Nhập toạ độ tay';
  Map<String, dynamic> toJson() => {'lat': point.latitude, 'lon': point.longitude, 'gps_accuracy': accuracy, 'location_source': source};
}

class LocationException implements Exception {
  LocationException(this.message);
  final String message;
  @override
  String toString() => message;
}

class LocationService {
  static Future<Fix> current({Duration timeout = const Duration(seconds: 25)}) async {
    if (!await Geolocator.isLocationServiceEnabled()) throw LocationException('Dịch vụ định vị đang tắt. Bật GPS hoặc chọn vị trí trên bản đồ.');
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      throw LocationException('Ứng dụng chưa được cấp quyền vị trí. Có thể chọn vị trí trên bản đồ.');
    }
    try {
      final p = await Geolocator.getCurrentPosition(locationSettings: LocationSettings(accuracy: LocationAccuracy.best, timeLimit: timeout));
      return Fix(LatLng(p.latitude, p.longitude), accuracy: p.accuracy, at: p.timestamp);
    } catch (_) {
      final last = await Geolocator.getLastKnownPosition();
      if (last != null) return Fix(LatLng(last.latitude, last.longitude), accuracy: last.accuracy, at: last.timestamp);
      throw LocationException('Không lấy được vị trí GPS (tín hiệu yếu). Hãy ra chỗ thoáng hoặc chọn trên bản đồ.');
    }
  }

  /// Theo dõi vị trí liên tục (đi bộ đo đường/vùng khảo sát).
  static Stream<Fix> track() => Geolocator.getPositionStream(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, distanceFilter: 5))
      .map((p) => Fix(LatLng(p.latitude, p.longitude), accuracy: p.accuracy, at: p.timestamp));
}
