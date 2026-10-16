# Danh mục cần bàn giao từ cơ quan quản lý

Ngày: 16/10/2026. Đây là danh mục chuẩn bị nội bộ, chưa gửi yêu cầu cho đơn vị nào.

| Bộ dữ liệu | Trường/bằng chứng tối thiểu | Mục đích |
|---|---|---|
| Ranh pháp lý tỉnh cũ và xã hiện hành | CRS, ngày hiệu lực, văn bản phê duyệt, mã đơn vị, phiên bản và crosswalk cũ–mới | Nghiệm thu phạm vi và thống kê |
| Lô/khoảnh/tiểu khu và chủ quản lý | Mã ổn định, geometry, loại rừng, mục đích sử dụng, trạng thái, ngày cập nhật, mã chủ quản lý, quyền công khai | Tra cứu, chồng xếp cảnh báo, phân công |
| Lớp nhiên liệu/loại rừng, rừng khộp | Phân loại, mùa vụ, phương pháp, tỷ lệ sai số, thời điểm khảo sát | Mô hình cháy/biến động và loại báo động mùa vụ |
| Vụ cháy đã xác minh | Thời gian phát sinh/phát hiện/kết thúc, vị trí/polygon, diện tích, nguyên nhân đã kết luận, bằng chứng, nguồn và trạng thái duyệt | Kiểm định nguy cơ và phát hiện cháy |
| Biến động và mẫu không biến động | Polygon/mẫu, năm/mùa, loại chuyển đổi, ảnh trước/sau, kiểm tra hiện trường, độ tin cậy và người duyệt | Huấn luyện, spatial/temporal holdout, kiểm định |
| Trạm khí tượng | T, RH/Td, gió và cao độ đo, mưa, tọa độ/trạm, giờ/múi giờ, QC, đơn vị, khoảng thời gian | Hiệu chỉnh ERA5/dự báo và kiểm định FWI |
| Quy tắc cảnh báo | Mô hình/phiên bản được chấp thuận, ngưỡng/cấp, người duyệt, thời hạn, SLA, khuyến cáo | Công bố đúng thẩm quyền |
| Nội dung công khai | Giới thiệu đơn vị, đầu mối liên hệ, logo được phép, tin/ảnh có quyền, văn bản/hướng dẫn, phạm vi công khai | Hoàn thiện nội dung hành chính của web |
| Hồ sơ vận hành | Phản ánh, ảnh GPS, nhiệm vụ/tuần tra, timeline, quyền truy cập | Chuyển đổi dữ liệu cũ nếu có; không seed hồ sơ giả |

Định dạng: GeoPackage/GeoJSON hoặc SHP đủ thành phần + `.prj`; raster GeoTIFF; bảng UTF-8 CSV/XLSX có từ điển trường; tài liệu PDF bản ký và phụ lục. Gửi kèm manifest tên file/kích thước/SHA-256, ngày trích xuất, chủ sở hữu, giấy phép hoặc văn bản cho phép, người liên hệ và mức độ bảo mật.

Quy trình nhận: giữ gói gốc → kiểm tra mã độc/định dạng/checksum → kiểm CRS/geometry/mã trùng → kiểm ngày/đơn vị/khóa tham chiếu → nhập staging → báo lỗi → chuyên môn nghiệm thu → công bố theo quyền. Không tự điều chỉnh ranh pháp lý hoặc biến ô thiếu thành số 0.

Phân quyền: loại PII và vị trí nhạy cảm khỏi bộ public; danh tính người phản ánh và chủ rừng cá nhân cần chính sách được đơn vị quản lý duyệt. Khóa dịch vụ chuyển qua kênh riêng, không đặt trong tài liệu dữ liệu.
