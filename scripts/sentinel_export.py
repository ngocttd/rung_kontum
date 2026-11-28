"""Tìm và tải ảnh Sentinel-2 (Copernicus, qua Google Earth Engine) theo vùng, thời gian, độ phủ mây và ĐỘ PHÂN GIẢI chọn.

  python sentinel_export.py search  <config.json>             → in JSON danh sách ngày chụp (số cảnh, % mây)
  python sentinel_export.py export  <config.json> <out_dir>   → GeoTIFF (out_dir/<tên>.tif) + preview.png + meta.json
  python sentinel_export.py display [độ phân giải 10|20]       → lớp hiển thị nét cho WebGIS: ảnh màu tự nhiên tháng mới nhất,
                                                                 cắt ô XYZ (public/tiles/s2-latest) và cập nhật data/web/overlays.json

config: {
  "from": "2026-10-01", "to": "2026-10-31",        khoảng ngày (gồm cả hai đầu)
  "cloud": 40,                                     % mây tối đa của cảnh (CLOUDY_PIXEL_PERCENTAGE)
  "resolution": 10 | 20 | 30 | 60,                 mét/điểm ảnh
  "aoi": {"type": "commune", "code": "…"} | {"type": "province"} | {"type": "geometry", "geometry": GeoJSON} | {"type": "bbox", "bbox": [W,S,E,N]},
  "product": "rgb" (màu tự nhiên 8-bit, 3 kênh) | "false" (giả màu B8-B4-B3, 8-bit) | "bands" (B2,B3,B4,B8,B11,B12 phản xạ ×10000, 16-bit) | "ndvi" (float32),
  "mode": "median" (tổ hợp trung vị đã lọc mây SCL) | "scene" (ghép các cảnh của một ngày: "date": "2026-10-12"),
  "crs": "EPSG:32648" | "VN2000:107.5:3" | "EPSG:4326"   hệ toạ độ tệp xuất (mặc định UTM 48N)
}
Ảnh lớn được tải theo từng mảnh rồi ghép; giới hạn 60 triệu điểm ảnh mỗi lần xuất (cả tỉnh: dùng ≥ 20 m).
"""
import os, sys, io, json, math, datetime, importlib.util
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import warnings; warnings.filterwarnings('ignore')
import rasterio
from rasterio.crs import CRS
from rasterio.warp import transform_geom, transform_bounds, reproject, Resampling, calculate_default_transform
from rasterio.features import geometry_mask
from rasterio.transform import from_origin, from_bounds
from rasterio.windows import Window
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/collection')); sys.path.insert(0, str(Path(__file__).resolve().parent))
from _crs import resolve
import ee, requests

MAX_PX = 60e6
UTM = CRS.from_epsg(32648)
PROV = json.loads((ROOT / 'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']


def out_json(o): print(json.dumps(o, ensure_ascii=False), flush=True)
def fail(msg): out_json(dict(ok=False, error=msg)); sys.exit(2)


def init():
    k = json.loads((ROOT / '.secrets/gee-key.json').read_text())
    ee.Initialize(ee.ServiceAccountCredentials(k['client_email'], str(ROOT / '.secrets/gee-key.json')), project=k['project_id'])


def aoi_geom(a):
    t = (a or {}).get('type', 'province')
    if t == 'province': return PROV, 'Toàn vùng Kon Tum (cũ)'
    if t == 'commune':
        fc = json.loads((ROOT / 'data/web/communes.geojson').read_text(encoding='utf-8'))
        f = next((x for x in fc['features'] if str(x['properties']['code']) == str(a.get('code'))), None)
        if not f: fail('Không tìm thấy xã/phường.')
        return f['geometry'], f['properties'].get('fullName') or f['properties'].get('name')
    if t == 'bbox':
        w, s, e, n = [float(x) for x in a['bbox']]
        return dict(type='Polygon', coordinates=[[[w, s], [e, s], [e, n], [w, n], [w, s]]]), 'Khung toạ độ'
    if t == 'geometry': return a['geometry'], a.get('name') or 'Vùng tự chọn'
    fail('Vùng tải không hợp lệ.')


def collection(cfg, geom):
    d0 = datetime.date.fromisoformat(cfg['from']); d1 = datetime.date.fromisoformat(cfg['to']) + datetime.timedelta(days=1)
    return (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(ee.Geometry(geom)).filterDate(str(d0), str(d1))
            .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', float(cfg.get('cloud', 60)))))


def scl_mask(img):
    s = img.select('SCL')
    ok = s.neq(0).And(s.neq(1)).And(s.neq(3)).And(s.neq(8)).And(s.neq(9)).And(s.neq(10)).And(s.neq(11))
    return img.updateMask(ok)


def search(cfg):
    geom, name = aoi_geom(cfg.get('aoi')); init()
    col = collection(cfg, geom)
    rows = col.reduceColumns(ee.Reducer.toList(3), ['system:index', 'system:time_start', 'CLOUDY_PIXEL_PERCENTAGE']).get('list').getInfo()
    days = {}
    for idx, t, c in rows:
        d = datetime.datetime.utcfromtimestamp(t / 1000 + 7 * 3600).strftime('%Y-%m-%d')
        days.setdefault(d, []).append(float(c))
    out_json(dict(ok=True, aoi=name, scenes=len(rows), days=[dict(date=d, scenes=len(v), cloud=round(sum(v) / len(v), 1), cloud_min=round(min(v), 1)) for d, v in sorted(days.items(), reverse=True)]))


def build_image(cfg, geom):
    """→ (ee.Image, số kênh, dtype, nodata, tên kênh, số cảnh)"""
    col = collection(cfg, geom)
    if cfg.get('mode') == 'scene':
        d0 = datetime.date.fromisoformat(cfg['date'])
        # ngày theo giờ Việt Nam (UTC+7): cảnh chụp ~03:20 UTC cùng ngày
        col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(ee.Geometry(geom)).filterDate(str(d0), str(d0 + datetime.timedelta(days=1)))
        n = col.size().getInfo()
        if not n: fail(f'Không có cảnh Sentinel-2 ngày {d0}.')
        base = col.mosaic()
    else:
        n = col.size().getInfo()
        if not n: fail('Không có cảnh nào thoả điều kiện (thử nới độ phủ mây hoặc khoảng ngày).')
        base = col.map(scl_mask).median()
    p = cfg.get('product', 'rgb')
    if p == 'rgb': return base.visualize(bands=['B4', 'B3', 'B2'], min=0, max=2300, gamma=1.55), 3, 'uint8', 0, ['R', 'G', 'B'], n
    if p == 'false': return base.visualize(bands=['B8', 'B4', 'B3'], min=0, max=4000, gamma=1.2), 3, 'uint8', 0, ['NIR', 'R', 'G'], n
    if p == 'ndvi': return base.normalizedDifference(['B8', 'B4']).toFloat().unmask(-9999), 1, 'float32', -9999, ['NDVI'], n
    if p == 'bands':
        b = ['B2', 'B3', 'B4', 'B8', 'B11', 'B12']
        return base.select(b).unmask(0).toUint16(), 6, 'uint16', 0, b, n
    fail('Sản phẩm không hợp lệ (rgb, false, bands, ndvi).')


def download(img, nb, dtype, res, geom, log=None, proj='EPSG:32648'):
    """Tải theo mảnh trên lưới UTM 48N căn theo bội số độ phân giải; trả về (mảng [nb,H,W], transform)."""
    g = transform_geom('EPSG:4326', UTM, geom)
    xs, ys = [], []
    def walk(c):
        if isinstance(c[0], (int, float)): xs.append(c[0]); ys.append(c[1])
        else:
            for x in c: walk(x)
    walk(g['coordinates'])
    x0 = math.floor(min(xs) / res) * res; y1 = math.ceil(max(ys) / res) * res
    W = int(math.ceil((max(xs) - x0) / res)); H = int(math.ceil((y1 - min(ys)) / res))
    if W * H > MAX_PX: fail(f'Vùng quá lớn ở {res} m ({W * H / 1e6:.0f} triệu điểm ảnh, tối đa {MAX_PX / 1e6:.0f}) – chọn độ phân giải thô hơn hoặc tải theo xã.')
    bpp = nb * np.dtype(dtype).itemsize
    side = 2048 if bpp <= 4 else 1024
    arr = np.zeros((nb, H, W), dtype=dtype)
    jobs = [(c, r) for r in range(0, H, side) for c in range(0, W, side)]
    done = [0]
    def one(job):
        c, r = job; w = min(side, W - c); h = min(side, H - r)
        for attempt in range(4):
            try:
                url = img.getDownloadURL(dict(crs='EPSG:32648', crs_transform=[res, 0, x0 + c * res, 0, -res, y1 - r * res], dimensions=[w, h], format='GEO_TIFF', filePerBand=False))
                rr = requests.get(url, timeout=300)
                if rr.status_code != 200: raise RuntimeError(f'HTTP {rr.status_code}: {rr.text[:200]}')
                with rasterio.open(io.BytesIO(rr.content)) as d: a = d.read()
                arr[:, r:r + h, c:c + w] = a[:nb, :h, :w]
                done[0] += 1
                if log: log(f'mảnh {done[0]}/{len(jobs)}')
                return
            except Exception as e:  # noqa
                err = e
        raise RuntimeError(f'Không tải được mảnh ảnh: {err}')
    with ThreadPoolExecutor(4) as pool: list(pool.map(one, jobs))
    T = from_origin(x0, y1, res, res)
    inside = geometry_mask([g], (H, W), T, invert=True)
    return arr, T, inside


def export(cfg, out):
    out.mkdir(parents=True, exist_ok=True)
    res = int(cfg.get('resolution', 20))
    if res not in (10, 20, 30, 60): fail('Độ phân giải phải là 10, 20, 30 hoặc 60 m.')
    geom, name = aoi_geom(cfg.get('aoi')); init()
    log = lambda m: print(m, flush=True)
    img, nb, dtype, nodata, bands, n = build_image(cfg, geom)
    log(f'{n} cảnh · {name} · {res} m · {cfg.get("product", "rgb")}')
    arr, T, inside = download(img, nb, dtype, res, geom, log)
    arr[:, ~inside] = nodata
    spec = cfg.get('crs') or 'EPSG:32648'; proj, label = resolve(spec); dst = CRS.from_user_input(proj)
    crs_out, T_out, a_out = UTM, T, arr
    if proj != 'EPSG:32648':
        Hs, Ws = arr.shape[1:]; b = rasterio.transform.array_bounds(Hs, Ws, T)
        T2, W2, H2 = calculate_default_transform(UTM, dst, Ws, Hs, *b)
        a2 = np.full((nb, H2, W2), nodata, dtype=dtype)
        reproject(arr, a2, src_transform=T, src_crs=UTM, dst_transform=T2, dst_crs=dst, resampling=Resampling.nearest, src_nodata=nodata, dst_nodata=nodata)
        crs_out, T_out, a_out = dst, T2, a2
    period = cfg['date'] if cfg.get('mode') == 'scene' else f"{cfg['from']}_{cfg['to']}"
    fname = f"S2_{cfg.get('product', 'rgb')}_{res}m_{period}.tif"
    prof = dict(driver='GTiff', height=a_out.shape[1], width=a_out.shape[2], count=nb, dtype=dtype, crs=crs_out, transform=T_out, nodata=nodata, compress='deflate', tiled=True, blockxsize=512, blockysize=512, BIGTIFF='IF_SAFER',
                predictor=3 if dtype == 'float32' else 2)
    with rasterio.open(out / fname, 'w', **prof) as d:
        d.write(a_out)
        for i, bn in enumerate(bands, start=1): d.set_band_description(i, bn)
        d.update_tags(SOURCE='Copernicus Sentinel-2 SR Harmonized (Google Earth Engine)', PERIOD=period, AOI=name, RESOLUTION_M=str(res), MAX_CLOUD=str(cfg.get('cloud', 60)), SCENES=str(n), MODE=cfg.get('mode', 'median'), CRS_LABEL=label)
    # ảnh xem trước
    if nb >= 3 and dtype == 'uint8': pv = np.moveaxis(arr[:3], 0, -1)
    elif nb == 6: pv = (np.clip(np.moveaxis(arr[[2, 1, 0]].astype('float32'), 0, -1) / 2600, 0, 1) ** (1 / 1.35) * 255).astype('uint8')
    else:
        v = np.clip((arr[0] + 0.1) / 1.0, 0, 1); pv = np.stack([(1 - v) * 200 + 30, v * 170 + 60, (1 - v) * 90 + 30], -1).astype('uint8')
    im = Image.fromarray(np.dstack([pv, (inside * 255).astype('uint8')])); im.thumbnail((1200, 1200)); im.save(out / 'preview.png')
    valid = float((a_out[0] != nodata).sum()) / max(1, int(inside.sum()))
    meta = dict(ok=True, file=fname, bytes=(out / fname).stat().st_size, width=int(a_out.shape[2]), height=int(a_out.shape[1]), bands=bands, dtype=dtype, resolution=res, scenes=n, aoi=name, period=period,
                crs_label=label, valid_fraction=round(min(1.0, valid), 3), finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    (out / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    out_json(meta)


def tile_bounds(z, x, y):
    n = 2 ** z; R = 20037508.342789244
    return (-R + x * 2 * R / n, R - (y + 1) * 2 * R / n, -R + (x + 1) * 2 * R / n, R - y * 2 * R / n)


def display(res=20):
    """Lớp hiển thị nét: ảnh màu tự nhiên tháng mới nhất (tháng của lớp s2-latest), ô XYZ 256 px."""
    ov_p = ROOT / 'data/web/overlays.json'; ovs = json.loads(ov_p.read_text(encoding='utf-8'))
    cur = next((o for o in ovs if o['id'] == 's2-latest'), None)
    if not cur or not cur.get('month'): fail('Chưa có lớp s2-latest (chạy build_latest_overlay.py trước).')
    month = cur['month']; y, m = int(month[:4]), int(month[5:7])
    tdir = ROOT / 'public/tiles/s2-latest'; stamp = tdir / 'month.json'
    zmax = 14 if res <= 10 else 13
    info = json.loads(stamp.read_text()) if stamp.exists() else {}
    if info.get('month') != month or info.get('resolution') != res:
        init()
        last = (datetime.date(y + 1, 1, 1) if m == 12 else datetime.date(y, m + 1, 1)) - datetime.timedelta(days=1)
        cfg = {'from': f'{month}-01', 'to': str(last), 'cloud': 70, 'product': 'rgb', 'mode': 'median'}
        img, nb, dtype, nodata, bands, n = build_image(cfg, PROV)
        arr, T, inside = download(img, nb, dtype, res, PROV, lambda s: print(s, flush=True))
        arr[:, ~inside] = 0
        import shutil
        if tdir.exists(): shutil.rmtree(tdir)
        tdir.mkdir(parents=True)
        W, S, E, N = transform_bounds(UTM, 'EPSG:4326', *rasterio.transform.array_bounds(arr.shape[1], arr.shape[2], T))
        count = 0; R = 20037508.342789244
        from PIL import features
        WEBP = features.check('webp')
        X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', W, S, E, N)
        for z in range(8, zmax + 1):
            n2 = 2 ** z; span = 2 * R / n2
            for tx in range(int((X0 + R) / span), int((X1 + R) / span) + 1):
                for ty in range(int((R - Y1) / span), int((R - Y0) / span) + 1):
                    b = tile_bounds(z, tx, ty); dst = np.zeros((3, 256, 256), dtype='uint8')
                    reproject(arr, dst, src_transform=T, src_crs=UTM, dst_transform=from_bounds(*b, 256, 256), dst_crs='EPSG:3857', resampling=Resampling.bilinear if z >= zmax - 1 else Resampling.average, src_nodata=0, dst_nodata=0)
                    a = (dst.max(0) > 0)
                    if not a.any(): continue
                    p = tdir / str(z) / str(tx); p.mkdir(parents=True, exist_ok=True)
                    im = Image.fromarray(np.dstack([np.moveaxis(dst, 0, -1), (a * 255).astype('uint8')]))
                    if WEBP: im.save(p / f'{ty}.webp', quality=82, method=4)
                    else: im.save(p / f'{ty}.png', compress_level=1)
                    count += 1
        if not WEBP:  # Pillow không có WebP: chuyển bằng sharp (Node.js)
            import subprocess
            subprocess.run(['node', str(ROOT / 'scripts/tiles_to_webp.cjs'), str(tdir)], check=True, cwd=str(ROOT))
        info = dict(month=month, resolution=res, scenes=n, tiles=count, minzoom=8, maxzoom=zmax, bounds=[round(W, 5), round(S, 5), round(E, 5), round(N, 5)], built_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        stamp.write_text(json.dumps(info))
        print(f'{count} ô ảnh {res} m, tháng {month}', flush=True)
    # ghi vào danh mục lớp (build_latest_overlay.py ghi lại mục s2-latest mỗi lần chạy nên luôn gắn lại phần ô ảnh)
    cur['tiles'] = dict(url=f"/tiles/s2-latest/{{z}}/{{x}}/{{y}}.webp?v={month}", minzoom=info['minzoom'], maxzoom=info['maxzoom'], bounds=info['bounds'])
    cur['photo'] = True; cur['resolution'] = f"{info['resolution']} m"
    cur['source'] = 'Copernicus Sentinel-2 SR (GEE), median tháng, lọc mây SCL'
    ov_p.write_text(json.dumps(ovs, ensure_ascii=False, indent=1), encoding='utf-8')
    out_json(dict(ok=True, month=month, resolution=info['resolution'], tiles=info['tiles']))


if __name__ == '__main__':
    try:
        cmd = sys.argv[1] if len(sys.argv) > 1 else ''
        if cmd == 'search': search(json.loads(Path(sys.argv[2]).read_text(encoding='utf-8')))
        elif cmd == 'export': export(json.loads(Path(sys.argv[2]).read_text(encoding='utf-8')), Path(sys.argv[3]))
        elif cmd == 'display': display(int(sys.argv[2]) if len(sys.argv) > 2 else 20)
        else: fail('Lệnh: search | export | display')
    except SystemExit: raise
    except Exception as e:  # noqa
        fail(f'{type(e).__name__}: {e}')
