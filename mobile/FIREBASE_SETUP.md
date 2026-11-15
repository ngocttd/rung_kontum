# Firebase KonTum đã cấu hình

Cập nhật 01/11/2026.

- Google đã đăng nhập lại thành công: `longcanh2k3@gmail.com` (phiên CLI cũ đã thu hồi).
- Dự án hiện có: **KonTum** — `even-metrics-413108`, sender/project number `315105906364`.
- iOS production: `1:315105906364:ios:d44716f1cb166a35c10ab9`, Bundle ID `vn.gov.kontum.mobilegis`.
- Android theo package hiện tại: `vn.gov.kontum.kontum_mobilegis`, app `1:315105906364:android:4d942c85ba243dfdc10ab9`.

## Ứng dụng

Cấu hình Firebase công khai được lưu ở `lib/app/firebase_options.dart`, dùng mặc định khi build/chạy. Không cần nhớ thêm dart-define để bật Firebase. `FirebaseConfig` vẫn hỗ trợ ghi đè đủ cấu hình cho môi trường khác; override thiếu trường không tự trộn với production.

`ios/Runner/GoogleService-Info.plist` đã thêm vào Runner Resources và có trong archive. Đã tải `android/app/google-services.json` khớp package hiện tại; phiên này tập trung kiểm tra build iOS, chưa xác minh build/phân phối Android.

Trên máy có `firebase.json` chứa các dart-define Firebase và `release.json` đã điền Firebase thật. API và cổng web dùng `https://kontum.humgsoftware.pro.vn`; URL quyền riêng tư/xóa tài khoản trong `release.json` vẫn cần trang chính thức. Không dùng `firebase init` ghi đè `mobile/firebase.json`: đó là tệp dart-define của app, không phải cấu hình hosting.

App mặc định dùng tên miền HTTPS này trên mọi nền tảng. Các cấu hình chạy trong VS Code và cấu hình release cũng dùng cùng địa chỉ; địa chỉ localhost đã lưu từ bản cài cũ tự chuyển khi mở lại app.

## Máy chủ gửi thông báo

Đã tạo service account riêng:

`kontum-fcm-sender@even-metrics-413108.iam.gserviceaccount.com`

Role duy nhất gán cho tài khoản này ở dự án: `roles/firebasecloudmessaging.admin`. Không dùng tài khoản Firebase Admin toàn quyền cho việc gửi thông báo.

Tại gốc repo:

- `.env` đã có `FCM_PROJECT_ID=even-metrics-413108` và `FCM_SERVICE_ACCOUNT_FILE=.secrets/firebase-service-account.json`.
- Tệp service account nằm tại `.secrets/firebase-service-account.json`, quyền tệp 0600, được Git bỏ qua.
- Không đưa khóa này vào app, repo Git hoặc gói ZIP mã iOS.

Kiểm tra lại từ gốc repo:

```bash
node scripts/check_firebase_live.cjs
```

Đã đạt: ký JWT → lấy OAuth token từ Google → FCM HTTP v1 xác thực bản tin APNs với `validate_only=true`. Không phát bản tin đến người dùng. Quyền IAM mới cần khoảng hai phút để có hiệu lực trong lần kiểm tra này.

Chưa chuyển khóa/cấu hình lên VPS vì chưa có thông tin truy cập máy chủ. Kiểm tra `https://kontum.humgsoftware.pro.vn/api/mobile/bootstrap` ngày 01/11/2026: API hoạt động, `push.configured=false`; kết nối Socket.IO `/mobile` qua WSS thành công. Backend trên VPS cần các biến môi trường và tệp khóa tương ứng để gửi FCM được.

## Kết quả test thông báo ngày 01/11/2026

- `npm run test:notifications`: **4/4 đạt**, gồm bản tin APNs, OAuth/FCM giả lập và API khi chưa có PostgreSQL.
- `flutter test test/notification_payload_test.dart test/notify_open_test.dart` (trong `mobile/`): **10/10 đạt**, gồm chống trùng, giữ riêng ID thông báo/đối tượng và mở đúng chi tiết khi chạm.
- `flutter test test/server_url_test.dart`: **2/2 đạt**, kiểm tra chuyển localhost đã lưu sang HTTPS và giữ địa chỉ HTTPS đã chọn. Sau cập nhật bố cục điện thoại/iPad, toàn bộ `flutter test`: **53/53 đạt**; xem [LAYOUT.md](LAYOUT.md).
- `flutter analyze --no-pub`: **không có lỗi**.
- `scripts/test_push.cjs`: **25/25 đạt** với backend cục bộ, PostgreSQL 16.4/PostGIS và một xã giả lập trong thư mục tạm. Đã kiểm tra Socket.IO, hủy bản FCM sau ACK, hàng đợi khi ngắt socket, lịch sử/đã đọc, phân quyền người nhận và API tự gửi thông báo thử. Phần gửi FCM dùng HTTP server giả lập; trường hợp đóng app được mô phỏng bằng ngắt socket.
- `node scripts/check_firebase_live.cjs`: **đạt** OAuth và FCM `validate_only` với Firebase thật; không phát thông báo đến thiết bị.

Đã sửa API `/notifications/test` để trả `503 DB_REQUIRED` khi thiếu PostgreSQL, thay vì trả HTTP 200 khiến app báo đã gửi dù chưa tạo thông báo. Test FCM cũng ghi đè rõ project và OAuth URL giả lập để không bị `.env` nạp lại cấu hình Firebase thật.

Môi trường DB/backend thử nghiệm đã được dọn sau khi chạy. Chưa có iPhone thật kết nối trong phiên test này; kết quả trên chưa xác minh nhận push nền/đã đóng qua APNs hoặc TestFlight. Phần khóa APNs bên dưới vẫn cần xác nhận.

## Phần APNs cần xác nhận

[Firebase KonTum → Cloud Messaging](https://console.firebase.google.com/project/even-metrics-413108/settings/cloudmessaging)

Chọn app iOS **MobileGIS Kon Tum iOS Prod** có Bundle ID `vn.gov.kontum.mobilegis`. Kiểm tra APNs authentication key đã có khóa hợp lệ cho môi trường production. Nếu chưa, dùng khóa `.p8` có quyền APNs của Apple Team `F4BF8GHX56`, đúng Key ID, rồi tải lên trong phần Apple app configuration.

Google login không tạo khóa APNs của Apple. Firebase CLI hiện dùng không có lệnh công khai kiểm tra/tải khóa APNs; trạng thái này chưa được xác minh. Không kết luận nhận push đã hoạt động chỉ dựa vào validate-only.

Sau khi khóa APNs sẵn sàng: cài bản ký trên iPhone hoặc TestFlight, bật thông báo trong Cài đặt app, kiểm tra có APNs/FCM token, đưa app về nền rồi gửi từ máy chủ/Firebase Console; chạm thông báo phải mở đúng chi tiết. Simulator không thay thế bước thử APNs production trên TestFlight.

Hướng dẫn App Store, signing và các mục còn thiếu: [APP_STORE.md](APP_STORE.md).
