"""Chuyển một lớp ảnh bản đồ (PNG RGBA, hệ EPSG:3857, biết 4 góc WGS84) thành GeoTIFF có toạ độ để mở trong QGIS/ArcGIS.
  python overlay_to_tif.py <ảnh.png> <W> <S> <E> <N> <out.tif> [hệ toạ độ]
hệ toạ độ: EPSG:3857 (mặc định, giữ nguyên lưới ảnh) | EPSG:4326 | EPSG:32648 | VN2000:<kinh tuyến trục>:<múi> (xem _crs.py)."""
import os, sys, json, importlib.util
from pathlib import Path
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import warnings; warnings.filterwarnings('ignore')
import rasterio
from rasterio.crs import CRS
from rasterio.warp import transform_bounds, reproject, Resampling, calculate_default_transform
from rasterio.transform import from_bounds
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _crs import resolve
Image.MAX_IMAGE_PIXELS = None
try:
    src, W, S, E, N, out = sys.argv[1], *[float(x) for x in sys.argv[2:6]], sys.argv[6]
    spec = sys.argv[7] if len(sys.argv) > 7 else 'EPSG:3857'
    a = np.array(Image.open(src).convert('RGBA')); a = np.moveaxis(a, -1, 0); H, Wd = a.shape[1:]
    M = CRS.from_epsg(3857); T = from_bounds(*transform_bounds('EPSG:4326', M, W, S, E, N), Wd, H)
    crs, T2, arr, label = M, T, a, 'WGS84 / Pseudo-Mercator (EPSG:3857)'
    if spec.upper() != 'EPSG:3857':
        proj, label = resolve(spec); dst = CRS.from_user_input(proj)
        T2, W2, H2 = calculate_default_transform(M, dst, Wd, H, *rasterio.transform.array_bounds(H, Wd, T))
        arr = np.zeros((4, H2, W2), dtype='uint8')
        reproject(a, arr, src_transform=T, src_crs=M, dst_transform=T2, dst_crs=dst, resampling=Resampling.nearest)
        crs = dst
    with rasterio.open(out, 'w', driver='GTiff', height=arr.shape[1], width=arr.shape[2], count=4, dtype='uint8', crs=crs, transform=T2, compress='deflate', tiled=True, photometric='RGB', alpha='YES') as d:
        d.write(arr); d.colorinterp = [rasterio.enums.ColorInterp.red, rasterio.enums.ColorInterp.green, rasterio.enums.ColorInterp.blue, rasterio.enums.ColorInterp.alpha]
    print(json.dumps(dict(ok=True, width=int(arr.shape[2]), height=int(arr.shape[1]), crs_label=label), ensure_ascii=False))
except Exception as e:  # noqa
    print(json.dumps(dict(ok=False, error=f'{type(e).__name__}: {e}'), ensure_ascii=False)); sys.exit(2)
