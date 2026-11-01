# Bản Apple dùng trong MobileGIS Kon Tum

Nguồn: geolocator_apple 2.3.15 từ pub.dev, bản khóa ban đầu của dự án.
Giữ LICENSE/AUTHORS và nguyên Dart/Objective-C; chỉ thay `darwin/geolocator_apple/Package.swift` để `bypassLocationAlways` luôn là `"1"`.

App chỉ dùng GPS khi mở. Xcode 27.1/Swift Package Manager đã biên dịch `BYPASS_PERMISSION_LOCATION_ALWAYS=0` dù lệnh Flutter có đặt biến môi trường bằng 1; điều đó giữ selector `requestAlwaysAuthorization` trong archive, có thể dẫn đến ITMS-90683 nếu không khai báo quyền Always.

Override này loại API Always khỏi bản iOS mà không yêu cầu quyền vị trí dư thừa. Không sửa pub cache toàn máy. Khi nâng geolocator cần kiểm tra lại bản chính thức, bỏ override nếu upstream có cấu hình ổn định tương đương.
