# Phát hành MobileGIS Kon Tum lên App Store

Ngày kiểm tra: 01/11/2026. Nguồn: `ngocttd/rung_kontum`, commit `f477afb`, nhánh sửa `fix/ios-app-store-readiness`.
Mã app chính ở `mobile/`. Bản cũ `../kontum-mobile` được giữ nguyên. Đã lấy Bundle ID, Apple Team và mức Dart SDK tương thích từ bản cũ; giữ các thay đổi giao diện và nghiệp vụ mới trên GitHub.

## Tình trạng hiện tại

**Chưa phải bản sẵn sàng upload.** Đã cấu hình Firebase thật cho app và backend, cloud FCM HTTP v1 validate-only đã đạt, build/archive không ký thành công. Chưa thử nhận qua APNs trên iPhone/TestFlight và chưa xuất IPA ký phân phối. Xem [FIREBASE_SETUP.md](FIREBASE_SETUP.md).

| Hạng mục | Kết quả |
| --- | --- |
| Flutter | 3.47.1, Dart 3.13.1 trên máy; `.fvmrc` của dự án vẫn pin 3.47.5 |
| Xcode/SDK | Xcode 27.1, iOS SDK 27.1 |
| App | MobileGIS Kon Tum, `1.0.0+10`, iOS tối thiểu 15.0 |
| Bundle ID/Team | `vn.gov.kontum.mobilegis` / `F4BF8GHX56`, khớp cấu hình iOS có sẵn trên máy |
| Phân tích mã | `flutter analyze`: không có lỗi/cảnh báo |
| Flutter test | 19 bài đạt, gồm mở thông báo, tách ID và chống trùng, safe area |
| Chạy app iOS | Đã cài và mở trên iPhone 18 Pro Max Simulator; màn hình đăng nhập hiện bình thường, thiếu backend được báo trong giao diện, không crash. Chưa xác minh đăng nhập/nghiệp vụ với máy chủ thật |
| Firebase thật | Project `even-metrics-413108`, iOS `vn.gov.kontum.mobilegis`; service account gửi FCM đã cấu hình, OAuth và FCM validate-only đã đạt |
| FCM unit test | 2 bài đạt; HTTP v1/OAuth chạy với máy chủ giả lập cục bộ, không gửi đến Firebase thật |
| Cấu hình phát hành | Đã thử 9 trường hợp kiểm tra với dữ liệu tổng hợp; file mẫu bị từ chối đúng vì chưa điền giá trị thật |
| Privacy manifest | Manifest app và 25 manifest của SDK/plugin có trong archive |
| Icon/launch | Bộ icon đúng kích thước, không alpha; archive không còn cảnh báo placeholder |
| GPS | Đã kiểm tra binary archive không còn selector `requestAlwaysAuthorization`; cờ native biên dịch bằng 1 |
| Chứng chỉ/profile | Có profile Kon Tum development/production; Keychain chỉ thấy identity **Apple Development**, chưa có identity **Apple Distribution** hợp lệ |

## Những gì đã sửa

- Đồng bộ Bundle ID giữa Runner, Firebase và tài liệu; giữ Apple Team đang dùng trên máy.
- Debug dùng `Runner.entitlements` (`aps-environment=development`); Release/Profile dùng `RunnerRelease.entitlements` (`production`). Bật Push Notifications, Background fetch và Remote notifications; giữ Firebase swizzling.
- Chờ APNs token; không gọi FCM `getToken()` nếu APNs chưa sẵn sàng. Lỗi thông báo không chặn toàn bộ app.
- Listener nhận FCM không phụ thuộc API đăng ký thiết bị thành công. Token làm mới gửi bằng API có phiên đăng nhập hiện tại, có xử lý lỗi.
- Chống trùng bằng ID thông báo thay vì bỏ qua FCM khi socket đang kết nối. Ngắt socket khi app ở nền; chỉ ACK sau khi đã xử lý thông báo ở foreground.
- Tách `notification_id` khỏi ID nhiệm vụ/điểm cháy: mở đúng chi tiết và đánh dấu đúng thông báo đã đọc.
- Lưu lựa chọn tắt push qua lần mở app tiếp theo; backend thực sự đặt `push_enabled=false` khi gỡ đăng ký.
- Payload APNs có `apns-push-type=alert`, priority 10, collapse ID tối đa 64 byte; bỏ time-sensitive khi chưa khai báo capability. Chỉ vô hiệu hóa token khi có lỗi token thật, không xóa token vì dự án trả 404 chung.
- Tắt đăng nhập demo mặc định trong release; bộ build kiểm tra bắt buộc API HTTPS và cấu hình Firebase/quyền riêng tư.
- Bỏ kênh alpha khỏi các icon iOS, dùng logo của app cho launch screen; thêm vị trí neo và xử lý lỗi chia sẻ trên iPad.
- Dùng bản local `packages/geolocator_apple` 2.3.15, chỉ cố định cờ SPM `BYPASS_PERMISSION_LOCATION_ALWAYS=1`. Biến môi trường đơn thuần không có tác dụng trong bản archive thử đầu tiên do Xcode/SPM vẫn biên dịch với giá trị 0; bản local bảo đảm build bằng CLI và Xcode nhất quán.
- Thêm chỗ mở chính sách riêng tư và trang xóa tài khoản khi có URL thật trong cấu hình.

Hai file backend **phải triển khai cùng**: `src/services/field.js` và `src/services/push/fcm.js`. Không cần thay đổi schema DB cho các sửa này.

## Những mục phải hoàn tất trước khi gửi Apple

1. **API thật:** cung cấp tên miền HTTPS, chứng chỉ TLS hợp lệ, backend đang chạy và đủ dữ liệu. Bản build kiểm tra hiện chưa có API thật; không dùng localhost để upload.
2. **Firebase thật — đã cấu hình:** app iOS production có đúng Bundle ID trên. Có cấu hình mặc định trong `lib/app/firebase_options.dart`, native `GoogleService-Info.plist`, cùng `firebase.json`/`release.json` trên máy. Có thể ghi đè đầy đủ bằng dart-define cho môi trường khác.
3. **APNs trên Firebase:** tải khóa APNs `.p8` lên Firebase → Project settings → Cloud Messaging → Apple app configuration; điền Key ID/Team ID, bảo đảm khóa cho phép môi trường production và đúng topic/bundle. Không đóng gói `.p8` trong app.
4. **Máy chủ gửi FCM — đã cấu hình tại máy này:** `.env` và `.secrets/firebase-service-account.json` dùng tài khoản `kontum-fcm-sender` có role FCM. API đã bật và Google đã chấp nhận bản tin validate-only. Khi triển khai VPS cần chuyển tệp bí mật an toàn và cấu hình tương ứng; không đóng gói khóa vào app/ZIP. Chưa triển khai lên máy chủ production.
5. **Signing phân phối:** cấu hình Apple Distribution trong Xcode → Settings → Accounts → Manage Certificates cho Team trên. Có profile production thôi chưa đủ nếu thiếu certificate/private key ký tương ứng.
6. **Quyền riêng tư và xóa tài khoản:** backend hiện chưa có luồng xóa tài khoản. `ACCOUNT_DELETION_URL` phải trỏ thẳng đến trang HTTPS cho phép người dùng thực sự yêu cầu/thực hiện xóa, có xác thực và xác nhận, xử lý tài khoản/dữ liệu liên quan. Chỉ đặt URL hoặc tạo trang hướng dẫn liên hệ hỗ trợ là chưa hoàn tất. `PRIVACY_POLICY_URL` phải là chính sách đã công bố, mô tả dữ liệu, Firebase/bản đồ, lưu giữ và xóa. Không có trang hoạt động thì chưa nộp review.
7. **App Store Connect:** tạo đúng app/bundle, chọn build number lớn hơn mọi build đã tải trước đó (10 chỉ là giá trị chuẩn bị), khai báo App Privacy, age rating, URL hỗ trợ/quyền riêng tư, ảnh chụp iPhone/iPad và cung cấp tài khoản review thực có dữ liệu. Không bật đăng nhập nhanh theo vai trò cho bản public.

Privacy manifest hiện kê dữ liệu app thực tế có thể gửi: tên, email, điện thoại, vị trí chính xác, tài khoản, ID thiết bị ngẫu nhiên/FCM, ảnh/video và nội dung phản ánh. Mục đích là chức năng ứng dụng; không quảng cáo/theo dõi. Cần đối chiếu với vận hành backend thực và Privacy Report trong Organizer; manifest không tự điền App Privacy trên App Store Connect.

## Cấu hình và build

Từ thư mục `mobile`:

```bash
# release.json trên máy đã có Firebase thật.
# Điền API_BASE_URL, PRIVACY_POLICY_URL, ACCOUNT_DELETION_URL chính thức.
python3 scripts/check_ios_release.py release.json
bash scripts/build_ios.sh release.json 10
```

Script kiểm tra cấu hình, chạy analyze/test rồi archive/export, không tự upload. File IPA ở `build/ios/ipa/`; archive ở `build/ios/archive/Runner.xcarchive`. Export dùng `ios/ExportOptions.plist` với Team hiện tại. Nếu thay Apple Team/Bundle ID, phải sửa đồng thời Xcode, ExportOptions, Firebase và App Store Connect.

Kiểm tra cấu hình chỉ kiểm tra cú pháp và tính nhất quán, không xác thực quyền Apple/Firebase hoặc nội dung website. Phải mở thử các URL và kiểm tra thiết bị thật.

Nếu chỉ muốn kiểm tra khả năng biên dịch khi chưa có chứng chỉ:

```bash
flutter build ipa --release --no-codesign --dart-define=DEMO_LOGIN=false
```

Lệnh này chỉ tạo archive không ký để kiểm tra, không tạo IPA có thể upload. Archive kiểm tra đã có Firebase production; API backend và các URL phát hành chưa được cung cấp. Bản geolocator local đã cố định cờ quyền vị trí cho cả Xcode và CLI; cần giữ thư mục `packages/` khi bàn giao.

## Kiểm thử push bắt buộc trên iPhone thật / TestFlight

| Tình huống | Điều cần xác nhận |
| --- | --- |
| Cài mới, chưa cấp quyền | App dùng bình thường; Cá nhân → Cài đặt → Bật / đăng ký lại mới xin quyền |
| Từ chối quyền | App không crash; bật lại trong Cài đặt iOS rồi quay lại app đăng ký được |
| App đang mở, socket nối | Gửi thông báo thử, hiển thị một lần, lịch sử xuất hiện |
| App đang mở, socket mất | FCM vẫn hiện một lần; không bỏ qua vì trạng thái socket cũ |
| App ở nền / không chạy | Bản notification + data hiện qua APNs; chạm mở đúng chi tiết |
| Cold start từ thông báo | Đăng nhập khi cần, sau đó mở đúng nhiệm vụ/điểm cháy/hồ sơ |
| Tắt push rồi mở lại | Push vẫn tắt, bản đăng ký thiết bị gửi provider `none` |
| Đăng xuất / đổi tài khoản | Thiết bị không nhận thông báo riêng của tài khoản cũ |
| Token thay đổi, mất mạng | Đăng ký lại được, không có exception chưa xử lý |
| TestFlight | Gửi qua APNs production thành công, không chỉ bản chạy development |

Nút “Gửi thông báo thử” ưu tiên socket nếu app còn mở; nó không tự chứng minh APNs đã hoạt động. Để thử nền, cần gửi từ backend hoặc Firebase Console đến FCM token thật sau khi đưa app về nền. iOS có thể hạn chế background/data-only sau khi người dùng force-quit; bài kiểm tra phải phân biệt notification hiển thị với xử lý Dart nền. App hiện dùng notification + data, không cung cấp Critical Alerts.

Kiểm tra backend độc lập DB:

```bash
npm ci --ignore-scripts
node --test scripts/test_fcm_unit.cjs
```

Bài `npm run test:push` tích hợp DB/backend chưa chạy trong phiên này: cần PostgreSQL/PostGIS và máy chủ được cấu hình. Không chạy bộ tích hợp lên dữ liệu production vì nó tạo dữ liệu kiểm thử.

## Nguồn đối chiếu

- [Yêu cầu SDK App Store hiện hành](https://developer.apple.com/news/upcoming-requirements/?id=04282026a): từ 28/04/2026 dùng Xcode 26 / iOS SDK 26 trở lên.
- [Firebase Cloud Messaging cho Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/get-started): APNs key, capabilities, swizzling và chờ APNs token.
- [Apple: xóa tài khoản](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/).
- [Apple App Review Guidelines, mục 5.1.1](https://developer.apple.com/app-store/review/guidelines/): chính sách riêng tư và quản lý dữ liệu.
- [Apple: các loại dữ liệu trong privacy manifest](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype).
