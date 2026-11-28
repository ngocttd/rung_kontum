"""Phân tích MẤT TÁN CÂY theo khoảng năm tuỳ chọn (chạy từ Quản trị → Phân tích Python).

  python analyze_treeloss.py <config.json> <out_dir>

config: {"type": "treeloss", "years": {"from": 2023, "to": 2025}, "min_ha": 1.0, "id_prefix": "CR-xxxxxx"}
Nguồn: Hansen/UMD Global Forest Change (lớp lossyear 30 m, phiên bản mới nhất đã tải – data/processed/forest-lossyear-hansen-30m.tif).
Kết quả: các vùng mất tán cây liền khối ≥ min_ha trong khoảng năm (candidates.geojson), lớp ảnh năm mất (overlay.png, EPSG:3857),
bảng diện tích theo xã và theo năm (summary.json). Cùng cấu trúc đầu ra với analyze_change_custom.py nên dùng chung khâu
xem – công bố. Mất tán cây gồm mọi nguyên nhân (kể cả khai thác rừng trồng) – KHÔNG phải kết luận mất rừng, cần xác minh.
"""
import os, sys, json, datetime, importlib.util
from pathlib import Path
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import warnings; warnings.filterwarnings('ignore')
import rasterio
from rasterio.features import shapes, rasterize
from rasterio.warp import transform_geom, transform, transform_bounds, reproject, Resampling
from rasterio.transform import from_bounds, xy
from scipy import ndimage
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    cfg = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')); out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    y0, y1 = int(cfg['years']['from']), int(cfg['years']['to']); min_ha = float(cfg.get('min_ha') or 1.0)
    with rasterio.open(ROOT / 'data/processed/forest-lossyear-hansen-30m.tif') as d:
        ly = d.read(1); T = d.transform; CRS = d.crs
    last = 2000 + int(ly.max())
    if y0 > last: raise ValueError(f'Dữ liệu Hansen hiện có đến năm {last}')
    y1 = min(y1, last); pix = abs(T.a * T.e) / 1e4
    sel = (ly >= y0 - 2000) & (ly <= y1 - 2000)
    fc = json.loads((ROOT / 'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))
    codes = [f['properties']['code'] for f in fc['features']]; names = {f['properties']['code']: f['properties']['fullName'] for f in fc['features']}
    cgrid = rasterize([(transform_geom('EPSG:4326', CRS, f['geometry']), i + 1) for i, f in enumerate(fc['features'])], out_shape=ly.shape, transform=T, fill=0, dtype='int16')
    sel &= cgrid > 0
    lab, n = ndimage.label(sel, structure=np.ones((3, 3)))
    sizes = ndimage.sum(sel, lab, range(1, n + 1)) * pix
    big = np.flatnonzero(sizes >= min_ha) + 1
    keep = np.isin(lab, big)
    title = f"Mất tán cây {y0}" + (f"–{y1}" if y1 != y0 else '')
    objs = ndimage.find_objects(lab); feats = []
    for geom, val in shapes(lab.astype('int32'), mask=keep, transform=T):
        v = int(val); sl = objs[v - 1]; m = lab[sl] == v; rows, cols = np.nonzero(m)
        r = rows.mean() + sl[0].start; c = cols.mean() + sl[1].start
        cx, cy = xy(T, r, c); lon, lat = transform(CRS, 'EPSG:4326', [cx], [cy])
        ci = int(np.bincount(cgrid[sl][m]).argmax()); yrs = ly[sl][m]; yy = np.bincount(yrs)
        main_year = 2000 + int(yy.argmax())
        feats.append(dict(type='Feature', geometry=transform_geom(CRS, 'EPSG:4326', geom, precision=6), properties=dict(
            id=f"{cfg.get('id_prefix', 'TL')}-{int(r):04d}{int(c):04d}", window=title, area_ha=round(float(m.sum()) * pix, 2), kind='treeloss', loss_year=main_year,
            loss_years=f"{2000 + int(yrs.min())}–{2000 + int(yrs.max())}" if yrs.min() != yrs.max() else str(main_year),
            commune_code=codes[ci - 1] if ci > 0 else None, commune_name=names[codes[ci - 1]] if ci > 0 else None, lon=round(lon[0], 5), lat=round(lat[0], 5),
            seasonal_leaf_fall_possible=False, verification_status='unverified', low_confidence=False,
            evidence=f"Mất tán cây Hansen/UMD GFC 30 m, năm {y0}–{y1}, vùng liền khối ≥ {min_ha:g} ha. Gồm mọi nguyên nhân (kể cả khai thác rừng trồng) – cần xác minh trước khi kết luận mất rừng.")))
    feats.sort(key=lambda f: -f['properties']['area_ha'])
    (out / 'candidates.geojson').write_text(json.dumps(dict(type='FeatureCollection', features=feats), ensure_ascii=False), encoding='utf-8')
    # bảng theo xã và theo năm (mọi điểm ảnh mất trong khoảng năm, không chỉ vùng ≥ min_ha)
    by_commune = []
    for i, code in enumerate(codes):
        a = float((sel & (cgrid == i + 1)).sum()) * pix
        if a > 0: by_commune.append(dict(code=code, name=names[code], loss_ha=round(a, 1), zones=sum(1 for f in feats if f['properties']['commune_code'] == code)))
    by_commune.sort(key=lambda r: -r['loss_ha'])
    by_year = {str(y): round(float(((ly == y - 2000) & (cgrid > 0)).sum()) * pix, 1) for y in range(y0, y1 + 1)}
    # lớp ảnh: màu theo năm mất (vàng → đỏ)
    Wb, Sb, Eb, Nb = 107.33, 13.91, 108.56, 15.43
    X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', Wb, Sb, Eb, Nb); OH = 2800; OW = int(round(OH * (X1 - X0) / (Y1 - Y0))); otr = from_bounds(X0, Y0, X1, Y1, OW, OH)
    dst = np.zeros((OH, OW), dtype='uint8')
    reproject(np.where(sel, ly, 0).astype('uint8'), dst, src_transform=T, src_crs=CRS, dst_transform=otr, dst_crs='EPSG:3857', resampling=Resampling.max, src_nodata=0, dst_nodata=0)
    t = np.clip((dst.astype('float32') - (y0 - 2000)) / max(1, y1 - y0), 0, 1)
    rgb = np.stack([np.full_like(t, 255), 220 - 190 * t, 60 - 40 * t], -1).astype('uint8')
    Image.fromarray(np.dstack([rgb, np.where(dst > 0, 235, 0).astype('uint8')])).save(out / 'overlay.png')
    summary = dict(kind='treeloss', window=title, period=[str(y) for y in range(y0, y1 + 1)], years=dict(**{'from': y0, 'to': y1}), min_ha=min_ha, candidates=len(feats),
                   area_ha=round(float(keep.sum()) * pix, 1), total_loss_ha=round(float(sel.sum()) * pix, 1), by_commune=by_commune, by_year=by_year, dry_season=False, low_confidence=False,
                   valid_fraction=1, source=f'Hansen/UMD Global Forest Change (lossyear 30 m, đến {last})', thresholds=dict(min_ha=min_ha),
                   overlay_coordinates=[[Wb, Nb], [Eb, Nb], [Eb, Sb], [Wb, Sb]], finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    (out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"{title}: tổng {summary['total_loss_ha']:.0f} ha; {len(feats)} vùng ≥ {min_ha:g} ha ({summary['area_ha']:.0f} ha)", flush=True)
    print(json.dumps(dict(ok=True, window=title, candidates=len(feats), area_ha=summary['area_ha']), ensure_ascii=False))


if __name__ == '__main__':
    try: main()
    except Exception as e:  # noqa
        print(f'! {type(e).__name__}: {e}', flush=True); sys.exit(1)
