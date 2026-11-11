"""Chuyển tệp dữ liệu không gian sang GeoJSON WGS84 (EPSG:4326) để nhập thành lớp vector trên WebGIS.
Usage: python convert_layer.py <tệp vào> <tệp GeoJSON ra> [hệ toạ độ]
Hỗ trợ:
  - Shapefile nén .zip (.shp + .shx + .dbf, nên có .prj) – hệ toạ độ đọc từ .prj; nếu thiếu .prj dùng tham số [hệ toạ độ]
  - Excel .xlsx / .csv có cột toạ độ: lon/lat (kinh độ, vĩ độ) hoặc x/y (mét, theo [hệ toạ độ])
  - GeoJSON (.geojson/.json) – chuyển hệ toạ độ nếu khai báo crs khác WGS84
[hệ toạ độ]: auto | EPSG:4326 | EPSG:32648 (UTM 48N) | VN2000-KT (VN-2000 múi 3° KT 107°45', tỉnh Kon Tum) | VN2000-UTM48 (múi 6°)
In ra JSON tóm tắt (số đối tượng, kiểu hình học, hệ toạ độ nguồn, cảnh báo)."""
import os, sys, io, json, csv, zipfile, tempfile, importlib.util
from pathlib import Path
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
from rasterio.crs import CRS
from rasterio.warp import transform_geom

TOWGS = '+towgs84=-191.90441429,-39.30318279,-111.45032835,-0.00928836,0.01975479,-0.00427372,0.252906278'
CRS_OPTS = {
    'EPSG:4326': 'EPSG:4326', 'EPSG:32648': 'EPSG:32648',
    'VN2000-KT': f'+proj=tmerc +lat_0=0 +lon_0=107.75 +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 {TOWGS} +units=m +no_defs',
    'VN2000-UTM48': f'+proj=tmerc +lat_0=0 +lon_0=105 +k=0.9996 +x_0=500000 +y_0=0 +ellps=WGS84 {TOWGS} +units=m +no_defs',
}
src, out = Path(sys.argv[1]), Path(sys.argv[2])
want = sys.argv[3] if len(sys.argv) > 3 else 'auto'
warn = []


def fail(msg): print(json.dumps(dict(ok=False, error=msg), ensure_ascii=False)); sys.exit(2)


def guess_crs(xs, ys):
    """Đoán hệ toạ độ theo độ lớn số: độ (lon/lat) hoặc mét (UTM/VN-2000)."""
    if all(100 <= x <= 112 for x in xs[:50]) and all(6 <= y <= 25 for y in ys[:50]): return 'EPSG:4326'
    if all(6 <= x <= 25 for x in xs[:50]) and all(100 <= y <= 112 for y in ys[:50]): return 'SWAP'
    if all(100000 <= x <= 900000 for x in xs[:50]) and all(1000000 <= y <= 2600000 for y in ys[:50]):
        warn.append('Toạ độ dạng mét, không khai báo hệ toạ độ – giả định VN-2000 múi 3° KT 107°45′ (Kon Tum). Chọn hệ khác nếu vị trí lệch.')
        return 'VN2000-KT'
    return None


def to_wgs(geom, crs):
    if crs in (None, 'EPSG:4326'): return geom
    return transform_geom(CRS.from_user_input(CRS_OPTS.get(crs, crs)), 'EPSG:4326', geom, precision=7)


def clean(v):
    if v is None: return None
    if isinstance(v, (int, float, str, bool)): return v
    return str(v)


features = []; src_crs = None; kind = src.suffix.lower()
if kind == '.zip':
    import shapefile
    with zipfile.ZipFile(src) as z:
        names = [n for n in z.namelist() if not n.startswith('__MACOSX')]
        shps = [n for n in names if n.lower().endswith('.shp')]
        if not shps: fail('Tệp .zip không chứa Shapefile (.shp)')
        if len(shps) > 1: warn.append(f'Có {len(shps)} shapefile – chỉ nhập {Path(shps[0]).name}')
        base = shps[0][:-4]
        get = lambda ext: next((n for n in names if n.lower() == (base + ext).lower()), None)
        if not get('.dbf') or not get('.shx'): fail('Shapefile thiếu .dbf hoặc .shx')
        prj = get('.prj')
        if prj: src_crs = CRS.from_wkt(z.read(prj).decode('utf-8', 'ignore')).to_string()
        enc = 'utf-8'
        if get('.cpg'): enc = z.read(get('.cpg')).decode().strip() or 'utf-8'
        r = shapefile.Reader(shp=io.BytesIO(z.read(shps[0])), shx=io.BytesIO(z.read(get('.shx'))), dbf=io.BytesIO(z.read(get('.dbf'))), encoding=enc, encodingErrors='replace')
        fields = [f[0] for f in r.fields[1:]]
        for sr in r.iterShapeRecords():
            if sr.shape.shapeType == 0: continue
            features.append(dict(type='Feature', geometry=sr.shape.__geo_interface__, properties={k: clean(v) for k, v in zip(fields, sr.record)}))
    if not src_crs:
        if want != 'auto': src_crs = want
        else:
            c = features[0]['geometry']['coordinates'] if features else None
            while c and isinstance(c[0], list): c = c[0]
            src_crs = guess_crs([c[0]], [c[1]]) if c else None
            if not prj: warn.append('Shapefile thiếu tệp .prj')
elif kind in ('.xlsx', '.csv'):
    if kind == '.xlsx':
        import openpyxl
        wb = openpyxl.load_workbook(src, read_only=True, data_only=True); ws = wb.worksheets[0]
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
    else:
        raw = src.read_bytes()
        for e in ('utf-8-sig', 'cp1258', 'latin-1'):
            try: text = raw.decode(e); break
            except UnicodeDecodeError: continue
        rows = list(csv.reader(io.StringIO(text), delimiter=';' if text.count(';') > text.count(',') else ','))
    rows = [r for r in rows if any(c not in (None, '') for c in r)]
    if len(rows) < 2: fail('Bảng không có dữ liệu')
    head = [str(h or '').strip() for h in rows[0]]
    low = [h.lower() for h in head]
    def col(*keys):
        for k in keys:
            for i, h in enumerate(low):
                if h == k or h.replace(' ', '_') == k: return i
        return None
    ix = col('lon', 'lng', 'long', 'longitude', 'kinh độ', 'kinh_do', 'kinhdo', 'x', 'x_utm', 'toa_do_x', 'tọa độ x', 'toạ độ x', 'easting')
    iy = col('lat', 'latitude', 'vĩ độ', 'vi_do', 'vido', 'y', 'y_utm', 'toa_do_y', 'tọa độ y', 'toạ độ y', 'northing')
    if ix is None or iy is None: fail('Không tìm thấy cột toạ độ. Cần cột lon/lat (kinh độ/vĩ độ) hoặc x/y. Tiêu đề hiện có: ' + ', '.join(head))
    pts = []
    for n, r in enumerate(rows[1:], start=2):
        try: x = float(str(r[ix]).replace(',', '.')); y = float(str(r[iy]).replace(',', '.'))
        except (TypeError, ValueError, IndexError): warn.append(f'Dòng {n}: toạ độ không hợp lệ – bỏ qua'); continue
        pts.append((x, y, {head[i] or f'cot_{i + 1}': clean(v) for i, v in enumerate(r) if i not in (ix, iy)}))
    if not pts: fail('Không có dòng nào có toạ độ hợp lệ')
    src_crs = want if want != 'auto' else guess_crs([p[0] for p in pts], [p[1] for p in pts])
    if src_crs == 'SWAP': src_crs = 'EPSG:4326'; pts = [(y, x, pr) for x, y, pr in pts]; warn.append('Cột kinh độ/vĩ độ bị đảo – đã tự đổi lại')
    if not src_crs: fail('Không xác định được hệ toạ độ – hãy chọn hệ toạ độ khi tải lên')
    features = [dict(type='Feature', geometry=dict(type='Point', coordinates=[x, y]), properties=pr) for x, y, pr in pts]
    if len(warn) > 20: warn = warn[:20] + [f'… và {len(warn) - 20} cảnh báo khác']
elif kind in ('.geojson', '.json'):
    gj = json.loads(src.read_text(encoding='utf-8-sig'))
    features = gj['features'] if gj.get('type') == 'FeatureCollection' else [gj] if gj.get('type') == 'Feature' else fail('Không phải GeoJSON FeatureCollection/Feature')
    name = ((gj.get('crs') or {}).get('properties') or {}).get('name')
    src_crs = want if want != 'auto' else (CRS.from_user_input(name.replace('urn:ogc:def:crs:', '').replace('::', ':')).to_string() if name and not any(k in name for k in ('4326', 'CRS84')) else 'EPSG:4326')
else:
    fail('Định dạng chưa hỗ trợ (dùng .zip Shapefile, .xlsx, .csv, .geojson)')

if src_crs in ('EPSG:4326', 'OGC:CRS84'): src_crs = 'EPSG:4326'
out_f = []
for f in features:
    if not f.get('geometry'): continue
    try: f['geometry'] = to_wgs(f['geometry'], src_crs)
    except Exception as e: fail(f'Không chuyển được hệ toạ độ {src_crs}: {e}')
    out_f.append(f)
out.write_text(json.dumps(dict(type='FeatureCollection', features=out_f), ensure_ascii=False), encoding='utf-8')
types = sorted({f['geometry']['type'] for f in out_f})
print(json.dumps(dict(ok=True, count=len(out_f), types=types, source_crs=src_crs if src_crs in CRS_OPTS or src_crs is None else src_crs[:120], format=kind, warnings=warn), ensure_ascii=False))
