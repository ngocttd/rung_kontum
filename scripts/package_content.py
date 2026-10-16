import json,shutil,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'data/content';out.mkdir(exist_ok=True)
def save(name,data):(out/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
media=ROOT/'data/collected/reference-media';items=json.loads((media/'manifest.json').read_text(encoding='utf-8'))
accepted={'15698589.jpg':'Rừng tại Kon Tum theo mô tả của tác giả','15698586.jpg':'Suối trong rừng Đăk Glei theo mô tả của tác giả','15698587.jpg':'Suối trong rừng Đăk Glei theo mô tả của tác giả','135613899.jpg':'Khướu Ngọc Linh; ảnh chụp tại Việt Nam theo nguồn, chưa xác minh vị trí cụ thể'}
dest=ROOT/'public/assets/real-photos';dest.mkdir(exist_ok=True)
for item in items:
 item['status']='approved_reference_only' if item['file'] in accepted else 'not_selected'
 if item['file'] in accepted:
  shutil.copy2(media/item['file'],dest/item['file']);item.update(caption_vi=accepted[item['file']],public_path='/assets/real-photos/'+item['file'],usage='Ảnh tư liệu; không gán cho sự kiện hiện tại, không dùng làm nhãn hiện trường',credit_line=f"{item['artist']} — {item['license']} — Wikimedia Commons")
save('licensed-photos.json',[i for i in items if i['file'] in accepted]);(media/'review.json').write_text(json.dumps(items,ensure_ascii=False,indent=2),encoding='utf-8')
articles=[
 dict(id='forest-status-2025',title='Tài liệu công bố hiện trạng rừng năm 2025',category='Văn bản chuyên ngành',source_date='2026-03-31',source_url='https://kiemlam.quangngai.gov.vn/docdetails.aspx?d=685',body='Quyết định 1047/QĐ-UBND công bố hiện trạng rừng tỉnh Quảng Ngãi năm 2025. Bộ dữ liệu đã lưu văn bản và phụ lục, trong đó có thống kê theo đơn vị cấp xã. Khi tra cứu vùng Kon Tum trước sáp nhập, cần chọn đúng xã và giữ rõ phạm vi, năm số liệu; tổng toàn tỉnh mới không phải tổng của vùng nghiên cứu.',image='/assets/real-photos/15698589.jpg'),
 dict(id='commune-statistics',title='Tra cứu số liệu rừng theo xã hiện hành',category='Hướng dẫn dữ liệu',source_date='2025-12-31',source_url='https://kiemlam.quangngai.gov.vn/items/phuluc/80_phu-luc-1.xlsx',body='Dữ liệu chuẩn hóa có 40 xã/phường được ghép tên với phạm vi nghiên cứu. Diện tích rừng tự nhiên, rừng trồng đã thành rừng và rừng trồng chưa thành rừng được giữ riêng. Số liệu nguồn tính cho toàn xã hiện hành; phần cắt bản đồ theo ranh tỉnh cũ không tự làm thay đổi số liệu bảng. Xem nguồn và ngày công bố trước khi sử dụng.',image='/assets/real-photos/15698587.jpg'),
 dict(id='hotspot-explainer',title='Đọc đúng thông tin điểm nóng vệ tinh',category='Hướng dẫn cảnh báo',source_url='https://firms.modaps.eosdis.nasa.gov/',body='Một điểm nóng là phát hiện nhiệt của cảm biến tại thời điểm quan sát. Vị trí, cảm biến và độ tin cậy giúp chọn nơi cần kiểm tra; phát hiện này chưa chứng minh đó là cháy rừng. Trang cảnh báo cần thể hiện trạng thái xác minh, thời gian quan sát và dữ liệu có còn mới hay không. Không dùng số điểm nóng làm số vụ cháy đã xác nhận.',image='/assets/items/wildfire.webp'),
 dict(id='seasonal-change',title='Theo dõi biến động có xét mùa vụ',category='Hướng dẫn giám sát',source_url='https://bfast.r-forge.r-project.org/',body='Chỉ số thực vật thay đổi theo mùa, mây và điều kiện ảnh. Với rừng rụng lá, mức giảm trong mùa khô cần được đối chiếu chuỗi cùng mùa, nhiều chỉ số và ảnh quan sát hợp lệ. Bản đồ nghi vấn là đầu vào xác minh, chưa phải kết luận mất rừng. Thiếu quan sát do mây phải hiển thị rõ, không diễn giải thành không có biến động.',image='/assets/items/dipterocarp.webp')]
for a in articles:a.update(editorial_status='draft_original_summary',publication_requires_review=True,author='Nội dung biên soạn cho dự án',image_is_incident_evidence=False)
save('articles.json',articles)
docs=[]
for item in json.loads((ROOT/'data/collected/references/official-manifest.json').read_text()):
 docs.append(dict(id=Path(item['file']).stem,title=item['file'],file='data/collected/references/'+item['file'],source=item['source'],sha256=item['sha256'],type=Path(item['file']).suffix[1:],publication_status='catalogued_review_metadata_before_release'))
save('documents.json',docs)
pages={
 'P01':('Trang chủ',['forest-statistics-2025-kon-tum-communes.json','weather/communes.json','articles.json','documents.json'],'KPI phải ghi phạm vi/năm; cảnh báo chỉ hiện sản phẩm có nguồn và trạng thái.'),
 'P02':('Bản đồ',['boundaries','osm','worldcover-2021-10m.tif','dem-2024-1-30m.tif','firms'],'Có dữ liệu nền thật; các lớp nghiệp vụ chờ bàn giao.'),
 'P03':('Tài nguyên rừng',['forest-statistics-2025-kon-tum-communes.json','licensed-photos.json','worldcover-2021-10m.tif'],'Phân biệt thống kê chính thức với lớp phủ vệ tinh; chưa có polygon loại rừng đã duyệt.'),
 'P04':('Dự báo và cảnh báo cháy',['firms','weather/communes.json','hourly-weather','DU_BAO_CANH_BAO.md'],'Điểm nóng và dự báo khí tượng đã có; mô hình nguy cơ/threshold địa phương chờ kiểm định.'),
 'P05':('Tin tức',['articles.json','licensed-photos.json'],'Bài biên soạn là bản nháp cần biên tập duyệt, không giả tin/sự kiện mới.'),
 'P06':('Phản ánh',['YEU_CAU_BAN_GIAO_DU_LIEU.md'],'Biểu mẫu và quy trình được mô tả; không tạo hồ sơ người dân giả.'),
 'P07':('Tài liệu',['documents.json','references'],'Bản gốc và phụ lục đã tải; tách dữ liệu nội bộ/công khai khi phát hành.'),
 'P08':('Giới thiệu',['GHI_NHO_DU_AN.md'],'Nội dung phạm vi dự án đã có; tên đơn vị vận hành, logo và liên hệ cần chủ quản cung cấp.'),
 'P09':('Thời tiết',['weather/communes.json','daily-climate-2024-2025.csv'],'40 điểm đại diện; dự báo 5 ngày bước 3 giờ; ghi timestamp.'),
 'P10':('Thống kê và dự báo biến động',['forest-statistics-2025-kon-tum-communes.json','monitoring-series','raster-quality-by-commune.csv','DU_BAO_CANH_BAO.md'],'Thống kê chính thức và chuỗi chỉ số có nguồn; dự báo xác suất biến động chưa đủ nhãn kiểm định.'),
 'P11':('Hướng dẫn',['DU_BAO_CANH_BAO.md','YEU_CAU_BAN_GIAO_DU_LIEU.md','DATA_HANDOVER.md'],'Quy trình dữ liệu/cảnh báo có sẵn; thao tác giao diện cần cập nhật sau triển khai.')}
save('page-data-matrix.json',[dict(page=k,title=v[0],sources=v[1],readiness=v[2]) for k,v in pages.items()])
print('Content package:',len(articles),'articles;',len(docs),'documents;',len(accepted),'licensed photos;',len(pages),'pages')
