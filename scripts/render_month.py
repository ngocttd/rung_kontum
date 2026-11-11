"""Dựng ảnh hiển thị một tháng Sentinel-2 (median tháng 100 m) cho trang So sánh ảnh / tải xuống.
Usage: python render_month.py <YYYY-MM> <true|false|ndvi> <out.png>
Ảnh EPSG:3857 cùng khung toạ độ với các lớp phủ khác ([107.33, 13.91] – [108.56, 15.43]); ngoài ranh tỉnh trong suốt."""
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

ROOT = Path(__file__).resolve().parents[1]
month, mode, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
src = ROOT / f'data/collected/monitoring-series/sentinel-{month}-100m.tif'
if not src.exists(): print(json.dumps(dict(ok=False, error='Không có ảnh tháng này'))); sys.exit(2)
W, S, E, N = 107.33, 13.91, 108.56, 15.43
X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', W, S, E, N)
H = 1400; WD = int(round(H * (X1 - X0) / (Y1 - Y0))); tr = from_bounds(X0, Y0, X1, Y1, WD, H)
aoi = json.loads((ROOT / 'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
mask = geometry_mask([transform_geom('EPSG:4326', 'EPSG:3857', aoi)], (H, WD), tr, invert=True)
need = {'true': (3, 2, 1), 'false': (4, 3, 2), 'ndvi': (4, 3)}[mode]
bands = {}
with rasterio.open(src) as d:
    for b in set(need) | {7}:
        dst = np.zeros((H, WD), 'float32')
        reproject(rasterio.band(d, b), dst, dst_transform=tr, dst_crs='EPSG:3857', resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
        bands[b] = dst
valid = (bands[7] > 0) & mask
rgba = np.zeros((H, WD, 4), 'uint8')
if mode == 'ndvi':
    nd = (bands[4] - bands[3]) / np.maximum(bands[4] + bands[3], 1)
    stops = [(-0.1, '#a50026'), (0.2, '#f46d43'), (0.4, '#fee08b'), (0.6, '#a6d96a'), (0.8, '#1a9850'), (0.9, '#006837')]
    v = np.array([s[0] for s in stops]); c = np.array([[int(s[1][i:i + 2], 16) for i in (1, 3, 5)] for s in stops])
    for k in range(3): rgba[..., k] = np.interp(np.clip(nd, v[0], v[-1]), v, c[:, k])
else:
    div = [1800, 1800, 1800] if mode == 'true' else [4500, 1800, 1800]
    for k, b in enumerate(need): rgba[..., k] = np.clip(255 * (bands[b] / div[k]) ** 0.8, 0, 255)
rgba[..., 3] = np.where(valid, 255, 0)
out.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(rgba).save(out)
print(json.dumps(dict(ok=True, month=month, mode=mode, valid_fraction=round(float(valid.sum() / mask.sum()), 3))))
