# Firebase KonTum đã cấu hình

Cập nhật 01/11/2026.

- Google đã đăng nhập lại thành công: `longcanh2k3@gmail.com` (phiên CLI cũ đã thu hồi).
- Dự án hiện có: **KonTum** — `even-metrics-413108`, sender/project number `315105906364`.
- iOS production: `1:315105906364:ios:d44716f1cb166a35c10ab9`, Bundle ID `vn.gov.kontum.mobilegis`.
- Android theo package hiện tại: `vn.gov.kontum.kontum_mobilegis`, app `1:315105906364:android:4d942c85ba243dfdc10ab9`.

## Ứng dụng

Cấu hình Firebase công khai được lưu ở `lib/app/firebase_options.dart`, dùng mặc định khi build/chạy. Không cần nhớ thêm dart-define để bật Firebase. `FirebaseConfig` vẫn hỗ trợ ghi đè đủ cấu hình cho môi trường khác; override thiếu trường không tự trộn với production.

`ios/Runner/GoogleService-Info.plist` đã thêm vào Runner Resources và có trong archive. Đã tải `android/app/google-services.json` khớp package hiện tại; phiên này tập trung kiểm tra build iOS, chưa xác minh build/phân phối Android.

Trên máy có `firebase.json` chứa các dart-define Firebase và `release.json` đã điền Firebase thật. Các URL API/quyền riêng tư/xóa tài khoản trong `release.json` vẫn cần tên miền production. Không dùng `firebase init` ghi đè `mobile/firebase.json`: đó là tệp dart-define của app, không phải cấu hình hosting.

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

Chưa chuyển khóa/cấu hình lên VPS vì chưa có thông tin máy chủ production. Backend trên VPS cần các biến môi trường và tệp khóa tương ứng để gửi được.

## Phần APNs cần xác nhận

[Firebase KonTum → Cloud Messaging](https://console.firebase.google.com/project/even-metrics-413108/settings/cloudmessaging)

Chọn app iOS **MobileGIS Kon Tum iOS Prod** có Bundle ID `vn.gov.kontum.mobilegis`. Kiểm tra APNs authentication key đã có khóa hợp lệ cho môi trường production. Nếu chưa, dùng khóa `.p8` có quyền APNs của Apple Team `F4BF8GHX56`, đúng Key ID, rồi tải lên trong phần Apple app configuration.

Google login không tạo khóa APNs của Apple. Firebase CLI hiện dùng không có lệnh công khai kiểm tra/tải khóa APNs; trạng thái này chưa được xác minh. Không kết luận nhận push đã hoạt động chỉ dựa vào validate-only.

Sau khi khóa APNs sẵn sàng: cài bản ký trên iPhone hoặc TestFlight, bật thông báo trong Cài đặt app, kiểm tra có APNs/FCM token, đưa app về nền rồi gửi từ máy chủ/Firebase Console; chạm thông báo phải mở đúng chi tiết. Simulator không thay thế bước thử APNs production trên TestFlight.

Hướng dẫn App Store, signing và các mục còn thiếu: [APP_STORE.md](APP_STORE.md).
