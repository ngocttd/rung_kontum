# MobileGIS Kon Tum (Flutter)

Ứng dụng di động của hệ thống giám sát tài nguyên rừng và cảnh báo cháy rừng khu vực Kon Tum. Ứng dụng xây dựng theo *Đặc tả MobileGIS v1.0* và bộ prototype 14 màn hình trong `docs/05_Prototype_MobileGIS`. Một mã nguồn chạy được trên Android, iOS và web (bản xem thử).

Ứng dụng chỉ hiển thị sản phẩm đã công bố, gửi dữ liệu hiện trường và nhận thông báo. Mọi xử lý chuyên môn (Python, GEE) và mọi khoá bí mật đều nằm ở backend Node.js trong thư mục gốc dự án. Không đưa mật khẩu DB, khoá GEE hay khoá thời tiết vào ứng dụng.

**Hướng dẫn sử dụng cho người dùng cuối:** trang `/huong-dan/mobile` trên web, nội dung ở `src/content/guide.js` (mobileGuide), ảnh ở `public/guide/mobile/`. Trong ứng dụng mở được từ *Cá nhân → Hướng dẫn sử dụng*.

## 1. Yêu cầu môi trường

| Thành phần | Phiên bản đã kiểm thử |
|---|---|
| Flutter | **3.47.5** (stable, Dart 3.13.4) – ghi trong `.fvmrc` |
| Android | SDK 36, JDK 17, minSdk theo Flutter (24) |
| iOS | Xcode 16 trở lên, iOS 13 trở lên (build trên macOS) |
| Backend | Thư mục gốc dự án (`npm start`), PostgreSQL/PostGIS |

> Nên đặt Flutter SDK và thư mục build ở đường dẫn **không có dấu cách và ngoài OneDrive** (ví dụ `C:\dev\`). Gradle/NDK có thể lỗi với đường dẫn có dấu cách. OneDrive đồng bộ thư mục `build/` làm chậm máy.

```bash
fvm use 3.47.5        # nếu dùng FVM; hoặc cài đúng bản Flutter trên
flutter pub get
flutter analyze       # phải "No issues found"
flutter test          # kiểm thử đơn vị
```

## 2. Chạy thử

1. Chạy backend ở thư mục gốc: `npm start`, mặc định cổng 3000. Ở môi trường phát triển, máy chủ tự bật đăng nhập nhanh (`MOBILE_DEMO_LOGIN`).
2. Chạy ứng dụng:

```bash
# Android emulator (tự trỏ tới http://10.0.2.2:3000)
flutter run

# Điện thoại thật cùng mạng LAN với máy chạy backend
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:3000

# Bản web xem thử, do backend phục vụ tại http://localhost:3000/mobile-app/
flutter build web --base-href /mobile-app/
```

Địa chỉ máy chủ còn đổi được ngay trong ứng dụng: biểu tượng máy chủ ở màn đăng nhập, hoặc *Cá nhân → Cài đặt → Địa chỉ máy chủ*.

### Đăng nhập nhanh theo vai trò (môi trường thử nghiệm)

Khối **“Đăng nhập nhanh theo vai trò”** có ở ba nơi: màn đăng nhập, nút đổi vai trò trên Trang chủ và *Cá nhân → Đăng nhập nhanh / đổi vai trò*. Nhờ vậy có thể chuyển vai trò ở bất cứ đâu, không phải quay về màn đăng nhập.

| Vai trò | Tài khoản demo | Dùng để thử |
|---|---|---|
| Khách | không đăng nhập | xem công khai, gửi phản ánh ẩn danh |
| Người dân | `demo.nguoidan` | gửi và theo dõi phản ánh của mình |
| Cán bộ kiểm lâm | `demo.canbo` | nhiệm vụ, khảo sát, xác minh trên toàn vùng |
| Cán bộ địa bàn xã | `demo.canbo.xa` | phân quyền theo địa bàn (TC05) |
| Lãnh đạo | `demo.lanhdao` | giao nhiệm vụ, duyệt kết quả xác minh |
| Quản trị | `demo.quantri` | quản trị hệ thống, không xác minh nghiệp vụ |

Tài khoản demo do máy chủ tạo, không có mật khẩu dùng được. Khối này **chỉ hiện khi cả hai điều kiện đều đúng**:

- máy chủ bật `MOBILE_DEMO_LOGIN`: mặc định bật khi `NODE_ENV` khác `production`; khi `NODE_ENV=production` phải đặt `MOBILE_DEMO_LOGIN=true` mới bật;
- ứng dụng build với `DEMO_LOGIN=true` (mặc định).

**Bản phát hành chính thức:** build với `--dart-define=DEMO_LOGIN=false` và giữ máy chủ production không bật cờ này.

## 3. Build phát hành

**Nhanh nhất** – build APK trỏ tới máy chủ đã triển khai:

```bat
build-apk.bat https://webgis.kontum.gov.vn
:: hoặc PowerShell, thêm gói .aab cho Google Play:
.uild-apk.ps1 -ApiUrl https://webgis.kontum.gov.vn -Aab
```

Kết quả nằm trong `release\WebGISKonTum-<phiên bản>.apk` (và `.aab`).
Script tự chạy `flutter pub get`, build bản release và tắt đăng nhập nhanh.
Muốn ký bằng khoá phát hành, làm các bước bên dưới.


### Android

1. Tạo khoá ký một lần. Lưu khoá ở nơi an toàn và **không commit**:

```bash
keytool -genkey -v -keystore C:\keys\mobilegis-kontum.jks -keyalg RSA -keysize 2048 -validity 10000 -alias mobilegis
```

2. Tạo tệp `android/key.properties` (đã gitignore):

```properties
storePassword=...
keyPassword=...
keyAlias=mobilegis
storeFile=C:/keys/mobilegis-kontum.jks
```

3. Build:

```bash
flutter build appbundle --release --dart-define=API_BASE_URL=https://<ten-mien> --dart-define=DEMO_LOGIN=false   # Google Play
flutter build apk --release --split-per-abi --dart-define=API_BASE_URL=https://<ten-mien> --dart-define=DEMO_LOGIN=false  # cài trực tiếp
```

Nếu chưa có `key.properties`, bản release tạm ký bằng khoá debug để chạy thử.

Mã ứng dụng là `vn.gov.kontum.kontum_mobilegis`. Muốn đổi thì sửa `applicationId` trong `android/app/build.gradle.kts`.

**HTTP và HTTPS:** bản release chỉ cho HTTPS (`android/app/src/main/res/xml/network_security_config.xml`). Bản debug và profile cho phép HTTP để thử trong mạng LAN.

### iOS (trên macOS)

```bash
cd ios && pod install && cd ..
flutter build ipa --release --dart-define=API_BASE_URL=https://<ten-mien> --dart-define=DEMO_LOGIN=false
```

Đặt Team, Bundle ID và chứng chỉ trong Xcode (`ios/Runner.xcworkspace`). Lời xin quyền vị trí, camera, thư viện ảnh và micro đã có tiếng Việt trong `ios/Runner/Info.plist`.

### Đổi biểu trưng / icon

Đặt logo mới (ảnh PNG nền trắng, có biểu tượng tròn và chữ bên dưới) rồi chạy ở thư mục gốc:

```bash
node scripts/build_brand_icons.cjs duong/dan/logo.png
```

Lệnh này sinh lại cùng lúc logo và icon cho web, Android, iOS và bản web của app.

## 4. Kiến trúc mã nguồn

```
lib/
  main.dart                 khởi tạo, ProviderScope, theme, cỡ chữ/tương phản
  app/  config.dart          API_BASE_URL, DEMO_LOGIN (--dart-define)
        theme.dart           màu, thang cấp nguy cơ cháy I–V
        router.dart          go_router: 5 tab (Trang chủ, Bản đồ, Cảnh báo, Nhiệm vụ/Tin tức, Cá nhân) + màn hình con
  core/ api.dart             Dio, Bearer token, tự refresh token (xoay vòng), lỗi thống nhất {error, code}
        session.dart         đăng nhập/đăng ký/demo/khách/đăng xuất, bootstrap (quyền, danh mục, cấu hình bản đồ)
        data.dart            provider dữ liệu + cache ngoại tuyến (khoá pub:/cache:), tiện ích GeoJSON
        outbox.dart          hàng đợi ngoại tuyến: tệp đính kèm, client_uuid, /sync/batch, xung đột
        location.dart        GPS kèm độ chính xác, nguồn vị trí (gps/map/manual)
        platform/files*.dart lưu tệp đính kèm bền vững (mobile) / bộ nhớ (web)
  widgets/                  thành phần dùng chung: AsyncView, thẻ, chip trạng thái, biểu đồ, chọn vị trí, chọn ảnh/video
  features/                 mỗi màn hình theo mã đặc tả (M01–M17)
```

Thư viện chính và lý do chọn:

- **flutter_riverpod 3:** quản lý trạng thái và dữ liệu.
- **go_router:** điều hướng.
- **dio:** gọi HTTP.
- **flutter_map:** bản đồ. Tương thích tile Mapbox/XYZ, không cần khoá tải SDK riêng.
- **geolocator:** GPS.
- **image_picker:** chụp ảnh và quay video.
- **flutter_secure_storage:** lưu refresh token trong Keychain/Keystore.
- **shared_preferences:** cache và hàng đợi.
- **connectivity_plus:** theo dõi trạng thái mạng.
- **fl_chart:** biểu đồ.

## 5. Bảng màn hình ↔ đặc tả

| Mã | Màn hình | Tệp |
|---|---|---|
| M01 | Khởi động | `features/auth/splash_page.dart` |
| M02 | Đăng nhập / đăng ký (+ đăng nhập nhanh) | `features/auth/login_page.dart`, `widgets/common.dart` (QuickLoginPanel) |
| M03 | Trang chủ | `features/home/home_page.dart` |
| M04 | Bản đồ (lớp, nền, GPS, tìm kiếm, đo đạc, lọc thời gian) | `features/map/map_page.dart` |
| M05 | Chi tiết đối tượng | `features/map/object_page.dart` |
| M06 | Tài nguyên rừng (rừng khộp là lớp riêng) | `features/forest/forest_page.dart` |
| M07 | Cảnh báo cháy rừng | `features/fire/fire_page.dart` |
| M08 | Ảnh vệ tinh | `features/imagery/imagery_page.dart` |
| M09/M10 | Tin tức / chi tiết | `features/news/news_page.dart` |
| M11 | Phản ánh (nháp tự lưu, gửi ngoại tuyến) | `features/reports/*.dart` |
| M12 | Thời tiết, khí hậu | `features/weather/weather_page.dart` |
| M13 | Tài liệu – bản đồ PDF | `features/documents/documents_page.dart` |
| M14 | Cá nhân / cài đặt / thông báo | `features/profile/*.dart` |
| M15 | Nhiệm vụ hiện trường | `features/field/tasks_page.dart`, `task_detail_page.dart` |
| M16 | Khảo sát / xác minh | `features/field/survey_page.dart`, `verification_page.dart`, `review_page.dart` |
| M17 | Đồng bộ ngoại tuyến | `features/profile/sync_page.dart`, `core/outbox.dart` |

## 6. API backend

Endpoint ở `/api/mobile/*`, mã nguồn tại `src/routes/mobile.js`. Phần nghiệp vụ nằm ở `src/services/field.js` và `src/services/mobile-auth.js`; bảng dữ liệu ở `db/migrations/004_mobile.sql`.

| Nhóm | Endpoint |
|---|---|
| Xác thực | `POST auth/login`, `auth/register`, `auth/refresh`, `auth/logout`, `auth/demo`, `auth/password`, `auth/forgot`, `GET me` |
| Cấu hình | `GET bootstrap` |
| Tra cứu | `GET layers?bbox=&zoom=`, `home`, `forest/summary`, `forest/change`, `fire/hotspots`, `fire/alerts`, `fire/danger`, `fire/history`, `imagery/products`, `weather`, `weather/:code`, `news`, `news/:slug`, `documents` |
| Phản ánh | `POST uploads/presign`, `PUT uploads/:token`, `POST reports`, `GET reports/mine`, `reports/:code`, `files/:key` |
| Hiện trường | `GET/POST assignments`, `POST assignments/:id/accept`, `assignments/:id/start`, `GET/POST/PATCH surveys`, `POST surveys/:id/review`, `GET/POST verifications`, `POST verifications/:id/review` |
| Đồng bộ | `POST sync/batch`, `GET sync/changes?since=`, `GET sync/conflicts`, `POST sync/conflicts/:id/resolve` |
| Thông báo | `POST devices`, `GET notifications`, `POST notifications/read` |

Kiểm thử API theo TC01–TC12 và đồng bộ web ↔ mobile: `node scripts/test_mobile_api.cjs` (chạy ở thư mục gốc).

**Đồng bộ dữ liệu web ↔ mobile:** web và app dùng chung một cơ sở dữ liệu PostGIS.

- Từ web sang app: phân công cán bộ trên web (Cảnh báo → điểm nóng, Phản ánh → phân công) sẽ tạo nhiệm vụ trong app.
- Từ app sang web: kết quả xác minh và khảo sát từ app hiện ở *Quản trị → Nhiệm vụ hiện trường*; phản ánh từ app hiện ở *Quản trị → Phản ánh*.
- Nhiều tiến trình máy chủ: thay đổi được phát qua PostgreSQL `NOTIFY` (migration 005) nên các tiến trình đều thấy ngay.

## 7. Việc còn lại khi triển khai

- **Thông báo đẩy:** Firebase Cloud Messaging – cấu hình theo mục 8.1 (`firebase.json` cho bản build, service account trên máy chủ).
- **Gói bản đồ ngoại tuyến theo khu vực:** hiện app đã lưu dữ liệu công khai đã xem và hàng đợi gửi. Muốn có nền bản đồ ngoại tuyến cần thêm gói tile (ví dụ MBTiles) theo địa bàn được giao.
- **Tên miền HTTPS, Mapbox token** giới hạn URL / bundle id, chính sách quyền riêng tư khi phát hành lên kho ứng dụng.

## 8. Thông báo – PostgreSQL + Socket.IO + Firebase Cloud Messaging

| Lớp | Vai trò | Mã nguồn |
|---|---|---|
| **PostgreSQL** | Nguồn sự thật: `mobile.notifications` (thông báo + đối tượng nhận), `mobile.notification_deliveries` (trạng thái từng thiết bị × kênh, hàng đợi gửi lại có backoff, `SKIP LOCKED`), trigger `pg_notify` cho mọi tiến trình | `db/migrations/006_notifications.sql`, `008_fcm_push.sql`, `src/services/notifier.js` |
| **Socket.IO** (namespace `/mobile`) | Ứng dụng đang mở: nhận `notification` tức thời (có ack) và `changed` để làm mới dữ liệu (đồng bộ web ↔ mobile) | `src/services/realtime.js`, `lib/core/realtime.dart` |
| **Firebase Cloud Messaging** (Android + iOS) | Ứng dụng ở nền/đã đóng – máy chủ gọi FCM HTTP v1 bằng service account (JWT RS256 → OAuth2); iOS do Firebase chuyển tiếp qua APNs | `src/services/push/fcm.js`, `lib/core/push.dart`, `lib/app/firebase_config.dart` |

**Luồng:**

1. Một sự kiện đã chốt xảy ra → `notifier.scan()` tạo bản ghi (`source_ref` UNIQUE nên nhiều tiến trình không tạo trùng). Các loại:
   - cảnh báo nguy cơ cháy đã phê duyệt, cháy rừng đã xác minh (gồm điểm cháy nhập tay “Xác nhận cháy”) → người dân / thiết bị theo dõi xã;
   - hồ sơ phản ánh đổi trạng thái → người gửi;
   - phản ánh mới, tin báo cháy nhập tay chờ xác minh → cán bộ phụ trách xã (+ lãnh đạo với phản ánh);
   - nhiệm vụ mới / bị trả lại, kết quả duyệt xác minh → cán bộ liên quan.
2. Máy chủ xếp một bản giao FCM cho từng thiết bị phù hợp, chờ 4 giây.
3. `pg_notify` báo cho mọi tiến trình; tiến trình giữ kết nối Socket.IO của thiết bị giao qua socket. Thiết bị ack → bản FCM đang chờ bị huỷ (không báo trùng).
4. Socket không giao được → gửi FCM, thử lại tối đa 6 lần (thời gian chờ tăng dần) với lỗi tạm thời (429, 5xx). `UNREGISTERED`/404 → thiết bị bị đánh dấu ngừng nhận. FCM chưa cấu hình → bản giao “failed” kèm lý do, không thử lại.

**Quy tắc người nhận:** thông báo riêng → đúng người dùng; theo vai trò → cán bộ có địa bàn khớp (hoặc toàn vùng); công khai → thiết bị theo dõi xã đó hoặc toàn vùng. Không bao giờ phát từ điểm nóng/tin báo chưa xác minh. **Đăng xuất:** máy chủ gỡ liên kết thiết bị khỏi người dùng (chỉ còn nhận cảnh báo công khai).

### 8.1. Cấu hình Firebase (làm một lần)

1. Tạo dự án trên <https://console.firebase.google.com> (không cần Google Analytics).
2. Thêm ứng dụng:
   - **Android** – package name `vn.gov.kontum.kontum_mobilegis` (SHA-1 không bắt buộc cho FCM);
   - **iOS** – bundle ID `vn.gov.kontum.kontumMobilegis`.
   Không cần tải `google-services.json` / `GoogleService-Info.plist`: ứng dụng khởi tạo Firebase bằng cấu hình truyền lúc build.
3. **iOS:** Apple Developer → Keys → tạo khoá APNs (`.p8`) → Firebase *Project settings → Cloud Messaging → Apple app configuration* → tải khoá lên (Key ID, Team ID). Bundle ID phải bật capability Push Notifications (`ios/Runner/Runner.entitlements`; bản phát hành đổi `aps-environment` thành `production`). `Info.plist` đã khai báo Background Modes → `remote-notification`.
4. **Cấu hình ứng dụng:** chép `firebase.example.json` thành `firebase.json` (đã nằm trong `.gitignore`) và điền từ *Project settings → General → Your apps*:

   | Khoá | Lấy ở |
   |---|---|
   | `FIREBASE_PROJECT_ID` | Project ID |
   | `FIREBASE_SENDER_ID` | Project number / Sender ID |
   | `FIREBASE_ANDROID_API_KEY`, `FIREBASE_ANDROID_APP_ID` | ứng dụng Android: Web API key, App ID `1:…:android:…` |
   | `FIREBASE_IOS_API_KEY`, `FIREBASE_IOS_APP_ID` | ứng dụng iOS: API key, App ID `1:…:ios:…` |

   Đây là định danh công khai của ứng dụng (không phải khoá bí mật). Build: `build-apk.bat https://<máy-chủ>` tự dùng `firebase.json`; chạy thử: `flutter run --dart-define-from-file=firebase.json`. Thiếu tệp → ứng dụng vẫn chạy, chỉ nhận thông báo khi đang mở (Cài đặt → Thông báo hiển thị cảnh báo).
5. **Máy chủ:** *Project settings → Service accounts → Generate new private key* → đặt tệp vào `.secrets\firebase-service-account.json` trên VPS (KHÔNG commit, không gửi qua chat), thêm vào `.env`:

   ```
   FCM_SERVICE_ACCOUNT_FILE=.secrets/firebase-service-account.json
   # FCM_PROJECT_ID=...   (tuỳ chọn – mặc định lấy project_id trong tệp khoá)
   ```

   Khởi động lại dịch vụ. *Quản trị → Cài đặt hệ thống → Thông báo MobileGIS* hiển thị “Đã cấu hình · dự án …”.

**Lưu ý nâng cấp:** firebase_messaging 17 đánh dấu `getToken`/`onTokenRefresh` là deprecated (chuyển sang `register()`/`onRegistered` theo Firebase Installation ID). Ứng dụng vẫn dùng registration token vì máy chủ gửi tới `message.token` của FCM HTTP v1; khi chuyển cần đổi đồng thời `lib/core/push.dart` và `src/services/push/fcm.js`.

**Kiểm thử:** `node scripts/test_push.cjs` (máy chủ đang chạy): Socket.IO + ack huỷ bản FCM trùng, hàng đợi FCM khi ứng dụng đóng, và FCM HTTP v1 với máy chủ Google OAuth/FCM giả lập (kiểm chữ ký JWT RS256, nội dung message, UNREGISTERED, 503). Trên điện thoại: *Cài đặt → Thông báo → Gửi thông báo thử* (đóng ứng dụng trong vài giây để thấy bản tin FCM).

**Theo dõi:** *Quản trị → Cài đặt hệ thống → Thông báo MobileGIS*: số kết nối Socket.IO, trạng thái FCM, số thiết bị theo kênh, trạng thái giao 7 ngày.
