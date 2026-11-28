"""Xuất dữ liệu vector (GeoJSON WGS84) sang định dạng và hệ toạ độ người dùng chọn.

  python geo_export.py <in.geojson> <out_file> <format> [hệ toạ độ] [tên lớp]

format: geojson | kml | shp (Shapefile nén .zip, kèm .prj, .cpg UTF-8) | csv | xlsx
hệ toạ độ: xem _crs.py (EPSG:4326, EPSG:32648, VN2000:<kinh tuyến trục>:<múi>). KML luôn là WGS84 theo chuẩn.
csv/xlsx: bảng thuộc tính + toạ độ tâm (X, Y theo hệ đã chọn) + kinh độ, vĩ độ WGS84 + diện tích/chiều dài (ha, m).
In ra JSON {ok, count, crs_label}.
"""
import os, sys, io, json, csv, zipfile, importlib.util
from pathlib import Path
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import warnings; warnings.filterwarnings('ignore')
from rasterio.crs import CRS
from rasterio.warp import transform_geom
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _crs import resolve

src, out, fmt = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3].lower()
spec = sys.argv[4] if len(sys.argv) > 4 else 'EPSG:4326'
layer = (sys.argv[5] if len(sys.argv) > 5 else 'du_lieu')[:60]


def fail(msg): print(json.dumps(dict(ok=False, error=msg), ensure_ascii=False)); sys.exit(2)


try: proj, label = resolve(spec); crs = CRS.from_user_input(proj)
except Exception as e: fail(f'Hệ toạ độ không hợp lệ: {e}')
gj = json.loads(src.read_text(encoding='utf-8'))
feats = [f for f in (gj.get('features') or []) if f.get('geometry')]
geo = proj == 'EPSG:4326'
tr = (lambda g: g) if geo else (lambda g: transform_geom('EPSG:4326', crs, g, precision=3))
METRIC = CRS.from_epsg(32648)  # tính diện tích/chiều dài


def flat(v):
    if v is None or isinstance(v, (int, float, str, bool)): return v
    return json.dumps(v, ensure_ascii=False)


keys = []
for f in feats:
    for k in (f.get('properties') or {}):
        if k not in keys: keys.append(k)

if fmt == 'geojson':
    o = dict(type='FeatureCollection', name=layer, features=[dict(type='Feature', geometry=tr(f['geometry']), properties=f.get('properties') or {}) for f in feats])
    if not geo: o['crs'] = dict(type='name', properties=dict(name=label, proj4=proj))
    out.write_text(json.dumps(o, ensure_ascii=False), encoding='utf-8')
elif fmt == 'kml':
    from xml.sax.saxutils import escape
    label = 'WGS84 (kinh độ, vĩ độ) – chuẩn KML'
    cs = lambda pts: ' '.join(f'{p[0]:.7f},{p[1]:.7f},0' for p in pts)
    def kg(g):
        t, c = g['type'], g.get('coordinates')
        if t == 'Point': return f'<Point><coordinates>{cs([c])}</coordinates></Point>'
        if t == 'LineString': return f'<LineString><coordinates>{cs(c)}</coordinates></LineString>'
        if t == 'Polygon': return '<Polygon>' + ''.join(f"<{'outer' if i == 0 else 'inner'}BoundaryIs><LinearRing><coordinates>{cs(r)}</coordinates></LinearRing></{'outer' if i == 0 else 'inner'}BoundaryIs>" for i, r in enumerate(c)) + '</Polygon>'
        if t in ('MultiPoint', 'MultiLineString', 'MultiPolygon'): return '<MultiGeometry>' + ''.join(kg(dict(type=t[5:], coordinates=x)) for x in c) + '</MultiGeometry>'
        if t == 'GeometryCollection': return '<MultiGeometry>' + ''.join(kg(x) for x in g['geometries']) + '</MultiGeometry>'
        return ''
    pms = []
    for f in feats:
        p = f.get('properties') or {}
        name = p.get('name') or p.get('title') or p.get('ten') or p.get('id') or p.get('code') or ''
        ext = ''.join(f'<Data name="{escape(str(k))}"><value>{escape(str(flat(v)) if v is not None else "")}</value></Data>' for k, v in p.items())
        pms.append(f'<Placemark><name>{escape(str(name))}</name><ExtendedData>{ext}</ExtendedData>{kg(f["geometry"])}</Placemark>')
    out.write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>{escape(layer)}</name>{"".join(pms)}</Document></kml>', encoding='utf-8')
elif fmt == 'shp':
    import shapefile
    groups = {}
    for f in feats:
        t = f['geometry']['type'].replace('Multi', '')
        groups.setdefault(t, []).append(f)
    if not groups: fail('Không có đối tượng để xuất')
    # tên trường DBF tối đa 10 ký tự, không dấu
    import unicodedata, re
    def fname(k, used):
        b = re.sub(r'[^A-Za-z0-9_]', '_', unicodedata.normalize('NFD', str(k)).encode('ascii', 'ignore').decode().replace('đ', 'd'))[:10] or 'f'
        n = b; i = 1
        while n.lower() in used: i += 1; n = f'{b[:8]}{i:02d}'[:10]
        used.add(n.lower()); return n
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for t, fs_ in groups.items():
            used = set(); fm = {k: fname(k, used) for k in keys}
            shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
            w = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, encoding='utf-8')
            num = {k: all(isinstance((f.get('properties') or {}).get(k), (int, float)) and not isinstance((f.get('properties') or {}).get(k), bool) for f in fs_ if (f.get('properties') or {}).get(k) is not None) and any((f.get('properties') or {}).get(k) is not None for f in fs_) for k in keys}
            for k in keys:
                if num[k]: w.field(fm[k], 'N', 18, 6)
                else: w.field(fm[k], 'C', 254)
            if not keys: w.field('id', 'N', 10, 0)
            for i, f in enumerate(fs_):
                w.shape(tr(f['geometry']))
                p = f.get('properties') or {}
                w.record(*([(p.get(k) if num[k] else (None if p.get(k) is None else str(flat(p.get(k)))[:254])) for k in keys] or [i + 1]))
            w.close()
            base = layer if len(groups) == 1 else f"{layer}_{dict(Point='diem', LineString='duong', Polygon='vung').get(t, t.lower())}"
            z.writestr(f'{base}.shp', shp.getvalue()); z.writestr(f'{base}.shx', shx.getvalue()); z.writestr(f'{base}.dbf', dbf.getvalue())
            z.writestr(f'{base}.prj', crs.to_wkt('WKT1_ESRI') if hasattr(crs, 'to_wkt') else crs.wkt); z.writestr(f'{base}.cpg', 'UTF-8')
        z.writestr('DOC_TRUOC.txt', f'Hệ toạ độ: {label}\nTham số: {proj}\nMã hoá thuộc tính: UTF-8. Tên trường rút gọn 10 ký tự theo giới hạn DBF.\n')
elif fmt in ('csv', 'xlsx'):
    xl, yl = ('kinh_do', 'vi_do') if geo else ('X_m', 'Y_m')
    head = keys + ([f'{xl} ({label})', f'{yl} ({label})'] if not geo else []) + ['kinh_do_WGS84', 'vi_do_WGS84', 'kieu_hinh_hoc', 'dien_tich_ha', 'chieu_dai_m']
    rows = []
    def ring_area(r): return abs(sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))) / 2
    def ring_len(r): return sum(((r[i + 1][0] - r[i][0]) ** 2 + (r[i + 1][1] - r[i][1]) ** 2) ** 0.5 for i in range(len(r) - 1))
    def parts(g):
        t, c = g['type'], g.get('coordinates')
        if t == 'Point': return [('pt', [c])]
        if t == 'MultiPoint': return [('pt', c)]
        if t == 'LineString': return [('ln', c)]
        if t == 'MultiLineString': return [('ln', x) for x in c]
        if t == 'Polygon': return [('pg', c)]
        if t == 'MultiPolygon': return [('pg', x) for x in c]
        if t == 'GeometryCollection': return [q for x in g['geometries'] for q in parts(x)]
        return []
    def measure(g):
        area = length = 0.0
        for k, c in parts(g):
            if k == 'pg': area += ring_area(c[0]) - sum(ring_area(h) for h in c[1:])
            elif k == 'ln': length += ring_len(c)
        return area, length
    def center(g):
        ps = parts(g); best = None
        for k, c in ps:
            pts = c[0][:-1] if k == 'pg' else c
            if not pts: continue
            w = ring_area(c[0]) if k == 'pg' else len(pts)
            if best is None or w > best[0]: best = (w, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        return (best[1], best[2]) if best else (None, None)
    for f in feats:
        gt = f['geometry']['type']; cx, cy = center(f['geometry'])
        area, length = measure(transform_geom('EPSG:4326', METRIC, f['geometry']))
        p = f.get('properties') or {}
        r = [flat(p.get(k)) for k in keys]
        if not geo:
            cc = transform_geom('EPSG:4326', crs, dict(type='Point', coordinates=[cx, cy]), precision=3)['coordinates']; r += [cc[0], cc[1]]
        r += [round(cx, 7), round(cy, 7), gt, round(area / 1e4, 3) if area else None, round(length, 1) if length else None]
        rows.append(r)
    if fmt == 'csv':
        b = io.StringIO(); w = csv.writer(b); w.writerow(head); w.writerows(rows)
        out.write_bytes(b'\xef\xbb\xbf' + b.getvalue().encode('utf-8'))
    else:
        import openpyxl
        from openpyxl.styles import Font, PatternFill
        wb = openpyxl.Workbook(); ws = wb.active; ws.title = layer[:31] or 'du_lieu'
        ws.append(head)
        for c in ws[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='1F5C3A')
        for r in rows: ws.append(r)
        for i, h in enumerate(head, start=1): ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = min(40, max(12, len(str(h)) + 2))
        ws.freeze_panes = 'A2'
        ws2 = wb.create_sheet('Ghi chu'); ws2.append(['Hệ toạ độ', label]); ws2.append(['Tham số', proj]); ws2.append(['Số đối tượng', len(rows)])
        wb.save(out)
else:
    fail('Định dạng xuất không hỗ trợ (geojson, kml, shp, csv, xlsx)')
print(json.dumps(dict(ok=True, count=len(feats), crs_label=label), ensure_ascii=False))
