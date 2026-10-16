# Bộ dữ liệu và tài liệu chuẩn bị xây dựng website

Phạm vi chốt ngày 16/10/2026: chuẩn bị dữ liệu, nội dung và tài liệu; chưa triển khai ứng dụng. Trạng thái mới nhất: [TIEN_DO_DU_AN.md](TIEN_DO_DU_AN.md).

## Đường dẫn sử dụng

| Nhóm | Đầu ra ưu tiên | Cách sử dụng |
|---|---|---|
| Hành chính | `data/boundaries/` | Tỉnh lịch sử giữ nguyên; xã full và clipped tách riêng; xem validation trước thống kê |
| Hiện trạng chính thức | `data/processed/forest-statistics-2025-kon-tum-communes.json` | Số liệu 2025 toàn 40 xã mới; mã ghép theo tên, nguồn/dòng Excel có sẵn |
| OSM | `data/processed/osm/*.geojson` khi extraction hoàn tất | Đường/sông/dân cư cộng đồng, EPSG:4326, cắt ranh lịch sử; ghi công ODbL |
| Lớp phủ | `data/processed/worldcover-2021-10m.tif` | COG 10 m, EPSG:32648, lớp phủ tham khảo năm 2021 |
| Địa hình | `data/processed/dem-2024-1-30m.tif` | COG 30 m, DSM, bản GLO30_2024_1; bản legacy giữ để truy vết |
| Ảnh đa phổ | `data/processed/sentinel-2025-dry-30m.tif`, `sentinel-2025-wet-30m.tif` | Sáu băng B2/B3/B4/B8/B11/B12, phản xạ nhân 0,0001; nodata=0; không coi band1–3 là RGB đúng thứ tự |
| QA ảnh | `data/processed/raster-quality-by-commune.csv` | Tỷ lệ pixel hợp lệ theo xã; chưa đo chính xác phân loại hoặc mây sót |
| Chuỗi biến động | `data/collected/monitoring-series/`, `data/processed/monthly-sentinel-commune-features.csv` sau xử lý | 33 tháng 100 m và số quan sát hợp lệ; đặc trưng cấp xã, chưa phải dự báo hoặc kết luận mất rừng |
| Thời tiết/dự báo thật | `data/collected/weather/communes.json` | Current + forecast 5 ngày/3 giờ tại điểm đại diện; giữ thời điểm quan trắc/hiệu lực |
| Khí tượng lịch sử | `data/processed/daily-climate-2024-2025.csv` | Hai nguồn ERA5/CHIRPS riêng; không dùng trung bình ngày thay đầu vào trưa của FWI |
| Đầu vào nguy cơ cháy | `data/processed/fire-weather-noon-inputs.csv` sau xử lý | T/Td/RH/gió lúc 12 giờ VN, mưa 24 giờ và QC; tái phân tích, chưa phải chỉ số cháy đã hiệu chỉnh |
| Điểm nóng | `data/collected/firms/*-kon-tum-7d.geojson` | Phát hiện nhiệt chưa xác minh, không phải hồ sơ cháy; giữ nguồn cảm biến và thời gian |
| Nội dung 11 trang | `data/content/page-data-matrix.json` | Nêu nguồn có thật và hạn chế cho mỗi trang |
| Tin/hướng dẫn | `data/content/articles.json` | Bốn bài gốc biên soạn từ nguồn dẫn, trạng thái nháp cần duyệt; không giả bài báo mới |
| Tài liệu gốc | `data/content/documents.json`, `data/collected/references/` | Quyết định/phụ lục/bản trích; xem source và SHA-256 |
| Ảnh giao diện | `public/assets/` | Ảnh minh họa AI tách ảnh tư liệu thật ở `real-photos/`; icon/sprite sẵn có |
| Ảnh có giấy phép | `data/content/licensed-photos.json` | Bốn ảnh đã chọn và xem; hiển thị credit, link nguồn/license; không gán ảnh cho vụ việc |

## Tài liệu nghiệp vụ

- [Dự báo và cảnh báo](notes/DU_BAO_CANH_BAO.md): phân biệt sáu sản phẩm; đầu vào đúng giờ, thời hạn dự báo, kiểm định, quyền duyệt, trạng thái thiếu/cũ và cấu trúc dữ liệu.
- [Yêu cầu bàn giao](notes/YEU_CAU_BAN_GIAO_DU_LIEU.md): các lớp nghiệp vụ/nhãn/trạm/quy trình còn cần chủ quản; chưa gửi cho bên thứ ba.
- [Nguồn dữ liệu](notes/NGUON_DU_LIEU.md), [bộ tài nguyên giao diện](notes/BO_TAI_NGUYEN_GIAO_DIEN.md), [ghi nhớ đặc tả](GHI_NHO_DU_AN.md).

## Quy ước chung khi nhập hệ thống

- Vector trao đổi EPSG:4326; raster xử lý theo CRS ghi trong file, phần lớn UTM 48N. Không gán SRID thay cho chuyển tọa độ. GeoJSON diện tích không tính bằng độ.
- Ngày quan sát, thời điểm dự báo có hiệu lực, ngày lấy dữ liệu và ngày công bố là các trường khác nhau. Giữ UTC và hiển thị Asia/Ho_Chi_Minh; không thay toàn bộ bằng ngày tải.
- `null` là chưa có giá trị, khác 0. `unverified`, `insufficient_observations`, `stale`, `draft` không được tự đổi thành bình thường/đã xác nhận/đã công bố.
- Mọi sản phẩm dẫn xuất lưu source snapshot, script/thuật toán, cấu hình, thời gian, CRS, độ phân giải, checksum, chất lượng và phạm vi.
- Các khóa/API ở `.env` và `.secrets/` chỉ được backend đọc. Không chép toàn thư mục dự án vào thư mục static. COG lớn phục vụ qua dịch vụ raster/tiles có cache; không nhúng trực tiếp tất cả raster vào trình duyệt.

## Quyền sử dụng và ghi công

- OSM: © OpenStreetMap contributors; ODbL 1.0. Bản cắt/biến đổi phải giữ giấy phép và điều kiện cơ sở dữ liệu dẫn xuất.
- WorldCover: ESA WorldCover 2021 v200, CC BY 4.0; tree cover khác rừng pháp lý.
- Sentinel: Copernicus Sentinel data theo nguồn và năm ảnh; các tổ hợp là sản phẩm dẫn xuất.
- Copernicus DEM: ghi công EU/ESA, DLR và Airbus theo license catalog; DSM có thực vật/công trình.
- ERA5-Land: ghi công Copernicus Climate Change Service/ECMWF; dữ liệu biến đổi phải ghi nguồn và không ngụ ý cơ quan nguồn chịu trách nhiệm cho kết quả của dự án.
- FIRMS: NASA FIRMS/LANCE, cảm biến và phiên bản. OpenWeather/Mapbox: sử dụng theo gói, hạn mức, ghi công và điều kiện cache của nhà cung cấp.
- Wikimedia: từng ảnh có tác giả/license riêng; CC BY-SA giữ điều kiện tương ứng nếu sửa/phát hành ảnh dẫn xuất. Chỉ giấy phép không xác minh địa điểm hoặc ngày chụp.
- Văn bản nhà nước: giữ cơ quan, số hiệu, ngày và nguồn; không chỉnh bản ký. Tài liệu nội bộ chưa được duyệt không tự công khai.

## Giới hạn hoàn thành

Bộ nguồn công khai và tài liệu này cho phép xây dựng các phần tra cứu/thống kê/hiển thị dữ liệu thật và chuẩn bị pipeline dự báo. Nó không thay việc bàn giao GIS nghiệp vụ, mẫu hiện trường, hiệu chỉnh mô hình và phê duyệt cảnh báo. Những phần đó được ghi là phụ thuộc đầu vào bên ngoài, không đánh dấu đã hoàn thành và không lấp bằng mock data.
