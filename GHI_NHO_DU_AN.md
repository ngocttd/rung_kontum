# Ghi nhớ tài liệu dự án WebGIS MobileGIS Kon Tum

Ngày đọc: 15/10/2026. Phạm vi: toàn bộ 18 tệp nguồn trong `docs`. Đây là ghi nhận yêu cầu và tham chiếu thiết kế, chưa phải xác nhận hệ thống đã triển khai hay dữ liệu đã được kiểm định. Giữ nguyên các tệp gốc.

## Cập nhật theo yêu cầu tiếp theo ngày 15/10/2026

Người dùng chỉ định lấy xã mới sau sáp nhập từ ThangLeQuoc/vietnamese-provinces-database và giữ phạm vi tỉnh Kon Tum cũ. Đã chuẩn bị `data/boundaries`: ranh tỉnh lịch sử 2020 Government of Viet Nam/HDX qua geoBoundaries, giữ nguyên geometry; 40 xã/phường mới (37 xã, 3 phường) từ GitHub v5.2.0, có full và bản clipped dẫn xuất. Đây là baseline nguồn mở chưa được chủ quản nghiệm thu; khác nguồn có sai lệch mép được ghi trong validation. Xem `notes/NGUON_DU_LIEU.md` và manifest để biết phiên bản/CRS/giấy phép.

Đã lưu cấu hình thật theo người dùng ở `.env`, khóa GEE được sao chép vào `.secrets/gee-key.json`, có gitignore; không ghi giá trị tại đây. Cấu hình thật hiện dùng tài khoản DB người dùng chỉ định, không phải app_kontum của mẫu. Chưa xác thực dịch vụ hoặc kết nối DB. Xem `notes/CAU_HINH_DA_LUU.md`.

Đã tạo bộ ảnh/icon/marker/symbol tại `public/assets`, gallery `public/assets/index.html`, ánh xạ theo trang ở `notes/BO_TAI_NGUYEN_GIAO_DIEN.md`. Ảnh AI chỉ minh họa, không dùng như dữ liệu/bằng chứng. Giữ ghi nhận tài liệu gốc phía dưới làm lịch sử; câu “chưa có khóa” ở phần nguồn ban đầu đã được cập nhật bởi mục này.

## Nguồn và cách tra cứu

- `docs/01_Tai_lieu/Danh muc chuc nang WebGIS_MobileGIS kontum.docx`: danh mục gốc, ma trận bốn vai trò và ví dụ GEE/SQL/Mapbox, mô hình cháy thử nghiệm.
- `docs/01_Tai_lieu/Dac_ta_WebGIS_MobileGIS_KonTum_v1.docx`: đặc tả v1.0 tháng 10/2026, 14 mục về phạm vi, tác nhân, sitemap, nghiệp vụ, dữ liệu, nguồn, kiến trúc, API, nghiệm thu và giai đoạn. Phần kỹ thuật bổ sung là đề xuất cần xác nhận khi khảo sát.
- `docs/01_Tai_lieu/Phu_luc_Kien_truc_Python_Rung_Khop_v1_1.docx`: bổ sung v1.1 về Python, rừng khộp, công bố/phân quyền và giới hạn bộ prototype.
- `docs/02_Sitemap`: hai sơ đồ theo Public/Admin và theo vai trò.
- `docs/03_Prototype_Public`: tám trang P01, P02, P03, P04, P05, P06, P07, P10.
- `docs/04_Prototype_Admin/Tong_hop_Admin.png`: ảnh tổng hợp 10 màn hình.
- `docs/05_Prototype_MobileGIS/Tong_hop_14_man_hinh_MobileGIS.png`: ảnh tổng hợp 14 màn hình.
- `docs/README.txt`, `docs/06_Cau_hinh_mau/README_BAO_MAT.txt`, `docs/06_Cau_hinh_mau/.env.example`: phạm vi bàn giao và cấu hình mẫu không có khóa thật.

`notes/source-text` giữ bản trích xuất toàn bộ đoạn văn và nội dung ô bảng theo thứ tự XML của ba DOCX, phục vụ tìm kiếm; định dạng bảng và bố cục vẫn phải đối chiếu bản gốc. `notes/docs-manifest.json` ghi đường dẫn, kích thước và SHA-256 của 18 tệp nguồn. Đã kiểm tra các DOCX không có media nhúng, comments hay footnotes/endnotes; chưa render để đánh giá bố cục Word.

## Phạm vi và nguyên tắc nghiệp vụ

Hệ thống giám sát tài nguyên, biến động rừng, nguy cơ cháy, điểm nóng nhiệt và xử lý phản ánh tại vùng Kon Tum trước sắp xếp hành chính năm 2025 theo phụ lục. Ranh giới cần được chủ quản phê duyệt, có phiên bản, thời gian hiệu lực và đối chiếu đơn vị hiện hành. Không mặc định tên vùng nghiên cứu là tên tỉnh hiện hành hoặc cố định tỉnh/huyện/xã theo sơ đồ cũ. Mọi thống kê ghi năm dữ liệu và phiên bản ranh giới.

WebGIS và MobileGIS dùng chung API, danh tính, phân quyền và CSDL. Bốn vai trò gốc: quản trị hệ thống; UBND/lãnh đạo; Sở NN&MT/nghiệp vụ; người dân. Áp dụng RBAC cùng phạm vi địa bàn, trạng thái công bố và quyền phê duyệt. Quản trị nền tảng không tự động thay thế phê duyệt chuyên môn. Vai trò kiểm lâm/hiện trường, thẩm định và phê duyệt là đề xuất mở rộng cần xác nhận.

Ưu tiên dữ liệu chính thức; ảnh vệ tinh bổ trợ quan sát. Tách ba sản phẩm: nguy cơ cháy dự báo, điểm nóng VIIRS/MODIS quan sát, diện tích/mức độ cháy sau sự kiện. FIRMS không tự chứng minh cháy rừng. Không dùng NDVI giảm đơn lẻ để kết luận mất rừng, không dùng NBR đơn thời điểm làm xác suất cháy. FWI cần hiệu chỉnh/kiểm định tại địa phương, không tự coi là xác suất cháy.

## Kiến trúc và xử lý

Theo bổ sung v1.1: Node.js + Express + EJS cho web/API; Mapbox GL JS cho bản đồ; PostgreSQL/PostGIS; Python worker qua hàng đợi. Bản v1 còn đề xuất MapLibre tùy giấy phép, Flutter, Redis/queue, MinIO/S3, FCM, HTTPS/reverse proxy. Đây là định hướng chưa có source code trong gói.

GEE tìm kiếm, lọc mây, lập danh mục, truy xuất Landsat/Sentinel/MODIS, có thể tạo tổ hợp để xuất ảnh. Thuật toán nghiệp vụ chạy Python, không phụ thuộc script GEE. Luồng: catalog/search → chọn cảnh và QA → xuất kèm metadata → kho tệp → Python tiền xử lý → chỉ số/đặc trưng mùa → mô hình → hậu xử lý → kiểm định → COG/vector tiles → PostGIS/API/Mapbox. Thư viện đề xuất rasterio/GDAL/xarray/numpy/scikit-learn.

Mỗi job lưu AOI, khoảng thời gian, bộ dữ liệu, phiên bản thuật toán, tham số, trạng thái, log, đầu ra và chỉ số chất lượng; hỗ trợ chạy lại, retry và đối soát. Sentinel-2 dùng SCL/cloud mask và kiểm soát ảnh trống; Landsat xử lý scale/cloud QA; không ghép khác mùa tùy tiện. Không xử lý raster lớn trong trình duyệt.

Rừng khộp phải xét chu kỳ rụng lá mùa khô: đặc trưng đa mùa, nhiều năm, biên độ/pha mùa vụ, địa hình, kết cấu ảnh; so sánh cùng mùa và xác minh bằng ảnh độ phân giải cao/mẫu/thực địa. Cờ “rụng lá theo mùa” và “biến động nghi vấn”; chỉ thống kê mất rừng sau xác minh hoặc kiểm định đạt yêu cầu.

Danh mục lớp tối thiểu: lá rộng thường xanh, nửa rụng lá, rừng khộp, lá kim, hỗn giao, tre nứa, rừng trồng, cây lâu năm/nông nghiệp, trảng cỏ-cây bụi, đất trống, nước, xây dựng; hợp nhất theo kiểm kê được duyệt. Random Forest làm nền, cân nhắc XGBoost khi đủ mẫu. Phân tầng theo loại rừng/vùng sinh thái/mùa, chia train/test theo không gian. Báo cáo confusion matrix, precision, recall, F1, OA và sai số diện tích.

## Chức năng và quy trình

- Bản đồ: nền đường phố/vệ tinh/địa hình, 3D, cây lớp/độ mờ, popup, tìm kiếm, lọc vùng/thời gian, đo dài/diện tích, tọa độ, chia sẻ/in, chỉ đường theo nghiệp vụ.
- Dữ liệu: GeoJSON, SHP ZIP, GeoPackage, CSV/XLSX có tọa độ; kiểm CRS/geometry/schema/trùng lặp → staging → kiểm định → duyệt → công bố và quản lý phiên bản. Xuất theo quyền; tiles/GeoJSON/OGC khi cần.
- Ảnh: AOI/thời gian/cảm biến/mây, RGB/false color, NDVI/NDMI/NDWI/NBR/dNBR, trước–sau, huấn luyện/kiểm định phân loại, xuất vector và diện tích.
- Biến động: nhận ảnh → phân tích → polygon nghi vấn → chồng ranh rừng/tiểu khu/chủ rừng → giao xác minh → thẩm định/hiện trường → duyệt kết luận.
- Cháy: khí tượng/nguy cơ + FIRMS → đối chiếu vùng rừng → sự kiện nghi vấn → phân công/xác minh → xác nhận hoặc không xác nhận → xử lý → kết thúc. Giữ UTC gốc và giờ Việt Nam, vệ tinh, confidence, FRP; loại/đánh dấu điểm ngoài rừng. Lưu mọi thay đổi, người thực hiện, thời gian và bằng chứng.
- Phản ánh: loại, mô tả, GPS, ảnh → mã hồ sơ/chống trùng → tiếp nhận → phân loại/phân công → xác minh → kết luận/phản hồi → đóng hoặc mở lại. Bảo vệ danh tính và vị trí nhạy cảm.
- Nội dung: tin tức, bình luận theo danh mục gốc, báo cáo/văn bản, bản đồ PDF; nháp → biên tập → duyệt → xuất bản, phân biệt công khai/nội bộ, lịch sử và tải theo quyền.
- Thời tiết/thông báo: nguồn và timestamp; vùng quan tâm/cấp/khoảng cách GPS/quyền, chống gửi lặp; in-app, email/push khi cấu hình.
- Mobile: GPS, chụp ảnh tọa độ, cập nhật hiện trạng theo quyền, nhiệm vụ/xác minh, queue offline, xử lý xung đột, chống gửi lặp, nén ảnh và trạng thái đồng bộ.

## Dữ liệu, API và bảo mật

Nhóm dữ liệu: identity (users/roles/permissions/scopes); spatial (đơn vị hành chính/tiểu khu/lô rừng/chủ rừng/khu bảo vệ/lớp/phiên bản/metadata); imagery (scenes/products/jobs/outputs/models/training/validation/classification/change events); fire (observations/risk runs/zones/alerts/incidents/verifications/actions/notifications); operations (reports/attachments/assignments/status history/news/documents/pdf maps/API clients/logs/audit).

Tên bảng trong v1 và v1.1 khác nhau; đây chưa phải schema đã chốt. Khóa UUID và liên kết FK, nguồn, thời gian hiệu lực, phiên bản, tác giả, kiểm duyệt; GIST geometry, chỉ mục thời gian/trạng thái; kiểm trùng quan sát. Trao đổi EPSG:4326, tính diện tích bằng CRS phù hợp. Raster lớn lưu kho tệp/object storage khi phù hợp, DB lưu URI và lineage. Lưu thời gian UTC, hiển thị Việt Nam.

v1 đưa ví dụ `/api/v1/...`; v1.1 đưa `/api/public/...` và `/api/admin/...`. Cần thống nhất route contract/OpenAPI khi triển khai. Có API layers/forest summary/hotspots/risk/reports, jobs/classification/change events/verify/assign. Phân trang, bbox/thời gian/địa bàn, xác thực, kiểm input, RBAC/object-level scope, rate limit, quota, audit, thu hồi API key; không lộ tệp nội bộ qua URL công khai.

TLS, mật khẩu hash, MFA quản trị, kiểm soát upload, audit không sửa, backup và kiểm thử khôi phục. DB ứng dụng quyền tối thiểu, hạn chế mạng. Không commit `.env`, `.secrets` hay khóa GEE; JSON key ngoài repository, env trỏ đường dẫn. OpenWeather gọi backend; Mapbox public token giới hạn origin/URL; GEE/FIRMS secrets ở server. Cấu hình mẫu: localhost:5432, DB `rung_kontum`, user `app_kontum`; giá trị password/token chỉ là placeholder, không chứng minh DB/tài khoản tồn tại. Tileset giao thông là tùy chọn khi có nghiệp vụ tiếp cận.

Nguồn dự kiến: cơ quan chuyên ngành cho ranh giới/rừng; Sentinel-2 SR, Landsat 8/9, MODIS LST, ERA5-Land/CHIRPS, FIRMS, DEM Copernicus/SRTM, dữ liệu hiện trường. FIRMS kiểm tra 1–3 giờ, Sentinel kiểm tra cảnh mới hằng ngày, MODIS hằng ngày nếu hợp lệ; tần suất là mục tiêu phụ thuộc độ trễ, không cam kết dữ liệu thời gian thực. ERA5-Land tái phân tích không mặc định là dự báo.

## Ghi nhớ giao diện đã xem

Phong cách Public: header trắng với nhận diện/logo đỏ, chữ xanh navy, điều hướng và nút xanh rừng, ảnh rừng/núi làm banner, nền trắng, thẻ viền nhạt/bo góc; bản đồ vệ tinh nổi bật, ranh tím/trắng, vùng rừng xanh, điểm nóng icon lửa đỏ/cam, biểu đồ xanh-vàng-đỏ. Dùng ảnh gốc làm tham chiếu thị giác; không suy ra font chính xác từ ảnh.

- P01: hero rừng lớn, tìm kiếm và lối tắt, bản đồ tổng quan bên phải, KPI, thẻ bản đồ, tin tức, cảnh báo và tài liệu.
- P02: cây lớp bên trái, bản đồ/công cụ giữa, thông tin đối tượng/nguy cơ/thời tiết bên phải, thống kê phía dưới.
- P03: banner/KPI, tab tài nguyên, bộ lọc trái, bản đồ giữa, biểu đồ phải, phân bố/ảnh/bảng khu bảo tồn dưới.
- P04: banner cháy/KPI, tab, cây lớp và ngày, bản đồ điểm nóng/nguy cơ, chi tiết điểm và biểu đồ/cảnh báo.
- P05: danh mục trái, tìm kiếm/bộ lọc và tin nổi bật giữa, thông báo/thời tiết/văn bản phải.
- P06: danh mục/bộ lọc/nút gửi trái, bản đồ và danh sách giữa, chi tiết/ảnh/vị trí/timeline xử lý phải. Ảnh dùng chữ “phản ánh hiện trạng”.
- P07: danh mục/bộ lọc trái, lưới tài liệu giữa, preview PDF và metadata/nút tải/chia sẻ bên phải.
- P10: sidebar chủ đề/báo cáo/công cụ, lọc năm/phạm vi/loại rừng, KPI, bản đồ/biểu đồ/bảng, xuất PDF/Excel/CSV.
- Admin: sidebar tối, thanh đầu sáng, nút xanh/lam, bảng CRUD/bộ lọc/trạng thái; ảnh tổng hợp gồm dashboard, dữ liệu không gian, ảnh vệ tinh, tài nguyên, phân tích, cảnh báo, tin tức, phản ánh, người dùng, nhật ký.
- Mobile 14 màn hình: khởi động; đăng nhập/đăng ký; trang chủ; bản đồ; chi tiết điểm; tài nguyên; cảnh báo; ảnh vệ tinh; tin tức; chi tiết tin; phản ánh; thời tiết; tài liệu/PDF; cá nhân/cài đặt. Tông trắng/xanh rừng/navy, bottom navigation, tab và biểu mẫu GPS/ảnh.

## Khác biệt và giới hạn phải giữ

1. Dùng v1.1 để diễn giải những phần được bổ sung/sửa, giữ bản gốc để truy vết; không tự xem các đề xuất kỹ thuật là quyết định chủ đầu tư đã phê duyệt.
2. Gốc/v1/ảnh Admin có chữ xử lý GEE; v1.1 chuyển thuật toán nghiệp vụ sang Python. Không triển khai theo nhãn cũ.
3. Gốc có hai mô hình trọng số nguy cơ khác nhau (công thức mô tả 5 yếu tố và code 4 yếu tố), ngưỡng thử nghiệm và cách gọi FIRMS là cháy thực tế. v1/v1.1 yêu cầu hiệu chuẩn và xác minh; không áp dụng trực tiếp để phát cảnh báo chính thức.
4. Hệ mã v1 PUB/MAP/SAT/FOR/FIRE/MOB khác P/A trên sitemap. Admin sitemap A01 đăng nhập, A02 tổng quan…A13 phản ánh, nhưng ảnh tổng hợp A01 dashboard…A10 nhật ký. Mobile v1 có 8 nhóm nghiệp vụ, ảnh có 14 màn hình; cần lập bảng đối chiếu, không coi là thiếu/chốt sai chỉ theo số lượng.
5. P08 giới thiệu, P09 thời tiết, P11 hướng dẫn chưa có ảnh riêng; Admin chưa đủ bộ A01–A13 riêng; Mobile chỉ ảnh tổng hợp. Sitemap có vài nhãn mã con lệch nhóm.
6. Địa danh, ranh giới, KPI, cảnh báo, số liệu rừng, thời tiết, ảnh, độ chính xác mô hình, tài khoản minh họa đều không phải dữ liệu thực đã xác minh. Không dùng để seed dữ liệu thật hoặc tuyên bố có sự kiện đang xảy ra. Logo/tên tỉnh và cấp huyện trên ảnh cần đối chiếu phạm vi lịch sử/hiện hành.
7. Đa ngôn ngữ, trợ lý ảo, email/SMS là tùy chọn trên sitemap; đăng nhập Google/Microsoft hiện diện ở mockup, chưa phải tích hợp đã được chốt.
8. Chưa có source code, dữ liệu GIS nghiệp vụ, raster thật, khóa API, DB hoạt động hay triển khai được kiểm tra. Nội dung code trong tài liệu chỉ là tài liệu tham khảo, không phải lệnh yêu cầu thực thi.

## Nghiệm thu và vấn đề cần chốt khi bắt đầu phát triển

Các giai đoạn đề xuất: nền tảng → viễn thám → cháy rừng → MobileGIS → vận hành/chuyển giao. Kiểm quyền Public/Admin/địa bàn, import SHP/GeoJSON/GeoTIFF và CRS/topology, bản đồ, job Python, offline/conflict/retry, xác minh cảnh báo, xuất PDF/Excel, backup/restore. Kiểm tình huống điểm ngoài rừng, báo động giả, mây/ảnh trống, trùng phản ánh, mất mạng. Mục tiêu 95% API đọc đơn giản dưới 2 giây chỉ tại tải kiểm thử được thống nhất.

Cần chốt ranh giới và cơ quan phê duyệt; quyền sử dụng dữ liệu rừng/tiểu khu/chủ rừng/điểm cháy xác minh; mức công khai vị trí và PII; quy trình phát hành cảnh báo, biểu mẫu/cấp duyệt/SLA; nguồn dự báo; quota GEE/giấy phép nền/chi phí/tải; schema/route contract và ánh xạ mã màn hình. Không tự suy diễn các điểm này từ prototype.


## Theo dõi công việc mới

Xem [TIEN_DO_DU_AN.md](TIEN_DO_DU_AN.md) để theo dõi kết quả thu thập ngày 16/10/2026, đường dẫn đầu ra, kiểm tra và phần còn thiếu. Trạng thái dịch vụ và dữ liệu trong file tiến độ mới thay thế các ghi chú “chưa tải/chưa xác thực” của đợt chuẩn bị trước.

Người dùng xác nhận hoàn tất dữ liệu/tài liệu trước, chưa triển khai ứng dụng trong đợt này. Dự báo và cảnh báo biến động rừng/cháy là chức năng bắt buộc; xem [đặc tả chuẩn bị](notes/DU_BAO_CANH_BAO.md) và [bộ bàn giao](DATA_HANDOVER.md). Không nhầm chuỗi quan sát với dự báo hoặc điểm nóng với cháy đã xác minh.
