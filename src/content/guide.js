// Tài liệu hướng dẫn sử dụng (công khai và quản trị). Ảnh minh hoạ chụp từ hệ thống thật: public/guide/*.webp
// Mỗi mục: id, title, icon, img, caption, intro, steps[], notes[] ({ type: 'tip' | 'warn', text })

const publicGuide = {
  title: 'Hướng dẫn sử dụng – Cổng thông tin công khai',
  lead: 'Dành cho người dân, doanh nghiệp, chủ rừng và cán bộ tra cứu thông tin. Không cần đăng nhập.',
  sections: [
    {
      id: 'tong-quan', title: '1. Tổng quan và điều hướng', icon: 'house-fill', img: 'p-home', caption: 'Trang chủ: số liệu nổi bật, dự báo – cảnh báo tổng hợp, tin tức và tài liệu',
      intro: 'Thanh menu trên cùng dẫn tới các trang chức năng: Trang chủ, Bản đồ, Tài nguyên rừng, Cảnh báo cháy rừng (gồm Biến động và dự báo mất rừng), Tin tức, Thống kê, Tài liệu, Phản ánh và Giới thiệu.',
      steps: [
        'Ô “Tìm kiếm…” ở góc phải tìm nhanh xã/phường, tin tức, tài liệu; chọn kết quả để mở trang tương ứng.',
        'Ô tìm kiếm không cần gõ dấu và nhận nhiều từ: tìm được trang chức năng, xã/phường, thôn/làng, toạ độ “14.35, 108.0”, mã phản ánh (PA-2026-0001), lớp bản đồ, tin tức, tài liệu.',
        'Trên điện thoại, bấm nút “⋯” để mở menu; các bảng và dải số liệu có thể vuốt ngang.',
        'Ở chân trang có liên kết Hướng dẫn – Hỏi đáp, Giới thiệu và nguồn dữ liệu.',
      ],
      notes: [{ type: 'tip', text: 'Mọi số liệu đều ghi nguồn và thời điểm cập nhật ngay bên dưới biểu đồ/bảng. Hãy đọc dòng nguồn trước khi trích dẫn.' }],
    },
    {
      id: 'ban-do', title: '2. Bản đồ WebGIS', icon: 'map-fill', img: 'p-map', caption: 'Bản đồ WebGIS: cây lớp bên trái, bản đồ ở giữa, thông tin đối tượng và dự báo bên phải',
      intro: 'Trang Bản đồ cho phép xem chồng nhiều lớp dữ liệu: ranh giới hành chính, tài nguyên rừng, lớp phủ theo năm (Dynamic World), biến động và dự báo mất rừng, điểm nóng và nguy cơ cháy, thời tiết, phản ánh, bản đồ chuyên đề đã xuất bản.',
      steps: [
        'Khung “Lớp bản đồ” (trái) có hai thẻ: “Chuyên đề” (các lớp nghiệp vụ, chia nhóm HÀNH CHÍNH, CHUYÊN ĐỀ RỪNG, CẢNH BÁO CHÁY RỪNG, MÔI TRƯỜNG & HIỆN TRƯỜNG, BẢN ĐỒ CHUYÊN ĐỀ) và “Dữ liệu nền” (bản đồ nền, ảnh Sentinel-2, địa hình, NDVI).',
        'Đánh dấu ô vuông để bật/tắt lớp. Dòng “Đang bật N lớp” cho biết số lớp đang hiển thị; “Tắt lớp chuyên đề” tắt nhanh tất cả.',
        'Biểu tượng bánh răng ⚙ mở thanh trượt độ trong suốt; biểu tượng ⋯ hiện nguồn và ý nghĩa lớp.',
        'Các lớp “theo xã” (che phủ, diện tích rừng, xác suất mất rừng, cấp nguy cơ cháy) tô màu toàn bộ xã; chỉ một lớp tô màu được bật tại một thời điểm.',
        'Nhấp vào xã, điểm nóng, điểm biến động hoặc phản ánh để xem chi tiết ở khung “Thông tin đối tượng” (thẻ Điểm nóng cháy / Rừng / Hành chính).',
        'Ô tìm kiếm trên bản đồ nhận tên địa danh hoặc toạ độ dạng “14.35, 108.0”.',
        'Thanh công cụ: Chọn, Đo khoảng cách, Đo diện tích (nhấp liên tiếp các đỉnh, nhấp đúp để kết thúc), Toạ độ (nhấp để sao chép), Xuất bản đồ (ảnh PNG), Chia sẻ (liên kết giữ vị trí và lớp đang bật), In.',
        '“Khoảng cách dân cư”: nhấp một điểm (ví dụ điểm cháy) để xem khoảng cách đường chim bay tới 3 thôn/làng gần nhất, đường giao thông gần nhất và cơ sở ứng cứu (PCCC, công an, y tế) – dữ liệu OpenStreetMap.',
        '“Chỉ đường”: nhấp điểm đi (hoặc bấm “dùng vị trí của tôi”) rồi nhấp điểm đến; hệ thống vẽ đường ngắn nhất trên mạng đường OpenStreetMap, ghi quãng đường và thời gian ước tính; đoạn từ đường tới đích trong rừng vẽ nét đứt (đi bộ).',
        '“So sánh ảnh” mở trang so sánh hai thời điểm ảnh vệ tinh bằng thanh trượt (mục 12).',
        'Nhóm MÔI TRƯỜNG & HIỆN TRƯỜNG có bản đồ nhiệt độ cao nhất, lượng mưa, tốc độ gió hôm nay (dự báo Open-Meteo nội suy từ 40 điểm xã) và ngày gần nhất của tái phân tích ERA5-Land (lưới ~11 km), kèm lớp mũi tên hướng gió.',
        'Nhóm CẢNH BÁO CHÁY RỪNG › “Yếu tố môi trường gây cháy”: độ ẩm thực vật NDMI (Sentinel-2 tháng mới nhất) và nhiệt độ bề mặt đất ban ngày LST (MODIS 8 ngày, 1 km).',
        'Thẻ “Dữ liệu nền” › “Phân loại ảnh (tự động)”: kết quả phân loại lớp phủ từ ảnh tháng do cán bộ công bố (ghi rõ độ chính xác).',
        'Các nút bên phải bản đồ đổi nền: Vệ tinh, Đường phố, Địa hình, Ảnh nền nhạt và chế độ 3D.',
        'Chú giải của các lớp đang bật hiện ở góc dưới bản đồ.',
      ],
      notes: [
        { type: 'tip', text: 'Có thể mở thẳng một lớp bằng liên kết, ví dụ /ban-do?lop=dw-2025; thêm #kinh_độ,vĩ_độ,mức_zoom để mở đúng vị trí.' },
      ],
    },
    {
      id: 'ban-do-chi-tiet', title: '3. Xem chi tiết lớp phủ và bản đồ chuyên đề', icon: 'zoom-in', img: 'p-map-lc', caption: 'Lớp phủ theo năm (Dynamic World) và bản đồ chuyên đề trên WebGIS',
      intro: 'Nhóm “Lớp phủ theo năm (Dynamic World, chuẩn hoá)” có một lớp cho mỗi năm từ 2016 đến năm hiện tại (năm hiện tại tạm tính), tự thêm khi có năm mới. Bản đồ lớp phủ do dự án cung cấp (LPR, 15 m) và bản đồ GeoTIFF đã xuất bản nằm ở nhóm “tham khảo”, chỉ để đối chiếu trực quan.',
      steps: [
        'Bật lớp, rồi phóng to bằng con lăn chuột hoặc nút “+”: ảnh tự tải ô chi tiết hơn.',
        'Lớp Dynamic World hiển thị ở lưới 100 m; mất tán cây Hansen 30 m; bản đồ GeoTIFF giữ độ phân giải gốc.',
        'Bản đồ chuyên đề GeoTIFF do cơ quan xuất bản nằm ở nhóm “BẢN ĐỒ CHUYÊN ĐỀ”; nút ⋯ hiện đơn vị, năm và sai số nắn chỉnh (nếu có).',
      ],
      notes: [{ type: 'warn', text: 'Lớp “Rừng” trong bản đồ lớp phủ là kết quả giải đoán ảnh vệ tinh, không thay thế hiện trạng rừng pháp lý theo kết quả theo dõi diễn biến rừng.' }],
    },
    {
      id: 'tai-nguyen', title: '4. Tài nguyên rừng', icon: 'tree-fill', img: 'p-forest', caption: 'Trang Tài nguyên rừng',
      intro: 'Xem hiện trạng rừng theo 40 xã/phường theo quyết định công bố mới nhất (chọn được năm số liệu khác nếu đã nạp), quy hoạch 3 loại rừng, biến động tán rừng và lớp phủ qua các năm.',
      steps: [
        'Chọn thẻ ở đầu trang: Tổng quan, Hiện trạng rừng, Phân loại rừng, Rừng đặc dụng/phòng hộ/sản xuất, Lớp phủ qua các năm.',
        'Thẻ “Lớp phủ qua các năm”: biểu đồ diện tích 8 lớp phủ mọi năm (chọn toàn vùng hoặc một xã); chọn “năm đầu → năm cuối” để xem cây gỗ giữ nguyên/mất/tăng, ma trận chuyển đổi lớp phủ và bảng mất – tăng cây gỗ theo xã.',
        'Ô “Năm” ở khung bộ lọc: số liệu hiện trạng công bố (các năm đã nạp) hoặc lớp phủ Dynamic World từng năm; bản đồ lớp phủ của dự án ghi rõ “tham khảo”.',
        'Khung “Bộ lọc dữ liệu”: chọn năm, loại rừng, đơn vị hành chính, các lớp hiển thị thêm rồi bấm “Áp dụng bộ lọc”.',
        'Nhấp vào một xã trên bản đồ hoặc trong bảng để xem số liệu riêng của xã.',
      ],
      notes: [{ type: 'tip', text: 'Số liệu hiện trạng lấy theo quyết định công bố của UBND tỉnh; bản đồ tô theo xã vì chưa có polygon lô/khoảnh được duyệt công khai.' }, { type: 'warn', text: 'Thống kê lớp phủ dùng Google Dynamic World (chuẩn hoá toàn cầu). “Cây gỗ” gồm cả rừng trồng và cây lâu năm nên khác diện tích rừng pháp lý. Bản đồ ảnh/GeoTIFF/PDF do dự án cung cấp không được dùng để tính số liệu.' }],
    },
    {
      id: 'bien-dong', title: '5. Biến động và dự báo mất rừng', icon: 'graph-up-arrow', img: 'p-change', caption: 'Trang Biến động và dự báo mất rừng',
      intro: 'Theo dõi các vùng nghi vấn biến động phát hiện từ chuỗi ảnh Sentinel-2 hằng tháng, bản đồ xác suất mất rừng cho giai đoạn dự báo kế tiếp và lịch sử mất tán cây Hansen từ 2001 đến năm mới nhất đã phát hành (tự nâng phiên bản).',
      steps: [
        'Danh sách “Biến động nghi vấn” xếp theo mức độ; nhấp một dòng để bay tới vị trí và xem “Chi tiết điểm biến động” (chênh lệch NDVI/NBR, diện tích, trạng thái xác minh).',
        'Bảng “Dự báo nguy cơ mất rừng theo xã” cho biết xác suất và diện tích dự báo; phần “Kiểm định mô hình” trình bày độ tin cậy (AUC).',
        'Cột “Mất tán cây” trong bảng dự báo: chọn 5 năm gần nhất hoặc từng năm. Ma trận chuyển đổi lớp phủ xem ở Tài nguyên rừng › Lớp phủ qua các năm.',
      ],
      notes: [
        { type: 'warn', text: 'Điểm “nghi vấn” chưa phải kết luận mất rừng. Chỉ khi cán bộ xác minh thực địa, trạng thái mới chuyển thành “Xác nhận mất rừng” hoặc “Không phải mất rừng / Rụng lá theo mùa”.' },
        { type: 'tip', text: 'Hệ thống tự động tải ảnh tổng hợp tháng mới và tính lại vào ngày 5 hằng tháng (hoặc hằng quý nếu quản trị chọn), khi ảnh tháng trước đã đủ – ảnh quang học hay bị mây nên không cập nhật theo ngày/tuần.' },
      ],
    },
    {
      id: 'chay-rung', title: '6. Cảnh báo cháy rừng', icon: 'fire', img: 'p-fire', caption: 'Trang Cảnh báo cháy rừng',
      intro: 'Gồm cấp dự báo nguy cơ cháy (chỉ số P Nesterov, 5 cấp theo quy định) cho hôm nay và 7 ngày tới ở từng xã, điểm nóng vệ tinh NASA FIRMS 7 ngày và lịch sử.',
      steps: [
        'Chọn ngày ở khung “Dự báo nguy cơ cháy rừng” để đổi màu bản đồ theo cấp của ngày đó.',
        'Bảng “Cảnh báo theo xã” liệt kê xã có cấp III trở lên; cảnh báo có nhãn “Đã phê duyệt công bố” là cảnh báo chính thức.',
        'Nhấp điểm nóng để xem thời gian, vệ tinh, độ tin cậy, lớp phủ tại vị trí và trạng thái xác minh.',
        'Biểu đồ “Diễn biến điểm nóng và nguy cơ cháy” so sánh 7 ngày qua và 7 ngày tới.',
      ],
      notes: [
        { type: 'warn', text: 'Ba loại thông tin cần phân biệt: (1) Dự báo nguy cơ – thời tiết thuận lợi cho cháy, không phải đang cháy; (2) Điểm nóng vệ tinh – điểm nhiệt bất thường, có thể là đốt nương, đốt rác; (3) Sự kiện đã xác minh – do cán bộ kiểm tra thực địa.' },
        { type: 'tip', text: 'Thời gian hiện trên bản đồ: điểm chưa xác minh 7 ngày kể từ lúc phát hiện; điểm đang xác minh, xác nhận cháy, đang xử lý hiện cho đến khi đóng hồ sơ; điểm đã kết thúc hiện thêm 7 ngày; điểm “không phải cháy rừng” ẩn ngay. Sau đó dữ liệu không bị xoá – tra cứu, xem trên bản đồ và tải CSV ở trang Cảnh báo cháy rừng → thẻ Lịch sử điểm nóng.' },
        { type: 'tip', text: 'Điểm nóng cập nhật tự động mỗi 30 phút; dự báo khí tượng 3 giờ/lần; số liệu tái phân tích ERA5-Land 1 lần/ngày.' },
      ],
    },
    {
      id: 'phan-anh', title: '7. Gửi và tra cứu phản ánh hiện trường', icon: 'megaphone-fill', img: 'p-report', caption: 'Trang Phản ánh hiện trường',
      intro: 'Người dân gửi thông tin về cháy rừng, phá rừng, khai thác/vận chuyển lâm sản trái phép, xâm lấn đất rừng, động vật hoang dã… kèm ảnh và vị trí.',
      steps: [
        'Bấm “Gửi phản ánh mới”, chọn loại phản ánh, nhập mô tả (thời gian, hiện tượng quan sát được).',
        'Chọn vị trí bằng cách nhấp trên bản đồ hoặc nút “Lấy vị trí GPS” (trên điện thoại).',
        'Đính kèm tối đa 5 ảnh; nhập họ tên, số điện thoại để cán bộ liên hệ (không công khai).',
        'Bấm Gửi và ghi lại mã hồ sơ dạng PA-2026-xxxx.',
        'Tra cứu tiến độ: nhập mã hồ sơ ở khung “Thông tin phản ánh” rồi bấm “Tra cứu”. Các trạng thái: Đã tiếp nhận → Đang xác minh → Đang xử lý → Đã xử lý / Không đủ căn cứ → Đã đóng.',
      ],
      notes: [{ type: 'tip', text: 'Danh sách công khai chỉ hiện phản ánh đã được cán bộ cho phép công khai; thông tin người gửi luôn được bảo mật. Mỗi địa chỉ gửi tối đa 5 phản ánh/giờ để chống spam.' }],
    },
    {
      id: 'tai-lieu', title: '8. Tài liệu, bản đồ PDF', icon: 'file-earmark-pdf-fill', img: 'p-docs', caption: 'Trang Tài liệu',
      intro: 'Tra cứu văn bản pháp lý, báo cáo, dữ liệu chuyên ngành và bản đồ chuyên đề dạng PDF đã xuất bản. Bản đồ GeoTIFF/ảnh bản đồ là dữ liệu bản đồ – xem trên trang Bản đồ (nhóm tham khảo) hoặc qua API chia sẻ.',
      steps: [
        'Chọn danh mục ở khung trái hoặc lọc theo loại tài liệu, cơ quan ban hành, từ khoá.',
        'Nhấp một tài liệu để xem trước ngay trên trang; khung thông tin hiển thị số hiệu, ngày ban hành, dung lượng, mã SHA-256 để kiểm tra tính toàn vẹn.',
        'Bấm “Tải về” để lưu tệp gốc. Bản đồ PDF có bản GeoTIFF/ảnh tương ứng đã thành lớp còn có nút “Xem trên bản đồ”.',
      ],
    },
    {
      id: 'thong-ke', title: '9. Thống kê – báo cáo', icon: 'bar-chart-fill', img: 'p-stats', caption: 'Trang Thống kê',
      intro: 'Tổng hợp số liệu theo xã: rừng, mất tán cây, điểm nóng theo tháng, số ngày theo cấp nguy cơ cháy, dự báo mất rừng. Mọi năm, giai đoạn trên trang lấy từ dữ liệu mới nhất.',
      steps: [
        'Ô “Năm số liệu”: chọn năm hiện trạng rừng đã nạp (mặc định năm mới nhất); bảng, bản đồ và tệp xuất theo năm đã chọn.',
        'Chọn chỉ tiêu để tô màu bản đồ thống kê theo xã.',
        'Phần “Xuất báo cáo”: tải bảng Excel (.xlsx) hoặc CSV, kèm ghi chú nguồn dữ liệu.',
      ],
    },
    {
      id: 'thoi-tiet', title: '10. Thời tiết và tin tức', icon: 'cloud-sun-fill', img: 'p-weather', caption: 'Trang Thời tiết',
      intro: 'Trang Thời tiết hiển thị thời tiết hiện tại, dự báo 7 ngày, khí hậu 2024–2025 và thời tiết từng xã. Trang Tin tức đăng thông báo, hướng dẫn, văn bản chính sách đã được cán bộ xuất bản.',
      steps: ['Chọn xã trong bảng “Thời tiết các xã” để xem chi tiết.', 'Ở trang Tin tức, lọc theo chuyên mục và nhấp tiêu đề để đọc toàn văn.'],
    },
    {
      id: 'di-dong', title: '11. Sử dụng trên điện thoại', icon: 'phone-fill', img: 'p-mobile', caption: 'Giao diện trên điện thoại', narrow: true,
      intro: 'Có hai cách dùng trên điện thoại: mở trang web (giao diện tự co giãn) hoặc cài ứng dụng MobileGIS Kon Tum (Android/iOS). Ứng dụng có bản đồ, cảnh báo, tin tức như trang web, thêm GPS, chụp ảnh/quay video và gửi phản ánh cả khi mất mạng.',
      steps: [
        'Trang web: bấm “⋯” để mở menu; khi gửi phản ánh, cho phép trình duyệt truy cập vị trí.',
        'Ứng dụng: chọn “Tiếp tục với vai trò Khách” để xem ngay, hoặc đăng ký tài khoản người dân (số điện thoại/email) để theo dõi phản ánh của mình.',
        'Phản ánh trong ứng dụng tự lưu nháp; khi mất mạng được giữ trên máy và tự gửi khi có mạng (mục Cá nhân → Dữ liệu ngoại tuyến & đồng bộ).',
        'Cá nhân → Cài đặt: chỉnh cỡ chữ, tương phản cao, chọn xã/phường muốn nhận thông báo cảnh báo đã phê duyệt.',
      ],
    },
    {
      id: 'so-sanh-anh', title: '12. So sánh ảnh vệ tinh', icon: 'layout-split', img: 'p-compare', caption: 'So sánh ảnh Sentinel-2 tháng 10/2025 và 10/2026 bằng thanh trượt',
      intro: 'Trang So sánh ảnh (Bản đồ › nút “So sánh ảnh”, hoặc /so-sanh-anh) đặt hai ảnh chồng lên nhau trên cùng khung nhìn để nhận ra thay đổi lớp phủ.',
      steps: [
        'Chọn ảnh “Bên trái” và “Bên phải”: ảnh tháng Sentinel-2 (màu tự nhiên, giả màu hồng ngoại, NDVI) của bất kỳ tháng nào có ảnh, hoặc sản phẩm khác (lớp phủ 1991/2014/2023, WorldCover, NDMI, phân loại đã công bố).',
        'Kéo thanh trắng ở giữa (hoặc dùng phím ←/→) để quét qua lại; phóng to, kéo bản đồ ở một bên – bên kia đi theo.',
        'Nút ⇅ đổi hai bên; “Tải ảnh bên phải” lưu ảnh đang xem (WebP).',
      ],
      notes: [{ type: 'tip', text: 'Ảnh một tháng được dựng lần đầu khi chọn (vài giây), các lần sau mở ngay. Vùng trống là pixel bị mây che cả tháng.' }],
    },
    {
      id: 'tai-khoan', title: '13. Tài khoản người dân, bình luận tin bài', icon: 'person-circle', img: null, caption: '',
      intro: 'Người dân có thể đăng ký tài khoản ngay trên trang web (nút “Đăng nhập” › “Đăng ký”). Tài khoản dùng chung với ứng dụng MobileGIS.',
      steps: [
        'Đăng ký: nhập họ tên, số điện thoại hoặc email, mật khẩu (≥ 8 ký tự). Đăng nhập bằng số điện thoại/email.',
        '“Tài khoản của tôi”: danh sách mọi phản ánh đã gửi (cả từ ứng dụng) và tiến độ xử lý, số người cùng phản ánh tại vị trí đó; sửa họ tên, đổi mật khẩu; xem bình luận đã gửi.',
        'Gửi phản ánh khi đã đăng nhập: hồ sơ gắn với tài khoản, nhận thông báo khi được xử lý (trên ứng dụng).',
        'Bình luận tin bài: cuối mỗi tin có mục Bình luận; khách nhập họ tên, người có tài khoản bình luận bằng tên tài khoản. Bình luận hiển thị sau khi biên tập viên duyệt.',
      ],
      notes: [{ type: 'warn', text: 'Tài khoản cán bộ đăng nhập ở trang Quản trị (/quan-tri/dang-nhap), không dùng trang đăng nhập người dân.' }],
    },
  ],
  faq: [
    ['Vì sao bản đồ thể hiện cấp nguy cơ cao nhưng không có cháy?', 'Cấp nguy cơ phản ánh điều kiện thời tiết thuận lợi cho cháy (nắng nóng, khô, ít mưa). Cháy chỉ xảy ra khi có nguồn lửa; cấp cao là lúc cần tăng cường phòng ngừa.'],
    ['Điểm nóng vệ tinh có phải là cháy rừng?', 'Chưa chắc. Điểm nóng là điểm có nhiệt độ bất thường; có thể là đốt nương rẫy, đốt phụ phẩm, công trình. Trạng thái xác minh của cán bộ được ghi kèm từng điểm.'],
    ['Số liệu được cập nhật khi nào?', 'Điểm nóng: 30 phút/lần. Dự báo nguy cơ cháy: 3 giờ/lần. Tái phân tích ERA5-Land: hằng ngày. Ảnh Sentinel-2 và biến động rừng: hằng tháng (ngày 5) hoặc hằng quý. Hiện trạng rừng: theo quyết định công bố hằng năm.'],
    ['Thông tin cá nhân khi gửi phản ánh có bị công khai?', 'Không. Họ tên, số điện thoại chỉ cán bộ xử lý được xem; tra cứu bằng mã hồ sơ không hiển thị số điện thoại.'],
  ],
};

const adminGuide = {
  title: 'Hướng dẫn sử dụng – Phân hệ quản trị',
  lead: 'Dành cho Quản trị hệ thống, Cán bộ chuyên môn (Sở NN&MT / Kiểm lâm) và Lãnh đạo. Các chức năng hiển thị theo quyền của từng vai trò.',
  roles: [
    ['Quản trị hệ thống (admin)', 'Quản lý người dùng, cấu hình, dữ liệu, bản đồ (được xuất bản/thu hồi/xoá bản đồ), tin tức, tài liệu, chạy phân tích; cập nhật và đánh dấu đã kiểm tra phản ánh; nhập tin báo cháy. Không xác minh nghiệp vụ cảnh báo.'],
    ['Cán bộ chuyên môn (specialist)', 'Xác minh điểm nóng, biến động; phê duyệt cảnh báo nguy cơ cháy; xử lý phản ánh; quản lý dữ liệu, bản đồ (tải lên, cấu hình, nắn chỉnh, gửi duyệt), tin tức, tài liệu; chạy phân tích.'],
    ['Lãnh đạo (leader)', 'Xem toàn bộ dashboard, nhật ký; cập nhật và đánh dấu đã kiểm tra phản ánh; nhập tin báo cháy; phê duyệt công bố cảnh báo nguy cơ cháy.'],
  ],
  sections: [
    {
      id: 'dang-nhap', title: '1. Đăng nhập, đổi mật khẩu, đăng xuất', icon: 'key-fill', img: 'a-login', caption: 'Màn hình đăng nhập',
      intro: 'Truy cập /quan-tri (hoặc nút “Đăng nhập” trên cổng công khai).',
      steps: [
        'Nhập tên đăng nhập và mật khẩu do quản trị cấp. Sai quá 10 lần trong 15 phút sẽ bị tạm khoá đăng nhập.',
        'Lần đầu đăng nhập bằng mật khẩu tạm, vào “Cài đặt hệ thống” → đổi mật khẩu (tối thiểu 10 ký tự).',
        'Bấm “Đăng xuất” ở góc phải trên khi kết thúc phiên làm việc, nhất là trên máy dùng chung.',
      ],
    },
    {
      id: 'dashboard', title: '2. Dashboard', icon: 'grid-fill', img: 'a-dashboard', caption: 'Dashboard quản trị',
      intro: 'Tổng hợp nhanh: cảnh báo mới, điểm nóng 7 ngày, biến động nghi vấn, phản ánh chờ xử lý, độ mới của dữ liệu và các lần chạy phân tích gần nhất.',
      steps: ['Nhấp vào từng thẻ để đi tới trang xử lý tương ứng.', 'Mục “Độ mới dữ liệu” cảnh báo nguồn nào chưa cập nhật đúng hạn.'],
    },
    {
      id: 'du-lieu', title: '3. Dữ liệu không gian (lớp vector)', icon: 'layers-fill', img: 'a-layers', caption: 'Quản lý lớp dữ liệu không gian',
      intro: 'Nhập lớp vector bổ sung để hiển thị trên bản đồ công khai, ví dụ ranh giới khu bảo tồn, chòi canh lửa, tuyến tuần tra. Hỗ trợ GeoJSON, Shapefile (nén .zip), Excel .xlsx và CSV có cột toạ độ.',
      steps: [
        'Thẻ “Lớp dữ liệu bản đồ”: mọi lớp trên Bản đồ WebGIS, MobileGIS, trang Tài nguyên rừng và API chia sẻ (lớp hệ thống, lớp ảnh tự sinh, bản đồ PDF/GeoTIFF đã xuất bản, lớp vector). Sửa ô Nhóm, Tên hiển thị, Thứ tự hoặc đánh dấu Bật sẵn / Tài nguyên rừng → nút “Lưu thay đổi” của dòng đó sáng lên, bấm để lưu. “Ẩn/Hiện”: tạm gỡ khỏi bản đồ. “Xoá”: lớp vector bổ sung và bản đồ chuyên đề bị xoá hẳn dữ liệu; lớp hệ thống chỉ gỡ khỏi danh mục, khôi phục được ở mục “Lớp đã gỡ” cuối trang. Bản trùng dữ liệu được ẩn sẵn, có ghi chú lý do.',
        'Thẻ “Danh mục nhóm lớp”: quản lý các nhóm của cây lớp – tên nhóm, mục lớn (ví dụ TÀI NGUYÊN RỪNG), thẻ Chuyên đề/Dữ liệu nền, thứ tự, ẩn nhóm (ẩn mọi lớp trong nhóm). Thêm nhóm mới ở cuối trang rồi gán lớp vào nhóm ở thẻ “Lớp dữ liệu bản đồ”. Nhóm mặc định chỉ đổi tên/ẩn/sắp xếp; nhóm do quản trị thêm xoá được (lớp trong nhóm về nhóm mặc định).',
        'Thẻ “Nhập lớp”: chọn tệp (≤ 25 MB) và hệ toạ độ nguồn – để “Tự nhận” nếu Shapefile có .prj; Excel/CSV toạ độ mét chọn VN-2000 múi 3° KT 107°45′ (Kon Tum), VN-2000 UTM 48 hoặc WGS84/UTM 48N.',
        'Shapefile: nén .shp, .shx, .dbf, .prj (và .cpg) thành một tệp .zip. Excel/CSV: dòng đầu là tiêu đề, có cột lon/lat (Kinh độ/Vĩ độ) hoặc x/y; các cột khác thành thuộc tính.',
        'Hệ thống chuyển về WGS84, kiểm tra hình học; lớp hợp lệ vào “Chờ duyệt”, lỗi/cảnh báo (ví dụ cột kinh/vĩ bị đảo) được ghi ở cột ghi chú.',
        'Bấm “Duyệt công bố” để lớp xuất hiện trong nhóm “Lớp vector bổ sung” trên trang Bản đồ; “Gỡ công bố” để ẩn; “Sửa” để đổi tên, nguồn, mô tả, màu.',
        'Ô “Tìm trong danh sách”, nhấp tiêu đề cột để sắp xếp, “Hiển thị N dòng” để đổi số dòng – có ở mọi bảng quản trị.',
      ],
    },
    {
      id: 'api-lop', title: '3b. API chia sẻ và quản lý lớp (tích hợp hệ thống khác)', icon: 'code-slash', img: null, caption: '',
      intro: 'Đường dẫn trong API tự theo tên miền đang truy cập (khi chạy trên VPS sau Caddy là https://<tên miền>); có thể cố định bằng biến PUBLIC_BASE_URL trong .env. Chia sẻ: GET /api/v1/catalog (công khai, không cần đăng nhập) trả về mọi lớp đang hiển thị – ảnh raster kèm toạ độ góc và ô ảnh XYZ, bản đồ chuyên đề, GeoJSON lớp vector, lớp tô màu theo xã – để phần mềm GIS khác dùng lại. Quản lý: hệ thống khác tạo, cập nhật, công bố lớp vector qua /api/v1/layers và cấu hình/xoá lớp qua /api/v1/catalog (cần token). Trang Quản trị › Dữ liệu không gian › “API quản lý lớp” có đủ endpoint, ví dụ lệnh và mã các lớp hiện có; mô tả máy đọc được: GET /api/v1.',
      steps: [
        'Lấy token: POST /api/mobile/auth/login với {"username","password"} của tài khoản cán bộ → access_token (gia hạn bằng /api/mobile/auth/refresh).',
        'Gửi kèm header Authorization: Bearer <access_token>. Đọc: mọi cán bộ; ghi: tài khoản có quyền quản lý dữ liệu (Quản trị hệ thống, Cán bộ chuyên môn).',
        'GET /api/v1/layers (lọc ?status=staging|published|invalid, ?q=) · GET /api/v1/layers/{id} · GET /api/v1/layers/{id}/geojson.',
        'POST /api/v1/layers: JSON {"title","source","description","color","geojson"} hoặc multipart (file = .geojson/.zip/.xlsx/.csv, title, crs) → lớp vào vùng chờ.',
        'PATCH /api/v1/layers/{id} sửa thông tin · PUT /api/v1/layers/{id}/geojson thay dữ liệu (lớp quay về chờ duyệt) · POST …/publish, …/unpublish · DELETE /api/v1/layers/{id}.',
        'Mã lỗi: 401 thiếu/hết hạn token, 403 không đủ quyền, 422 dữ liệu không đạt kiểm tra (kèm danh sách lỗi), 413 quá 25 MB.',
      ],
      notes: [{ type: 'tip', text: 'Ví dụ: curl -H "Authorization: Bearer $TOKEN" -F title="Chòi canh lửa" -F file=@choi_canh.zip https://<máy chủ>/api/v1/layers. Mọi thao tác qua API được ghi nhật ký như trên giao diện.' }],
    },
    {
      id: 'ban-do', title: '4. Dữ liệu bản đồ (GeoTIFF/ảnh) và Bản đồ PDF', icon: 'map-fill', img: 'a-maps', caption: 'Danh sách dữ liệu bản đồ',
      intro: 'Hai mục tách riêng trên menu: “Dữ liệu bản đồ” (GeoTIFF, ảnh bản đồ JPG/PNG/TIFF, gói .mpk – sau khi duyệt thành lớp tham khảo trên WebGIS và API) và “Bản đồ PDF” (tài liệu, hiện ở trang Tài liệu). Cả hai theo quy trình: Tải lên → Xử lý → (Nắn chỉnh) → Gửi duyệt → Xuất bản. Dữ liệu bản đồ của dự án không dùng để tính thống kê.',
      steps: [
        'Lọc theo trạng thái, chuyên đề, định dạng hoặc tìm theo tên.',
        'Trạng thái: Đã tải lên → Đang xử lý → Cần nắn chỉnh / Chờ gửi duyệt → Chờ duyệt → Đã xuất bản; có thể Trả về hiệu chỉnh, Thu hồi; Lỗi xử lý nếu tệp hỏng.',
        'Nhấp tên bản đồ để mở trang chi tiết.',
      ],
    },
    {
      id: 'ban-do-moi', title: '5. Thêm bản đồ mới', icon: 'cloud-arrow-up-fill', img: 'a-map-new', caption: 'Bước 1–2: chọn loại bản đồ và tải tệp',
      intro: 'Trình hướng dẫn 4 bước theo báo cáo chuyên đề (PL.2–PL.4).',
      steps: [
        'Bước 1 – Chọn loại: GeoTIFF (có toạ độ), PDF bản đồ, Ảnh bản đồ, Gói bản đồ.',
        'Bước 2 – Kéo thả tệp (GeoTIFF ≤ 2 GB, PDF ≤ 200 MB, ảnh ≤ 500 MB) và nhập thông tin: tên, chuyên đề, năm, tỷ lệ, đơn vị cung cấp, phạm vi truy cập (công khai/nội bộ), mô tả.',
        'Hệ thống kiểm tra định dạng thật của tệp (không chỉ phần mở rộng), tính SHA-256, đọc hệ toạ độ, kích thước, số băng, số trang và tạo ảnh xem trước.',
        'Bước 3 – Xem trước và cấu hình hiển thị (xem mục 6). Bước 4 – Gửi duyệt.',
      ],
      notes: [{ type: 'warn', text: 'Tệp sai định dạng bị từ chối ngay kèm thông báo. Tệp gốc được lưu nguyên vẹn, không bị chỉnh sửa.' }],
    },
    {
      id: 'ban-do-chi-tiet', title: '6. Chi tiết bản đồ: cấu hình, nắn chỉnh, phiên bản, duyệt', icon: 'gear-fill', img: 'a-map-detail', caption: 'Trang chi tiết: xem trước trên bản đồ nền, thông tin kỹ thuật, cấu hình hiển thị',
      intro: 'Trang chi tiết gồm xem trước trên bản đồ nền, thông tin kỹ thuật, cấu hình hiển thị, nắn chỉnh, danh sách tệp, phiên bản công bố và nhật ký.',
      steps: [
        'Cấu hình hiển thị: chọn Màu tự nhiên/tổ hợp RGB hoặc Đơn kênh + bảng màu, ngưỡng min/max, giá trị NoData, độ trong suốt mặc định → “Lưu và xử lý lại”. Hệ thống tạo lại lớp hiển thị, COG và ô ảnh (tile) độ phân giải gốc.',
        'Nắn chỉnh (PDF/ảnh không có toạ độ): chọn trang, nhấp điểm trên ảnh và nhập kinh độ/vĩ độ tương ứng (tối thiểu 3 điểm cho affine, 6 điểm cho đa thức bậc 2). Hệ thống báo sai số RMSE (m) và sai số từng điểm; RMSE lớn cần kiểm tra lại điểm khống chế.',
        'Cập nhật phiên bản: tải tệp mới ở mục “Phiên bản tệp”; tệp cũ và lịch sử công bố được giữ.',
        'Cán bộ bấm “Gửi duyệt”. Quản trị “Xuất bản” (ghi chú duyệt), “Trả về hiệu chỉnh” (kèm lý do) hoặc “Thu hồi” bản đã công bố.',
        'Bản đồ có toạ độ được xuất bản sẽ hiện trong nhóm “BẢN ĐỒ CHUYÊN ĐỀ” trên trang Bản đồ; bản đồ PDF công khai hiện ở trang Tài liệu.',
        'Ảnh bản đồ toàn tỉnh không có toạ độ (xuất từ bố cục): thẻ “Tự định vị theo hình tỉnh” tách đường viền tỉnh trên ảnh, khớp với ranh giới tỉnh thật và báo độ trùng khớp (IoU) cùng sai số ranh giới (m). Đạt ngưỡng thì bấm “Duyệt hiển thị lớp trên bản đồ”.',
        'Kiểm soát chất lượng: lớp chỉ hiện trên bản đồ khi nắn chỉnh có RMSE ≤ 50 m hoặc tự định vị sai số ≤ 500 m; bản đồ PDF chỉ là tài liệu, không hiển thị thành lớp.',
      ],
      notes: [{ type: 'tip', text: 'Quyền được kiểm tra ở máy chủ: cán bộ không xuất bản hay xoá được dù cố gửi yêu cầu trực tiếp. Mọi thao tác ghi vào nhật ký bộ dữ liệu.' }],
    },
    {
      id: 'anh-ve-tinh', title: '7. Ảnh vệ tinh và tài nguyên rừng', icon: 'globe2', img: 'a-imagery', caption: 'Ảnh vệ tinh Sentinel-2 theo tháng',
      intro: 'Trang “Ảnh vệ tinh” liệt kê ảnh tổng hợp Sentinel-2 theo tháng (tỷ lệ điểm ảnh hợp lệ, chỉ số NDVI/NDMI/NBR); trang “Tài nguyên rừng” có hai thẻ: “Hiện trạng rừng (số liệu công bố)” – nạp số liệu năm mới từ tệp Excel biểu 4 của quyết định (tải lên → kiểm tra khớp 40 xã → xác nhận), và “Chuỗi lớp phủ hằng năm” – trạng thái dữ liệu Dynamic World từng năm, nút “Cập nhật ngay”.',
      steps: [
        'Thẻ “Chuỗi ảnh hằng tháng”: tỷ lệ điểm ảnh hợp lệ (không mây) từng tháng; nhấp ô tháng để xem ảnh màu tự nhiên; “GeoTIFF” tải ảnh gốc 6 băng (B2, B3, B4, B8, B11, B12) + số quan sát, 100 m.',
        'Thẻ “Phân loại ảnh”: chọn tháng (nên chọn tháng mùa khô ít mây) → “Chạy phân loại”. Mô hình Random Forest học từ 389 mẫu thực địa Mau_KON_TUM_2025, phân 5 lớp; bảng kết quả ghi độ chính xác (đánh giá chéo), kappa, diện tích từng lớp; xem ảnh, tải GeoTIFF; “Công bố” để hiện trên bản đồ công khai.',
        '“So sánh ảnh” mở trang so sánh hai tháng/hai sản phẩm bằng thanh trượt.',
        'Thẻ “Sản phẩm hiển thị” liệt kê và cho tải ảnh mọi lớp ảnh trên bản đồ. Ảnh tháng mới được tải tự động bởi tác vụ “Ảnh Sentinel-2 tháng mới…” ở trang Phân tích.',
      ],
      notes: [{ type: 'warn', text: 'Phân loại tự động (100 m, độ chính xác ~68%) chỉ để tham khảo, phát hiện thay đổi lớn; số liệu rừng chính thức theo quyết định công bố hằng năm.' }],
    },
    {
      id: 'phan-tich', title: '8. Phân tích (Python) và lịch chạy tự động', icon: 'graph-up-arrow', img: 'a-analysis', caption: 'Lịch chạy tự động các luồng phân tích',
      intro: 'Các luồng xử lý Python chạy tự động theo lịch để giám sát, cảnh báo liên tục mà không cần thao tác tay.',
      steps: [
        '“Cập nhật khí tượng Open-Meteo và chỉ số nguy cơ cháy” – mặc định mỗi 3 giờ.',
        '“Cập nhật tái phân tích ERA5-Land (GEE)…” – mặc định mỗi ngày (ERA5-Land trễ khoảng 5 ngày).',
        '“Ảnh Sentinel-2 tháng mới, biến động nghi vấn và dự báo nguy cơ mất rừng” – chỉ chọn được mỗi tháng (mặc định) hoặc mỗi quý; chạy ngày 5 lúc 02:00 (quý: tháng 1, 4, 7, 10) để tháng vừa kết thúc đã đủ ảnh. Ảnh quang học hay bị mây nên không đặt chu kỳ ngày/tuần. Dòng báo lỗi có liên kết “xem nhật ký lỗi”.',
        '“Dựng lại lớp ảnh bản đồ…” – chỉ chạy tay khi dữ liệu nền thay đổi.',
        'Khung “Phân tích biến động rừng”: (1) Tự động theo lịch – chọn “Chờ duyệt trước khi công bố” hoặc “Tự công bố”; khi có kết quả mới chờ duyệt, bấm “Công bố kết quả mới”. (2) Chạy thủ công – chỉ chọn từ tháng … đến tháng (từ 01/2025, tối đa 12 tháng) → “Chạy phân tích”.',
        'Kỳ đối chứng (cùng các tháng của 1–2 năm trước) và ngưỡng phát hiện do hệ thống tự xác định theo dữ liệu từng kỳ – người dùng không cần nhập; giá trị đã dùng hiện ở trang kết quả. Kết quả chỉ ra bản đồ công khai khi người có quyền bấm “Công bố ra bản đồ”.',
        'Điểm nóng NASA FIRMS là dịch vụ nền 30 phút/lần, có kiểm tra hạn mức khoá API trước khi tải.',
        'Đổi chu kỳ hoặc bật/tắt tự động ở cột “Tự động”, “Chu kỳ” rồi bấm “Lưu lịch”. “Chạy ngay” để chạy tức thì.',
        'Bấm “Nhật ký” ở bảng Lịch sử chạy để xem log từng bước.',
      ],
      notes: [
        { type: 'tip', text: 'Chỉ một tác vụ chạy cùng lúc. Lỗi được tự thử lại sau 30 phút (tối đa 3 lần liên tiếp). Bước thu thập (*) lỗi mạng/hạn mức không làm dừng tác vụ: hệ thống tính tiếp bằng dữ liệu đã có và ghi cảnh báo.' },
        { type: 'warn', text: 'Kết quả tự động là dự báo; cảnh báo nguy cơ cháy chỉ thành cảnh báo chính thức sau khi được phê duyệt ở mục Cảnh báo.' },
      ],
    },
    {
      id: 'canh-bao', title: '9. Cảnh báo cháy & biến động: xác minh, phê duyệt', icon: 'fire', img: 'a-alerts', caption: 'Thẻ Điểm nóng (FIRMS)',
      intro: 'Các thẻ: Điểm nóng / điểm cháy (tự động FIRMS + nhập thủ công), Nhập thủ công điểm cháy, Nguy cơ cháy (P/FWI), Biến động rừng.',
      steps: [
        'Điểm nóng / điểm cháy: cán bộ chuyên môn cập nhật trạng thái theo luồng Mới phát hiện → Cần xác minh → Đang xác minh → Xác nhận cháy / Không phải cháy rừng → Đang xử lý → Kết thúc, kèm người được giao và ghi chú. Trạng thái hiện ngay trên bản đồ công khai. Lọc “Mọi nguồn / Tự động (NASA FIRMS) / Nhập thủ công”. Danh sách gồm điểm chưa xác minh 7 ngày, điểm còn đang xử lý (dù đã cũ – có ghi “đang theo dõi”) và điểm mới kết luận trong 7 ngày; điểm cũ hơn xem ở “Lịch sử điểm nóng”.',
        'Nhập thủ công điểm cháy (khi có tin báo không đến từ vệ tinh, hoặc vệ tinh bỏ sót do mây, cháy nhỏ, cháy dưới tán): bấm “Nhập điểm cháy”, bấm trên bản đồ để lấy toạ độ (kéo ghim để chỉnh) hoặc nhập toạ độ GPS, chọn thời điểm phát hiện, nguồn tin (kiểm lâm, tổ chống cháy/xã, người dân báo tin, phản ánh…), diện tích ước tính, mô tả. Điểm nhập tay có mã CH-<năm>-<số>, đi chung danh sách, bản đồ và quy trình xác minh với điểm nóng FIRMS, luôn ghi rõ nguồn “Nhập thủ công”. Mô tả và người nhập chỉ cán bộ xem.',
        'Trạng thái ban đầu: quản trị và lãnh đạo nhập tin ở trạng thái “Mới phát hiện” (chờ cán bộ chuyên môn xác minh); cán bộ chuyên môn có thể nhập thẳng “Xác nhận cháy” khi đã kiểm tra hiện trường – khi đó người dân và thiết bị theo dõi xã nhận thông báo “Đã xác minh cháy rừng” trên MobileGIS.',
        'Nguy cơ cháy: danh sách xã – ngày có cấp III trở lên. Cán bộ chuyên môn hoặc lãnh đạo chọn “Phê duyệt công bố” hoặc “Không công bố”.',
        'Biến động rừng: xác minh từng điểm nghi vấn thành Xác nhận mất rừng / Không phải mất rừng / Rụng lá theo mùa. Kết quả xác minh là nhãn để hiệu chỉnh mô hình về sau.',
      ],
      notes: [{ type: 'warn', text: 'Quản trị hệ thống không xác minh nghiệp vụ (tách bạch quản trị kỹ thuật và chuyên môn), nhưng được nhập tin báo cháy để cán bộ chuyên môn xác minh.' }],
      extra: [['a-alerts-danger', 'Thẻ Nguy cơ cháy – phê duyệt công bố'], ['a-alerts-change', 'Thẻ Biến động rừng – xác minh điểm nghi vấn']],
    },
    {
      id: 'hien-truong', title: '9b. Nhiệm vụ hiện trường (MobileGIS)', icon: 'geo-alt-fill', img: 'a-field', caption: 'Nhiệm vụ & xác minh hiện trường',
      intro: 'Kết nối web với ứng dụng MobileGIS của cán bộ: giao nhiệm vụ xác minh/khảo sát theo địa bàn, nhận kết quả có GPS và ảnh bằng chứng, duyệt kết quả.',
      steps: [
        'Giao nhiệm vụ: chọn loại (xác minh điểm nóng, biến động, phản ánh, hoặc khảo sát hiện trạng), mã đối tượng, cán bộ thực hiện (hoặc để cán bộ phụ trách xã tự nhận), hạn hoàn thành.',
        'Nhanh hơn: ở trang Cảnh báo bấm “Giao xác minh (MobileGIS)” cạnh điểm nóng/biến động; ở trang Phản ánh chọn “Phân công cán bộ” – nhiệm vụ tự xuất hiện trong ứng dụng của cán bộ.',
        'Cán bộ nhận nhiệm vụ, đến hiện trường, nộp kết quả (GPS kèm sai số, ảnh/video, kết luận, kiến nghị) – kể cả khi mất mạng, ứng dụng tự gửi khi có mạng.',
        'Thẻ “Kết quả xác minh”: người có thẩm quyền (cán bộ chuyên môn khác hoặc lãnh đạo) bấm Duyệt hoặc Trả lại. Duyệt “Có cháy rừng” chuyển điểm nóng sang “Xác nhận cháy”; không ai tự duyệt kết quả của mình.',
        'Thẻ “Khảo sát hiện trạng”: chấp thuận/từ chối khảo sát điểm – đường – vùng. Rừng khộp khảo sát mùa khô được hệ thống ghi chú “chưa đủ căn cứ kết luận mất rừng”.',
        'Thẻ “Xung đột đồng bộ”: các trường hợp dữ liệu trên máy chủ đã thay đổi khi cán bộ chỉnh sửa ngoại tuyến – không ghi đè âm thầm, cán bộ tự chọn cách xử lý trong ứng dụng.',
      ],
      notes: [{ type: 'tip', text: 'Ứng dụng có “Đăng nhập nhanh theo vai trò” ở môi trường thử nghiệm để kiểm tra toàn bộ luồng; tắt khi triển khai chính thức.' }],
    },
    {
      id: 'phan-anh', title: '10. Xử lý phản ánh hiện trường', icon: 'megaphone-fill', img: 'a-reports', caption: 'Danh sách phản ánh',
      intro: 'Tiếp nhận và xử lý phản ánh gửi từ cổng công khai và ứng dụng MobileGIS. Quản trị, lãnh đạo và cán bộ chuyên môn đều cập nhật được hồ sơ.',
      steps: [
        'Thẻ “Danh sách phản ánh”: lọc theo trạng thái, loại phản ánh, đã kiểm tra / chưa kiểm tra; bấm “Xử lý” để mở chi tiết (ảnh, video, vị trí trên bản đồ, thông tin liên hệ).',
        'Thẻ “Bản đồ phản ánh”: hiện vị trí chính xác của các phản ánh theo bộ lọc, viền màu theo trạng thái xử lý; bấm điểm (hoặc dòng bên phải) để xem tóm tắt và mở hồ sơ.',
        'Kiểm tra hồ sơ: bấm “Đánh dấu đã kiểm tra” ngay trên danh sách hoặc trong chi tiết; hệ thống ghi người và thời điểm kiểm tra vào lịch sử xử lý (có thể bỏ đánh dấu).',
        'Cập nhật trạng thái (Đã tiếp nhận → Đang xác minh → Đang xử lý → Đã xử lý / Không đủ căn cứ → Đã đóng), giao người xử lý, ghi chú nội bộ và ghi chú công khai. Người gửi có tài khoản nhận thông báo khi hồ sơ đổi trạng thái.',
        'Phản ánh loại “Cháy rừng”: khung “Điểm cháy trong cảnh báo” cho phép “Tạo điểm cháy – chờ xác minh” hoặc (cán bộ chuyên môn) “Xác nhận cháy và thông báo”. Điểm cháy được gắn với hồ sơ và xuất hiện trong Quản lý cảnh báo.',
        'Đánh dấu “Cho phép công khai” để phản ánh hiện trên bản đồ và danh sách công khai (không kèm thông tin người gửi).',
        'Nhãn “N người cùng báo”: hệ thống đếm phản ánh của người gửi khác trong bán kính 500 m, ±14 ngày; trang chi tiết liệt kê mã các hồ sơ đó để gộp xử lý.',
      ],
      notes: [{ type: 'tip', text: 'Phản ánh mới (nhất là tin báo cháy) được thông báo ngay tới cán bộ phụ trách xã và lãnh đạo trên MobileGIS. Cán bộ chuyên môn gửi phản ánh “Cháy rừng” bằng GPS tại hiện trường thì hệ thống coi là đã xác minh: tự tạo điểm cháy “Xác nhận cháy” và thông báo cho người dân trong xã.' }],
    },
    {
      id: 'tin-tuc', title: '11. Tin tức', icon: 'newspaper', img: 'a-news-form', caption: 'Soạn tin',
      intro: 'Soạn, duyệt và xuất bản tin tức, thông báo.',
      steps: [
        '“Thêm tin”: nhập tiêu đề, chuyên mục, tóm tắt, nội dung, ảnh đại diện (JPG/PNG/WebP), nguồn.',
        'Lưu ở trạng thái Nháp, gửi Chờ duyệt hoặc Xuất bản (nếu có quyền xuất bản).',
        'Ở danh sách, dùng nút trạng thái để xuất bản, gỡ hoặc lưu trữ tin.',
        'Thẻ “Bình luận”: bình luận của bạn đọc chờ duyệt (số trên thẻ); “Duyệt” để hiển thị công khai, “Ẩn” hoặc xoá bình luận không phù hợp.',
      ],
      extra: [['a-news', 'Danh sách tin tức']],
    },
    {
      id: 'tai-lieu', title: '12. Tài liệu', icon: 'file-earmark-pdf-fill', img: 'a-docs', caption: 'Quản lý tài liệu',
      intro: 'Tải lên văn bản, báo cáo PDF (≤ 40 MB) để công bố ở trang Tài liệu.',
      steps: ['Chọn tệp PDF, nhập tên, danh mục, số hiệu, cơ quan ban hành, ngày ban hành → “Tải lên”.', '“Sửa” ở cột thao tác để cập nhật thông tin tài liệu đã tải lên; tìm kiếm, sắp xếp, chọn số dòng ngay trên bảng.', 'Bản đồ PDF đưa vào mục “Bản đồ PDF”, GeoTIFF/ảnh bản đồ đưa vào “Dữ liệu bản đồ” để có quy trình duyệt và xem trước.'],
    },
    {
      id: 'nguoi-dung', title: '13. Người dùng và phân quyền', icon: 'people-fill', img: 'a-users', caption: 'Quản lý người dùng (chỉ quản trị)',
      intro: 'Tạo tài khoản, gán/đổi vai trò và phạm vi xã phụ trách, khoá/mở khoá và đặt lại mật khẩu.',
      steps: ['Nhập tên đăng nhập, họ tên, vai trò, phạm vi → “Tạo”; hệ thống sinh mật khẩu tạm hiển thị một lần.', '“Sửa” dưới tên người dùng để cập nhật họ tên, email, điện thoại; “Cấp lại mật khẩu” sinh mật khẩu tạm mới; “Khóa/Mở khóa” tài khoản.', 'Khoá tài khoản khi cán bộ chuyển công tác thay vì xoá, để giữ lịch sử thao tác. Tài khoản người dân tự đăng ký (web/ứng dụng) cũng hiện ở đây.'],
    },
    {
      id: 'nhat-ky', title: '14. Nhật ký hệ thống và cài đặt', icon: 'clock-history', img: 'a-audit', caption: 'Nhật ký hệ thống (chỉ ghi thêm, không sửa/xoá được)',
      intro: 'Nhật ký ghi mọi thao tác quan trọng: đăng nhập, xác minh, phê duyệt, xuất bản, thay đổi lịch chạy… Trang Cài đặt hiển thị trạng thái kết nối cơ sở dữ liệu PostGIS, khoá dịch vụ (chỉ báo có/không, không hiện giá trị), hạn mức FIRMS.',
      steps: ['Lọc nhật ký theo người dùng và nhóm hành động (đăng nhập, phản ánh, điểm nóng, biến động…).', 'Kiểm tra định kỳ trang Cài đặt để phát hiện dịch vụ ngoài bị lỗi.', 'Cài đặt › “Phiên bản ứng dụng MobileGIS”: khai báo phiên bản mới, phiên bản tối thiểu, nội dung cập nhật và liên kết tải (Android/iOS) → ứng dụng hiện thẻ “Có phiên bản mới” khi mở; “Gửi thông báo” đẩy tin tới mọi thiết bị.'],
      extra: [['a-settings', 'Cài đặt hệ thống']],
    },
  ],
};


// ---------- Ứng dụng MobileGIS (ảnh chụp thật từ ứng dụng: public/guide/mobile/*.webp) ----------
const P = (f, c) => [`mobile/${f}`, c];
const mobileGuide = {
  title: 'Hướng dẫn sử dụng – Ứng dụng MobileGIS Kon Tum',
  lead: 'Ứng dụng di động (Android/iOS) kết nối với WebGIS: người dân tra cứu và gửi phản ánh; cán bộ nhận nhiệm vụ, khảo sát, xác minh tại hiện trường có toạ độ và ảnh bằng chứng; lãnh đạo giao việc và duyệt kết quả.',
  roles: [
    ['Khách (không đăng nhập)', 'Xem bản đồ, cảnh báo, tài nguyên rừng, ảnh vệ tinh, tin tức, thời tiết, tài liệu công khai; gửi phản ánh và tra cứu bằng mã hồ sơ.'],
    ['Người dân có tài khoản', 'Như khách, thêm: xem danh sách và tiến độ mọi phản ánh của mình, nhận thông báo khi hồ sơ được xử lý.'],
    ['Cán bộ Sở NN&MT / Kiểm lâm', 'Nhận nhiệm vụ theo địa bàn, xác minh điểm nóng / biến động / phản ánh, khảo sát cập nhật hiện trạng rừng, duyệt kết quả của cán bộ khác.'],
    ['Lãnh đạo / UBND', 'Xem tổng hợp, giao nhiệm vụ khảo sát, duyệt kết quả xác minh; không sửa dữ liệu hiện trường.'],
    ['Quản trị', 'Dùng chủ yếu trên web quản trị; trong ứng dụng chỉ xem, không xác minh nghiệp vụ.'],
  ],
  sections: [
    {
      id: 'cai-dat', title: '1. Cài đặt và khởi động', icon: 'phone-fill',
      intro: 'Cài ứng dụng do đơn vị cung cấp (tệp APK cho Android hoặc qua kho ứng dụng). Khi mở, ứng dụng kiểm tra kết nối và phiên đăng nhập; mất mạng vẫn vào được dữ liệu đã lưu.',
      phones: [P('m01-splash', 'Màn hình khởi động'), P('m02-login', 'Đăng nhập / Đăng ký')],
      steps: [
        'Android: mở tệp APK, cho phép “Cài ứng dụng không rõ nguồn” nếu được hỏi. iOS: cài qua TestFlight/App Store theo hướng dẫn của đơn vị.',
        'Cho phép quyền Vị trí (gắn toạ độ), Camera và Ảnh (chụp bằng chứng). Nếu từ chối vẫn có thể chọn vị trí trên bản đồ.',
        'Biểu tượng máy chủ ở góc trên màn đăng nhập dùng để đổi địa chỉ máy chủ (đội kỹ thuật cung cấp).',
      ],
    },
    {
      id: 'dang-nhap', title: '2. Đăng nhập, đăng ký, vai trò Khách', icon: 'key-fill',
      intro: 'Thông tin công khai xem được không cần đăng nhập. Người dân tự đăng ký bằng số điện thoại hoặc email; cán bộ dùng tài khoản do đơn vị cấp.',
      phones: [P('m03-quick', 'Đăng nhập nhanh theo vai trò (môi trường thử nghiệm)'), P('m35-switch-role', 'Đổi vai trò từ mục Cá nhân')],
      steps: [
        'Đăng nhập: nhập tên đăng nhập / số điện thoại / email và mật khẩu. Sai quá 5 lần, tài khoản tạm khoá 15 phút.',
        'Đăng ký (người dân): thẻ “Đăng ký” – họ tên, số điện thoại hoặc email, mật khẩu ≥ 8 ký tự, đồng ý chính sách bảo vệ dữ liệu.',
        '“Tiếp tục với vai trò Khách” để xem ngay không cần tài khoản.',
        'Môi trường thử nghiệm: khối “Đăng nhập nhanh theo vai trò” vào ngay bằng tài khoản demo (Người dân, Cán bộ kiểm lâm, Cán bộ địa bàn xã, Lãnh đạo, Quản trị). Đổi vai trò bất cứ lúc nào bằng nút ở Trang chủ hoặc Cá nhân → “Đăng nhập nhanh / đổi vai trò”. Bản phát hành chính thức không có khối này.',
      ],
      notes: [{ type: 'tip', text: 'Phiên đăng nhập được lưu an toàn trên máy; khi đổi mật khẩu, mọi thiết bị khác tự đăng xuất.' }],
    },
    {
      id: 'trang-chu', title: '3. Trang chủ', icon: 'house-fill',
      intro: 'Tổng quan đã công bố (diện tích rừng, điểm nóng 7 ngày, cấp nguy cơ cháy), lối tắt 9 chức năng, cảnh báo gần đây, tin nổi bật. Mỗi số liệu ghi nguồn và thời điểm cập nhật.',
      phones: [P('m04-home', 'Trang chủ (người dân)'), P('m24-officer-home', 'Trang chủ (cán bộ) – thẻ nhiệm vụ đang mở')],
      steps: ['Khi có phiên bản ứng dụng mới, Trang chủ hiện thẻ “Có phiên bản mới” (bấm Cập nhật để tải; bản quá cũ bắt buộc cập nhật). Chạm thông báo “MobileGIS có phiên bản mới” cũng mở liên kết tải.', 'Kéo xuống để tải lại.', 'Chuông góc phải: thông báo (số chưa đọc).', 'Cán bộ: thẻ xanh đậm cho biết số nhiệm vụ đang mở / quá hạn; thẻ cam nhắc bản ghi chưa gửi khi mất mạng.'],
    },
    {
      id: 'ban-do', title: '4. Bản đồ', icon: 'map-fill',
      intro: 'Ranh giới 40 xã/phường, điểm nóng, biến động rừng, lớp phủ, ảnh vệ tinh, phản ánh công khai; cán bộ thấy thêm lớp nhiệm vụ.',
      phones: [P('m06-map', 'Bản đồ và thanh lớp nhanh'), P('m07-layers', 'Bảng lớp dữ liệu, độ mờ, lọc thời gian')],
      steps: [
        'Ô tìm kiếm: gõ tên xã/phường hoặc toạ độ “14.35, 108.0” rồi chọn kết quả.',
        'Nút bên phải: Lớp dữ liệu, Bản đồ nền (vệ tinh, đường phố, địa hình, nền nhạt), Vị trí của tôi (hiện sai số GPS), Đo đạc (khoảng cách / diện tích), Toàn vùng.',
        'Thanh dưới bật/tắt nhanh nhóm lớp: Hành chính, Rừng, Điểm cháy, Ảnh vệ tinh, Biến động.',
        'Bảng Lớp dữ liệu: tô màu xã theo cấp nguy cơ cháy hoặc tỷ lệ che phủ; lọc điểm nóng 24 giờ / 48 giờ / 7 ngày; chỉnh độ mờ, xem chú giải lớp ảnh.',
        'Chạm điểm/biểu tượng hoặc một xã để mở chi tiết.',
      ],
      notes: [{ type: 'warn', text: 'Khi GPS sai số lớn (> 30 m) ứng dụng hiện cảnh báo; nên chọn vị trí trên bản đồ khi gửi dữ liệu.' }],
    },
    {
      id: 'chi-tiet', title: '5. Chi tiết đối tượng', icon: 'info-circle-fill',
      intro: 'Thuộc tính, nguồn, thời gian, trạng thái xác minh; nút Chỉ đường (Google Maps), Xem khu vực, Chia sẻ, Gửi phản ánh tại vị trí; cán bộ có thêm nút “Xác minh tại hiện trường”.',
      phones: [P('m08-object', 'Chi tiết điểm nóng – nhãn “Chưa xác minh”')],
      notes: [{ type: 'warn', text: 'Ứng dụng luôn phân biệt kết quả phân tích tự động / chưa xác minh với thông tin đã được cán bộ xác minh và phê duyệt.' }],
    },
    {
      id: 'chay-rung', title: '6. Cảnh báo cháy rừng', icon: 'fire',
      intro: 'Ba thẻ: Hiện tại (cảnh báo đã phê duyệt và điểm nóng), Dự báo (chỉ số P Nesterov hôm nay và 7 ngày tới theo xã), Lịch sử (điểm nóng theo tháng, xã nhiều điểm nóng).',
      phones: [P('m09-fire', 'Hiện tại'), P('m10-fire-forecast', 'Dự báo theo xã'), P('m11-fire-history', 'Lịch sử')],
      steps: ['Nút “Chỉ đường”: ứng dụng lấy vị trí GPS và vẽ đường ngắn nhất trên mạng đường OpenStreetMap tới đối tượng (quãng đường, thời gian ước tính, đoạn đi bộ nét đứt từ đường vào rừng), kèm thôn/làng và cơ sở ứng cứu gần đích; có nút mở bằng ứng dụng bản đồ khác.', 'Lọc theo cấp: Tất cả / Cấp III+ / Cấp IV+.', 'Thẻ Dự báo: chọn xã để xem cột chỉ số P tô màu theo cấp I–V, kèm nhiệt độ, độ ẩm, mưa, FWI.'],
      notes: [{ type: 'warn', text: 'Dự báo nguy cơ là điều kiện thời tiết thuận lợi cho cháy, không phải đang cháy. Chỉ cảnh báo có nhãn “đã phê duyệt” là cảnh báo chính thức.' }],
    },
    {
      id: 'tai-nguyen', title: '7. Tài nguyên rừng và ảnh vệ tinh', icon: 'tree-fill',
      intro: 'Tài nguyên rừng: tổng quan, cơ cấu 3 loại rừng, diện tích theo xã; thẻ Phân loại tách riêng rừng khộp; thẻ Biến động có mất tán cây hằng năm, dự báo nguy cơ mất rừng, biến động nghi vấn. Ảnh vệ tinh: sản phẩm Sentinel-2 đã xử lý, chỉ số NDVI/NDMI/NBR theo tháng, so sánh trước–sau.',
      phones: [P('m12-forest', 'Tài nguyên rừng'), P('m13-imagery', 'Ảnh vệ tinh')],
      notes: [{ type: 'warn', text: 'Rừng khộp rụng lá mùa khô: NDVI thấp mùa khô không đồng nghĩa mất rừng.' }],
    },
    {
      id: 'tra-cuu', title: '8. Tin tức, thời tiết, tài liệu', icon: 'newspaper',
      intro: 'Tin tức đã duyệt theo chuyên mục; thời tiết hiện tại, dự báo 7 ngày và chỉ số FWI theo xã; tài liệu – bản đồ PDF công khai để xem và tải.',
      phones: [P('m14-news', 'Tin tức'), P('m18-weather', 'Thời tiết'), P('m19-documents', 'Tài liệu – bản đồ PDF')],
    },
    {
      id: 'phan-anh', title: '9. Gửi phản ánh hiện trường', icon: 'megaphone-fill',
      intro: 'Gửi thông tin cháy rừng, phá rừng, lấn chiếm, vận chuyển lâm sản trái phép, động vật hoang dã… kèm vị trí và ảnh/video.',
      phones: [P('m15-report', 'Biểu mẫu phản ánh'), P('m16-report2', 'Ảnh/video và gửi'), P('m17-myreports', 'Lịch sử – tra cứu mã hồ sơ')],
      steps: ['Trong chi tiết phản ánh của tôi, dòng “Cùng vị trí” cho biết số người đã báo cùng sự việc gần đó (cơ quan xử lý gộp thông tin).', 
        'Trang chủ → “Phản ánh hiện trạng” (hoặc “Gửi phản ánh tại vị trí này” trong chi tiết đối tượng).',
        'Chọn loại, mô tả (≥ 10 ký tự). Vị trí tự lấy GPS; tín hiệu yếu thì bấm “Chọn trên bản đồ” (kéo bản đồ đặt điểm đỏ) hoặc “Nhập toạ độ”.',
        'Thêm tối đa 5 ảnh/video (chụp, chọn có sẵn hoặc quay ≤ 60 giây).',
        'Bấm “Gửi phản ánh” → nhận mã hồ sơ PA-…; thẻ “Lịch sử phản ánh” để xem tiến độ hoặc tra cứu bằng mã.',
      ],
      notes: [
        { type: 'tip', text: 'Bản nháp tự lưu liên tục: tắt ứng dụng hay mất mạng giữa chừng vẫn không mất. Khi mất mạng, phản ánh được giữ trên máy và tự gửi khi có mạng, không tạo hồ sơ trùng.' },
        { type: 'warn', text: 'Thông tin người gửi chỉ cán bộ xử lý xem. Khi thấy cháy đang lan, gọi ngay 114 hoặc kiểm lâm địa bàn.' },
      ],
    },
    {
      id: 'ca-nhan', title: '10. Cá nhân, cài đặt, thông báo', icon: 'people-fill',
      intro: 'Hồ sơ, đổi mật khẩu, phản ánh của tôi, thông báo, dữ liệu ngoại tuyến, cài đặt, hướng dẫn, hỗ trợ – đường dây nóng, đăng xuất.',
      phones: [P('m20-me', 'Cá nhân'), P('m36-settings-push', 'Cài đặt – Thông báo'), P('m38-notif-feed', 'Thông báo')],
      steps: [
        'Cài đặt: cỡ chữ, tương phản cao, chọn xã/phường nhận thông báo, tự động gửi khi có mạng, xoá dữ liệu lưu tạm, địa chỉ máy chủ.',
        'Thông báo gồm: cảnh báo nguy cơ cháy đã phê duyệt và cháy rừng đã xác minh (gửi người dân, thiết bị theo dõi xã); cập nhật hồ sơ phản ánh của bạn; với cán bộ thêm phản ánh/tin báo cháy mới trong địa bàn, nhiệm vụ mới và kết quả duyệt xác minh. Không phát cảnh báo khẩn từ điểm nóng hay tin báo chưa xác minh.',
        'Cài đặt → Thông báo: “Thời gian thực” cho biết ứng dụng đang kết nối máy chủ (nhận ngay khi mở). Để nhận cả khi ứng dụng ở nền hoặc đã đóng: cho phép thông báo khi ứng dụng hỏi (Android 13+, iOS); dòng “Khi ứng dụng ở nền / đã đóng” hiện “Firebase Cloud Messaging – đã đăng ký”. Bấm “Bật / đăng ký lại” nếu chưa đăng ký, “Gửi thông báo thử” để kiểm tra.',
        'Đăng xuất: token bị thu hồi trên máy chủ, dữ liệu nghiệp vụ lưu tạm bị xoá; có tuỳ chọn đăng xuất mọi thiết bị.',
      ],
    },
    {
      id: 'dong-bo', title: '11. Dữ liệu ngoại tuyến và đồng bộ', icon: 'clock-history',
      intro: 'Phản ánh, khảo sát, kết quả xác minh, thao tác nhận/bắt đầu nhiệm vụ đều vào hàng đợi trên máy trước, rồi gửi khi có mạng.',
      phones: [P('m22-sync', 'Đồng bộ ngoại tuyến')],
      steps: [
        'Cá nhân → “Dữ liệu ngoại tuyến & đồng bộ”: xem số bản ghi chờ gửi, bấm “Đồng bộ ngay”.',
        'Trạng thái bản ghi: Chờ gửi, Đang gửi, Đã gửi (kèm mã hồ sơ), Bị từ chối (kèm lý do – gửi lại hoặc xoá), Xung đột.',
        'Xung đột (dữ liệu trên máy chủ đã bị người khác thay đổi): chọn “Giữ bản máy chủ” hoặc “Áp dụng của tôi”. Hệ thống không tự ghi đè.',
      ],
    },
    {
      id: 'nhiem-vu', title: '12. Cán bộ – Nhiệm vụ hiện trường', icon: 'geo-alt-fill',
      intro: 'Nhiệm vụ do web quản trị hoặc lãnh đạo giao: xác minh điểm nóng, biến động, phản ánh hoặc khảo sát hiện trạng. Cán bộ giới hạn theo xã chỉ thấy nhiệm vụ thuộc địa bàn mình.',
      phones: [P('m25-tasks', 'Danh sách nhiệm vụ'), P('m26-task', 'Chi tiết nhiệm vụ'), P('m30-task-accepted', 'Sau khi nhận – các nút thực hiện')],
      steps: [
        'Tab “Nhiệm vụ” → Cần làm / Đã nộp / Tất cả. Nhiệm vụ quá hạn hiện chữ đỏ.',
        'Mở nhiệm vụ: đọc hướng dẫn, xem bản đồ vị trí, “Chỉ đường” tới hiện trường.',
        'Bấm “Nhận nhiệm vụ”, tới nơi bấm “Bắt đầu thực hiện”, rồi “Nộp kết quả xác minh” hoặc “Nộp khảo sát hiện trạng”.',
      ],
    },
    {
      id: 'xac-minh', title: '13. Cán bộ – Xác minh tại hiện trường', icon: 'fire',
      intro: 'Ghi nhận kết luận (có/không có cháy, mất rừng / rụng lá theo mùa, đúng/không đúng phản ánh), mức độ, diện tích cháy, loại rừng, mùa, mô tả, kiến nghị, toạ độ và ảnh bằng chứng.',
      phones: [P('m31-verify', 'Biểu mẫu xác minh'), P('m32-verify2', 'Mô tả, kiến nghị, ảnh bằng chứng')],
      steps: [
        'Vị trí tại hiện trường lấy bằng GPS (ứng dụng hiện khoảng cách tới vị trí cảnh báo).',
        'Chọn kết luận; với “Có cháy rừng” nhập thêm mức độ và diện tích ước tính.',
        'Bắt buộc ít nhất 1 ảnh bằng chứng; có thể quay video.',
        'Bấm “Nộp kết quả xác minh” – kết quả chờ người có thẩm quyền duyệt rồi trạng thái cảnh báo mới thay đổi.',
      ],
      notes: [{ type: 'warn', text: 'Rừng khộp mùa khô: không chọn “Xác nhận mất rừng” nếu chưa có bằng chứng gốc chặt, chuyển đổi đất… – cả ứng dụng và máy chủ đều chặn kết luận thiếu căn cứ.' }],
    },
    {
      id: 'khao-sat', title: '14. Cán bộ – Khảo sát cập nhật hiện trạng', icon: 'tree-fill',
      intro: 'Tạo đối tượng điểm, đường hoặc vùng; nhập loại rừng, mùa khảo sát, trạng thái tán lá, độ che phủ, nguyên nhân biến động, ghi chú và ảnh.',
      phones: [P('m28-survey', 'Chọn điểm / đường / vùng'), P('m29-survey2', 'Thuộc tính khảo sát')],
      steps: [
        'Điểm: dùng GPS hoặc chọn trên bản đồ. Đường / vùng: chạm lần lượt các đỉnh trên bản đồ, hoặc bấm “Đi bộ ghi theo GPS” rồi đi dọc ranh giới; ứng dụng hiện chiều dài / diện tích.',
        'Chọn loại rừng (có mục riêng “Rừng khộp”), mùa khô/mùa mưa, trạng thái lá; kéo thanh độ che phủ.',
        'Bấm “Nộp khảo sát” – lưu kèm người khảo sát, thời gian, sai số GPS; mọi chỉnh sửa sau có lịch sử phiên bản; chờ duyệt.',
      ],
    },
    {
      id: 'lanh-dao', title: '15. Lãnh đạo – Giao nhiệm vụ và duyệt kết quả', icon: 'people-fill',
      intro: 'Lãnh đạo (và cán bộ chuyên môn được phân quyền) giao nhiệm vụ khảo sát và duyệt kết quả xác minh ngay trên điện thoại.',
      phones: [P('m33-leader-tasks', 'Nhiệm vụ – nút “Giao khảo sát”'), P('m34-review', 'Duyệt kết quả xác minh')],
      steps: [
        'Tab Nhiệm vụ → “Giao khảo sát”: nhập nội dung, hướng dẫn, chọn vị trí và hạn; cán bộ phụ trách xã nhận trên ứng dụng.',
        'Biểu tượng duyệt (góc trên) hoặc Cá nhân → “Duyệt kết quả xác minh”: xem bằng chứng (ảnh, toạ độ, sai số GPS), bấm Duyệt hoặc Trả lại (ghi lý do).',
        'Không tự duyệt kết quả của chính mình. Giao xác minh điểm nóng / phản ánh thực hiện trên web quản trị (Cảnh báo, Phản ánh).',
      ],
    },
  ],
  faq: [
    ['Không lấy được vị trí GPS?', 'Bật Dịch vụ định vị, cấp quyền Vị trí cho ứng dụng, ra chỗ thoáng. Nếu vẫn yếu, dùng “Chọn trên bản đồ” – hệ thống ghi nguồn vị trí là chọn tay.'],
    ['Gửi xong nhưng chưa thấy mã hồ sơ?', 'Có thể đang mất mạng: xem Cá nhân → Dữ liệu ngoại tuyến & đồng bộ. Bản ghi tự gửi khi có mạng và không tạo hồ sơ trùng.'],
    ['Vì sao tôi không thấy nhiệm vụ của xã bên cạnh?', 'Cán bộ giới hạn theo địa bàn chỉ thấy nhiệm vụ giao cho mình hoặc thuộc xã mình phụ trách – máy chủ từ chối mở nhiệm vụ ngoài địa bàn.'],
    ['Điểm nóng trên bản đồ có phải cháy rừng?', 'Chưa chắc. Nhãn “Chưa xác minh” nghĩa là chưa có cán bộ kiểm tra; chỉ khi kết quả xác minh được duyệt mới chuyển thành “Xác nhận cháy”.'],
  ],
};

module.exports = { publicGuide, adminGuide, mobileGuide };
