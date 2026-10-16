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

- **Thông báo:** không dùng Firebase – xem mục 8.
- **Gói bản đồ ngoại tuyến theo khu vực:** hiện app đã lưu dữ liệu công khai đã xem và hàng đợi gửi. Muốn có nền bản đồ ngoại tuyến cần thêm gói tile (ví dụ MBTiles) theo địa bàn được giao.
- **Tên miền HTTPS, Mapbox token** giới hạn URL / bundle id, chính sách quyền riêng tư khi phát hành lên kho ứng dụng.

## 8. Thông báo – Socket.IO + PostgreSQL + push theo nền tảng (không Firebase)

| Lớp | Vai trò | Mã nguồn |
|---|---|---|
| **PostgreSQL** | Nguồn sự thật: `mobile.notifications` (thông báo + đối tượng nhận), `mobile.notification_deliveries` (trạng thái từng thiết bị × kênh, hàng đợi gửi lại có backoff, `SKIP LOCKED`), trigger `pg_notify` cho mọi tiến trình | `db/migrations/006_notifications.sql`, `src/services/notifier.js` |
| **Socket.IO** (namespace `/mobile`) | Ứng dụng đang mở: nhận `notification` tức thời (có ack) và `changed` để làm mới dữ liệu (đồng bộ web ↔ mobile) | `src/services/realtime.js`, `lib/core/realtime.dart` |
| **APNs** (iOS) | Ứng dụng ở nền/đã đóng – máy chủ gửi thẳng tới Apple qua HTTP/2, khoá `.p8` | `src/services/push/apns.js`, `ios/Runner/AppDelegate.swift` |
| **UnifiedPush / Web Push** (Android, trình duyệt) | Ứng dụng ở nền/đã đóng – chuẩn mở, Web Push mã hoá đầu-cuối (RFC 8291) + VAPID; không cần Google Play Services | `src/services/push/webpush.js`, `lib/core/push.dart` |

**Luồng:**

1. Một sự kiện đã được chốt xảy ra. Năm loại sự kiện tạo thông báo:
   - cảnh báo cháy đã phê duyệt;
   - cháy đã xác minh;
   - phản ánh đổi trạng thái;
   - nhiệm vụ mới hoặc bị trả lại;
   - kết quả duyệt xác minh.

   Khi đó `notifier.scan()` tạo bản ghi, có `source_ref` UNIQUE nên dù chạy nhiều tiến trình cũng không trùng.
2. Máy chủ xếp hàng một bản giao qua push nền tảng cho từng thiết bị phù hợp, chờ 4 giây.
3. `pg_notify` báo cho mọi tiến trình. Tiến trình nào giữ kết nối Socket.IO của thiết bị sẽ gửi qua socket. Thiết bị xác nhận (ack) thì bản push đang chờ bị huỷ, nên không báo trùng.
4. Nếu socket không giao được, bộ gửi thử lại tối đa 6 lần với thời gian chờ tăng dần.
   - Mã 410 hoặc `Unregistered`: thiết bị bị đánh dấu ngừng nhận.
   - Chưa cấu hình APNs: bản giao chuyển sang “failed” kèm lý do.

**Quy tắc người nhận:**
- Thông báo riêng: gửi tới đúng người dùng.
- Nhiệm vụ chưa giao: gửi tới cán bộ phụ trách xã đó.
- Cảnh báo công khai: gửi tới thiết bị theo dõi xã đó, hoặc thiết bị theo dõi toàn vùng.
- Không bao giờ phát từ điểm nóng chưa xác minh.

**Đăng xuất:** máy chủ gỡ liên kết thiết bị với người dùng, nên thiết bị chỉ còn nhận cảnh báo công khai.

**Cấu hình triển khai:**
- **Android:** người dùng cài một ứng dụng phân phối UnifiedPush, ví dụ **ntfy** từ Google Play hoặc F-Droid (không cần tài khoản Google). Ứng dụng tự chọn bộ phân phối mặc định; có thể đổi trong *Cài đặt → Thông báo → Chọn ứng dụng phân phối*. Đơn vị có thể tự dựng máy chủ ntfy để dữ liệu không đi qua bên thứ ba. Không có bộ phân phối thì vẫn nhận qua Socket.IO khi mở ứng dụng.
- **iOS:**
  1. Trong Apple Developer, tạo khoá APNs (`.p8`), đặt vào `.secrets/` và khai báo `APNS_KEY_FILE`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` trong `.env` (mẫu: `docs/06_Cau_hinh_mau/.env.example`).
  2. Bật capability *Push Notifications* cho Bundle ID. Tệp `ios/Runner/Runner.entitlements` đã khai báo `aps-environment`.
  3. Bản debug đăng ký môi trường `sandbox`, bản phát hành dùng `production`.
- **Web Push (VAPID):** khoá tự sinh lần đầu (`storage/.vapid.json`) hoặc đặt `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. Không đổi khoá sau khi đã có thiết bị đăng ký, nếu không các thiết bị phải đăng ký lại.

**Kiểm thử:** chạy `node scripts/test_push.cjs` khi máy chủ đang chạy. Bài kiểm thử dùng dịch vụ Web Push giả lập, giải mã nội dung bằng khoá của thuê bao, và dùng máy chủ APNs HTTP/2 giả lập để kiểm tra chữ ký JWT ES256.

Trong ứng dụng: *Cài đặt → Thông báo → Gửi thông báo thử*.

**Theo dõi:** *Quản trị → Cài đặt hệ thống → Thông báo MobileGIS* hiển thị số kết nối, số thiết bị theo kênh và trạng thái giao 7 ngày.
