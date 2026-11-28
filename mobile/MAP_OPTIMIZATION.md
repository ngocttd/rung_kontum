# Sửa lỗi ngoại tuyến và tối ưu mở Bản đồ

Cập nhật 01/11/2026. Đã áp dụng vào `mobile/` và đồng bộ phần sửa sang `../kontum-mobile`.

- Sửa `AsyncView`: chỉ dùng Expanded khi chiều cao hữu hạn; dữ liệu cache trong ListView thu gọn theo nội dung. Có test tái hiện đúng Trang chủ rộng 412 logical pixel và trường hợp danh sách toàn trang.
- Chuẩn bị tọa độ xã/tỉnh bằng isolate. Giữ nguyên Polygon, MultiPolygon, vòng lỗ và thuộc tính; không giảm độ chính xác của dữ liệu chọn đối tượng.
- Provider giữ kết quả hình học đến khi GeoJSON thay đổi. Giữ widget lớp vẽ khi dữ liệu/màu không đổi để flutter_map không bỏ cache chiếu/tối giản tọa độ khi tìm kiếm hoặc đổi tab.
- Giữ TileLayer của nền khi URL không đổi. Mã hóa/giải mã cache GeoJSON lớn chạy ở isolate; dữ liệu vẫn được kiểm tra từ mạng trước rồi dùng cache khi mất kết nối.
- Phản hồi chọn tab bằng một khung nhẹ trước; khởi tạo canvas và ô tìm kiếm ở các khung kế tiếp. Xử lý MapFocus sau khi controller sẵn sàng và giải phóng controller khi đóng trang.

## Kiểm tra và giới hạn

`flutter analyze --no-pub` không báo lỗi ở cả hai bản. Bản chính đạt **53/53 test**; bản cũ đạt **8/8 test mới** về ngoại tuyến, hình học, cache và khởi tạo. Build Android Release và iOS Simulator thành công. Kiểm tra runtime trên Simulator: đủ 40 xã và một vòng biên tỉnh, không có lỗi chuẩn bị geometry.

Trên Debug Simulator, cùng kịch bản restart rồi chọn Map: phản hồi khung chuyển tab trước sửa khoảng 497–545 ms, sau sửa khoảng 37–48 ms. **Đây là thời gian phản hồi chọn tab, không phải thời gian bản đồ tải/vẽ hoàn chỉnh.** Khung khởi tạo tiếp theo trong Debug vẫn có thể nặng: lượt đo riêng ghi nhận tối đa khoảng 576 ms trên UI thread. Vì vậy chưa kết luận đã hết khựng hoặc tốc độ Release trên máy thật.

APK Release hiện tại: [MobileGIS-KonTum-network-fix-release.apk](release/MobileGIS-KonTum-network-fix-release.apk), dùng `https://kontum.humgsoftware.pro.vn`. Chưa có Android/iPhone thật kết nối để đo Profile/Release. Nếu đang chạy từ IDE, thực hiện **Hot Restart** sau khi cập nhật mã.

Ảnh và số đo Debug được lưu trong `release/map-profile/` trên máy. Để đo tốc độ sử dụng thực tế, dùng Profile/Release trên thiết bị thật theo [hướng dẫn Flutter](https://docs.flutter.dev/perf/ui-performance).

## Khi không phân giải được tên miền / mất mạng

Log `Failed host lookup` ở cả `api.mapbox.com` và tên miền API nghĩa là các yêu cầu đó thất bại ở bước DNS. Kiểm tra từ máy phát triển ngày 01/11/2026: API bootstrap/home và bốn nền Mapbox đều trả HTTP 200. Kết quả này không xác nhận kết nối của Simulator/điện thoại tại thời điểm lỗi.

`NetworkMap` gom lỗi tải nền/raster vào một thông báo với nút **Thử lại**. Các lớp vector và marker tiếp tục hiển thị; tile đã tải vẫn dùng cache của flutter_map. `MapTileClient` tạm dừng yêu cầu mới trong 10 giây sau lỗi kết nối, không tự retry từng tile liên tục. Khi đổi trạng thái kết nối sang có mạng hoặc quay lại ứng dụng, các lớp đang lỗi được thử tải lại. Nút Thử lại bỏ thời gian tạm dừng và reset lớp ảnh; không đổi nền, URL hoặc token.

Áp dụng cho tab Bản đồ, chọn vị trí, khảo sát và xem vị trí nhiệm vụ, gồm cả ảnh phủ cũ. Tile raster 404 ngoài vùng dữ liệu không hiện cảnh báo mất mạng; 401/403 vẫn hiển thị lỗi quyền truy cập. Không thay đổi bộ xử lý FlutterError toàn ứng dụng. Các vùng chưa có ảnh cache vẫn cần Internet; mã ứng dụng không thể sửa DNS của hệ điều hành.

Thêm **9 test**: DNS lỗi và giới hạn yêu cầu, giữ header, hủy yêu cầu có chủ đích, HTTP 403/404/503, đứt body, hai nguồn lỗi chỉ hiện một thông báo, retry thành công, kết nối/app resume và dispose khi đang tải, ảnh phủ lỗi và phục hồi. Toàn bộ bản chính **53/53 đạt**; 9 test mạng ở bản cũ cũng đạt. `flutter analyze --no-pub` không báo lỗi ở cả hai bản.
