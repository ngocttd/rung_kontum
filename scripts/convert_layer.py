"""Chuyển tệp dữ liệu không gian sang GeoJSON WGS84 (EPSG:4326) để nhập thành lớp vector trên WebGIS.
Usage: python convert_layer.py <tệp vào> <tệp GeoJSON ra> [hệ toạ độ] [bảng mã thuộc tính: auto|tcvn3|none]
Hỗ trợ:
  - Shapefile nén .zip (.shp + .shx + .dbf, nên có .prj) – hệ toạ độ đọc từ .prj; nếu thiếu .prj dùng tham số [hệ toạ độ]
  - Excel .xlsx / .csv có cột toạ độ: lon/lat (kinh độ, vĩ độ) hoặc x/y (mét, theo [hệ toạ độ])
  - GeoJSON (.geojson/.json) – chuyển hệ toạ độ nếu khai báo crs khác WGS84
  - MapInfo: tệp .zip chứa bộ .TAB/.DAT/.MAP/.ID hoặc cặp .MIF/.MID (đọc bằng mapinfo_to_geojson.py – thư viện fiona); hệ toạ độ lấy từ
    khai báo CoordSys của tệp; bảng NonEarth dùng tham số [hệ toạ độ]
  - Thuộc tính tiếng Việt bảng mã TCVN3 (ABC) được tự nhận dạng và chuyển sang Unicode
  - KML / KMZ (Google Earth) – điểm, đường, vùng, kể cả MultiGeometry; thuộc tính từ name, description, ExtendedData
[hệ toạ độ]: auto | EPSG:4326 | EPSG:32648 (UTM 48N) | VN2000:<kinh tuyến trục>:<múi 3|6> (vd VN2000:107.5:3) – xem _crs.py
In ra JSON tóm tắt (số đối tượng, kiểu hình học, hệ toạ độ nguồn, cảnh báo)."""
import os, sys, io, json, csv, zipfile, tempfile, importlib.util
from pathlib import Path
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
from rasterio.crs import CRS
from rasterio.warp import transform_geom

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _crs import resolve
src, out = Path(sys.argv[1]), Path(sys.argv[2])
want = sys.argv[3] if len(sys.argv) > 3 else 'auto'
text_mode = sys.argv[4] if len(sys.argv) > 4 else 'auto'
warn = []


def fail(msg): print(json.dumps(dict(ok=False, error=msg), ensure_ascii=False)); sys.exit(2)


def guess_crs(xs, ys):
    """Đoán hệ toạ độ theo độ lớn số: độ (lon/lat) hoặc mét (UTM/VN-2000)."""
    if xs and all(48000000 <= x < 50000000 for x in xs[:50]) and all(1000000 <= y <= 2600000 for y in ys[:50]):
        z = int(xs[0] // 1000000)
        warn.append(f'Toạ độ X có tiền tố số múi {z} (múi 6°) – đã bỏ tiền tố và dùng kinh tuyến trục {105 if z == 48 else 111}°.')
        return f'ZONE{z}'
    if all(100 <= x <= 112 for x in xs[:50]) and all(6 <= y <= 25 for y in ys[:50]): return 'EPSG:4326'
    if all(6 <= x <= 25 for x in xs[:50]) and all(100 <= y <= 112 for y in ys[:50]): return 'SWAP'
    if all(100000 <= x <= 900000 for x in xs[:50]) and all(1000000 <= y <= 2600000 for y in ys[:50]):
        from _crs import CANDIDATES, AOI
        from rasterio.warp import transform as _tf
        hits = []
        for cand in CANDIDATES:
            try:
                lo, la = _tf(CRS.from_user_input(resolve(cand)[0]), 'EPSG:4326', list(xs[:50]), list(ys[:50]))
                if all(AOI[0] <= a <= AOI[2] and AOI[1] <= b <= AOI[3] for a, b in zip(lo, la)): hits.append(cand)
            except Exception: pass
        pick = hits[0] if hits else 'VN2000:107.5:3'
        if len(hits) == 1: warn.append(f'Toạ độ dạng mét, không khai báo hệ toạ độ – tự nhận {resolve(pick)[1]} (phương án duy nhất rơi vào vùng Kon Tum). Kiểm tra vị trí sau khi nhập.')
        elif hits: warn.append('Toạ độ dạng mét, không khai báo hệ toạ độ – có ' + str(len(hits)) + ' phương án đều rơi vào vùng Kon Tum (' + '; '.join(resolve(h)[1] for h in hits) + f'). Đang dùng {resolve(pick)[1]}; nếu vị trí lệch hãy chọn đúng kinh tuyến trục và múi chiếu của bản đồ gốc rồi nhập lại.')
        else: warn.append('Toạ độ dạng mét nhưng không phương án nào (107°30′/108° múi 3°; 105°/111° múi 6°) rơi vào vùng Kon Tum – giả định VN-2000 107°30′ múi 3°. Hãy chọn hệ toạ độ thủ công.')
        return pick
    return None


def to_wgs(geom, crs):
    if crs in (None, 'EPSG:4326'): return geom
    return transform_geom(CRS.from_user_input(resolve(crs)[0]), 'EPSG:4326', geom, precision=7)


def clean(v):
    if v is None: return None
    if isinstance(v, (int, float, str, bool)): return v
    return str(v)


features = []; src_crs = None; kind = src.suffix.lower()
if kind == '.zip':
    with zipfile.ZipFile(src) as z:
        names = [n for n in z.namelist() if not n.startswith('__MACOSX') and not n.endswith('/')]
        shps = [n for n in names if n.lower().endswith('.shp')]
        mi = [n for n in names if n.lower().endswith('.tab')] or [n for n in names if n.lower().endswith('.mif')]
        if not shps and not mi: fail('Tệp .zip không chứa Shapefile (.shp) hoặc MapInfo (.tab / .mif)')
        if shps:
            import shapefile
            if len(shps) > 1: warn.append(f'Có {len(shps)} shapefile – chỉ nhập {Path(shps[0]).name}')
            base = shps[0][:-4]
            get = lambda ext: next((n for n in names if n.lower() == (base + ext).lower()), None)
            if not get('.dbf') or not get('.shx'): fail('Shapefile thiếu .dbf hoặc .shx')
            prj = get('.prj')
            if prj: src_crs = CRS.from_wkt(z.read(prj).decode('utf-8', 'ignore')).to_string()
            # bảng mã thuộc tính: theo .cpg nếu có; không có thì thử UTF-8, hỏng thì đọc Latin-1 (giữ nguyên byte để nhận dạng TCVN3) hoặc cp1258
            enc = (z.read(get('.cpg')).decode().strip() if get('.cpg') else '') or None
            dbf_raw = z.read(get('.dbf'))
            if not enc:
                try: dbf_raw[:200000].decode('utf-8'); enc = 'utf-8'
                except UnicodeDecodeError: enc = 'latin-1'
            r = shapefile.Reader(shp=io.BytesIO(z.read(shps[0])), shx=io.BytesIO(z.read(get('.shx'))), dbf=io.BytesIO(dbf_raw), encoding=enc, encodingErrors='replace')
            fields = [f[0] for f in r.fields[1:]]
            for sr in r.iterShapeRecords():
                if sr.shape.shapeType == 0: continue
                features.append(dict(type='Feature', geometry=sr.shape.__geo_interface__, properties={k: clean(v) for k, v in zip(fields, sr.record)}))
            if not src_crs:
                if want != 'auto': src_crs = want
                else:
                    c = features[0]['geometry']['coordinates'] if features else None
                    while c and isinstance(c[0], (list, tuple)): c = c[0]
                    src_crs = guess_crs([c[0]], [c[1]]) if c else None
                    if not prj: warn.append('Shapefile thiếu tệp .prj')
        else:
            # MapInfo: bung ra thư mục tạm, đọc bằng tiến trình riêng (fiona/OGR) → GeoJSON WGS84 kèm mọi trường thuộc tính
            import subprocess, shutil
            td = tempfile.mkdtemp(prefix='kt-mi-')
            try:
                for n in names: (Path(td) / Path(n).name).write_bytes(z.read(n))
                if len(mi) > 1: warn.append(f'Có {len(mi)} bảng MapInfo – chỉ nhập {Path(mi[0]).name}')
                tmp_gj = Path(td) / '_out.geojson'
                rr = subprocess.run([sys.executable, str(Path(__file__).resolve().parent / 'mapinfo_to_geojson.py'), str(Path(td) / Path(mi[0]).name), str(tmp_gj)], capture_output=True, text=True, encoding='utf-8', errors='replace')
                try: mi_info = json.loads((rr.stdout or '').strip().split('\n')[-1])
                except Exception: fail('Không đọc được tệp MapInfo: ' + ((rr.stderr or '').strip().split('\n')[-1] or 'lỗi không xác định'))
                if not mi_info.get('ok'): fail(mi_info.get('error'))
                features = json.loads(tmp_gj.read_text(encoding='utf-8'))['features']
            finally:
                shutil.rmtree(td, ignore_errors=True)
            kind = '.tab' if mi[0].lower().endswith('.tab') else '.mif'
            if mi_info.get('nonearth'):
                warn.append('Bảng MapInfo không khai báo hệ toạ độ (NonEarth) – dùng hệ toạ độ đã chọn hoặc tự nhận theo độ lớn toạ độ.')
                c = features[0]['geometry']['coordinates'] if features else None
                while c and isinstance(c[0], (list, tuple)): c = c[0]
                src_crs = want if want != 'auto' else (guess_crs([c[0]], [c[1]]) if c else None)
            else:
                src_crs = 'EPSG:4326'; mi_label = mi_info.get('crs') or 'đọc từ tệp MapInfo'
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
    if isinstance(src_crs, str) and src_crs.startswith('ZONE'):
        z = int(src_crs[4:]); pts = [(x - z * 1000000, y, pr) for x, y, pr in pts]; src_crs = f'VN2000:{105 if z == 48 else 111}:6'
    if src_crs == 'SWAP': src_crs = 'EPSG:4326'; pts = [(y, x, pr) for x, y, pr in pts]; warn.append('Cột kinh độ/vĩ độ bị đảo – đã tự đổi lại')
    if not src_crs: fail('Không xác định được hệ toạ độ – hãy chọn hệ toạ độ khi tải lên')
    features = [dict(type='Feature', geometry=dict(type='Point', coordinates=[x, y]), properties=pr) for x, y, pr in pts]
    if len(warn) > 20: warn = warn[:20] + [f'… và {len(warn) - 20} cảnh báo khác']
elif kind in ('.geojson', '.json'):
    gj = json.loads(src.read_text(encoding='utf-8-sig'))
    features = gj['features'] if gj.get('type') == 'FeatureCollection' else [gj] if gj.get('type') == 'Feature' else fail('Không phải GeoJSON FeatureCollection/Feature')
    name = ((gj.get('crs') or {}).get('properties') or {}).get('name')
    src_crs = want if want != 'auto' else (CRS.from_user_input(name.replace('urn:ogc:def:crs:', '').replace('::', ':')).to_string() if name and not any(k in name for k in ('4326', 'CRS84')) else 'EPSG:4326')
elif kind in ('.kml', '.kmz'):
    import re
    import xml.etree.ElementTree as ET
    if kind == '.kmz':
        with zipfile.ZipFile(src) as z:
            kn = next((n for n in z.namelist() if n.lower().endswith('.kml')), None)
            if not kn: fail('Tệp .kmz không chứa .kml')
            raw = z.read(kn)
    else:
        raw = src.read_bytes()
    try: root = ET.fromstring(raw)
    except ET.ParseError as e: fail(f'KML không hợp lệ: {e}')
    tag = lambda e: e.tag.split('}')[-1]
    def coords(e):
        t = ''.join(e.itertext()) if e is not None else ''
        out_c = []
        for tok in t.split():
            p = tok.split(',')
            try: out_c.append([float(p[0]), float(p[1])])
            except (ValueError, IndexError): pass
        return out_c
    def find(e, name): return next((c for c in e.iter() if tag(c) == name), None)
    def ring(e):
        c = coords(find(e, 'coordinates'))
        if c and c[0] != c[-1]: c.append(c[0])
        return c
    def geom(e):
        t = tag(e)
        if t == 'Point':
            c = coords(find(e, 'coordinates')); return dict(type='Point', coordinates=c[0]) if c else None
        if t in ('LineString', 'LinearRing'):
            c = coords(find(e, 'coordinates')); return dict(type='LineString', coordinates=c) if len(c) > 1 else None
        if t == 'Polygon':
            outer = next((c for c in e if tag(c) == 'outerBoundaryIs'), None); rings = [ring(outer)] if outer is not None else []
            rings += [ring(c) for c in e if tag(c) == 'innerBoundaryIs']
            return dict(type='Polygon', coordinates=[r for r in rings if len(r) >= 4]) if rings and len(rings[0]) >= 4 else None
        if t == 'MultiGeometry':
            gs = [g for g in (geom(c) for c in e if tag(c) in ('Point', 'LineString', 'Polygon', 'MultiGeometry')) if g]
            if not gs: return None
            if len(gs) == 1: return gs[0]
            ts = {g['type'] for g in gs}
            if ts == {'Polygon'}: return dict(type='MultiPolygon', coordinates=[g['coordinates'] for g in gs])
            if ts == {'LineString'}: return dict(type='MultiLineString', coordinates=[g['coordinates'] for g in gs])
            if ts == {'Point'}: return dict(type='MultiPoint', coordinates=[g['coordinates'] for g in gs])
            return dict(type='GeometryCollection', geometries=gs)
        return None
    strip = lambda t: re.sub(r'<[^>]+>', ' ', t or '').strip()
    for pm in root.iter():
        if tag(pm) != 'Placemark': continue
        g = next((geom(c) for c in pm if tag(c) in ('Point', 'LineString', 'Polygon', 'MultiGeometry')), None)
        if not g: continue
        props = {}
        for c in pm:
            if tag(c) == 'name': props['name'] = (c.text or '').strip()
            elif tag(c) == 'description': props['description'] = strip(c.text)[:2000]
            elif tag(c) == 'ExtendedData':
                for d in c.iter():
                    if tag(d) in ('Data', 'SimpleData') and d.get('name'):
                        v = find(d, 'value') if tag(d) == 'Data' else d
                        props[d.get('name')] = ((v.text if v is not None else '') or '').strip()
        if g['type'] == 'GeometryCollection':
            for sub in g['geometries']: features.append(dict(type='Feature', geometry=sub, properties=dict(props)))
        else:
            features.append(dict(type='Feature', geometry=g, properties=props))
    if not features: fail('KML không có đối tượng (Placemark) nào có hình học')
    src_crs = 'EPSG:4326'
else:
    fail('Định dạng chưa hỗ trợ (dùng .zip Shapefile, .kml, .kmz, .xlsx, .csv, .geojson)')

if src_crs in ('EPSG:4326', 'OGC:CRS84'): src_crs = 'EPSG:4326'
out_f = []
for f in features:
    if not f.get('geometry'): continue
    try: f['geometry'] = to_wgs(f['geometry'], src_crs)
    except Exception as e: fail(f'Không chuyển được hệ toạ độ {src_crs}: {e}')
    out_f.append(f)
from _text import fix_props
if fix_props(out_f, text_mode): warn.append('Thuộc tính tiếng Việt bảng mã TCVN3 (ABC) đã được chuyển sang Unicode – kiểm tra lại chữ có dấu.')
out.write_text(json.dumps(dict(type='FeatureCollection', features=out_f), ensure_ascii=False), encoding='utf-8')
types = sorted({f['geometry']['type'] for f in out_f})
code = None if src_crs is None else (src_crs if len(str(src_crs)) <= 40 else 'custom')
label = locals().get('mi_label') or (None if src_crs is None else resolve(src_crs)[1])
print(json.dumps(dict(ok=True, count=len(out_f), types=types, source_crs=code, source_crs_label=label, format=kind, warnings=warn), ensure_ascii=False))
