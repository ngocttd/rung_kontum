"""Lớp phủ hằng năm từ Google Dynamic World V1 (Sentinel-2, 10 m, 9 lớp, Brown et al. 2022 – CC BY 4.0) qua Google Earth Engine.
Mỗi năm: lớp phổ biến nhất (mode) của nhãn 'label' trong năm, xuất lưới 100 m (EPSG:32648) trong khung Kon Tum.
Ra: data/collected/dynamic-world/dw-<năm>-100m.tif (+ manifest.json). Năm hiện tại tải lại mỗi lần chạy (năm chưa trọn,
được đánh dấu "tạm tính"); các năm đã trọn chỉ tải một lần. Đây là dữ liệu chuẩn hoá toàn cầu, dùng thay bản đồ lớp phủ
do dự án cung cấp cho phần thống kê (bản đồ dự án vẫn hiển thị như lớp tham khảo).
Usage: python collect_dynamic_world.py [năm_đầu]   (mặc định 2016)"""
import sys, json, datetime, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / '.tools/collection'))
import ee, requests
OUT = ROOT / 'data/collected/dynamic-world'; OUT.mkdir(parents=True, exist_ok=True)
k = json.loads((ROOT / '.secrets/gee-key.json').read_text())
ee.Initialize(ee.ServiceAccountCredentials(k['client_email'], str(ROOT / '.secrets/gee-key.json')), project=k['project_id'])
aoi = json.loads((ROOT / 'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
region = ee.Geometry(aoi).bounds()
first = int(sys.argv[1]) if len(sys.argv) > 1 else 2016
today = datetime.date.today()
man_p = OUT / 'manifest.json'
man = json.loads(man_p.read_text(encoding='utf-8')) if man_p.exists() else {}
for y in range(first, today.year + 1):
    p = OUT / f'dw-{y}-100m.tif'
    partial = y == today.year
    if p.exists() and not partial and not (man.get(str(y)) or {}).get('partial'): continue
    end = min(datetime.date(y + 1, 1, 1), today)
    col = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1').filterBounds(region).filterDate(f'{y}-01-01', str(end)).select('label')
    n = col.size().getInfo()
    if not n: print(y, 'không có ảnh', flush=True); continue
    # mode theo thời gian; GEE tính ở lưới 100 m từ pyramid "mode" của nhãn DW (giữ lớp chiếm ưu thế trong ô)
    img = col.mode().add(1).unmask(0).toUint8().clip(region)  # 1..9 = lớp DW 0..8; 0 = không có dữ liệu
    url = img.getDownloadURL(dict(region=region, scale=100, crs='EPSG:32648', format='GEO_TIFF'))
    for attempt in range(3):
        try:
            r = requests.get(url, timeout=600)
            if r.status_code != 200: raise RuntimeError(f'HTTP {r.status_code}: {r.text[:300]}')
            break
        except Exception as e:
            print(y, 'thử lại', e, flush=True)
    else:
        continue
    p.write_bytes(r.content)
    man[str(y)] = dict(file=p.name, images=n, start=f'{y}-01-01', end_exclusive=str(end), partial=partial, collected_at=datetime.datetime.utcnow().isoformat() + 'Z',
                      sha256=hashlib.sha256(r.content).hexdigest(), source='GOOGLE/DYNAMICWORLD/V1 (label, mode theo năm)')
    man_p.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
    print(y, 'saved', n, 'ảnh', 'tạm tính' if partial else '', flush=True)
print(json.dumps(dict(ok=True, years=sorted(man)), ensure_ascii=False))
