# WebGIS giám sát tài nguyên rừng Kon Tum

Website công khai (P01–P11) và phân hệ quản trị (A01–A10) theo prototype trong `docs/`. Có dự báo, cảnh báo cháy rừng và mất rừng. Kiến trúc theo phụ lục v1.1: Node.js + Express + EJS, Mapbox GL JS, xử lý dữ liệu bằng Python.

## Chạy

```bash
npm install
npm start                      # http://localhost:3000
npm run create-user -- quantri admin "Họ tên"   # in mật khẩu tạm một lần
npm run check                  # kiểm thử end-to-end (dùng thư mục tạm)
```

Cấu hình trong `.env`: `MAPBOX_TOKEN` (token công khai, giới hạn URL), `OPENWEATHER_KEY` (chỉ máy chủ dùng). Biến tuỳ chọn:

- `PORT`
- `WEATHER_REFRESH_MINUTES` (mặc định 30)
- `ENABLE_DATA_JOBS=false`: tắt lịch chạy tự động các luồng phân tích (mặc định bật, chu kỳ chỉnh ở `/quan-tri/phan-tich`)
- `SHOW_DRAFT_CONTENT=false`: ẩn bài nháp
- `SESSION_SECRET`, `STORAGE_DIR`, `SESSION_DIR`

## Trang

| Mã | Đường dẫn | Nội dung |
|---|---|---|
| P01 | `/` | Trang chủ, bản đồ tổng quan, KPI, cảnh báo, tin, tài liệu |
| P02 | `/ban-do` | WebGIS: cây lớp, đo đạc, toạ độ, 3D, xuất/chia sẻ/in |
| P03 | `/tai-nguyen-rung` | Hiện trạng 2025, phân loại, 3 loại rừng |
| — | `/bien-dong-rung` | Biến động nghi vấn, lịch sử mất tán cây, **dự báo nguy cơ mất rừng 2025–2026** |
| P04 | `/canh-bao-chay` | Điểm nóng FIRMS, **dự báo cấp nguy cơ cháy 7 ngày** theo xã, lịch sử |
| P05 | `/tin-tuc` | Tin tức (CMS, quy trình nháp → duyệt → xuất bản) |
| P06 | `/phan-anh` | Gửi/tra cứu phản ánh (ảnh xoá EXIF, bảo mật người gửi) |
| P07 | `/tai-lieu` | Văn bản gốc, xem PDF, SHA-256 |
| P08–P11 | `/gioi-thieu`, `/thoi-tiet`, `/thong-ke`, `/huong-dan` | Thống kê có xuất Excel/CSV/PDF |
| A01–A10 | `/quan-tri` | Dashboard, dữ liệu, ảnh vệ tinh, tài nguyên, phân tích Python, cảnh báo (xác minh/phê duyệt), tin, phản ánh, tài liệu, người dùng, nhật ký |

## Dự báo và cảnh báo

- **Nguy cơ cháy** (`scripts/build_fire_danger.py`):
  - Chỉ số P Nesterov 5 cấp theo ngưỡng 5.000/10.000/15.000/20.000 (bảng tra cấp tỉnh theo NĐ 156/2018). Kèm bộ chỉ số FWI.
  - Đầu vào: ERA5-Land lúc 12 giờ, sau đó Open-Meteo cho những ngày gần đây và 7 ngày dự báo.
  - Kiểm định với điểm nóng MODIS 2024–2026: AUC P = 0,80; AUC FWI = 0,83.
- **Mất rừng** (`scripts/build_forest_change.py`):
  - Mô hình Random Forest lưới 100 m, học từ Hansen GFC 2001–2024.
  - Kiểm định theo thời gian trên giai đoạn 2023–2024: AUC 0,88.
  - Vùng nghi vấn 2026: Sentinel-2 so cùng kỳ 2024/2025, lặp lại ít nhất 2 tháng.
- Mọi kết quả trên là tự động. Điểm nóng và vùng nghi vấn cần xác minh; cảnh báo chỉ chính thức khi người có quyền phê duyệt ở `/quan-tri/canh-bao`.

## Cập nhật dữ liệu

### Chạy tự động (mặc định bật)

Bộ lập lịch trong `src/services/jobs.js` kiểm tra mỗi phút và chạy các luồng đến hạn, mỗi lúc một luồng. Lỗi được thử lại sau 30 phút, tối đa 3 lần liên tiếp. Lịch lưu ở `storage/scheduler.json`; quản trị và cán bộ chỉnh tại `/quan-tri/phan-tich`.

| Luồng | Chu kỳ mặc định | Các bước |
|---|---|---|
| `update-forecast` | 3 giờ | Open-Meteo* → gắn nhãn điểm nóng → P Nesterov/FWI → PostGIS |
| `update-era5` | 1 ngày | ERA5-Land qua GEE* → `prepare_forecast_inputs` → P/FWI → PostGIS |
| `forest-change` | 1 tuần | Sentinel-2 tháng mới qua GEE* → biến động nghi vấn + dự báo mất rừng → ảnh mới nhất → PostGIS |
| `web-data` | chạy tay | lớp ảnh bản đồ, ranh giới, tile XYZ |

Bước có dấu * là bước thu thập. Nếu bước này lỗi, luồng vẫn tính tiếp với dữ liệu đã có.

Các collector tự xác định tháng từ ngày hiện tại:
- ERA5-Land: tải lại tháng gần nhất cho tới 7 ngày sau khi tháng kết thúc.
- Sentinel-2: chỉ lấy tháng đã kết thúc, tải lại tới 5 ngày sau.

FIRMS là dịch vụ riêng, chạy 30 phút/lần.

### Tile độ phân giải gốc

`python scripts/build_tiles.py` sinh tile XYZ z7–14 cho lớp phủ 1991/2014/2023, biến động 1991–2023, WorldCover và Hansen vào `public/tiles/<id>/`. Web tự dùng tile khi có `tilejson.json`.

Bản đồ GeoTIFF RGB trong phân hệ bản đồ được sinh tile khi xử lý. Có thể chạy lại bằng `node scripts/retile_maps.cjs`.

Nguyên nhân ảnh trước đây bị mờ: lớp hiển thị là một ảnh khoảng 65 m/px, phóng to bằng nội suy tuyến tính. Dữ liệu gốc 15 m vẫn sắc nét.

### Chạy tay

Có thể chạy các job dưới đây ở `/quan-tri/phan-tich` hoặc bằng dòng lệnh:

- `npm run update-forecast`
- `npm run rebuild-web-data`

Thu thập lại lịch sử qua GEE: `scripts/collect_change_fire_history.py`.

Dữ liệu vận hành (người dùng, phản ánh, quyết định xác minh, nhật ký) lưu JSON trong `storage/`, đã gitignore. Có thể thay bằng PostGIS mà không đổi route.

## Cơ sở dữ liệu PostgreSQL/PostGIS

```bash
npm run db:setup     # tạo database, role ứng dụng quyền tối thiểu (app_kontum), áp dụng db/migrations/*.sql
npm run db:import    # nạp ranh giới, thống kê, biến động, điểm nóng, nguy cơ cháy, lớp phủ, mẫu thực địa
node scripts/seed_real_maps.cjs   # đăng ký bản đồ thực tế (data/Data_thuc_te) vào phân hệ bản đồ
```

Schema: `identity`, `spatial`, `imagery`, `fire`, `ops`, `maps`. Dữ liệu vận hành (người dùng, phản ánh, xác minh, tin, nhật ký) ghi xuyên vào PostGIS. Nếu database không kết nối được, hệ thống dùng JSON trong `storage/` làm dự phòng. Nhật ký `identity.audit_logs` và `maps.map_audit_logs` chỉ ghi thêm.

## Dữ liệu thực tế dự án (`data/Data_thuc_te`)

- **Lớp phủ 1991/2014/2023 (GeoTIFF 15 m):** xử lý bằng `scripts/import_real_data.py`.
  - Giải mã 7 lớp phủ; thống kê diện tích theo xã; ma trận chuyển đổi giữa các năm; bản đồ mất/tăng rừng 1991–2023.
  - Hiển thị ở trang Tài nguyên rừng (tab “Lớp phủ 1991–2023”), trang Biến động và Bản đồ.
- **Mẫu thực địa 2025 (389 điểm):** lớp trên bản đồ; dùng kiểm chứng lớp phủ 2023 (khớp 82,7%) và WorldCover (khớp 87,9%).
- **Bản đồ biên tập, ảnh LPR, PDF 1991–2023, gói MPK:** đăng ký vào phân hệ bản đồ. Tệp gốc không bị sao chép.

## MobileGIS (ứng dụng Flutter, thư mục `mobile/`)

Hướng dẫn build và bảo trì cho đội mobile: [`mobile/README.md`](mobile/README.md). Hướng dẫn sử dụng ứng dụng cho người dùng có ảnh chụp thật, xem tại `/huong-dan/mobile`.

- **API:** backend phục vụ `/api/mobile/*` (`src/routes/mobile.js`).
  - Xác thực: token truy cập 15 phút và refresh token xoay vòng (lưu dạng băm).
  - Nghiệp vụ: nhiệm vụ hiện trường theo địa bàn, khảo sát (có quy tắc rừng khộp), xác minh bất biến kèm duyệt riêng.
  - Đồng bộ ngoại tuyến: dùng `client_uuid` chống trùng; xung đột đưa vào hàng chờ, không ghi đè.
- **Bảng dữ liệu:** `db/migrations/004_mobile.sql`. Migration `005_change_notify.sql` để dữ liệu ghi từ tiến trình khác hiện ngay trên web và app (`LISTEN/NOTIFY`).
- **Đăng nhập nhanh theo vai trò:**
  - mặc định bật khi `NODE_ENV` khác `production`;
  - khi `NODE_ENV=production`, chỉ bật nếu đặt `MOBILE_DEMO_LOGIN=true`.
- **Quản trị web:** trang *Nhiệm vụ hiện trường* (`/quan-tri/hien-truong`) dùng để giao nhiệm vụ, duyệt xác minh/khảo sát và xem xung đột đồng bộ. Phân công cán bộ ở trang Cảnh báo / Phản ánh sẽ tự tạo nhiệm vụ trong app.
- **Kiểm thử:** `node scripts/test_mobile_api.cjs` (TC01–TC12 và đồng bộ web ↔ mobile). Dọn dữ liệu thử: `node scripts/purge_mobile_test.cjs`.
- **Thông báo (không Firebase):**
  - lưu trong PostgreSQL;
  - giao qua Socket.IO `/mobile` khi ứng dụng mở;
  - giao qua APNs (iOS) hoặc UnifiedPush/Web Push (Android) khi ứng dụng ở nền.

  Cấu hình và luồng: mục 8 của `mobile/README.md`. Kiểm thử: `node scripts/test_push.cjs`.
- **Bản xem thử trên web:** `cd mobile && flutter build web --base-href /mobile-app/` rồi mở `http://localhost:3000/mobile-app/`.
- **Logo / icon** web và app sinh từ một ảnh nguồn: `node scripts/build_brand_icons.cjs <logo.png>`. Ảnh nguồn lưu tại `public/img/brand/logo-source.png`.

## Tài liệu hướng dẫn sử dụng

- Công khai: `/huong-dan/su-dung`
- Quản trị: `/quan-tri/huong-dan`

Nội dung nằm ở `src/content/guide.js`, ảnh minh hoạ ở `public/guide/*.webp`. Có nút In / lưu PDF.

## Phân hệ nhập bản đồ PDF/GeoTIFF (`/quan-tri/ban-do`)

Làm theo “Báo cáo chuyên đề nhập bản đồ PDF, GeoTIFF”:

- **Danh sách (PL.1):** lọc theo loại, trạng thái, nhóm, năm; xuất CSV.
- **Thêm bản đồ theo các bước (PL.2–PL.5):** tải tệp kéo-thả có thanh tiến độ; kiểm tra MIME, phần mở rộng và giới hạn dung lượng.
- **Worker Python `scripts/map_worker.py`:** đọc CRS, bbox, số băng, NoData, SHA-256; tạo ảnh xem trước; tạo lớp hiển thị EPSG:3857 và COG.
- **Nắn chỉnh PDF/ảnh bằng điểm khống chế (PL.6):** phép biến đổi affine hoặc đa thức bậc 2; tính RMSE theo mét.
- **Duyệt và xuất bản (PL.7):** chỉ quản trị viên được xuất bản, kiểm tra ở máy chủ. Có trả về, thu hồi, phiên bản mới (giữ tệp gốc), nhật ký.
- **Sau khi xuất bản (PL.8):**
  - Bản đồ đã định vị xuất hiện trên Bản đồ WebGIS, nhóm “Bản đồ chuyên đề đã xuất bản”.
  - Mọi bản đồ đã xuất bản xuất hiện ở mục Tài liệu – Bản đồ PDF.
  - Bản đồ chưa định vị chỉ xem như tài liệu, không chồng lên bản đồ.
- **Kiểm thử:** `node scripts/test_maps.cjs` (TC01–TC07).
