# Dữ liệu và quy trình dự báo, cảnh báo

Ngày chốt yêu cầu: 16/10/2026. Phạm vi đợt này là chuẩn bị dữ liệu/tài liệu, chưa triển khai ứng dụng hoặc phát cảnh báo công khai.

## Các sản phẩm phải có trên website

| Sản phẩm | Ý nghĩa | Đầu vào | Đầu ra và điều kiện |
|---|---|---|---|
| Dự báo thời tiết | Diễn biến nhiệt độ, ẩm, gió, mưa trong tương lai | OpenWeather 40 điểm xã; 5 ngày, bước 3 giờ | Ghi thời điểm lấy, thời điểm hiệu lực, nguồn và độ cũ; không đổi thành dự báo 7 ngày |
| Dự báo nguy cơ cháy | Điều kiện thuận lợi cho phát sinh/lan cháy, không phải xác suất chắc chắn có cháy | Khí tượng đúng giờ, mưa 24 giờ, trạng thái ẩm tích lũy, loại nhiên liệu/rừng, địa hình, mô hình đã kiểm định | FWI hoặc mô hình được chọn phải có phiên bản, khởi tạo/warm-up, kiểm định và ngưỡng địa phương; xuất theo hạn dự báo |
| Cảnh báo điểm nóng | Phát hiện nhiệt của cảm biến | FIRMS, thời gian UTC/VN, FRP, confidence, vị trí và cảm biến | Hiển thị “điểm nóng chưa xác minh”; đối chiếu ranh rừng, chuyển xác minh; không tự ghi thành vụ cháy rừng |
| Dự báo biến động rừng | Dự báo xu hướng/chỉ số hoặc nguy cơ biến động trong một khoảng tương lai | Chuỗi ảnh đủ dài, mùa vụ, tác động con người, nhãn lịch sử xác minh và mô hình | Phải chốt mục tiêu: dự báo NDVI/NDMI khác dự báo xác suất mất rừng. Không dùng một mức giảm chỉ số để giả xác suất mất rừng |
| Cảnh báo biến động | Phát hiện quan sát mới lệch khỏi nền mùa vụ | Chuỗi Sentinel cùng mùa, QA mây, NDVI/NDMI/NBR, count quan sát, loại rừng/khộp, dữ liệu kiểm định | Polygon nghi vấn, mức độ bằng chứng, ngày quan sát trước/sau, nguyên nhân chưa xác định; chuyên môn thẩm định trước công bố kết luận |
| Cảnh báo chính thức | Thông tin đã được người có thẩm quyền phê duyệt | Kết quả mô hình, bằng chứng, xác minh và quyết định duyệt | Người duyệt, phạm vi, thời hạn, mức cảnh báo theo bộ quy tắc được duyệt, nội dung khuyến cáo, lịch sử thay đổi |

## Đầu vào đang chuẩn bị

- `data/collected/monitoring-series/`: 33 tháng Sentinel 01/2024–09/2026, tổ hợp median băng B2/B3/B4/B8/B11/B12 và số quan sát hợp lệ; lưới **100 m tổng quan**. Bản chi tiết 30 m hai mùa 2025 ở `data/processed/sentinel-2025-*-30m.tif`. Chuỗi tổng quan phục vụ khảo sát tính khả thi, chưa đủ để phát cảnh báo lô rừng nhỏ. Khi chốt khu vực/mô hình cần tải chuỗi chi tiết tương ứng.
- `data/collected/hourly-weather/`: gói ERA5-Land gồm T, Td, U10, V10 lúc **05:00 UTC = 12:00 Việt Nam** và mưa từng giờ. Chỉ coi là sẵn sàng sau kiểm tra manifest và báo cáo xử lý. ERA5-Land là tái phân tích lưới khoảng 11 km, không phải trạm tại xã và không phải dự báo tương lai.
- `data/collected/weather/communes.json`: dự báo OpenWeather thật. Bước 3 giờ thường không trùng đúng 12:00 Việt Nam; nếu mô hình cần đúng giờ, phải chọn sản phẩm giờ hoặc có quy tắc nội suy được kiểm định. Không dùng giá trị gần nhất rồi ghi nhãn như quan trắc đúng giờ.
- Mưa ERA5 dùng băng `total_precipitation_hourly`; không cộng lặp băng tích lũy. Chuyển m sang mm; giữ cờ giá trị âm hoặc thiếu, không tự xóa dấu lỗi. Cửa sổ 24 giờ phải được ghi theo giờ UTC, kiểm đủ 24 quan sát và kiểm ý nghĩa kết thúc khoảng của nguồn.
- T/Td đổi K sang °C; độ ẩm tương đối tính từ T/Td bằng công thức đã chọn và ghi phiên bản; gió tính `sqrt(u²+v²)`, đổi m/s sang km/h nếu FWI yêu cầu. Kiểm định đơn vị và thời gian trước huấn luyện.

## Điều kiện dữ liệu và kiểm định

1. Nhãn xác minh: có loại sự kiện, ngày xảy ra/quan sát/xác minh, polygon, nguồn chứng cứ, người xác minh, trạng thái duyệt; có cả trường hợp không cháy/không mất rừng để đo báo động giả. Thiếu nhãn thì đánh dấu **chưa đủ điều kiện kiểm định**, không tạo accuracy/AUC giả.
2. Chia train/test theo không gian và thời gian; không dùng dữ liệu tương lai hoặc mẫu cùng lô rò sang test. Backtest nhiều mùa khô/mưa; báo cáo riêng rừng khộp/rừng rụng lá.
3. Dự báo: đánh giá theo hạn dự báo, calibration/Brier cho xác suất nếu có, precision/recall, tỷ lệ báo động giả và lead time. Biến động: đánh giá polygon/diện tích và thời gian phát hiện, không chỉ pixel accuracy.
4. Không có dữ liệu hợp lệ do mây phải trả `insufficient_observations`, không trả “không biến động”. Dữ liệu dịch vụ quá cũ phải trả `stale`, không báo “nguy cơ thấp”.
5. Ngưỡng màu/cấp cảnh báo là cấu hình có người duyệt và phiên bản; không lấy ngưỡng mẫu trong prototype/code tài liệu làm ngưỡng vận hành.
6. Hiện chưa có nhãn, lớp nhiên liệu và bộ ngưỡng địa phương được duyệt: chưa thể hoàn thành mô hình cảnh báo có kiểm định chỉ bằng nguồn công khai đã tải.

## Trường dữ liệu cho triển khai

`forecast_run`: id, product_type, issued_at_utc, valid_from_utc, valid_to_utc, lead_hours, model_id/version, input_snapshot_ids, boundary_version, spatial_resolution_m, units, initialization_state_id, calibration_id, quality_status, publication_status, approver_id, approved_at.

`forecast_zone`: run_id, geometry/commune_code, value, uncertainty_lower/upper nếu mô hình có, probability chỉ khi đã hiệu chuẩn, risk_class và threshold_version chỉ khi đã duyệt, evidence_ids, missing_inputs.

`change_candidate`: id, geometry, observation_before/after, season, index_features, valid_observation_count, seasonal_leaf_fall_flag, source_scene_ids, model_version, verification_status, forest_reference_version.

`alert`: id, alert_type, forecast_run_id hoặc observation/candidate_id, geometry, severity, status, issued/expiry, verification_id, approved_by, message, public_visibility, supersedes_id. Tách cảnh báo với hồ sơ sự kiện; có khóa chống trùng và lịch sử thao tác.

## Quy trình và lịch cập nhật đề xuất

- Thu thời tiết theo hạn mức gói và cache, không gọi API từ mỗi lượt người dùng mở trang. Mỗi lần dự báo giữ snapshot đầu vào.
- FIRMS: kiểm bản cập nhật theo tần suất nguồn, deduplicate theo cảm biến/vị trí/thời gian; duy trì khả năng thu hồi/đính chính phát hiện.
- Ảnh: phát hiện cảnh mới → QA → tổ hợp phù hợp mùa → Python phân tích → đối chiếu nhiên liệu/rừng → tạo nghi vấn → người chuyên môn xác minh → phê duyệt → công bố.
- Dự báo nguy cơ: kiểm đủ chuỗi giờ/mưa/trạng thái mô hình → chạy từng lead → kiểm chất lượng → chuyên môn duyệt/cơ chế tự động được phê duyệt → công bố → hết hạn/được thay thế.
- Gửi thông báo ra email/push/SMS là bước vận hành riêng; đợt thu thập này không gửi thông báo cho người khác.

## Tài liệu kỹ thuật nguồn

- [NRCan — Fire Weather Index](https://cfs.nrcan.gc.ca/terms/read/1318): đầu vào khí tượng liên tiếp và mưa 24 giờ.
- [ERA5-Land hourly catalog](https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_HOURLY): đơn vị, băng mưa theo giờ, điều kiện ghi công.
- [OpenWeather 5 day / 3 hour](https://openweathermap.org/api/forecast5): giới hạn thời hạn và bước thời gian.
- [BFAST — tài liệu của nhóm phát triển](https://bfast.r-forge.r-project.org/): nền mùa vụ và giám sát sai lệch chuỗi. Là phương án nghiên cứu, chưa phải mô hình đã được chọn/kiểm định cho Kon Tum.
- [FIRMS](https://firms.modaps.eosdis.nasa.gov/): phát hiện nhiệt, không thay thế xác minh hiện trường.
