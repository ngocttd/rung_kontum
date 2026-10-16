# Cấu hình cục bộ đã lưu

Đã lưu các biến do người dùng cung cấp vào `.env` ở gốc dự án; đã sao chép tệp JSON được chỉ định thành `.secrets/gee-key.json`. `.gitignore` loại trừ `.env`, `.env.*` (trừ `.env.example`), `.secrets/`, `.tools/` và dependencies. Không ghi giá trị bí mật trong tài liệu này.

Đã kiểm JSON có cấu trúc service account cùng các trường cần thiết. Chưa xác thực quyền GEE, quota, quyền project; chưa kết nối DB, Mapbox hoặc OpenWeather. Việc lưu cấu hình không đồng nghĩa các dịch vụ hoạt động.

Theo chỉ định hiện tại, DB sử dụng tài khoản người dùng đã cung cấp thay cho user mẫu trong docs. Không tự tạo DB hoặc thay mật khẩu. Khi xây web, chỉ phục vụ thư mục `public`; không phục vụ toàn bộ gốc repository. Backend đọc OpenWeather/GEE/DB từ môi trường, không đóng gói vào client. Mapbox public token chỉ được đưa ra client theo cấu hình có chủ đích, kiểm hạn chế origin và quyền.

Tệp khóa nguồn trong Downloads được giữ nguyên. Không chép `.env`/JSON vào assets, báo cáo, manifest công khai hay gói bàn giao hình ảnh.
