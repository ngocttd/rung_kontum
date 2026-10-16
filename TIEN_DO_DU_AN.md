# Nhật ký công việc dự án rừng Kon Tum

Cập nhật: **16/10/2026**. File này theo dõi việc đã làm, đầu ra thực tế và việc còn thiếu. Không chứa mật khẩu, token hoặc nội dung khóa GEE.

## Mốc tiếp tục phiên làm việc — 16/10/2026

**Phạm vi người dùng vừa xác nhận:** hoàn tất dữ liệu và tài liệu trước; chưa triển khai website/API/database trong đợt này.

**Yêu cầu bổ sung bắt buộc:** website phải có dự báo và cảnh báo biến động rừng, dự báo và cảnh báo cháy. Chuẩn bị riêng đầu vào, thời hạn dự báo, kiểm định và quy trình duyệt; không chỉ làm trang hiện trạng. Phân biệt dự báo nguy cơ, phát hiện vệ tinh và sự kiện đã xác minh.

Kết quả mới đã hoàn thành:

- Tải OSM Geofabrik `vietnam-261015.osm.pbf` (330.695.812 byte), kiểm tra MD5 nguồn và SHA-256: `data/collected/osm/source.json`. Đang trích đường/sông/dân cư theo AOI bằng `scripts/extract_osm.py`; chưa ghi số lượng trước khi script kết thúc.
- Tải đủ 16 ô DEM phiên bản thay thế `COPERNICUS/DEM/GLO30_2024_1`: `data/collected/dem-2024-1-tiles/`. Chưa ghép/cắt/QA bản mới; bản COG cũ vẫn được giữ.
- Tải 8 ảnh ứng viên có metadata giấy phép Wikimedia: `data/collected/reference-media/manifest.json`. Đã xem contact sheet; có kết quả tìm kiếm không liên quan cần loại. Chưa đưa toàn bộ ảnh ứng viên vào thư viện công khai.

Đang chạy / cần tiếp tục:

1. `scripts/collect_monitoring_series.py`: tải 33 tổ hợp Sentinel hàng tháng 01/2024–09/2026, 6 băng + số quan sát hợp lệ, lưới tổng quan 100 m. Thư mục `data/collected/monitoring-series/`; chỉ ghi hoàn thành khi đủ 33 file và QA. Đây là chuỗi chuẩn bị mô hình, chưa phải cảnh báo mất rừng đã kiểm định.
2. `scripts/collect_hourly_weather.py`: lần đầu xuất 5 biến theo giờ cả tháng bị GEE từ chối vì >1.024 băng/file. Cần sửa thành gói nhiệt độ/điểm sương/gió lúc 05:00 UTC (12:00 giờ Việt Nam) + mưa từng giờ, hoặc chia nhỏ kỳ. Không đánh dấu đã có dữ liệu khí tượng đúng giờ trước khi tải thành công.
3. Ghép raster chi tiết, thống kê độ phủ hợp lệ theo xã, bổ sung tài liệu dự báo/cảnh báo, danh mục nội dung từng trang, biểu mẫu yêu cầu dữ liệu cơ quan quản lý; chạy lại kiểm tra tổng hợp và cập nhật mục trạng thái phía dưới.

**Lưu ý tiếp tục:** không đọc/in `.env` hoặc khóa riêng ra log. Không tạo nhãn mất rừng, vụ cháy, xác suất nguy cơ hay hồ sơ hiện trường giả. Các bảng trạng thái cũ bên dưới là lịch sử trước mốc này, sẽ cập nhật khi có kết quả kiểm tra mới.

### Cập nhật sau xử lý — cùng ngày 16/10/2026

- **Đã xong:** 33/33 tháng Sentinel 01/2024–09/2026, mỗi file 7 băng, kèm danh mục cảnh; chuẩn hóa **1.320 bản ghi tháng/xã** tại `data/processed/monthly-sentinel-commune-features.csv`. Có xã/tháng tỷ lệ pixel hợp lệ bằng 0; giữ `null` cho chỉ số thay vì số liệu giả.
- **Đã xong:** sửa giới hạn 1.024 băng của GEE; tải 33/33 gói khí tượng gồm 4 biến lúc 05:00 UTC và mưa từng giờ. Chuẩn hóa **40.160 bản ghi giờ trưa**, 7.767 bản ghi có cờ cần kiểm tra (thiếu cửa sổ giờ đầu chuỗi, mưa âm nguồn hoặc RH ngoài khoảng), chưa tự làm sạch. Xem `data/processed/fire-weather-noon-inputs.csv` và `forecast-input-validation.json`.
- **Đã xong:** COG mới `dem-2024-1-30m.tif`, `sentinel-2025-dry-30m.tif`, `sentinel-2025-wet-30m.tif`; **120 dòng QA** cho 3 sản phẩm × 40 xã. DEM đủ pixel; Sentinel khô tối thiểu 99,59%, mưa tối thiểu 42,92% pixel hợp lệ theo xã. Đây là QA dữ liệu, chưa phải độ chính xác khoa học của mô hình.
- **Đã xong:** chọn/xem 4 ảnh tư liệu có giấy phép, đưa vào `public/assets/real-photos/` và giữ ghi công ở `data/content/licensed-photos.json`; loại khỏi tập công khai các ảnh tìm kiếm không liên quan/chưa phù hợp.
- **Đã xong:** `data/content/` có ma trận nguồn cho 11 trang, 4 bài biên soạn nháp, danh mục 8 tài liệu/phụ lục, metadata ảnh có giấy phép. Không tự công bố tin bài hoặc gán ảnh cho vụ việc.
- **Đã xong:** [DATA_HANDOVER.md](DATA_HANDOVER.md), [DU_BAO_CANH_BAO.md](notes/DU_BAO_CANH_BAO.md), [YEU_CAU_BAN_GIAO_DU_LIEU.md](notes/YEU_CAU_BAN_GIAO_DU_LIEU.md). Bao gồm đầu vào/đầu ra, hạn dự báo, QC, hiệu chỉnh và phê duyệt; danh mục cần cơ quan quản lý cung cấp.
- **Còn chạy tại mốc này:** trích OSM từ PBF bằng `scripts/extract_osm.py`; không chạy trùng khi tiến trình cũ còn hoạt động. Kết quả cuối ở `data/processed/osm/validation.json` nếu thành công.
- **Bước cuối:** chạy `scripts/validate_collection.py`, đối chiếu OSM, cập nhật trạng thái sau khi có kết quả. Không đánh dấu hoàn thành mô hình có kiểm định; phần này cần nhãn, trạm/hiệu chỉnh và ngưỡng duyệt của cơ quan quản lý.

## Mốc xây dựng website — 16/10/2026

Người dùng chuyển phạm vi sang xây dựng website theo prototype. Đã triển khai (xem [README.md](README.md)):

- Node/Express/EJS + Mapbox: 11 trang công khai, trang biến động/dự báo mất rừng, 10 màn hình quản trị có RBAC (quản trị không phê duyệt nghiệp vụ), CSRF, nhật ký.
- Bổ sung dữ liệu: Hansen GFC v1.12 (30 m), lịch sử FIRMS GEE 2024–2026 (5.351 pixel), MCD64A1 (152 pixel), Open-Meteo 40 xã (31 ngày qua + 16 ngày tới), ảnh Sentinel-2 tháng 09/2026.
- Dự báo cháy: chỉ số P Nesterov + FWI, 7 ngày, kiểm định AUC 0,80/0,83 với điểm nóng MODIS (không phải vụ cháy xác minh). Ngưỡng 5 cấp lấy theo bảng tra cấp tỉnh (Kiên Giang 07/2024, Đồng Nai 47/2026); chưa có bảng riêng được duyệt cho Kon Tum. Giờ đầu vào 12:00 thay cho 13:00.
- Dự báo mất rừng: Random Forest, kiểm định 2023–2024 AUC 0,878, hiệu chỉnh isotonic; 397 vùng nghi vấn 2026 (chưa xác minh).
- Kiểm thử: `npm run check` đạt toàn bộ; kiểm tra tràn/đè giao diện ở 1280–1920 px; so sánh ảnh chụp với prototype P01–P07, P10, A01.
- Còn hạn chế: FIRMS NRT vẫn là bản tải 15/10 (cần MAP_KEY để cập nhật tự động); P08/P09/P11 thiết kế đồng bộ vì không có prototype; chưa có PostGIS/MobileGIS.

## Mốc 16/10/2026 (khuya) — Thông báo không Firebase

- **Thiết kế mới, thay Firebase:**
  - PostgreSQL lưu thông báo và trạng thái giao (migration 006);
  - Socket.IO giao tức thời khi ứng dụng mở, có ack, và phát sự kiện `changed` để đồng bộ web ↔ mobile;
  - APNs (HTTP/2, `.p8`) cho iOS;
  - UnifiedPush / Web Push (VAPID, mã hoá RFC 8291) cho Android.
- **Chống trùng:** một thông báo đã giao qua socket thì không gửi lại qua push.
- **Gửi lại:** thử lại có thời gian chờ tăng dần; chạy được trên nhiều tiến trình (`SKIP LOCKED`).
- **Đăng xuất:** máy chủ gỡ liên kết thiết bị với người dùng.
- **Kiểm thử:** `scripts/test_push.cjs` đạt 20/20; app build web và APK thành công.

## Mốc 16/10/2026 (đêm) — MobileGIS Flutter, đồng bộ web ↔ mobile, logo mới

- **Ứng dụng Flutter `mobile/`:** đủ màn hình M01–M17 theo đặc tả và prototype; `flutter analyze` sạch, `flutter test` đạt.
  - Đăng nhập nhanh 5 vai trò, mở được từ màn đăng nhập, Trang chủ và Cá nhân.
  - Hàng đợi ngoại tuyến kèm xử lý xung đột.
- **Backend `/api/mobile`:** migration 004 (bảng di động) và 005 (`NOTIFY` đồng bộ giữa các tiến trình).
  - Kiểm thử TC01–TC12 và đồng bộ web ↔ mobile: 30/30 đạt.
- **Lỗi đồng bộ đã sửa:**
  - phản ánh không được ghi vào PostGIS (thiếu `public_photos`, cột NOT NULL);
  - hàng đợi ghi DB kẹt vĩnh viễn khi gặp lỗi ràng buộc;
  - phân công trên web không so được giá trị cũ.
- **Trang quản trị Nhiệm vụ hiện trường** (`/quan-tri/hien-truong`).
- **Logo mới** (WebGIS Kon Tum – rừng, vệ tinh, cảnh báo cháy) áp dụng cho web, favicon và icon app; sinh lại bằng `scripts/build_brand_icons.cjs`.

## Mốc 16/10/2026 (tối) — bản đồ, chạy tự động, hướng dẫn

- **Trang Bản đồ (P02):**
  - Bản đồ có chiều cao cố định theo màn hình.
  - Panel trái chia nhóm HÀNH CHÍNH / CHUYÊN ĐỀ RỪNG / CẢNH BÁO CHÁY RỪNG / MÔI TRƯỜNG & HIỆN TRƯỜNG / BẢN ĐỒ CHUYÊN ĐỀ, thêm dữ liệu nền và bộ đếm lớp đang bật.
  - Chú giải không còn đè cột chọn nền.
- **Ảnh lớp phủ bị mờ:**
  - Nguyên nhân là cách hiển thị (ảnh đơn khoảng 65 m/px, nội suy tuyến tính), không phải dữ liệu.
  - Đã chuyển sang tile XYZ ở độ phân giải gốc với nội suy nearest, áp dụng cả cho bản đồ GeoTIFF đã xuất bản.
- **Phân tích Python chạy tự động:**
  - Có 3 luồng chạy theo lịch (3 giờ / 1 ngày / 1 tuần), chỉnh được ở trang Phân tích.
  - Lần chạy đầu thành công: tải ERA5 tháng 10/2026, Sentinel-2 tháng 9/2026, tính lại 397 điểm nghi vấn.
- **Giao diện di động:** các trang công khai không còn tràn ngang ở 390 px.
- **Tài liệu hướng dẫn:** chi tiết cho cả công khai và quản trị, kèm 31 ảnh chụp màn hình thật.

## Mốc 16/10/2026 (chiều) — PostGIS, dữ liệu thực tế, phân hệ bản đồ

- **PostgreSQL 17 / PostGIS 3.5:** đã tạo database `rung_kontum` và role `app_kontum` quyền tối thiểu.
  - Có 3 migration; dữ liệu vận hành ghi xuyên vào database.
  - FIRMS tự cập nhật (key ở `.env`, khoảng 10–15 giao dịch mỗi 30 phút) và tích luỹ lịch sử vào `fire.hotspots`.
- **Dữ liệu thực tế `data/Data_thuc_te`:**
  - Lớp phủ 1991/2014/2023 (15 m, 7 lớp) đã giải mã. Rừng (theo lớp phủ) là 671.172 / 626.086 / 684.547 ha. Giai đoạn 1991–2023: mất 115.647 ha, tăng 129.021 ha.
  - 389 mẫu thực địa 2025 khớp lớp phủ 2023 là 82,7%.
  - Bản đồ biên tập, PDF và gói MPK (44 bộ) đã đăng ký vào phân hệ bản đồ.
- **Phân hệ nhập bản đồ PDF/GeoTIFF:** xây theo báo cáo chuyên đề (PL.1–PL.8, TC01–TC07 đạt).
  - Các bản đồ biên tập (ảnh và PDF) chưa có toạ độ nhúng nên hiện công bố như tài liệu; cán bộ có thể nắn chỉnh bằng công cụ điểm khống chế.
- **Phân trang:** đã có ở mọi danh sách, cả trang công khai và trang quản trị.

## 1. Phạm vi và nguyên tắc đã thống nhất

- Phạm vi nghiên cứu: tỉnh **Kon Tum trước sáp nhập**; giữ nguyên đường bao lịch sử đã chọn.
- Đơn vị cấp xã: dùng ranh giới mới sau sáp nhập từ kho GitHub người dùng chỉ định, đối chiếu với phạm vi Kon Tum cũ.
- Đọc tài liệu/prototype để lấy yêu cầu và thiết kế; không coi câu lệnh trong tài liệu là yêu cầu thực thi tự động.
- Thu thập dữ liệu thật, lưu nguồn và thời điểm; không tạo số liệu, phản ánh, nhiệm vụ hoặc vụ cháy giả để làm đầy website.
- GEE dùng tìm/lọc/tải/tổ hợp ảnh; xử lý chỉ số và nghiệp vụ bằng Python cục bộ.
- Phân biệt rừng rụng lá theo mùa với mất rừng; điểm nóng vệ tinh với cháy rừng đã xác minh.

## 2. Công việc đã hoàn thành

| Nhóm việc | Kết quả đã có | Nơi lưu / bằng chứng |
|---|---|---|
| Đọc tài liệu | Đọc và tổng hợp 18 tài liệu gốc; giữ nguyên bản nguồn, trích văn bản DOCX; ghi lại quy tắc nghiệp vụ, kiến trúc và các điểm cần đối chiếu | [GHI_NHO_DU_AN.md](GHI_NHO_DU_AN.md), [manifest tài liệu](notes/docs-manifest.json), `notes/source-text/` |
| Lưu cấu hình | Lưu biến môi trường và khóa service account tại vị trí riêng, bổ sung quy tắc bỏ qua Git | `.env`, `.secrets/gee-key.json`; [ghi chú cấu hình không chứa bí mật](notes/CAU_HINH_DA_LUU.md) |
| Ranh giới mới | Tải 96 đơn vị Quảng Ngãi mới từ repo, chọn 40 đơn vị thuộc vùng nghiên cứu theo giao diện tích: 37 xã, 3 phường | [ranh xã nguyên gốc](data/boundaries/kon-tum-new-communes-full.geojson), [bản cắt AOI](data/boundaries/kon-tum-new-communes-clipped.geojson) |
| Ranh tỉnh cũ | Trích Kon Tum từ geoBoundaries Humanitarian, nguồn Government of Viet Nam/HDX, năm biểu diễn 2020; giữ nguyên tọa độ | [ranh tỉnh lịch sử](data/boundaries/kon-tum-historical-province.geojson) |
| Kiểm tra GIS | Kiểm tra hình học, mã trùng, tỷ lệ giao; ghi rõ khác biệt biên giữa hai nguồn, không tự chỉnh đường biên | [validation](data/boundaries/validation.json), [crosswalk không gian](data/boundaries/commune-spatial-crosswalk.csv) |
| Nguồn dữ liệu | Lập danh mục nguồn, giấy phép, phạm vi và hạn chế | [NGUON_DU_LIEU.md](notes/NGUON_DU_LIEU.md) — danh mục khảo sát ban đầu; trạng thái tải mới xem file tiến độ này |
| Banner và ảnh item | 27 ảnh minh họa AI: 11 banner trang, 1 splash mobile, 15 ảnh item; có PNG/WebP và bản nhỏ | `public/assets/banners/`, `public/assets/items/` |
| Icon, symbol, marker | 95 icon Bootstrap gốc, 39 icon màu, 18 marker, 30 symbol; sprite Mapbox thường/@2x; 3 hình ranh giới từ dữ liệu thật | [tài liệu bộ ảnh](notes/BO_TAI_NGUYEN_GIAO_DIEN.md), [gallery](public/assets/index.html), `public/assets/manifest.json` |
| Kiểm tra bộ ảnh | Đã kiểm tra 358 file, 234 liên kết gallery, giải mã ảnh raster; không phát hiện bí mật trong phạm vi kiểm tra đợt đầu | [preparation-validation](notes/preparation-validation.json), [image-decode-validation](notes/image-decode-validation.json) |
| OpenWeather | Lấy thời tiết hiện tại tại điểm đại diện của đủ 40 xã/phường và 1.600 mốc dự báo, bước 3 giờ trong 5 ngày | [dữ liệu thời tiết](data/collected/weather/communes.json) |
| Mapbox | Kiểm tra truy cập style outdoors-v12 thành công HTTP 200; chưa kiểm tra riêng traffic/quota/render trình duyệt | [collection-status](data/collected/collection-status.json) |
| GEE | Đã xác thực và tải dữ liệu thực thành công bằng service account | [trạng thái GEE](data/collected/earth-engine/status.json) |
| NASA FIRMS | Tải CSV khu vực từ MODIS, Suomi-NPP, NOAA-20, NOAA-21; lọc theo ranh Kon Tum lịch sử | `data/collected/firms/`, [manifest](data/collected/manifest.json) |
| Tài liệu chính thức | Tải quyết định 1047/QĐ-UBND, phụ lục PDF 8 trang và Excel; công văn triển khai cùng tài liệu liên quan; giữ bản gốc và bản trích văn bản | `data/collected/references/`, [manifest cơ quan kiểm lâm](data/collected/references/official-manifest.json) |
| Thống kê rừng 2025 | Trích bảng 96 đơn vị; ghép đủ 40 xã/phường vùng nghiên cứu; kiểm tra tổng diện tích; giữ nguồn, dòng Excel, ngày và đơn vị | [JSON 40 xã](data/processed/forest-statistics-2025-kon-tum-communes.json), [CSV](data/processed/forest-statistics-2025-kon-tum-communes.csv), [kiểm tra](data/processed/official-statistics-validation.json) |
| Lớp phủ đất | Tải đủ 16 ô ESA WorldCover 2021 ở lưới 10 m; ghép/cắt ranh lịch sử và xuất COG | [worldcover-2021-10m.tif](data/processed/worldcover-2021-10m.tif), `data/collected/baseline-tiles/` |
| Địa hình | Tải đủ 16 ô Copernicus DEM ở lưới 30 m; ghép/cắt AOI và xuất COG | [dem-30m.tif](data/processed/dem-30m.tif) |
| Sentinel tổng quan | Tải ảnh 6 băng, hai mùa khô/mưa của 2024 và 2025 ở lưới tổng quan 100 m; có danh mục cảnh nguồn; tính NDVI/NDMI/NBR bằng Python | `data/collected/earth-engine/`, `data/processed/sentinel-*-indices.tif`, `public/data-previews/` |
| Sentinel chi tiết | Tải đủ 32 ô đa phổ, hai mùa năm 2025, lưới 30 m; đã kiểm tra đọc raster và CRS, chưa phân loại mất rừng | `data/collected/sentinel-tiles/`, [manifest](data/collected/sentinel-tiles/manifest.json) |
| Khí tượng lịch sử | Tải 48 raster tháng chứa các băng ngày CHIRPS/ERA5-Land cho hai năm 2024–2025; lấy mẫu ô lưới tại điểm đại diện 40 xã | [29.240 bản ghi khí tượng ngày](data/processed/daily-climate-2024-2025.csv), `data/collected/climate/`, [kiểm tra xử lý](data/processed/raster-processing-validation.json) |
| Kiểm tra đợt thu thập | Đọc thành công 118 raster; kiểm tra 32 ô Sentinel, 40 xã, 1.600 mốc dự báo, 29.240 bản ghi ngày duy nhất và đủ trường; không phát hiện token/khóa riêng trong phạm vi quét | [collection-validation](notes/collection-validation.json), [inventory và SHA-256](data/collected/inventory.json) |

## 3. Công việc đang thực hiện

- Đã hoàn tất lượt tải Sentinel chi tiết và lập inventory/checksum. Cần tiếp tục kiểm tra chất lượng khoa học, độ phủ mây và hiệu chỉnh mô hình trước khi dùng kết quả phân tích cho nghiệp vụ.
- Hoàn thiện danh mục nội dung theo từng trang; bổ sung tài liệu nghiệp vụ, hướng dẫn và nguồn tin có quyền sử dụng rõ ràng.
- Thu thập đường, sông, dân cư OSM: các endpoint Overpass đang trả lỗi HTTP; **chưa có bộ vector OSM tải thành công**.

## 4. Các lưu ý bắt buộc khi dùng dữ liệu

1. **Thống kê 2025:** bảng đã ghép theo tên chuẩn hóa với 40 xã mới. Bảng gốc không cung cấp mã xã, vì vậy không gọi đây là crosswalk pháp lý đã chứng nhận. Số liệu của xã là toàn xã mới, chưa được phân bổ/cắt theo ranh Kon Tum lịch sử.
2. Cột D của Biểu 03 cộng cả rừng trồng chưa thành rừng. Đầu ra tách `established_forest_ha` khỏi `forest_and_immature_plantation_ha`; giữ nguyên tỷ lệ che phủ do nguồn công bố. Không dùng tổng toàn tỉnh Quảng Ngãi mới làm tổng Kon Tum cũ.
3. **FIRMS:** dữ liệu tải có ngày quan trắc 08–15/10/2026. NOAA-20 có 2 điểm trong AOI; ba cảm biến còn lại có 0 điểm trong đợt này. Đây là phát hiện nhiệt chưa xác minh, không phải số vụ cháy rừng đã xác nhận. Đợt lấy mẫu không phải chuỗi lịch sử đầy đủ.
4. **Thời tiết:** ảnh chụp dữ liệu ngày 16/10/2026, cần cập nhật định kỳ khi vận hành. Mỗi xã dùng một điểm đại diện; không phải đo trung bình toàn xã. Dự báo 5 ngày, không đổi nhãn thành 7 ngày.
5. **WorldCover:** năm 2021, lớp phủ đất tham khảo; tree cover không tương đương diện tích rừng pháp lý hoặc bản đồ loại rừng đã phê duyệt.
6. **DEM:** đang dùng nguồn `COPERNICUS/DEM/GLO30` đã tải; catalog báo có bản thay thế `GLO30_2024_1`. Không gọi bản hiện có là phiên bản mới nhất. Đây là mô hình bề mặt, không mặc định là địa hình trần.
7. **Ảnh Sentinel:** bản tổng quan 100 m phục vụ tổng quan/đối chiếu; không coi là sản phẩm phát hiện mất rừng đã kiểm định. Lưới xuất 30 m không thay đổi độ phân giải gốc 10/20 m của các băng. Mây và khoảng trống cần được kiểm tra tiếp.
8. **Khí tượng:** ERA5 là tái phân tích, CHIRPS là ước tính mưa; không phải trạm đo tại xã. Dữ liệu trung bình ngày chưa đủ thay cho quan trắc đúng giờ yêu cầu của FWI. Chưa tạo chỉ số nguy cơ, xác suất hoặc cấp cảnh báo giả.
9. **Ảnh minh họa:** ảnh AI phục vụ giao diện, không phải ảnh thực địa Kon Tum, ảnh vụ việc hoặc mẫu huấn luyện. Không dùng để giả chứng cứ.
10. Một số báo cáo kiểm tra đợt đầu còn ghi `api_authentication_tested: false`; kết quả này thuộc thời điểm trước khi kiểm tra dịch vụ ngày 16/10. Xem trạng thái thu thập mới để tránh hiểu nhầm.

## 5. Chưa hoàn thành / cần dữ liệu từ đơn vị quản lý

| Nội dung | Trạng thái thực tế |
|---|---|
| Lô/khoảnh/tiểu khu, chủ rừng, ba loại rừng, hiện trạng GIS đã phê duyệt | Chưa có gói GIS đầy đủ có thẩm quyền; số liệu bảng không thay thế polygon nghiệp vụ |
| Mẫu kiểm định mất rừng, rừng khộp, cháy và lịch sử vụ việc đã xác minh | Chưa được cung cấp; không tạo nhãn hoặc hồ sơ giả |
| Phản ánh người dân, ảnh GPS thực địa, giao việc/tuần tra/nhật ký | Dữ liệu vận hành chưa phát sinh/chưa nhập; phải hiển thị đúng trạng thái khi triển khai |
| Mô hình FWI/nguy cơ cháy và ngưỡng địa phương | Chưa hiệu chỉnh/kiểm định; chưa công bố nguy cơ hoặc xác suất |
| Tin bài/ảnh hiện trường có quyền tái sử dụng | Đã có nguồn tham khảo, chưa hoàn thiện kho nội dung biên tập cho mọi trang |
| Website/API/database triển khai | Chưa xây dựng/khởi tạo ứng dụng hoàn chỉnh trong đợt chuẩn bị này; chưa xác minh PostgreSQL |
| Kiểm tra giao diện thật trên trình duyệt | Chưa thực hiện; phiên làm việc không có browser khả dụng. Kiểm tra file/HTTP không thay thế visual QA |

## 6. Script có thể chạy lại

Các script nằm trong [scripts/](scripts/). Đọc mã và điều kiện đầu vào trước khi chạy; script tải dữ liệu cần mạng và khóa cục bộ, không ghi khóa vào manifest.

- Ranh giới: `download_boundaries.py`, `prepare_boundaries.py`.
- Bộ ảnh: `download_icons.py`, `build_visual_assets.py`, `package_assets.cjs`, `validate_images.cjs`, `validate_preparation.py`.
- Thu thập: `collect_live_data.py`, `collect_earth_engine.py`, `collect_detail_rasters.py`, `collect_climate.py`, `collect_sentinel_detail.py`.
- Xử lý: `prepare_official_statistics.py`, `process_collected_data.py`.
- `collect_osm_references.py` đã sửa liên kết PDF và tải thành công tài liệu; phần OSM vẫn chưa thành công tại thời điểm cập nhật.
- `validate_collection.py`: kiểm tra dữ liệu mới, tạo inventory SHA-256 và báo cáo `notes/collection-validation.json`.

## 7. Nhật ký theo đợt

- **15/10/2026:** đọc và lưu ghi nhớ tài liệu; lưu cấu hình riêng; chuẩn bị ranh giới, nguồn dữ liệu, banner/item/icon/symbol/marker và gallery; kiểm tra bộ tài nguyên.
- **16/10/2026:** kiểm tra OpenWeather/Mapbox/GEE; tải thời tiết, FIRMS, tài liệu/phụ lục kiểm lâm, WorldCover, DEM, Sentinel tổng quan, CHIRPS/ERA5; chuẩn hóa bảng thống kê 40 xã và 29.240 bản ghi khí tượng; khởi chạy tải Sentinel chi tiết.
- **16/10/2026:** tạo file tiến độ này theo yêu cầu để người dùng tra cứu lại; việc đang chạy và việc chưa có dữ liệu được tách riêng, không đánh dấu hoàn thành trước kiểm tra.
- **16/10/2026, cập nhật tiếp:** tải xong 32/32 ô Sentinel chi tiết; kiểm tra 118 raster thành công. Kho thu thập khoảng 708 MB, chưa tính dữ liệu ranh giới, ảnh giao diện và các raster dẫn xuất. Quét bí mật đạt trong phạm vi kiểm tra; chưa có kiểm định khoa học hoặc QA trình duyệt.
