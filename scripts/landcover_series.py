"""Chuỗi lớp phủ hằng năm cho tab "Lớp phủ qua các năm" (trang Tài nguyên rừng) – nguồn chuẩn hoá Google Dynamic World V1
(collect_dynamic_world.py: mode nhãn theo năm, lưới 100 m). KHÔNG dùng bản đồ ảnh/GeoTIFF/PDF do dự án cung cấp cho thống kê.

Tính cho mọi năm có dữ liệu: diện tích từng lớp toàn vùng (ranh Kon Tum cũ) và theo 40 xã, ma trận chuyển đổi và
mất/tăng cây gỗ cho MỌI cặp năm (người dùng chọn năm đầu – năm cuối), độ phủ dữ liệu. Đồng thời dựng lớp ảnh
'dw-<năm>' cho bản đồ.
Ra: data/web/landcover-series.json, public/generated/overlays/dw-<năm>.png (+ mục trong data/web/overlays.json).
Usage: python landcover_series.py build
"""
import os, sys, json, importlib.util, datetime
from pathlib import Path
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
for k, v in (('PROJ_LIB', 'proj_data'), ('PROJ_DATA', 'proj_data'), ('GDAL_DATA', 'gdal_data')):
    if (_r / v).exists(): os.environ[k] = str(_r / v)
import rasterio
from rasterio.warp import reproject, Resampling, transform_geom, transform_bounds
from rasterio.features import rasterize, geometry_mask
from rasterio.transform import from_bounds
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'data/web'; DW = ROOT / 'data/collected/dynamic-world'; GEN = ROOT / 'public/generated/overlays'
# lớp Dynamic World (giá trị tệp = nhãn DW + 1), màu theo bảng màu chính thức của DW
CLASSES = {1: ('Mặt nước', '#419bdf'), 2: ('Cây gỗ (rừng, cây lâu năm)', '#397d49'), 3: ('Cỏ', '#88b053'), 4: ('Thực vật ngập nước', '#7a87c6'),
           5: ('Cây trồng nông nghiệp', '#e49635'), 6: ('Cây bụi', '#dfc35a'), 7: ('Xây dựng', '#c4281b'), 8: ('Đất trống', '#a59b8f'), 9: ('Băng tuyết', '#b39fe1')}
TREES = 2
aoi = json.loads((ROOT / 'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']


def build():
    man = json.loads((DW / 'manifest.json').read_text(encoding='utf-8')) if (DW / 'manifest.json').exists() else {}
    files = sorted(DW.glob('dw-*-100m.tif'))
    if not files: print(json.dumps(dict(ok=False, error='Chưa có dữ liệu Dynamic World – chạy collect_dynamic_world.py'), ensure_ascii=False)); sys.exit(2)
    with rasterio.open(files[0]) as d: prof = d.profile; T = d.transform; CRS = d.crs; H, W = d.height, d.width
    inside = geometry_mask([transform_geom('EPSG:4326', CRS, aoi)], (H, W), T, invert=True)
    pix_ha = abs(T.a * T.e) / 1e4
    fc = json.loads((WEB / 'communes.geojson').read_text(encoding='utf-8'))
    codes = [f['properties']['code'] for f in fc['features']]
    cg = rasterize([(transform_geom('EPSG:4326', CRS, f['geometry']), i + 1) for i, f in enumerate(fc['features'])], out_shape=(H, W), transform=T, fill=0, dtype='int16')
    series = []
    for p in files:
        y = int(p.stem.split('-')[1])
        with rasterio.open(p) as d:
            g = np.zeros((H, W), 'uint8')
            reproject(rasterio.band(d, 1), g, src_transform=d.transform, src_crs=d.crs, dst_transform=T, dst_crs=CRS, resampling=Resampling.nearest)
        m = man.get(str(y), {})
        series.append(dict(key=str(y), year=y, partial=bool(m.get('partial')), images=m.get('images'), period=f"{m.get('start', '')} → {m.get('end_exclusive', '')}", grid=g))
    area = lambda g, mask: {str(k): round(float(v) * pix_ha, 1) for k, v in enumerate(np.bincount(g[mask].ravel(), minlength=10)) if k in CLASSES and v}
    out = dict(source='Google Dynamic World V1 (Brown et al. 2022, CC BY 4.0) – nhãn phổ biến nhất trong năm, lưới 100 m', generated_at=datetime.datetime.utcnow().isoformat() + 'Z',
               pixel_ha=pix_ha, forest_class=TREES, classes={str(k): dict(label=v[0], color=v[1]) for k, v in CLASSES.items() if k != 9},
               note='Lớp phủ giải đoán tự động từ ảnh Sentinel-2; “Cây gỗ” gồm rừng tự nhiên, rừng trồng và cây lâu năm (cao su, cà phê…), không đồng nhất với diện tích rừng pháp lý theo quyết định công bố.',
               series=[{k: v for k, v in s.items() if k != 'grid'} for s in series], aoi={}, coverage={}, by_commune={c: {} for c in codes}, pairs={})
    for s in series:
        g = s['grid']
        out['aoi'][s['key']] = area(g, inside)
        out['coverage'][s['key']] = round(float((g[inside] > 0).mean()), 3)
        for i, c in enumerate(codes): out['by_commune'][c][s['key']] = area(g, inside & (cg == i + 1))
    for i, a in enumerate(series):
        for b in series[i + 1:]:
            ga, gb = a['grid'], b['grid']; both = inside & (ga > 0) & (gb > 0)
            M = np.zeros((10, 10), 'int64'); np.add.at(M, (ga[both], gb[both]), 1)
            fa, fb = (ga == TREES) & both, (gb == TREES) & both
            loss, gain = fa & ~fb, fb & ~fa
            bc = {c: dict(loss_ha=round(float((loss & (cg == k + 1)).sum()) * pix_ha, 1), gain_ha=round(float((gain & (cg == k + 1)).sum()) * pix_ha, 1),
                          a_ha=round(float((fa & (cg == k + 1)).sum()) * pix_ha, 1), b_ha=round(float((fb & (cg == k + 1)).sum()) * pix_ha, 1)) for k, c in enumerate(codes)}
            out['pairs'][f"{a['key']}|{b['key']}"] = dict(matrix=[[round(float(M[x, y]) * pix_ha, 1) for y in range(1, 9)] for x in range(1, 9)],
                stable_ha=round(float((fa & fb).sum()) * pix_ha, 1), loss_ha=round(float(loss.sum()) * pix_ha, 1), gain_ha=round(float(gain.sum()) * pix_ha, 1),
                compared_ha=round(float(both.sum()) * pix_ha, 1), by_commune=bc)
    (WEB / 'landcover-series.json').write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8')
    # lớp ảnh cho bản đồ (EPSG:3857, cùng khung các lớp khác)
    Wb, Sb, Eb, Nb = 107.33, 13.91, 108.56, 15.43
    X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', Wb, Sb, Eb, Nb)
    HH = 1400; WW = int(round(HH * (X1 - X0) / (Y1 - Y0))); tr = from_bounds(X0, Y0, X1, Y1, WW, HH)
    mask3 = geometry_mask([transform_geom('EPSG:4326', 'EPSG:3857', aoi)], (HH, WW), tr, invert=True)
    ov_p = WEB / 'overlays.json'; ovs = json.loads(ov_p.read_text(encoding='utf-8')) if ov_p.exists() else []
    ovs = [o for o in ovs if not o['id'].startswith('dw-')]
    for s in series:
        g3 = np.zeros((HH, WW), 'uint8')
        reproject(s['grid'], g3, src_transform=T, src_crs=CRS, dst_transform=tr, dst_crs='EPSG:3857', resampling=Resampling.nearest, src_nodata=0, dst_nodata=0)
        rgba = np.zeros((HH, WW, 4), 'uint8')
        for k, (_, col) in CLASSES.items():
            m = (g3 == k) & mask3
            for i in range(3): rgba[..., i][m] = int(col[1 + 2 * i:3 + 2 * i], 16)
            rgba[..., 3][m] = 235
        Image.fromarray(rgba).save(GEN / f"dw-{s['year']}.png")
        ovs.append(dict(id=f"dw-{s['year']}", url=f"/generated/overlays/dw-{s['year']}.webp", group='landcover', year=s['year'],
                        title=f"Lớp phủ năm {s['year']}{' (tạm tính đến nay)' if s['partial'] else ''} – Dynamic World", source='Google Dynamic World V1 (Sentinel-2, 10 m) – CC BY 4.0, lưới hiển thị 100 m',
                        meaning='Lớp phổ biến nhất trong năm của nhãn Dynamic World; “Cây gỗ” gồm rừng, rừng trồng và cây lâu năm', resolution='100 m',
                        legend=[dict(value=k, label=v[0], color=v[1]) for k, v in CLASSES.items() if k != 9], coordinates=[[Wb, Nb], [Eb, Nb], [Eb, Sb], [Wb, Sb]]))
    ov_p.write_text(json.dumps(ovs, ensure_ascii=False, indent=1), encoding='utf-8')
    print(json.dumps(dict(ok=True, years=[s['year'] for s in series], pairs=len(out['pairs'])), ensure_ascii=False))


if __name__ == '__main__':
    build()
