"""Import data/Data_thuc_te (dữ liệu thực tế do dự án cung cấp).

1. Lop_phu_{1991,2014,2023}.tif (RGB, UTM 48N, 15 m) -> class rasters (7 lớp theo chú giải bản đồ biên tập),
   thống kê diện tích theo xã/năm, ma trận chuyển đổi, bản đồ mất/tăng rừng 1991–2023, lớp hiển thị EPSG:3857.
2. Mẫu thực địa 2025 (shapefile điểm UTM 48N) -> GeoJSON WGS84, sửa lỗi mã hoá tên, đối chiếu với lớp phủ 2023.
Outputs: data/processed/landcover-*.tif, data/web/landcover-history.json, data/web/field-samples.geojson,
         public/generated/overlays/lc-*.png (to_webp.cjs converts), data/web/overlays.json (entries lc-*).
"""
import os, json, struct, importlib.util, datetime, hashlib
from pathlib import Path
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds, transform_geom, transform
from rasterio.features import rasterize, geometry_mask
from rasterio.transform import from_bounds
from rasterio.shutil import copy as raster_copy
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data/Data_thuc_te'
LP = SRC / 'BD_Longlat_ver2/BD_Longlat_ver2'
P = ROOT / 'data/processed'; WEB = ROOT / 'data/web'; GEN = ROOT / 'public/generated/overlays'
YEARS = [1991, 2014, 2023]
# Chú giải "Bản đồ lớp phủ tỉnh Kon Tum từ ảnh vệ tinh" (Bando_Bientap/BD_Lop phu_*.tif)
CLASSES = {
    1: ('Rừng', (38, 115, 0), '#267300'),
    2: ('Cây bụi', (115, 115, 0), '#737300'),
    3: ('Đất nông nghiệp', (115, 76, 0), '#734c00'),
    4: ('Dân cư', (115, 0, 0), '#730000'),
    5: ('Mặt nước', (0, 38, 115), '#002673'),
    6: ('Thực vật ngập nước', (115, 0, 76), '#73004c'),
    7: ('Đất trống', (0, 115, 76), '#00734c'),
}

def decode(path):
    with rasterio.open(path) as d:
        rgb = d.read()
        prof = d.profile
    cls = np.zeros(rgb.shape[1:], dtype='uint8')
    for k, (_, c, _) in CLASSES.items():
        cls[(rgb[0] == c[0]) & (rgb[1] == c[1]) & (rgb[2] == c[2])] = k
    del rgb
    return cls, prof

classes = {}; prof = None
for y in YEARS:
    cls, pr = decode(LP / f'Lop_phu_{y}.tif')
    if prof is None: prof = pr
    assert pr['transform'] == prof['transform'] and pr['width'] == prof['width'], f'grid mismatch {y}'
    classes[y] = cls
    out = P / f'landcover-{y}-15m.tif'
    if not out.exists():
        p2 = dict(driver='GTiff', height=cls.shape[0], width=cls.shape[1], count=1, dtype='uint8', crs=prof['crs'], transform=prof['transform'], nodata=0, compress='deflate', tiled=True)
        tmp = P / f'landcover-{y}-tmp.tif'
        with rasterio.open(tmp, 'w', **p2) as d:
            d.write(cls, 1)
            d.write_colormap(1, {k: v[1] + (255,) for k, v in CLASSES.items()})
        raster_copy(tmp, out, driver='COG', compress='DEFLATE', overview_resampling='nearest'); tmp.unlink()
    print(y, 'decoded', {CLASSES[k][0]: int((cls == k).sum()) for k in CLASSES}, flush=True)

tr = prof['transform']; crs = prof['crs']; H, W = classes[YEARS[0]].shape
PIX_HA = abs(tr.a * tr.e) / 1e4
fc = json.loads((ROOT / 'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))
codes = [f['properties']['code'] for f in fc['features']]
cgrid = rasterize([(transform_geom('EPSG:4326', crs, f['geometry']), i + 1) for i, f in enumerate(fc['features'])], out_shape=(H, W), transform=tr, fill=0, dtype='uint8')

# ---------- statistics ----------
by_year = {}; by_commune = {c: {} for c in codes}
for y in YEARS:
    cls = classes[y]
    tot = np.bincount(cls.ravel(), minlength=8)
    by_year[y] = {str(k): round(float(tot[k]) * PIX_HA, 1) for k in CLASSES}
    combo = np.bincount(cgrid.ravel().astype('int32') * 8 + cls.ravel(), minlength=(len(codes) + 1) * 8).reshape(-1, 8)
    for i, c in enumerate(codes):
        by_commune[c][str(y)] = {str(k): round(float(combo[i + 1, k]) * PIX_HA, 1) for k in CLASSES}

def matrix(a, b):
    m = np.bincount(classes[a].ravel().astype('int32') * 8 + classes[b].ravel(), minlength=64).reshape(8, 8)
    return {str(i): {str(j): round(float(m[i, j]) * PIX_HA, 1) for j in CLASSES if m[i, j]} for i in CLASSES}

transitions = {f'{a}-{b}': matrix(a, b) for a, b in [(1991, 2014), (2014, 2023), (1991, 2023)]}

# forest change 1991 -> 2023: 1 stable forest, 2 loss, 3 gain (only where both years valid)
f0 = classes[1991] == 1; f1 = classes[2023] == 1; valid = (classes[1991] > 0) & (classes[2023] > 0)
chg = np.zeros((H, W), dtype='uint8'); chg[valid & f0 & f1] = 1; chg[valid & f0 & ~f1] = 2; chg[valid & ~f0 & f1] = 3
for i, c in enumerate(codes):
    m = cgrid == i + 1
    cnt = np.bincount(chg[m], minlength=4)
    by_commune[c]['forest_change_1991_2023'] = {'stable_ha': round(float(cnt[1]) * PIX_HA, 1), 'loss_ha': round(float(cnt[2]) * PIX_HA, 1), 'gain_ha': round(float(cnt[3]) * PIX_HA, 1)}

# ---------- display overlays (EPSG:3857 PNG with alpha) ----------
Wb, Sb, Eb, Nb = 107.33, 13.91, 108.56, 15.43
X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', Wb, Sb, Eb, Nb)
OH = 2600; OW = int(round(OH * (X1 - X0) / (Y1 - Y0))); otr = from_bounds(X0, Y0, X1, Y1, OW, OH)
def warp(arr):
    dst = np.zeros((OH, OW), dtype='uint8')
    reproject(arr, dst, src_transform=tr, src_crs=crs, dst_transform=otr, dst_crs='EPSG:3857', resampling=Resampling.mode, src_nodata=0, dst_nodata=0)
    return dst
def hexrgb(h): return [int(h[i:i + 2], 16) for i in (1, 3, 5)]
overlays = []
for y in YEARS:
    v = warp(classes[y]); rgba = np.zeros((OH, OW, 4), dtype='uint8')
    for k, (_, _, hx) in CLASSES.items():
        s = v == k; rgba[s, :3] = hexrgb(hx); rgba[s, 3] = 235
    Image.fromarray(rgba).save(GEN / f'lc-{y}.png')
    overlays.append(dict(id=f'lc-{y}', url=f'/generated/overlays/lc-{y}.webp', title=f'Lớp phủ năm {y} (dữ liệu dự án)', source='Bản đồ lớp phủ tỉnh Kon Tum từ ảnh vệ tinh – dữ liệu thực tế dự án (Data_thuc_te)',
        meaning='Phân loại 7 lớp phủ từ ảnh vệ tinh, 15 m; lớp “Rừng” là lớp phủ, chưa phải hiện trạng rừng pháp lý', resolution='15 m (hiển thị ~45 m)',
        legend=[dict(value=k, label=v[0], color=v[2]) for k, v in CLASSES.items()], coordinates=[[Wb, Nb], [Eb, Nb], [Eb, Sb], [Wb, Sb]], group='landcover', year=y))
v = warp(chg); rgba = np.zeros((OH, OW, 4), dtype='uint8')
for k, hx, a in [(1, '#9fd39a', 120), (2, '#e0322d', 255), (3, '#1677d2', 255)]:
    s = v == k; rgba[s, :3] = hexrgb(hx); rgba[s, 3] = a
Image.fromarray(rgba).save(GEN / 'lc-forest-change-1991-2023.png')
overlays.append(dict(id='lc-forest-change-1991-2023', url='/generated/overlays/lc-forest-change-1991-2023.webp', title='Biến động rừng 1991–2023 (dữ liệu dự án)',
    source='So sánh lớp phủ 1991 và 2023 – dữ liệu thực tế dự án', meaning='Mất rừng: rừng 1991 không còn là rừng năm 2023; tăng rừng: ngược lại. Theo lớp phủ, chưa phải kết luận pháp lý',
    resolution='15 m', legend=[dict(value=1, label='Rừng ổn định', color='#9fd39a'), dict(value=2, label='Mất rừng', color='#e0322d'), dict(value=3, label='Tăng rừng', color='#1677d2')],
    coordinates=[[Wb, Nb], [Eb, Nb], [Eb, Sb], [Wb, Sb]], group='landcover'))
ovf = WEB / 'overlays.json'; ov = json.loads(ovf.read_text(encoding='utf-8'))
ov = [o for o in ov if not o['id'].startswith('lc-')] + overlays
ovf.write_text(json.dumps(ov, ensure_ascii=False, indent=1), encoding='utf-8')

# ---------- field samples 2025 ----------
SHP = SRC / 'Mau thuc dia_2025' / 'Mau_KON_TUM_2025'
def fix_text(s):
    try: return s.encode('cp1252').decode('utf-8')
    except Exception: return s
def read_dbf(path):
    b = path.read_bytes(); n = struct.unpack('<I', b[4:8])[0]; hl = struct.unpack('<H', b[8:10])[0]; rl = struct.unpack('<H', b[10:12])[0]
    fields = []; off = 32
    while b[off] != 0x0D:
        d = b[off:off + 32]; fields.append((d[:11].split(b'\x00')[0].decode(), d[16])); off += 32
    rows = []
    for i in range(n):
        r = b[hl + i * rl: hl + (i + 1) * rl]; pos = 1; row = {}
        for name, l in fields: row[name] = r[pos:pos + l].decode('utf-8', 'replace').strip(); pos += l
        rows.append(row)
    return rows
def read_points(path):
    b = path.read_bytes(); off = 100; pts = []
    while off < len(b):
        clen = struct.unpack('>i', b[off + 4:off + 8])[0] * 2; st = struct.unpack('<i', b[off + 8:off + 12])[0]
        pts.append(struct.unpack('<2d', b[off + 12:off + 28]) if st in (1, 11, 21) else (None, None)); off += 8 + clen
    return pts
attrs = read_dbf(SHP.with_suffix('.dbf')); pts = read_points(SHP.with_suffix('.shp'))
LPR = {'Rung trong': ('Rừng trồng', 1), 'Rung la kim': ('Rừng lá kim', 1), 'LR thuong xanh': ('Rừng lá rộng thường xanh', 1), 'HG tre nua': ('Rừng hỗn giao tre nứa', 1),
       'Rung tre nua': ('Rừng tre nứa', 1), 'HG go la kim': ('Rừng hỗn giao gỗ – lá kim', 1), 'Dat trong': ('Đất trống', 7), 'Mat nuoc': ('Mặt nước', 5), 'Dat khac': ('Đất khác', None)}
xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
lon, lat = transform(crs, 'EPSG:4326', xs, ys)
with rasterio.open(P / 'landcover-2023-15m.tif') as d:
    lc23 = [int(v[0]) for v in d.sample(list(zip(xs, ys)))]
wcpath = P / 'worldcover-2021-10m.tif'
with rasterio.open(wcpath) as d:
    wc = [int(v[0]) for v in d.sample(list(zip(xs, ys)))]
NAMES = {'cao su': 'Cao su', 'thong': 'Thông', 'san': 'Sắn', 'hg tre nua': 'Hỗn giao tre nứa', 'hg tr nua': 'Hỗn giao tre nứa', 'lua': 'Lúa', 'ca phe': 'Cà phê', 'tre nua': 'Tre nứa',
  'tr nua': 'Tre nứa', 'rtn': 'Rừng tự nhiên', 'hg la kim': 'Hỗn giao lá kim', 'dat trong': 'Đất trống', 'lrtx': 'Lá rộng thường xanh', 'chuoi': 'Chuối', 'dan cu': 'Dân cư',
  'la kim': 'Lá kim', 'ngo': 'Ngô', 'dat trong, co': 'Đất trống, cỏ', 'mat nuoc': 'Mặt nước', 'keo': 'Keo', 'bach dan': 'Bạch đàn', 'mi': 'Mì (sắn)', 'cay bui': 'Cây bụi', 'co': 'Cỏ'}
def nice(t):
    k = ' '.join(t.lower().split())
    return NAMES.get(k, t[:1].upper() + t[1:] if t else t)
feats = []; agree = {'n': 0, 'match': 0}; wc_agree = {'n': 0, 'match': 0}; conf = {}
for a, x, y_, lo, la, c23, w in zip(attrs, xs, ys, lon, lat, lc23, wc):
    label, ref = LPR.get(a.get('LPR', ''), (a.get('LPR', ''), None))
    is_forest = ref == 1
    if ref is not None and c23:
        agree['n'] += 1; agree['match'] += int(c23 == ref)
        key = f"{label}→{CLASSES[c23][0]}"; conf[key] = conf.get(key, 0) + 1
    if a.get('LPR') in LPR and w:
        wc_agree['n'] += 1; wc_agree['match'] += int((w == 10) == is_forest)
    feats.append(dict(type='Feature', geometry=dict(type='Point', coordinates=[round(lo, 6), round(la, 6)]),
        properties=dict(ten=fix_text(a.get('Ten', '')).strip(), ten_vi=nice(fix_text(a.get('Ten', '')).strip()), lpr_code=a.get('LPR'), lpr=label, is_forest=is_forest,
                        lc2023=CLASSES[c23][0] if c23 else None, worldcover2021=w, x_utm=round(x, 1), y_utm=round(y_, 1))))
(WEB / 'field-samples.geojson').write_text(json.dumps(dict(type='FeatureCollection', features=feats), ensure_ascii=False), encoding='utf-8')
validation = dict(samples=len(feats), source='Mẫu thực địa Kon Tum 2025 (Data_thuc_te/Mau thuc dia_2025)',
    landcover_2023=dict(compared=agree['n'], agreement=round(agree['match'] / max(agree['n'], 1), 3), note='So sánh nhãn mẫu (gộp các kiểu rừng thành “Rừng”) với lớp phủ 2023 tại điểm; mẫu “Đất khác” không so sánh vì không có lớp tương ứng duy nhất'),
    worldcover_2021_forest=dict(compared=wc_agree['n'], agreement=round(wc_agree['match'] / max(wc_agree['n'], 1), 3), note='Rừng (mẫu) so với lớp “Cây gỗ” WorldCover 2021'),
    confusion=dict(sorted(conf.items(), key=lambda kv: -kv[1])),
    by_label={l: sum(1 for f in feats if f['properties']['lpr'] == l) for l in sorted({f['properties']['lpr'] for f in feats})})

payload = dict(generated_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(), source='Data_thuc_te/BD_Longlat_ver2 (Lop_phu_1991/2014/2023.tif, UTM 48N, 15 m)',
    years=YEARS, classes={str(k): dict(label=v[0], color=v[2]) for k, v in CLASSES.items()}, pixel_ha=PIX_HA,
    aoi_by_year={str(y): by_year[y] for y in YEARS}, by_commune=by_commune, transitions=transitions,
    forest_change_1991_2023={k: round(float(np.sum(chg == v)) * PIX_HA, 1) for k, v in [('stable_ha', 1), ('loss_ha', 2), ('gain_ha', 3)]},
    field_validation=validation, scope='Thống kê trong ranh xã đã cắt theo ranh Kon Tum cũ; pixel ngoài ranh xã không tính vào xã')
(WEB / 'landcover-history.json').write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
print(json.dumps({k: payload[k] for k in ['aoi_by_year', 'forest_change_1991_2023']}, ensure_ascii=False))
print(json.dumps(validation, ensure_ascii=False, indent=1))
