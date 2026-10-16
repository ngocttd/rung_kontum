"""Map import worker (PDF / GeoTIFF / ảnh bản đồ). Called by src/services/maps.js; prints one JSON result.

  python map_worker.py inspect <src_file> <out_dir>
      -> technical metadata (FR02), sha256, previews (FR03): PDF pages / raster thumbnail
  python map_worker.py process <src_file> <out_dir> <config.json>
      -> GeoTIFF: overlay EPSG:3857 (RGBA PNG) theo cấu hình hiển thị + COG (FR05)
      -> PDF/ảnh có điểm khống chế (FR04): biến đổi affine/đa thức bậc 2, RMSE (m), raster định vị + overlay
The original file is never modified.
"""
import os, sys, json, hashlib, importlib.util, math
from pathlib import Path
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import warnings; warnings.filterwarnings('ignore')
import rasterio
from rasterio.warp import transform_bounds, reproject, Resampling, transform_geom, transform as warp_points
from rasterio.transform import from_bounds
from rasterio.features import geometry_mask
from rasterio.shutil import copy as raster_copy
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/pdf'))
AOI = json.loads((ROOT / 'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
PALETTES = {
    'greens': ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'],
    'heat': ['#313695', '#74add1', '#fee090', '#f46d43', '#a50026'],
    'terrain': ['#2c7f3f', '#8fbf5a', '#e8d98a', '#c99a5b', '#f2f2f2'],
    'risk': ['#007b4b', '#81cb1a', '#ffd21f', '#ff8a00', '#f02d2d'],
    'gray': ['#000000', '#ffffff'],
}

def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()

def out(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False)); sys.stdout.flush()

def hexrgb(h): return [int(h[i:i + 2], 16) for i in (1, 3, 5)]

def ramp(v, pal):
    cs = np.array([hexrgb(c) for c in pal], dtype='float32'); xs = np.linspace(0, 1, len(pal))
    return np.stack([np.interp(v, xs, cs[:, k]) for k in range(3)], -1).astype('uint8')

def save_jpeg(arr_or_img, path, maxdim=1600):
    im = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img)
    im = im.convert('RGB'); im.thumbnail((maxdim, maxdim)); im.save(path, 'JPEG', quality=85); return im.size

# ---------------------------------------------------------------- inspect
def inspect(src, odir):
    src = Path(src); odir = Path(odir); odir.mkdir(parents=True, exist_ok=True)
    ext = src.suffix.lower(); res = dict(size_bytes=src.stat().st_size, sha256=sha256(src), previews=[])
    if ext == '.pdf':
        import fitz
        doc = fitz.open(src); res.update(kind='pdf', pages=doc.page_count, page_size_pt=[round(doc[0].rect.width), round(doc[0].rect.height)])
        res['page_size_mm'] = [round(v * 25.4 / 72) for v in res['page_size_pt']]
        # GeoPDF? (GDAL PDF driver reads embedded georeferencing when present)
        try:
            with rasterio.open(src) as d:
                if d.crs: res.update(crs=d.crs.to_string(), georeferenced=True, bounds4326=list(transform_bounds(d.crs, 'EPSG:4326', *d.bounds)))
        except Exception: pass
        res.setdefault('georeferenced', False)
        for i in range(min(doc.page_count, 20)):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(1.6, 1.6))
            im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            p = odir / f'page-{i + 1}.jpg'; w, h = save_jpeg(im, p, 1800); res['previews'].append(dict(file=p.name, page=i + 1, width=w, height=h))
        return out(res)
    with rasterio.open(src) as d:
        res.update(kind='raster', width=d.width, height=d.height, bands=d.count, dtype=d.dtypes[0], nodata=d.nodata,
                   driver=d.driver, band_descriptions=list(d.descriptions), colorinterp=[c.name for c in d.colorinterp])
        if d.crs and not d.transform.is_identity:
            res.update(georeferenced=True, crs=d.crs.to_string(), epsg=d.crs.to_epsg(), wkt=d.crs.to_wkt()[:4000], pixel_size=[abs(d.res[0]), abs(d.res[1])],
                       units='m' if d.crs.is_projected else 'deg', bounds_native=list(d.bounds))
            b = transform_bounds(d.crs, 'EPSG:4326', *d.bounds); res['bounds4326'] = [round(x, 6) for x in b]
            res['footprint'] = transform_geom(d.crs, 'EPSG:4326', dict(type='Polygon', coordinates=[[(d.bounds.left, d.bounds.bottom), (d.bounds.right, d.bounds.bottom), (d.bounds.right, d.bounds.top), (d.bounds.left, d.bounds.top), (d.bounds.left, d.bounds.bottom)]]))
        else:
            res['georeferenced'] = False
        scale = max(d.width, d.height) / 1800
        shape = (max(1, int(d.height / scale)), max(1, int(d.width / scale))) if scale > 1 else (d.height, d.width)
        n = min(d.count, 3)
        arr = d.read(list(range(1, n + 1)), out_shape=(n, *shape), resampling=Resampling.nearest, masked=True)
        stats = []
        for k in range(d.count if d.count <= 4 else 4):
            a = d.read(k + 1, out_shape=shape, masked=True)
            stats.append(dict(band=k + 1, min=float(a.min()) if a.count() else None, max=float(a.max()) if a.count() else None, mean=float(a.mean()) if a.count() else None))
        res['stats'] = stats
        if n >= 3 and d.dtypes[0] == 'uint8':
            rgb = np.moveaxis(arr.filled(255), 0, 2).astype('uint8')
        else:
            a = arr[0].astype('float32'); lo, hi = np.percentile(a.compressed(), [2, 98]) if a.count() else (0, 1)
            rgb = ramp(np.clip((a.filled(lo) - lo) / max(hi - lo, 1e-9), 0, 1), PALETTES['gray'])
        p = odir / 'preview.jpg'; w, h = save_jpeg(rgb, p); res['previews'].append(dict(file=p.name, width=w, height=h))
    return out(res)

# ---------------------------------------------------------------- georeferencing (GCP)
def fit(gcps, method):
    px = np.array([[g['px'], g['py']] for g in gcps], dtype='float64')
    # work in UTM 48N metres so residuals are in metres
    xs, ys = warp_points('EPSG:4326', 'EPSG:32648', [g['lon'] for g in gcps], [g['lat'] for g in gcps])
    xy = np.column_stack([xs, ys])
    def design(p):
        x, y = p[:, 0], p[:, 1]
        cols = [np.ones_like(x), x, y] + ([x * x, x * y, y * y] if method == 'poly2' else [])
        return np.column_stack(cols)
    need = 6 if method == 'poly2' else 3
    if len(gcps) < need: raise ValueError(f'Cần tối thiểu {need} điểm khống chế cho phép biến đổi {"đa thức bậc 2" if method == "poly2" else "affine"}')
    A = design(px); fx, *_ = np.linalg.lstsq(A, xy[:, 0], rcond=None); fy, *_ = np.linalg.lstsq(A, xy[:, 1], rcond=None)
    pred = np.column_stack([A @ fx, A @ fy]); resid = np.hypot(*(pred - xy).T)
    # inverse (map -> pixel) for resampling
    B = design(xy); ix, *_ = np.linalg.lstsq(B, px[:, 0], rcond=None); iy, *_ = np.linalg.lstsq(B, px[:, 1], rcond=None)
    rmse = float(np.sqrt(np.mean(resid ** 2)))
    # degrees of freedom: with exactly the minimum number of points RMSE is 0 by construction
    return dict(fx=fx, fy=fy, ix=ix, iy=iy, design=design, rmse=rmse, residuals=resid.tolist(), exact=len(gcps) == need)

def georef_image(img, gcps, method, odir, opacity):
    f = fit(gcps, method)
    h, w = img.shape[:2]
    corners = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype='float64')
    C = f['design'](corners); cx = C @ f['fx']; cy = C @ f['fy']
    lon, lat = warp_points('EPSG:32648', 'EPSG:4326', cx.tolist(), cy.tolist())
    W_, S_, E_, N_ = min(lon), min(lat), max(lon), max(lat)
    X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', W_, S_, E_, N_)
    OH = min(2400, max(600, h)); OW = int(round(OH * (X1 - X0) / (Y1 - Y0)))
    otr = from_bounds(X0, Y0, X1, Y1, OW, OH)
    cols, rows = np.meshgrid(np.arange(OW) + 0.5, np.arange(OH) + 0.5)
    mx = otr.c + cols * otr.a; my = otr.f + rows * otr.e
    ux, uy = warp_points('EPSG:3857', 'EPSG:32648', mx.ravel().tolist(), my.ravel().tolist())
    U = f['design'](np.column_stack([ux, uy])); sx = (U @ f['ix']).reshape(OH, OW); sy = (U @ f['iy']).reshape(OH, OW)
    inside = (sx >= 0) & (sx < w) & (sy >= 0) & (sy < h)
    sxi = np.clip(sx.astype('int32'), 0, w - 1); syi = np.clip(sy.astype('int32'), 0, h - 1)
    rgba = np.zeros((OH, OW, 4), dtype='uint8'); rgba[..., :3] = img[syi, sxi, :3]; rgba[..., 3] = np.where(inside, 255, 0)
    Image.fromarray(rgba).save(odir / 'overlay.png')
    # georeferenced raster (EPSG:3857, RGBA) for download / GIS use
    with rasterio.open(odir / 'georef.tif', 'w', driver='GTiff', width=OW, height=OH, count=4, dtype='uint8', crs='EPSG:3857', transform=otr, compress='deflate', photometric='RGB', alpha='YES') as d:
        d.write(np.moveaxis(rgba, 2, 0))
    fp = dict(type='Polygon', coordinates=[[[lon[i], lat[i]] for i in range(4)] + [[lon[0], lat[0]]]])
    for g, r in zip(gcps, f['residuals']): g['residual_m'] = round(r, 2)
    return dict(overlay='overlay.png', georef_raster='georef.tif', bounds4326=[W_, S_, E_, N_], overlay_bounds=[[W_, N_], [E_, N_], [E_, S_], [W_, S_]],
                footprint=fp, rmse_m=round(f['rmse'], 2), gcps=gcps, method=method, exact_fit=f['exact'], output_size=[OW, OH])

def load_image(src, page):
    src = Path(src)
    if src.suffix.lower() == '.pdf':
        import fitz
        doc = fitz.open(src); pg = doc[page - 1]
        zoom = min(4.0, 3000 / max(pg.rect.width, pg.rect.height))
        pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom)); img = np.frombuffer(pix.samples, dtype='uint8').reshape(pix.height, pix.width, pix.n)
        scale = zoom * 1.6 / 1.6  # gcps are given in preview pixels (zoom 1.6)
        return img[..., :3].copy(), zoom / 1.6
    with rasterio.open(src) as d:
        s = max(d.width, d.height) / 3000
        shape = (int(d.height / s), int(d.width / s)) if s > 1 else (d.height, d.width)
        n = min(3, d.count); arr = d.read(list(range(1, n + 1)), out_shape=(n, *shape))
        img = np.moveaxis(arr, 0, 2)
        if n == 1: img = np.repeat(img, 3, axis=2)
        # preview.jpg was max 1800 px on the long side
        pv = max(d.width, d.height) / 1800 if max(d.width, d.height) > 1800 else 1
        return img.astype('uint8'), (1 / s if s > 1 else 1) * pv

# ---------------------------------------------------------------- process
def process(src, odir, cfg):
    odir = Path(odir); cfg = json.loads(Path(cfg).read_text(encoding='utf-8')) if os.path.exists(cfg) else json.loads(cfg)
    if cfg.get('gcps'):
        img, k = load_image(src, int(cfg.get('page', 1)))
        h0, w0 = img.shape[:2]
        # fx/fy: position as a fraction of the preview image (independent of preview resolution)
        gcps = [dict(g, px=g['fx'] * w0 if 'fx' in g else g['px'] * k, py=g['fy'] * h0 if 'fy' in g else g['py'] * k) for g in cfg['gcps']]
        r = georef_image(img, gcps, cfg.get('method', 'affine'), odir, cfg.get('opacity', 0.8))
        for g, o in zip(r['gcps'], cfg['gcps']): g['px'], g['py'] = o['px'], o['py']  # report in preview pixels
        return out(dict(ok=True, mode='gcp', **r))
    with rasterio.open(src) as d:
        if not d.crs or d.transform.is_identity: raise ValueError('Tệp chưa có hệ toạ độ – cần gán điểm khống chế trước khi xử lý')
        b = transform_bounds(d.crs, 'EPSG:4326', *d.bounds)
        X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', *b)
        OH = int(cfg.get('height', 2400)); OW = int(round(OH * (X1 - X0) / (Y1 - Y0))); otr = from_bounds(X0, Y0, X1, Y1, OW, OH)
        mode = cfg.get('mode') or ('rgb' if d.count >= 3 else 'single')
        dec = max(1, int(max(d.width, d.height) / (OH * 1.5)))
        rshape = (max(1, d.height // dec), max(1, d.width // dec))
        rtr = d.transform * d.transform.scale(d.width / rshape[1], d.height / rshape[0])
        nodata = cfg.get('nodata', d.nodata)
        def warp_band(i, resampling):
            a = d.read(i, out_shape=rshape, resampling=Resampling.nearest).astype('float32')
            valid = np.ones_like(a, dtype=bool) if nodata is None else a != nodata
            dst = np.full((OH, OW), np.nan, dtype='float32')
            reproject(np.where(valid, a, np.nan), dst, src_transform=rtr, src_crs=d.crs, dst_transform=otr, dst_crs='EPSG:3857', resampling=resampling, src_nodata=np.nan, dst_nodata=np.nan)
            return dst
        if mode == 'rgb':
            bands = [warp_band(i, Resampling.nearest) for i in (cfg.get('bands') or [1, 2, 3])[:3]]
            ok = np.isfinite(bands[0])
            if cfg.get('nodata_rgb'):
                nr = cfg['nodata_rgb']; ok &= ~((bands[0] == nr[0]) & (bands[1] == nr[1]) & (bands[2] == nr[2]))
            if d.dtypes[0] == 'uint8': rgb = np.stack([np.nan_to_num(x).astype('uint8') for x in bands], -1)
            else:
                lo, hi = float(cfg.get('min', np.nanpercentile(bands[0], 2))), float(cfg.get('max', np.nanpercentile(bands[0], 98)))
                rgb = np.stack([(np.clip((np.nan_to_num(x) - lo) / max(hi - lo, 1e-9), 0, 1) * 255).astype('uint8') for x in bands], -1)
        else:
            v = warp_band(int(cfg.get('band', 1)), Resampling.bilinear); ok = np.isfinite(v)
            lo = float(cfg.get('min', np.nanpercentile(v, 2))); hi = float(cfg.get('max', np.nanpercentile(v, 98)))
            rgb = ramp(np.clip((np.nan_to_num(v, nan=lo) - lo) / max(hi - lo, 1e-9), 0, 1), PALETTES.get(cfg.get('palette', 'greens'), PALETTES['greens']))
            cfg['min'], cfg['max'] = lo, hi
        if cfg.get('clip', True):
            ok &= geometry_mask([transform_geom('EPSG:4326', 'EPSG:3857', AOI)], (OH, OW), otr, invert=True)
        rgba = np.dstack([rgb, (ok * 255).astype('uint8')])
        Image.fromarray(rgba).save(odir / 'overlay.png')
        res = dict(ok=True, mode=mode, overlay='overlay.png', overlay_bounds=[[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]], bounds4326=list(b), output_size=[OW, OH],
                   display=dict((k, cfg[k]) for k in ('mode', 'band', 'palette', 'min', 'max', 'opacity', 'clip') if k in cfg))
        # COG (FR05): only when the source is not already a COG, and only for reasonably sized inputs
        try:
            is_cog = d.driver == 'GTiff' and (d.profile.get('tiled') and d.overviews(1))
        except Exception: is_cog = False
    if not is_cog and cfg.get('make_cog', True):
        raster_copy(src, odir / 'cog.tif', driver='COG', compress='DEFLATE', overview_resampling='nearest' if mode == 'rgb' else 'average')
        res['cog'] = 'cog.tif'
    return out(res)

if __name__ == '__main__':
    try:
        cmd = sys.argv[1]
        if cmd == 'inspect': inspect(sys.argv[2], sys.argv[3])
        elif cmd == 'process': process(sys.argv[2], sys.argv[3], sys.argv[4])
        else: raise ValueError('unknown command')
    except Exception as e:
        out(dict(ok=False, error_code=type(e).__name__, error=str(e))); sys.exit(2)
