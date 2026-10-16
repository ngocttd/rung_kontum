# Nguồn dữ liệu phục vụ WebGIS MobileGIS Kon Tum

Tra cứu ngày 15/10/2026. Phạm vi nghiên cứu giữ tỉnh Kon Tum trước sáp nhập; đơn vị cấp xã dùng danh mục và polygon mới. Danh mục dưới đây phân biệt dữ liệu đã tải với nguồn mới khảo sát. Không đồng nhất số liệu toàn tỉnh Quảng Ngãi mới với vùng Kon Tum cũ.

## Ranh giới đã tải và kiểm tra

| Nguồn | Sản phẩm và phiên bản | Sử dụng và lưu ý |
|---|---|---|
| [Vietnamese Provinces Database](https://github.com/ThangLeQuoc/vietnamese-provinces-database) | v5.2.0; commit `8b78ba5118715e1fa81769286724db79346abf52`; metadata tạo 20/09/2026 | Đã tải 96 polygon xã/phường/đặc khu của Quảng Ngãi, danh mục mã và giấy phép MIT của kho. GIS được kho dẫn nguồn bản đồ tham chiếu của NXB Tài nguyên–Môi trường và Bản đồ Việt Nam; không coi bản cộng đồng là hồ sơ địa giới có thẩm quyền. |
| [geoBoundaries gbHumanitarian VNM ADM1](https://www.geoboundaries.org/api/current/gbHumanitarian/VNM/ADM1/) | Nguồn Government of Viet Nam/HDX, năm biểu diễn 2020; snapshot `9469f09`; 63 tỉnh | Đã tải và trích tỉnh Kon Tum; giữ nguyên toàn bộ tọa độ. CC BY 3.0 IGO theo metadata; ghi attribution Government of Viet Nam / HDX, qua geoBoundaries. Đây là baseline lịch sử có nguồn, chưa phải bản ranh do chủ đầu tư nghiệm thu. |
| [Nghị quyết sắp xếp cấp xã Quảng Ngãi trên cổng tỉnh](https://quangngai.gov.vn/tin-tuc/nghi-quyet-ve-viec-sap-xep-cac-don-vi-hanh-chinh-cap-xa-cua-tinh-quang-ngai-nam-2025.html) | Nội dung sắp xếp 2025, vận hành 01/07/2025 | Nguồn đối chiếu tên và tổ hợp xã cũ. Các khoản 49–81, 88–90 và các xã không sắp xếp liên quan vùng Kon Tum. Chưa dựng bảng pháp lý đầy đủ tất cả mã xã cũ–mới. |
| [HDX COD-AB Việt Nam](https://data.humdata.org/dataset/cod-ab-vnm) | Bản hiện tại 34 tỉnh, tạo 01/07/2025 | Đã kiểm metadata và tải gói để đối chiếu, không dùng thay đường bao Kon Tum cũ. |

Đầu ra: `data/boundaries/kon-tum-historical-province.geojson`, `kon-tum-new-communes-full.geojson`, `kon-tum-new-communes-clipped.geojson`, bảng `commune-spatial-crosswalk.csv`, `validation.json` và manifest SHA-256. Có 40 đơn vị được chọn bằng tỷ lệ diện tích giao vùng >50%: 37 xã, 3 phường. Bản full giữ nguyên polygon GitHub; bản clipped là sản phẩm dẫn xuất cắt theo AOI, không phải địa giới pháp lý mới.

CRS trao đổi EPSG:4326; kiểm diện tích bằng EPSG:32648. 96/96 polygon xã hợp lệ; không có mã trùng trong tập chọn. Sai lệch nguồn: AOI lịch sử chưa được phủ khoảng 31,3035 km²; xã mới vượt AOI khoảng 16,9569 km². Xã Ia Chim có tỷ lệ giao 97,3030%, được đánh dấu kiểm tra. Không tự kéo/snapping đường biên để che khác biệt; thống kê cần ghi rõ AOI, năm và phiên bản.

## Nguồn ảnh và dữ liệu môi trường đã khảo sát

| Nguồn chính | Dữ liệu / độ phân giải | Phục vụ trang và xử lý | Điều kiện sử dụng |
|---|---|---|---|
| [Sentinel-2 SR Harmonized](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED) | 10/20/60 m tùy băng; `COPERNICUS/S2_SR_HARMONIZED` | P02/P03, RGB, đa mùa, NDVI/NDMI/NBR; GEE lọc và xuất ảnh, Python phân tích | Sentinel data terms/Copernicus attribution; mask mây/bóng mây SCL, resample băng 20 m có ghi nhận; chưa tải raster. |
| [Landsat 8/9 Level 2](https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LC09_C02_T1_L2) | `LANDSAT/LC08/C02/T1_L2`, `LANDSAT/LC09/C02/T1_L2`; lưới SR 30 m | Chuỗi lịch sử, so sánh cùng mùa, nhiệt độ bề mặt | Dữ liệu USGS mở, ghi nguồn; áp dụng scale/offset, QA và kiểm mây; chưa tải. |
| [MODIS MOD11A1 v061](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD11A1) | LST ngày/đêm, 1 km, hằng ngày | Yếu tố nhiệt cho P04/P09 | NASA/MODIS attribution; QC, scale 0,02 K và đổi °C; LST khác nhiệt độ không khí; chưa tải. |
| [NASA FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/) | VIIRS 375 m, MODIS khoảng 1 km; CSV có tọa độ/thời gian | P02/P04, điểm nóng và luồng xác minh | Cần MAP_KEY riêng, chưa được cung cấp; không dùng khóa thời tiết/GEE thay thế. Nguồn NASA; giữ UTC, confidence, FRP, cảm biến. Không suy ra diện tích đám cháy từ kích thước pixel; chưa kết nối. |
| [ERA5-Land Hourly](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_HOURLY) | `ECMWF/ERA5_LAND/HOURLY`, khoảng 11 km, giờ | Mưa, gió, nhiệt/điểm sương, chuỗi khí tượng lịch sử | Copernicus/CDS terms và attribution; đây là tái phân tích, không thay nguồn dự báo. Chú ý biến tích lũy/reset; chưa tải. |
| [CHIRPS Daily v2](https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHG_CHIRPS_DAILY) | `UCSB-CHG/CHIRPS/DAILY`, 0,05°, mm/ngày | Mưa tích lũy, khô hạn, kiểm định theo mùa | Ghi nguồn CHC/UCSB và phiên bản; dữ liệu mưa quá khứ, độ trễ tùy sản phẩm; chưa tải. |
| [Copernicus DEM GLO-30](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) | DSM khoảng 30 m; [catalog GEE](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30) | Địa hình, độ dốc/hướng sườn, 3D | Giấy phép Copernicus DEM và attribution bắt buộc theo điều khoản; DSM không mặc định là địa hình trần; chưa tải. |
| [ESA WorldCover 2021 v200](https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200) | `ESA/WorldCover/v200`, 10 m, 11 lớp | Lớp phủ tham khảo và kiểm chéo | CC BY 4.0; năm 2021, không gọi là hiện trạng 2026; tree cover không thay lớp rừng pháp lý, không phân đủ rừng khộp; chưa tải. |
| [Dynamic World V1](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1) | 10 m, 9 lớp và xác suất theo ảnh | Chuỗi lớp phủ bổ trợ, theo dõi nghi vấn | CC BY 4.0; giữ xác suất/mây và thời điểm; không tự kết luận mất rừng; chưa tải. |
| [Global Forest Watch Data API](https://data-api.globalforestwatch.org/) | Mất tán cây/cảnh báo biến động theo từng bộ dữ liệu | Đối chiếu biến động và ưu tiên kiểm tra | Đọc license của từng layer/version; mất tán cây không đồng nghĩa phá rừng. Chưa chọn phiên bản hoặc tải. |
| [OpenWeather Current](https://openweathermap.org/api/current), [Forecast 5 ngày](https://openweathermap.org/api/forecast5) | Thời tiết theo tọa độ; dự báo bước 3 giờ/5 ngày | P01/P04/P09, Mobile | Khóa đã lưu server-side, chưa thử quyền gói. Không hứa dự báo 7 ngày từ endpoint 5 ngày; nếu cần 7 ngày phải kiểm gói One Call/nguồn khác. Cache, quota, timestamp, attribution theo gói. |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Đường, sông suối, điểm dân cư, POI | Bản đồ nền, tuyến tiếp cận | ODbL và attribution © OpenStreetMap contributors; dữ liệu cộng đồng cần kiểm. Không tải hàng loạt từ máy chủ tile công cộng; tuyến cứu hỏa cần xác minh khả năng tiếp cận. |
| [Protected Planet](https://www.protectedplanet.net/en/legal) | Khu bảo tồn và khu bảo vệ theo bộ cung cấp | P03, thông tin khu bảo tồn | Điều khoản riêng, không mặc định được tái phân phối; cần kiểm quyền và đối chiếu ranh chính thức. Chưa tải. |

GEE chỉ dùng tìm/QA/lấy ảnh hoặc tổ hợp xuất ảnh; các thuật toán nghiệp vụ chạy Python theo phụ lục v1.1. Chưa chạy job GEE, chưa tải kho raster và chưa kiểm quyền service account. Có thể khởi đầu bằng AOI + metadata cảnh ảnh, sau đó chọn mùa/năm và hạn mức trước khi tải lớn.

## Dữ liệu chính thức và nội dung website

- [Quyết định công bố hiện trạng rừng Quảng Ngãi năm 2025](https://vanban.quangngai.gov.vn/upload/2007099/20260403/QDUB_CONG_BO_HIEN_TRANG_RUNG_NAM_2025_signed_1a066.pdf): nguồn báo cáo/đối chiếu thống kê. Đã tìm thấy liên kết công khai; chưa trích số liệu hay kiểm toàn bộ phụ lục. Phải lọc đúng vùng Kon Tum cũ trước khi đưa vào dashboard.
- [Chi cục Kiểm lâm Quảng Ngãi](https://kiemlam.quangngai.gov.vn/): nguồn tin, công bố chuyên ngành và đầu mối dữ liệu. Dẫn link tin gốc, không tự sao chép ảnh/tin không rõ quyền tái sử dụng.
- [Cổng tỉnh về kiểm kê rừng](https://quangngai.gov.vn/tin-tuc/tin-chi-dao-dieu-hanh/kinh-te/kiem-ke-rung-tren-dia-ban-tinh.html): xác định đầu mối Sở NN&MT và quy trình kiểm kê. Cần xin lớp lô/khoảnh/tiểu khu, chủ rừng, ba loại rừng, hiện trạng/phê duyệt, mẫu kiểm định và sự kiện cháy đã xác minh; chưa thấy gói GIS mở đủ các lớp này.
- Bản đồ PDF, biểu mẫu hiện trường, hướng dẫn kỹ thuật: lấy bản được cơ quan chủ quản cho phép công bố, giữ ngày/phiên bản/nguồn và phân quyền nội bộ/công khai.
- Phản ánh, ảnh GPS, nhiệm vụ, nhật ký: dữ liệu phát sinh từ ứng dụng. Không tạo hồ sơ/điểm cháy giả để làm đầy trang. Chưa có dữ liệu thì hiển thị trạng thái trống.

## Điều kiện đưa vào vận hành

Mỗi layer/job cần source URL, snapshot/version, ngày tải, ngày hiệu lực, license/attribution, CRS, độ phân giải, QA, bbox, quyền công bố và lineage. Tách rõ rừng theo mục đích sử dụng, kiểu thảm thực vật và lớp phủ đất để tránh cộng trùng thống kê. Chưa có raster hoặc mô hình hiệu chuẩn thì không dựng bản đồ nguy cơ giả từ màu của prototype.
