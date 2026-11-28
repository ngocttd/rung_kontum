"""Khai báo hệ toạ độ dùng chung cho nhập/xuất dữ liệu (convert_layer.py, geo_export.py).

Chuỗi khai báo:
  EPSG:4326                      WGS84 kinh/vĩ độ
  EPSG:32648 | EPSG:32649        WGS84 / UTM múi 48N, 49N
  VN2000:<kinh tuyến trục>:<múi>  VN-2000, phép chiếu UTM; múi 3 (k0 = 0,9999) hoặc 6 (k0 = 0,9996); ví dụ VN2000:107.5:3
  VN2000-KT / VN2000-UTM48       tên cũ: Kon Tum (107°30′, múi 3°) / múi 6° kinh tuyến trục 105°
  EPSG:xxxx hoặc chuỗi PROJ/WKT   dùng nguyên

VN-2000 → WGS84 dùng 7 tham số của Bộ TN&MT (Quyết định 05/2007/QĐ-BTNMT).
Kinh tuyến trục múi 3° theo tỉnh (Thông tư 25/2014/TT-BTNMT): Kon Tum 107°30′, Quảng Ngãi 108°00′, Gia Lai 108°30′, Quảng Nam 107°45′.
Kon Tum vắt qua kinh tuyến 108° nên ở múi 6° thuộc hai múi: số 48 (kinh tuyến trục 105°) và số 49 (kinh tuyến trục 111°).
"""
TOWGS = '+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278'


def vn2000(lon0, zone):
    k = 0.9999 if int(zone) == 3 else 0.9996
    return f'+proj=tmerc +lat_0=0 +lon_0={float(lon0)} +k={k} +x_0=500000 +y_0=0 +ellps=WGS84 {TOWGS} +units=m +no_defs'


# các phương án thử khi tệp toạ độ mét không khai báo hệ (vùng Kon Tum): (khai báo, nhãn)
CANDIDATES = ['VN2000:107.5:3', 'VN2000:108:3', 'VN2000:105:6', 'VN2000:111:6']
AOI = (107.0, 13.6, 108.9, 15.7)  # khung vùng Kon Tum (cũ) nới rộng

LEGACY = {'VN2000-KT': ('107.5', 3), 'VN2000-UTM48': ('105', 6)}


def resolve(spec):
    """Trả về (chuỗi cho rasterio CRS.from_user_input, nhãn hiển thị)."""
    s = str(spec or 'EPSG:4326').strip()
    if s in LEGACY: s = f'VN2000:{LEGACY[s][0]}:{LEGACY[s][1]}'
    if s.upper().startswith('VN2000:'):
        _, lon0, zone = (s.split(':') + ['3'])[:3]
        lon0 = float(lon0); zone = 6 if str(zone) == '6' else 3
        if not 102 <= lon0 <= 114: raise ValueError('Kinh tuyến trục phải trong khoảng 102°–114°')
        d = int(lon0); m = round((lon0 - d) * 60)
        return vn2000(lon0, zone), f"VN-2000, kinh tuyến trục {d}°{m:02d}′, múi {zone}°"
    if s.upper() in ('EPSG:4326', 'OGC:CRS84', 'WGS84'): return 'EPSG:4326', 'WGS84 (kinh độ, vĩ độ)'
    if s.upper() == 'EPSG:32648': return 'EPSG:32648', 'WGS84 / UTM múi 48N'
    if s.upper() == 'EPSG:32649': return 'EPSG:32649', 'WGS84 / UTM múi 49N'
    return s, s[:80]


def is_geographic(spec):
    return resolve(spec)[0] == 'EPSG:4326'
