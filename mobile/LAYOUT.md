# Bố cục Android, iPhone và iPad

Cập nhật 01/11/2026. Thay đổi áp dụng ở `mobile/` và đồng bộ phần bố cục sang `../kontum-mobile`.

## Thanh điều hướng và vùng an toàn

- `AppFrame` giữ nguyên inset đáy; không nâng toàn bộ ứng dụng bằng một SafeArea ở bên ngoài Scaffold.
- `AppNavigationBar` vẽ nền sát đáy, dùng inset hệ thống hiện tại để chừa chỗ cho 3 nút hoặc thanh vuốt. Khi đổi chế độ, MediaQuery cập nhật lại vị trí mà không cần khởi động lại app.
- Vùng nút cao 64 logical pixel trên Android và 60 trên iOS; iOS gọn hơn bản cũ 66. Khoảng dành cho home indicator chỉ được áp dụng một lần.
- Insets hai bên được giữ khi xoay ngang. Mở bàn phím không làm thay đổi khoảng đệm của navbar.
- `ResponsiveScaffold` bảo vệ nội dung/nút cuối trang. `FormSheet` và `SafeDraggableSheet` bảo vệ bottom sheet; form có thể cuộn khi bàn phím chiếm phần lớn màn hình.

## Thích ứng theo chiều rộng cửa sổ

Dùng chiều rộng thực tế bằng logical pixel, hỗ trợ cả iPad chia đôi màn hình; không suy đoán bố cục theo số inch của thiết bị.

| Nội dung | Chiều rộng tối đa |
| --- | ---: |
| Form đăng nhập/đăng ký | 480 |
| Hồ sơ, cài đặt và form hiện trường | 760 |
| Nội dung tổng quan | 1120 |
| Nhóm nút navbar trên tablet | 720 |
| Bottom sheet trên tablet | 640 |

Lưới lối tắt thay số cột theo chiều rộng và cỡ chữ. Thẻ KPI có chiều cao tự nhiên; chú giải biểu đồ và so sánh ảnh chuyển xuống dưới trên máy nhỏ. Thẻ thời tiết, thông tin phụ trong danh sách và hàng nút đăng nhập cho phép xuống dòng.

## Kiểm tra

```bash
flutter analyze --no-pub
flutter test --no-pub --concurrency=1
```

Test bố cục gồm 320×568, 360×640, 375×667, 390×844, 430×932, điện thoại xoay ngang 667×375, iPad 744×1133/1024×1366/1366×1024 và cửa sổ chia đôi 320×768/507×1024. Máy nhỏ được kiểm tra thêm với cỡ chữ 140%.

Test điều hướng thay trực tiếp inset 48 → 24 → 0 → 48, kiểm tra thanh 3 nút ở cạnh phải khi xoay ngang, iOS home indicator, bàn phím và form bottom sheet. Android chưa có thiết bị/emulator kết nối; các chế độ này được kiểm tra bằng widget test với insets thay đổi.

Kết quả sau sửa ngoại tuyến/tối ưu Map: 53 bài test ở bản chính đã đạt; `flutter analyze` ở cả hai bản không báo lỗi. Build iOS Simulator thành công, đã mở Trang chủ với API thật trên iPad mini (A17 Pro) và iPhone 17e. Ảnh xem trước: [iPad mini](release/layout-checks/ipad-mini.png), [iPhone 17e](release/layout-checks/iphone-17e.png). Sửa lỗi dữ liệu cache và tối ưu Map: [MAP_OPTIMIZATION.md](MAP_OPTIMIZATION.md).

Android debug APK đã build thành công và kiểm tra cấu trúc ZIP hợp lệ: [MobileGIS-KonTum-responsive-debug.apk](release/MobileGIS-KonTum-responsive-debug.apk). APK này dùng API `https://kontum.humgsoftware.pro.vn`.

Ảnh kiểm tra Simulator và bản APK thử được đặt trong `release/layout-checks/` và `release/` trên máy, không đưa vào Git.
