"""Phân tích biến động rừng theo thời gian tuỳ chọn (chạy từ Quản trị → Phân tích Python).

  python analyze_change_custom.py <config.json> <out_dir>

config: {
  "period": {"from": "2026-01", "to": "2026-04"},                 kỳ cần phân tích (tháng, gồm cả hai đầu)
  "baseline": {"mode": "years", "years": [2024, 2025]}            so cùng các tháng của các năm đối chứng
           | {"mode": "period", "from": "2025-01", "to": "2025-04"}  hoặc một khoảng thời gian bất kỳ (trước – sau)
  (ngưỡng KHÔNG nhận từ người dùng: tự thích nghi theo dữ liệu của kỳ – xem auto_thresholds)
  "id_prefix": "CR-xxxxxx"
}
Cùng thuật toán với luồng tự động (build_forest_change.py): Sentinel-2 median tháng 100 m (lọc mây SCL); nền = giá trị
thấp hơn giữa các kỳ đối chứng; ô nghi vấn khi ΔNDVI ≤ ngưỡng, ΔNBR ≤ ngưỡng, NDVI thấp hơn nền ≥ 0,10 ở ≥ `persist`
tháng, trong rừng còn đến 2024 (Hansen); gộp vùng ≥ min_ha. Đầu ra: candidates.geojson, overlay.png (ΔNDVI, EPSG:3857),
summary.json. Kết quả CHƯA công bố – người có quyền duyệt rồi mới hiện ra bản đồ công khai.
"""
import os, sys, json, datetime, importlib.util
from pathlib import Path
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import warnings; warnings.filterwarnings('ignore')
import rasterio
from rasterio.warp import reproject, Resampling, transform_geom, transform, transform_bounds
from rasterio.features import rasterize, shapes
from rasterio.transform import xy, from_bounds
from scipy import ndimage
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MS = ROOT / 'data/collected/monitoring-series'
DRY = {11, 12, 1, 2, 3, 4}


def auto_thresholds(dn, db, mask, n_months):
    """Ngưỡng tự thích nghi (người dùng không cần nhập): mức nghiêm ngặt hơn giữa ngưỡng chuẩn đã kiểm định
    (ΔNDVI −0,15; ΔNBR −0,10) và "trung vị − 3 × MAD" của rừng ổn định trong chính kỳ đó – kỳ có nhiều nhiễu
    (mây sót, mùa khô) tự chặt ngưỡng để giảm báo động giả. Lặp lại ≥ 2 tháng (≥ 1 nếu kỳ chỉ có 1 tháng ảnh)."""
    out = {}
    for k, a, base in (('dndvi', dn, -0.15), ('dnbr', db, -0.10)):
        v = a[mask & np.isfinite(a)]
        if v.size < 1000: out[k] = base; continue
        med = float(np.median(v)); mad = 1.4826 * float(np.median(np.abs(v - med)))
        out[k] = round(min(base, med - 3 * mad), 3)
    out['persist'] = 2 if n_months >= 2 else 1
    out['min_ha'] = 3
    out['mode'] = 'auto'
    return out


def months_between(a, b):
    (y1, m1), (y2, m2) = [tuple(map(int, x.split('-'))) for x in (a, b)]
    out = []
    y, m = y1, m1
    while (y, m) <= (y2, m2):
        out.append((y, m)); m += 1
        if m > 12: y, m = y + 1, 1
    return out


def load(ym):
    p = MS / f'sentinel-{ym[0]}-{ym[1]:02}-100m.tif'
    if not p.exists(): return None
    with rasterio.open(p) as d: a = d.read().astype('float32'); T = d.transform; crs = d.crs
    good = (a[3] > 0) & (a[2] > 0) & (a[6] > 0 if a.shape[0] > 6 else a[5] > 0)
    with np.errstate(invalid='ignore', divide='ignore'):
        nd = np.where(good, (a[3] - a[2]) / (a[3] + a[2]), np.nan); nb = np.where(good, (a[3] - a[5]) / (a[3] + a[5]), np.nan)
    return nd, nb, T, crs


def composite(months):
    got = [x for x in (load(ym) for ym in months) if x is not None]
    if not got: return None
    with np.errstate(all='ignore'):
        return dict(nd=np.nanmedian([g[0] for g in got], 0), nb=np.nanmedian([g[1] for g in got], 0), stack=np.array([g[0] for g in got]), T=got[0][2], crs=got[0][3], n=len(got))


def main(cfg_path, out_dir):
    cfg = json.loads(Path(cfg_path).read_text(encoding='utf-8')); out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    cur_m = months_between(cfg['period']['from'], cfg['period']['to'])
    if not 1 <= len(cur_m) <= 12: raise ValueError('Kỳ phân tích phải từ 1 đến 12 tháng')
    avail = [ym for ym in cur_m if (MS / f'sentinel-{ym[0]}-{ym[1]:02}-100m.tif').exists()]
    if not avail: raise ValueError('Chưa có ảnh Sentinel-2 tháng nào trong kỳ phân tích – chạy tác vụ tải ảnh trước')
    b = cfg.get('baseline') or {'mode': 'years', 'years': [y for y in (cur_m[0][0] - 1, cur_m[0][0] - 2) if y >= 2024]}
    if b['mode'] == 'years':
        # chỉ giữ năm đối chứng có ≥ 1 tháng ảnh tương ứng
        b['years'] = [y for y in b['years'] if any((MS / f'sentinel-{y - (cur_m[0][0] - ym[0])}-{ym[1]:02}-100m.tif').exists() for ym in avail)]
        if not b['years']: raise ValueError('Chưa có ảnh cùng kỳ của năm trước để đối chứng (chuỗi ảnh bắt đầu 01/2024)')
    if b['mode'] == 'period':
        bases = [months_between(b['from'], b['to'])]; base_label = f"{b['from']}..{b['to']}"
    else:
        years = sorted({int(y) for y in b['years']})
        if not years: raise ValueError('Chọn ít nhất một năm đối chứng')
        bases = [[(ym[0] - (cur_m[0][0] - y), ym[1]) for ym in avail] for y in years]; base_label = 'cùng kỳ ' + ', '.join(map(str, years))
    cur = composite(avail)
    base_c = [c for c in (composite(bm) for bm in bases) if c is not None]
    if not base_c: raise ValueError('Không có ảnh của kỳ đối chứng')
    with np.errstate(all='ignore'):
        base_n = np.fmin.reduce([c['nd'] for c in base_c]) if len(base_c) > 1 else base_c[0]['nd']
        base_b = np.fmin.reduce([c['nb'] for c in base_c]) if len(base_c) > 1 else base_c[0]['nb']
        dn = cur['nd'] - base_n; db = cur['nb'] - base_b
        persist = ((cur['stack'] - base_n[None]) <= -0.10).sum(0)
    T, CRS = cur['T'], cur['crs']; SH = dn.shape
    if b['mode'] == 'years' and not base_c: raise ValueError('Không có ảnh kỳ đối chứng')
    with rasterio.open(ROOT / 'data/processed/forest-standing-2024-100m.tif') as d:
        standing = np.zeros(SH, dtype='uint8')
        reproject(rasterio.band(d, 1), standing, dst_transform=T, dst_crs=CRS, resampling=Resampling.nearest)
    standing = standing.astype(bool)
    fc = json.loads((ROOT / 'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))
    codes = [f['properties']['code'] for f in fc['features']]; names = {f['properties']['code']: f['properties']['fullName'] for f in fc['features']}
    cgrid = rasterize([(transform_geom('EPSG:4326', CRS, f['geometry']), i + 1) for i, f in enumerate(fc['features'])], out_shape=SH, transform=T, fill=0, dtype='int16')
    valid = standing & np.isfinite(dn)
    th = auto_thresholds(dn, db, valid, len(avail))
    cand = valid & (dn <= float(th['dndvi'])) & (db <= float(th['dnbr'])) & (persist >= int(th['persist']))
    lab, n = ndimage.label(cand); sizes = ndimage.sum(cand, lab, range(1, n + 1))
    keep = np.isin(lab, np.flatnonzero(sizes >= float(th['min_ha'])) + 1)
    dry = any(m in DRY for _, m in avail)
    period_label = f"{avail[0][1]:02}/{avail[0][0]}" + (f"–{avail[-1][1]:02}/{avail[-1][0]}" if len(avail) > 1 else '')
    title = f"{period_label} so với {base_label}"
    feats = []
    for geom, val in shapes(lab.astype('int32'), mask=keep, transform=T):
        m = lab == int(val); rows, cols = np.nonzero(m); r0, c0 = int(round(rows.mean())), int(round(cols.mean()))
        cx, cy = xy(T, rows.mean(), cols.mean()); lon, lat = transform(CRS, 'EPSG:4326', [cx], [cy]); ci = np.bincount(cgrid[m]).argmax()
        feats.append(dict(type='Feature', geometry=transform_geom(CRS, 'EPSG:4326', geom), properties=dict(
            id=f"{cfg.get('id_prefix', 'CR')}-{r0:04d}{c0:04d}", window=title, area_ha=float(m.sum()), mean_dndvi=round(float(np.nanmean(dn[m])), 3),
            mean_dnbr=round(float(np.nanmean(db[m])), 3), commune_code=codes[ci - 1] if ci > 0 else None, commune_name=names[codes[ci - 1]] if ci > 0 else None,
            lon=round(lon[0], 5), lat=round(lat[0], 5), seasonal_leaf_fall_possible=dry, verification_status='unverified', low_confidence=len(base_c) < 2 and b['mode'] == 'years',
            evidence=f"Phân tích theo yêu cầu: Sentinel-2 median tháng 100 m, kỳ {period_label} so với {base_label}; ΔNDVI ≤ {th['dndvi']}, ΔNBR ≤ {th['dnbr']}, lặp lại ≥ {th['persist']} tháng, vùng ≥ {th['min_ha']} ha, trong rừng Hansen còn đến 2024")))
    (out / 'candidates.geojson').write_text(json.dumps(dict(type='FeatureCollection', features=feats), ensure_ascii=False), encoding='utf-8')
    # lớp ΔNDVI (EPSG:3857) trong rừng còn đến 2024
    Wb, Sb, Eb, Nb = 107.33, 13.91, 108.56, 15.43
    X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', Wb, Sb, Eb, Nb); OH = 1400; OW = int(round(OH * (X1 - X0) / (Y1 - Y0))); otr = from_bounds(X0, Y0, X1, Y1, OW, OH)
    dst = np.full((OH, OW), np.nan, dtype='float32')
    reproject(np.where(standing, dn, np.nan).astype('float32'), dst, src_transform=T, src_crs=CRS, dst_transform=otr, dst_crs='EPSG:3857', resampling=Resampling.nearest, src_nodata=np.nan, dst_nodata=np.nan)
    stops = [(-0.3, (165, 0, 38)), (-0.15, (244, 109, 67)), (-0.05, (254, 224, 139)), (0, (247, 247, 247)), (0.05, (217, 239, 139)), (0.15, (102, 189, 99)), (0.3, (0, 104, 55))]
    xs = np.array([s[0] for s in stops]); cs = np.array([s[1] for s in stops], dtype='float32'); v = np.clip(np.nan_to_num(dst, nan=0), -0.3, 0.3)
    rgb = np.stack([np.interp(v, xs, cs[:, k]) for k in range(3)], -1).astype('uint8')
    Image.fromarray(np.dstack([rgb, np.where(np.isfinite(dst), 220, 0).astype('uint8')])).save(out / 'overlay.png')
    stand_n = max(1, int(standing.sum()))
    summary = dict(window=title, period=[f'{y}-{m:02}' for y, m in avail], requested_months=len(cur_m), months_with_images=len(avail), baseline=b, baseline_label=base_label,
                   baseline_composites=len(base_c), thresholds=th, candidates=len(feats), area_ha=float(keep.sum()), dry_season=dry,
                   valid_fraction=round(float(valid.sum()) / stand_n, 3), low_confidence=len(base_c) < 2 and b['mode'] == 'years',
                   overlay_coordinates=[[Wb, Nb], [Eb, Nb], [Eb, Sb], [Wb, Sb]], finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    (out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f"Kỳ {title}: {len(avail)}/{len(cur_m)} tháng có ảnh; {len(feats)} vùng nghi vấn, {keep.sum():.0f} ha; phủ {summary['valid_fraction'] * 100:.0f}% diện tích rừng", flush=True)
    print(json.dumps(dict(ok=True, **{k: summary[k] for k in ('window', 'candidates', 'area_ha', 'valid_fraction')}), ensure_ascii=False))


if __name__ == '__main__':
    try: main(sys.argv[1], sys.argv[2])
    except Exception as e:
        print(f'! {type(e).__name__}: {e}', flush=True); sys.exit(2)
