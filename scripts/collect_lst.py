"""Tải nhiệt độ bề mặt đất ban ngày MODIS Terra MOD11A2 v6.1 (tổng hợp 8 ngày, 1 km) kỳ mới nhất qua Google Earth Engine.
Ra: data/collected/lst/modis-lst-<YYYY-MM-DD>.tif (°C, float32, EPSG:4326) – build_env_layers.py dựng lớp 'lst-latest'.
Cần khoá GEE của dự án (.secrets/gee-key.json) như các script collect_* khác."""
import sys, json, datetime
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / '.tools/collection'))
import ee, requests
OUT = ROOT / 'data/collected/lst'; OUT.mkdir(parents=True, exist_ok=True)
k = json.loads((ROOT / '.secrets/gee-key.json').read_text())
ee.Initialize(ee.ServiceAccountCredentials(k['client_email'], str(ROOT / '.secrets/gee-key.json')), project=k['project_id'])
region = ee.Geometry.Rectangle([107.33, 13.91, 108.56, 15.43])
end = datetime.date.today() + datetime.timedelta(days=1); start = end - datetime.timedelta(days=40)
col = ee.ImageCollection('MODIS/061/MOD11A2').filterDate(str(start), str(end)).select(['LST_Day_1km', 'QC_Day'])
ids = col.aggregate_array('system:index').getInfo()
if not ids: print(json.dumps(dict(ok=False, error='Chưa có ảnh MOD11A2 trong 40 ngày gần nhất'))); sys.exit(0)
done = 0
for sid in ids[-2:]:  # 2 kỳ 8 ngày gần nhất
    d0 = datetime.datetime.strptime(sid.replace('_', '-'), '%Y-%m-%d').date()
    p = OUT / f'modis-lst-{d0}.tif'
    if p.exists(): continue
    img = col.filter(ee.Filter.eq('system:index', sid)).first()
    # chỉ giữ pixel chất lượng tốt (QC bit 0–1 = 00 hoặc 01), đổi sang °C
    good = img.select('QC_Day').bitwiseAnd(3).lte(1)
    lst = img.select('LST_Day_1km').multiply(0.02).subtract(273.15).updateMask(good).unmask(-999).toFloat()
    url = lst.getDownloadURL(dict(region=region, scale=1000, crs='EPSG:4326', format='GEO_TIFF'))
    r = requests.get(url, timeout=180); r.raise_for_status(); p.write_bytes(r.content)
    import rasterio
    with rasterio.open(p, 'r+') as d:
        d.update_tags(period=f'{d0.strftime("%d/%m")}–{(d0 + datetime.timedelta(days=7)).strftime("%d/%m/%Y")}', source='MODIS/061/MOD11A2', scene=sid, nodata_value='-999')
    done += 1; print('saved', p.name, flush=True)
(OUT / 'manifest.json').write_text(json.dumps(dict(collected_at=datetime.datetime.utcnow().isoformat() + 'Z', scenes=ids[-2:], source='MODIS/061/MOD11A2'), indent=1))
print(json.dumps(dict(ok=True, new=done, latest=ids[-1])))
