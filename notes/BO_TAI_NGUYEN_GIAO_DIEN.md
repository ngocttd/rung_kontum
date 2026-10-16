# Bộ tài nguyên giao diện

Đã chuẩn bị ngày 15/10/2026 trong `public/assets`. Mở `public/assets/index.html` để xem, lọc và mở từng tài nguyên; không cần API key. Đây là thư viện tài nguyên phục vụ xây dựng website, chưa phải website nghiệp vụ hoàn chỉnh.

## Thành phần

- 11 banner riêng P01–P11 và 1 nền dọc MobileGIS: PNG gốc, WebP và WebP nhỏ. Banner không có chữ để tiêu đề/nút được render bằng HTML, hỗ trợ responsive và tiếng Việt rõ nét.
- 15 ảnh item: tuần tra, trồng rừng, đa dạng sinh học, cháy, khảo sát, rừng khộp, công nghệ, rừng thường xanh, tre nứa, rừng trồng, tập huấn, khai thác, khói, lá kim, vận chuyển gỗ.
- 95 icon SVG Bootstrap Icons 1.13.1, MIT; giữ giấy phép trong thư mục icons. 39 biến thể màu có SVG và PNG 128 px, phù hợp shortcut, thẻ KPI, sidebar và Mobile.
- 18 marker SVG/PNG trong suốt: điểm nóng chưa xác minh; cháy xác nhận/đang xác minh/đã xử lý/bác bỏ; rừng/khu bảo tồn/vi phạm; lấn chiếm; vận chuyển; động vật; phản ánh khác/ảnh; trạm; dân cư; nước; GPS; khảo sát. Chân marker hướng xuống, dùng anchor bottom.
- 30 symbol SVG/PNG: 5 cấp nguy cơ; ba mục đích sử dụng rừng; 12 nhóm lớp phủ; trạng thái hồ sơ; ranh tỉnh cũ/xã/tỉnh mới/biến động nghi vấn; mũi tên gió. Chỉ quy định màu, không tự quy định ngưỡng nguy cơ.
- 3 thumbnail SVG/PNG vẽ từ polygon thật: tổng quan hành chính, đường bao tỉnh cũ, chi tiết xã mới. Không mô phỏng giả dữ liệu rừng/cháy/NDVI.
- Sprite Mapbox 1x/2x, JSON vị trí và PNG; `visual-tokens.json`; manifest kích thước, SHA-256, nguồn và cờ ảnh minh họa.

Tổng 358 tệp ảnh/vector bao gồm các định dạng và kích cỡ dẫn xuất; 27 ảnh gốc AI độc lập. Không coi 358 là số ảnh chụp độc lập.

## Ánh xạ theo trang

| Trang | Banner | Ảnh item / tài nguyên dùng chung |
|---|---|---|
| P01 Trang chủ | `banners/p01-home.webp` | evergreen, forest-patrol, reforestation, forest-technology, wildfire; maps/administrative-overview; icon map/forest/fire/weather/statistics/report |
| P02 Bản đồ | `banners/p02-map.webp` | Marker/symbol/sprite; thumbnail GIS; lớp bản đồ thực tải qua API khi xây dựng |
| P03 Tài nguyên rừng | `banners/p03-forest.webp` | evergreen, dipterocarp, bamboo, conifer, plantation; symbol lớp rừng; biểu đồ dựng từ dữ liệu |
| P04 Cảnh báo cháy | `banners/p04-fire.webp` | wildfire, smoke-report, field-survey; marker theo trạng thái và 5 symbol nguy cơ |
| P05 Tin tức | `banners/p05-news.webp` | forest-patrol, reforestation, biodiversity, forest-meeting, forest-technology, wildfire |
| P06 Phản ánh | `banners/p06-reports.webp` | logging-report, smoke-report, timber-truck, biodiversity, field-survey; marker phản ánh |
| P07 Tài liệu/PDF | `banners/p07-documents.webp` | Icon pdf/excel/csv/documents; preview PDF thực phải render từ tệp được công bố, không tạo bìa giả có con dấu/metadata |
| P08 Giới thiệu | `banners/p08-about.webp` | evergreen, biodiversity, forest-patrol; thiết kế banner đồng bộ vì chưa có prototype riêng |
| P09 Thời tiết | `banners/p09-weather.webp` | Icon sun/rain/storm/wind/water/temperature; số liệu runtime; chưa có prototype riêng |
| P10 Thống kê | `banners/p10-statistics.webp` | Thumbnail GIS, icon statistics/excel/pdf/csv; biểu đồ runtime |
| P11 Hướng dẫn | `banners/p11-guide.webp` | field-survey, forest-technology; icon guide/gps/camera/sync/offline; chưa có prototype riêng |
| Admin | Không có banner ảnh trong prototype | Dùng chung toàn bộ icon chức năng, marker, symbol và ảnh CMS. Không thêm banner lớn vào dashboard/bảng quản trị |
| Mobile khởi động/đăng nhập | `banners/mobile-splash.webp` | Đặt logo/tiêu đề bằng giao diện; không dựng lại biểu trưng cơ quan bằng AI |
| Mobile 3–14 | Banner trang tương ứng khi có | Item, icon, marker dùng chung; ảnh hiện trường thật chỉ lấy từ hồ sơ được phép xem |

## Cách tích hợp

Đọc `manifest.json` để lấy đường dẫn, nguồn, kích thước. Web ưu tiên `.webp`, thumbnail dùng `-small.webp`; giữ PNG gốc để biên tập. Banner dùng `object-fit: cover` và lớp phủ xanh navy bằng CSS; ảnh gốc chưa nhúng tiêu đề. Các ảnh gốc có tỷ lệ gần 3:1, ảnh item 3:2, Mobile 2:3; giữ bố cục khi chọn crop responsive.

Icon SVG gốc dùng `fill="currentColor"` khi inline, tránh chèn SVG không tin cậy. Bản màu dùng trực tiếp qua img. Với Mapbox, sprite prefix `/assets/sprites/markers`, chọn `icon-image` trùng tên trong JSON; hoặc `loadImage` PNG rồi `addImage` theo API đang dùng. PNG marker 128 px có thể hiển thị 32–48 px; sprite ratio=2 tự khai báo pixelRatio. Biểu tượng hotspot-unverified luôn là quan sát nghi vấn, không phải sự kiện đã xác nhận.

Ảnh AI là minh họa cảnh quan/chủ đề, không chứng minh địa điểm cụ thể hoặc sự kiện thật. Không seed ảnh AI vào bảng bằng chứng, mẫu huấn luyện, điểm cháy hoặc tin tức sự kiện thật. Ảnh rừng khộp là minh họa mùa khô, không phải ảnh kiểm định thực vật. Ảnh khai thác/vận chuyển không tự mang kết luận vi phạm.

Không dùng logo/con dấu từ prototype như tài sản chính thức đã được cấp phép. Nhận diện cơ quan cần SVG/PNG chuẩn do chủ quản cung cấp. Không dựng giả screenshot vệ tinh, bản đồ nguy cơ, số liệu dashboard hay trang PDF để làm đầy UI.

## Kiểm tra

Đã xem ảnh sinh ra, sprite và thumbnail GIS; kiểm được kích thước/định dạng, đường dẫn và hash qua script `scripts/validate_preparation.py`. Trình duyệt tự động không khả dụng trong phiên này nên chưa xác nhận trực quan trang gallery trên trình duyệt. Gallery có thể mở trực tiếp bằng file hoặc server chỉ phục vụ `public`.

Các script chuẩn bị: `download_boundaries.py`, `prepare_boundaries.py`, `download_icons.py`, `build_visual_assets.py`, `package_assets.cjs`. Thư viện xử lý nằm trong `.tools` và bị loại khỏi Git; bản nguồn tải nằm `data/sources`; bản chính dùng phát triển ở `data/boundaries`.
