"""Phân loại ảnh Sentinel-2 tháng (100 m) có giám sát bằng Random Forest, học từ 389 mẫu thực địa dự án (Mau_KON_TUM_2025).
Usage: python classify_landcover.py <YYYY-MM> [out_dir]
Lớp: 1 Rừng tự nhiên · 2 Rừng trồng · 3 Đất trống, cây bụi · 4 Đất nông nghiệp, dân cư, khác · 5 Mặt nước.
Đặc trưng: 6 băng phản xạ + NDVI, NDMI, NDWI, NBR của tháng chọn; mặt nước bổ sung bằng quy tắc NDWI > 0,1 (ít mẫu).
Độ chính xác đánh giá chéo 5 lớp (stratified 5-fold) trên chính bộ mẫu; mẫu khảo sát năm 2025 nên các tháng xa 2025
có thể lệch do thay đổi lớp phủ thực tế. Ra: <out_dir>/class-<YYYY-MM>.png (EPSG:3857, toạ độ như các lớp phủ khác),
<out_dir>/class-<YYYY-MM>.json (diện tích từng lớp, độ chính xác, ma trận nhầm lẫn) và GeoTIFF 100 m để tải xuống."""
import os, sys, json, importlib.util
from pathlib import Path
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds, transform_geom
from rasterio.features import geometry_mask
from rasterio.transform import from_bounds
from PIL import Image
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import accuracy_score, cohen_kappa_score, confusion_matrix

ROOT = Path(__file__).resolve().parents[1]
month = sys.argv[1]
out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'public/generated/overlays'; out.mkdir(parents=True, exist_ok=True)
src = ROOT / f'data/collected/monitoring-series/sentinel-{month}-100m.tif'
if not src.exists(): print(json.dumps(dict(ok=False, error=f'Chưa có ảnh Sentinel-2 tháng {month}'), ensure_ascii=False)); sys.exit(2)

CLASSES = {1: ('Rừng tự nhiên', '#0b6b2e'), 2: ('Rừng trồng', '#7cc242'), 3: ('Đất trống, cây bụi', '#e8d27a'), 4: ('Nông nghiệp, dân cư, đất khác', '#d9822b'), 5: ('Mặt nước', '#2b7bd6')}
NAT = {'Rừng lá rộng thường xanh', 'Rừng lá kim', 'Rừng tre nứa', 'Rừng hỗn giao tre nứa', 'Rừng hỗn giao gỗ – lá kim'}


def label(p):
    l = p.get('lpr')
    if l in NAT: return 1
    if l == 'Rừng trồng': return 2
    if l == 'Đất trống': return 3
    if l == 'Mặt nước': return 5
    return 4


def feats(a):
    b2, b3, b4, b8, b11, b12 = [a[i].astype('float32') for i in range(6)]
    eps = 1e-6
    nd = lambda x, y: (x - y) / (x + y + eps)
    return np.stack([b2, b3, b4, b8, b11, b12, nd(b8, b4), nd(b8, b11), nd(b3, b8), nd(b8, b12)])


with rasterio.open(src) as d:
    a = d.read().astype('float32'); T = d.transform; crs = d.crs; prof = d.profile
valid = (a[6] > 0) & (a[:6].min(0) > 0)
F = feats(a)
# mẫu thực địa → giá trị pixel
fc = json.loads((ROOT / 'data/web/field-samples.geojson').read_text(encoding='utf-8'))
X, y = [], []
for f in fc['features']:
    lon, lat = f['geometry']['coordinates'][:2]
    r, c = rasterio.transform.rowcol(T, lon, lat) if crs.to_epsg() == 4326 else (None, None)
    if r is None:
        from rasterio.warp import transform as tf
        xs, ys = tf('EPSG:4326', crs, [lon], [lat]); r, c = rasterio.transform.rowcol(T, xs[0], ys[0])
    if 0 <= r < a.shape[1] and 0 <= c < a.shape[2] and valid[r, c]:
        X.append(F[:, r, c]); y.append(label(f['properties']))
X = np.array(X); y = np.array(y)
if len(y) < 100: print(json.dumps(dict(ok=False, error=f'Chỉ {len(y)} mẫu có ảnh hợp lệ trong tháng {month} (mây) – chọn tháng khác'), ensure_ascii=False)); sys.exit(2)
rf = RandomForestClassifier(n_estimators=300, min_samples_leaf=2, class_weight='balanced', random_state=42, n_jobs=-1)
counts = {int(k): int(v) for k, v in zip(*np.unique(y, return_counts=True))}
nfold = max(2, min(5, min(counts.values())))
pred = cross_val_predict(rf, X, y, cv=StratifiedKFold(nfold, shuffle=True, random_state=42)) if min(counts.values()) >= 2 else rf.fit(X, y).predict(X)
acc = float(accuracy_score(y, pred)); kappa = float(cohen_kappa_score(y, pred))
labels = sorted(counts); cm = confusion_matrix(y, pred, labels=labels).tolist()
rf.fit(X, y)
cls = np.zeros(valid.shape, 'uint8')
flat = F[:, valid].T
cls[valid] = rf.predict(flat).astype('uint8')
ndwi = F[8]; cls[valid & (ndwi > 0.1)] = 5
# chỉ trong ranh tỉnh
aoi = json.loads((ROOT / 'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
inside = geometry_mask([transform_geom('EPSG:4326', crs, aoi)], cls.shape, T, invert=True)
cls[~inside] = 0
# diện tích (ha) – ô 100 m trên lưới địa lý: tính diện tích thật theo vĩ độ
if crs.to_epsg() == 4326:
    rows = np.arange(cls.shape[0]); lat = T.f + (rows + 0.5) * T.e
    cell = (abs(T.a) * 111320 * np.cos(np.radians(lat))) * (abs(T.e) * 110574) / 1e4
    area = {k: round(float((cell[:, None] * (cls == k)).sum()), 1) for k in CLASSES}
else:
    area = {k: round(float((cls == k).sum() * abs(T.a * T.e) / 1e4), 1) for k in CLASSES}
# GeoTIFF để tải xuống
prof.update(count=1, dtype='uint8', nodata=0, compress='deflate')
tif = out / f'class-{month}.tif'
with rasterio.open(tif, 'w', **prof) as dst:
    dst.write(cls, 1); dst.write_colormap(1, {k: tuple(int(v[1][i:i + 2], 16) for i in (1, 3, 5)) + (255,) for k, v in CLASSES.items()})
# ảnh hiển thị EPSG:3857 như các lớp phủ khác
W, S, E, N = 107.33, 13.91, 108.56, 15.43
X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', W, S, E, N)
H = 1400; WD = int(round(H * (X1 - X0) / (Y1 - Y0))); tr = from_bounds(X0, Y0, X1, Y1, WD, H)
g = np.zeros((H, WD), 'uint8')
reproject(cls, g, src_transform=T, src_crs=crs, dst_transform=tr, dst_crs='EPSG:3857', resampling=Resampling.nearest, src_nodata=0, dst_nodata=0)
rgba = np.zeros((H, WD, 4), 'uint8')
for k, (_, col) in CLASSES.items():
    m = g == k
    for i in range(3): rgba[..., i][m] = int(col[1 + 2 * i:3 + 2 * i], 16)
    rgba[..., 3][m] = 230
Image.fromarray(rgba).save(out / f'class-{month}.png')
res = dict(ok=True, month=month, method='Random Forest (300 cây) + quy tắc NDWI cho mặt nước', samples=int(len(y)), samples_by_class={CLASSES[k][0]: v for k, v in counts.items()},
           accuracy=round(acc, 3), kappa=round(kappa, 3), folds=nfold, confusion=dict(labels=[CLASSES[k][0] for k in labels], matrix=cm),
           area_ha={CLASSES[k][0]: v for k, v in area.items()}, classes=[dict(value=k, label=v[0], color=v[1]) for k, v in CLASSES.items()],
           valid_fraction=round(float((valid & inside).sum() / max(inside.sum(), 1)), 3), coordinates=[[W, N], [E, N], [E, S], [W, S]])
(out / f'class-{month}.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(dict(ok=True, month=month, accuracy=res['accuracy'], kappa=res['kappa'], samples=res['samples']), ensure_ascii=False))
