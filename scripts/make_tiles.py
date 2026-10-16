"""XYZ raster tiles (EPSG:3857, 256 px PNG) from a GeoTIFF so map layers stay sharp at every zoom.

  python make_tiles.py <src.tif> <out_dir> --zmin 7 --zmax 14 --mode classes|rgb|ramp|loss
       [--nodata-rgb 255,255,255] [--palette '{"1":"#267300",...}'] [--clip] [--workers 4]

modes: classes = single band class codes coloured by --palette (nearest; e.g. landcover)
       rgb     = first three bands as RGB (nearest), optional --nodata-rgb made transparent
       ramp    = single band continuous values with --stops '[[v,"#hex"],...]' (bilinear)
Writes tilejson.json (bounds, minzoom, maxzoom). Empty tiles are skipped.
"""
import os, sys, json, math, argparse, importlib.util
from pathlib import Path
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import warnings; warnings.filterwarnings('ignore')
import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds, transform_geom
from rasterio.transform import from_bounds
from rasterio.features import geometry_mask
from PIL import Image
from concurrent.futures import ProcessPoolExecutor

ROOT = Path(__file__).resolve().parents[1]
R = 6378137.0; ORIGIN = math.pi * R

def tile_bounds(z, x, y):
    size = 2 * ORIGIN / 2 ** z
    return (-ORIGIN + x * size, ORIGIN - (y + 1) * size, -ORIGIN + (x + 1) * size, ORIGIN - y * size)

def lonlat_to_tile(lon, lat, z):
    n = 2 ** z; x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y

def hexrgb(h): return [int(h[i:i + 2], 16) for i in (1, 3, 5)]

CFG = {}
def init(cfg):
    CFG.update(cfg)
    CFG['ds'] = rasterio.open(cfg['src'])
    if cfg.get('clip'):
        aoi = json.loads((ROOT / 'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
        CFG['aoi'] = transform_geom('EPSG:4326', 'EPSG:3857', aoi)

def render(job):
    z, x, y = job; d = CFG['ds']; mode = CFG['mode']
    b = tile_bounds(z, x, y); tr = from_bounds(*b, 256, 256)
    if mode == 'rgb':
        bands = []
        for i in (1, 2, 3):
            dst = np.zeros((256, 256), dtype='uint8')
            reproject(rasterio.band(d, i), dst, dst_transform=tr, dst_crs='EPSG:3857', resampling=Resampling.nearest, src_nodata=None, dst_nodata=0)
            bands.append(dst)
        rgb = np.stack(bands, -1)
        ok = np.ones((256, 256), dtype=bool)
        # outside source extent reproject leaves zeros: treat pure black as empty, and nodata colour as transparent
        ok &= ~((rgb[..., 0] == 0) & (rgb[..., 1] == 0) & (rgb[..., 2] == 0))
        if CFG.get('nodata_rgb'):
            n = CFG['nodata_rgb']; ok &= ~((rgb[..., 0] == n[0]) & (rgb[..., 1] == n[1]) & (rgb[..., 2] == n[2]))
        rgba = np.dstack([rgb, (ok * 255).astype('uint8')])
    elif mode == 'classes':
        dst = np.zeros((256, 256), dtype='uint8')
        reproject(rasterio.band(d, 1), dst, dst_transform=tr, dst_crs='EPSG:3857', resampling=Resampling.nearest, src_nodata=d.nodata if d.nodata is not None else 0, dst_nodata=0)
        rgba = np.zeros((256, 256, 4), dtype='uint8')
        for k, col in CFG['palette'].items():
            s = dst == int(k)
            if s.any(): rgba[s, :3] = hexrgb(col[0] if isinstance(col, list) else col); rgba[s, 3] = col[1] if isinstance(col, list) else 255
    else:  # ramp
        dst = np.full((256, 256), np.nan, dtype='float32')
        reproject(rasterio.band(d, 1), dst, dst_transform=tr, dst_crs='EPSG:3857', resampling=Resampling.bilinear, src_nodata=d.nodata, dst_nodata=np.nan)
        stops = CFG['stops']; xs = [s[0] for s in stops]; cs = np.array([hexrgb(s[1]) for s in stops], dtype='float32')
        v = np.nan_to_num(dst, nan=xs[0])
        rgb = np.stack([np.interp(v, xs, cs[:, i]) for i in range(3)], -1).astype('uint8')
        rgba = np.dstack([rgb, (np.isfinite(dst) * 235).astype('uint8')])
    if CFG.get('aoi') is not None:
        m = geometry_mask([CFG['aoi']], (256, 256), tr, invert=True); rgba[~m, 3] = 0
    if not rgba[..., 3].any(): return 0
    out = Path(CFG['out']) / str(z) / str(x); out.mkdir(parents=True, exist_ok=True)
    im = Image.fromarray(rgba, 'RGBA')
    if mode == 'classes':  # palette PNG: much smaller for few colours
        im = im.quantize(colors=min(64, len(CFG['palette']) + 2), method=Image.FASTOCTREE)
    im.save(out / f'{y}.png', optimize=True)
    return 1

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--zmin', type=int, default=7); ap.add_argument('--zmax', type=int, default=14)
    ap.add_argument('--mode', default='rgb'); ap.add_argument('--palette'); ap.add_argument('--stops')
    ap.add_argument('--nodata-rgb'); ap.add_argument('--clip', action='store_true'); ap.add_argument('--workers', type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a = ap.parse_args()
    with rasterio.open(a.src) as d:
        b = transform_bounds(d.crs, 'EPSG:4326', *d.bounds)
        if a.mode == 'rgb' and d.dtypes[0] != 'uint8': print(json.dumps(dict(ok=False, error='rgb tiles need uint8 bands'))); sys.exit(3)
        if a.zmax <= 0:  # auto: first zoom whose tile pixel is finer than the source pixel
            px = abs(d.transform.a) * (111320 * math.cos(math.radians((b[1] + b[3]) / 2)) if d.crs.is_geographic else 1)
            a.zmax = int(min(15, max(a.zmin, math.ceil(math.log2(156543.03 * math.cos(math.radians((b[1] + b[3]) / 2)) / px)))))
    jobs = []
    for z in range(a.zmin, a.zmax + 1):
        x0, y0 = lonlat_to_tile(b[0], b[3], z); x1, y1 = lonlat_to_tile(b[2], b[1], z)
        jobs += [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    cfg = dict(src=a.src, out=a.out, mode=a.mode, clip=a.clip,
               palette=json.loads(a.palette) if a.palette else None, stops=json.loads(a.stops) if a.stops else None,
               nodata_rgb=[int(v) for v in a.nodata_rgb.split(',')] if a.nodata_rgb else None)
    Path(a.out).mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor(a.workers, initializer=init, initargs=(cfg,)) as ex:
        n = sum(ex.map(render, jobs, chunksize=16))
    tj = dict(tilejson='2.2.0', bounds=[round(v, 6) for v in b], minzoom=a.zmin, maxzoom=a.zmax, tiles_written=n, tiles_checked=len(jobs), mode=a.mode, ok=True)
    (Path(a.out) / 'tilejson.json').write_text(json.dumps(tj), encoding='utf-8')
    print(json.dumps(tj))

if __name__ == '__main__':
    main()
