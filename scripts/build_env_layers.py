"""Lớp môi trường phục vụ cảnh báo cháy và bản đồ thời tiết (dữ liệu thật đã thu thập, không giả lập):
  - wx-fc-temp / wx-fc-rain / wx-fc-wind : dự báo hôm nay Open-Meteo tại 40 điểm đại diện xã, nội suy IDW
  - wx-era-temp / wx-era-rain / wx-era-wind : ngày gần nhất có tái phân tích ERA5-Land (lưới ~11 km, nội suy song tuyến)
  - ndmi-latest : chỉ số độ ẩm thực vật NDMI = (B8 − B11)/(B8 + B11) từ ảnh Sentinel-2 tháng mới nhất (≥ 60 % pixel hợp lệ)
  - lst-latest  : nhiệt độ bề mặt đất ban ngày MODIS (MOD11A2, 1 km) nếu đã có tệp do collect_lst.py tải
Kết quả: PNG ở public/generated/overlays (to_webp.cjs chuyển WebP), mục tương ứng trong data/web/overlays.json
(nhóm 'weather' hoặc 'fire-env') và data/web/wind-today.geojson, data/web/wind-era.geojson (mũi tên gió theo xã).
"""
import os, json, math, datetime, importlib.util
from pathlib import Path
import numpy as np
_r = Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB'] = str(_r / 'proj_data'); os.environ['PROJ_DATA'] = str(_r / 'proj_data'); os.environ['GDAL_DATA'] = str(_r / 'gdal_data')
import rasterio
from rasterio.warp import reproject, Resampling, transform_bounds, transform_geom, transform
from rasterio.features import geometry_mask
from rasterio.transform import from_bounds
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'data/web'; GEN = ROOT / 'public/generated/overlays'; GEN.mkdir(parents=True, exist_ok=True)
W, S, E, N = 107.33, 13.91, 108.56, 15.43
X0, Y0, X1, Y1 = transform_bounds('EPSG:4326', 'EPSG:3857', W, S, E, N)
H = 1000; WD = int(round(H * (X1 - X0) / (Y1 - Y0))); TR = from_bounds(X0, Y0, X1, Y1, WD, H)
AOI = json.loads((ROOT / 'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
MASK = geometry_mask([transform_geom('EPSG:4326', 'EPSG:3857', AOI)], (H, WD), TR, invert=True)
COORDS = [[W, N], [E, N], [E, S], [W, S]]
OV = WEB / 'overlays.json'
overlays = json.loads(OV.read_text(encoding='utf-8')) if OV.exists() else []
made = []


def hexrgb(h): h = h.lstrip('#'); return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def colorize(a, stops, alpha=215):
    """a: float grid (nan = trống); stops: [(giá trị, '#màu')] tăng dần → RGBA."""
    v = np.array([s[0] for s in stops], 'float32'); c = np.array([hexrgb(s[1]) for s in stops], 'float32')
    x = np.clip(np.nan_to_num(a, nan=v[0]), v[0], v[-1])
    rgba = np.zeros(a.shape + (4,), 'uint8')
    for k in range(3): rgba[..., k] = np.interp(x, v, c[:, k]).astype('uint8')
    rgba[..., 3] = np.where(np.isfinite(a) & MASK, alpha, 0)
    return rgba


def save(oid, rgba, title, source, meaning, legend, resolution, group, extra=None):
    Image.fromarray(rgba).save(GEN / f'{oid}.png')
    ent = dict(id=oid, url=f'/generated/overlays/{oid}.webp', title=title, source=source, meaning=meaning, legend=legend,
               resolution=resolution, coordinates=COORDS, group=group, **(extra or {}))
    global overlays
    overlays = [o for o in overlays if o['id'] != oid] + [ent]
    made.append(oid); print(oid, title, flush=True)


# lưới tâm ô (EPSG:3857 → lon/lat) để nội suy điểm
cols, rows = np.meshgrid(np.arange(WD) + 0.5, np.arange(H) + 0.5)
gx = X0 + cols * (X1 - X0) / WD; gy = Y1 - rows * (Y1 - Y0) / H
glon, glat = transform('EPSG:3857', 'EPSG:4326', gx.ravel().tolist(), gy.ravel().tolist())
glon = np.array(glon).reshape(H, WD); glat = np.array(glat).reshape(H, WD)


def idw(lons, lats, vals, power=2):
    """Nội suy nghịch đảo khoảng cách (km) trên lưới hiển thị; tính ở lưới thô rồi phóng to cho nhanh."""
    st = 4; la = glat[::st, ::st]; lo = glon[::st, ::st]
    num = np.zeros(la.shape); den = np.zeros(la.shape)
    for x, y, v in zip(lons, lats, vals):
        if v is None or not np.isfinite(v): continue
        d = np.hypot((lo - x) * 111.32 * math.cos(math.radians(y)), (la - y) * 110.57) + 0.5
        w = 1 / d ** power; num += w * v; den += w
    small = num / np.where(den > 0, den, np.nan)
    img = Image.fromarray(small.astype('float32')).resize((WD, H), Image.BILINEAR)
    return np.array(img)


TEMP = [(14, '#313695'), (18, '#4575b4'), (22, '#91bfdb'), (26, '#fee090'), (30, '#fc8d59'), (34, '#d73027'), (38, '#a50026')]
RAIN = [(0, '#f7fbff'), (1, '#c6dbef'), (5, '#6baed6'), (15, '#2171b5'), (30, '#08519c'), (60, '#3f007d')]
WIND = [(0, '#f7fcf5'), (2, '#c7e9c0'), (4, '#74c476'), (6, '#fdae6b'), (9, '#e6550d'), (13, '#a63603')]
LEG = lambda stops, unit: [dict(value=s[0], color=s[1], label=f'{s[0]} {unit}') for s in stops]


def arrows(points, path, meta):
    fc = dict(type='FeatureCollection', meta=meta, features=[dict(type='Feature', geometry=dict(type='Point', coordinates=[round(p['lon'], 5), round(p['lat'], 5)]),
              properties=dict(code=p.get('code'), speed_ms=round(p['speed'], 1), dir_from=round(p['dir']) % 360, temp_c=None if p.get('temp') is None else round(p['temp'], 1),
                              rain_mm=None if p.get('rain') is None else round(p['rain'], 1))) for p in points])
    path.write_text(json.dumps(fc, ensure_ascii=False), encoding='utf-8')


# ---------- 1. Dự báo hôm nay (Open-Meteo, 40 điểm xã) ----------
om = ROOT / 'data/collected/open-meteo/hourly-communes.json'
if om.exists():
    j = json.loads(om.read_text(encoding='utf-8'))
    today = (datetime.datetime.utcnow() + datetime.timedelta(hours=7)).date().isoformat()
    pts = []
    for c in j['communes']:
        d = c['data']; dl = d.get('daily') or {}
        if today not in dl.get('time', []): continue
        i = dl['time'].index(today); h = d['hourly']
        # gió & nhiệt độ lúc 13 giờ (thời điểm dùng cho chỉ số cháy), mưa cả ngày
        hi = h['time'].index(f'{today}T13:00') if f'{today}T13:00' in h['time'] else None
        pts.append(dict(code=c['commune_code'], lon=c['lon'], lat=c['lat'], tmax=dl['temperature_2m_max'][i], rain=dl['precipitation_sum'][i],
                        speed=(h['wind_speed_10m'][hi] / 3.6) if hi is not None and h['wind_speed_10m'][hi] is not None else (dl['wind_speed_10m_max'][i] or 0) / 3.6,
                        dir=h['wind_direction_10m'][hi] if hi is not None else 0, temp=h['temperature_2m'][hi] if hi is not None else dl['temperature_2m_max'][i]))
    if len(pts) >= 10:
        lo = [p['lon'] for p in pts]; la = [p['lat'] for p in pts]
        src = f"Open-Meteo (CC BY 4.0) – dự báo ngày {today[8:]}/{today[5:7]}/{today[:4]} tại {len(pts)} điểm đại diện xã, nội suy IDW"
        dd = f'{today[8:]}/{today[5:7]}'
        save('wx-fc-temp', colorize(idw(lo, la, [p['tmax'] for p in pts]), TEMP), f'Nhiệt độ cao nhất hôm nay {dd}', src,
             'Nhiệt độ không khí cao nhất trong ngày (°C) – mô hình dự báo, không phải số đo trạm', LEG(TEMP, '°C'), '40 điểm xã (IDW)', 'weather', dict(date=today))
        save('wx-fc-rain', colorize(idw(lo, la, [p['rain'] for p in pts]), RAIN), f'Lượng mưa dự báo hôm nay {dd}', src,
             'Tổng lượng mưa trong ngày (mm)', LEG(RAIN, 'mm'), '40 điểm xã (IDW)', 'weather', dict(date=today))
        save('wx-fc-wind', colorize(idw(lo, la, [p['speed'] for p in pts]), WIND), f'Tốc độ gió 13 giờ hôm nay {dd}', src,
             'Tốc độ gió 10 m lúc 13 giờ (m/s); mũi tên chỉ hướng gió thổi tới', LEG(WIND, 'm/s'), '40 điểm xã (IDW)', 'weather', dict(date=today, arrows='/api/public/weather/wind?nguon=du-bao'))
        arrows([dict(p, rain=p['rain'], temp=p['temp']) for p in pts], WEB / 'wind-today.geojson', dict(source='Open-Meteo', date=today, time='13:00'))

# ---------- 2. Ngày gần nhất có ERA5-Land ----------
hw = sorted((ROOT / 'data/collected/hourly-weather').glob('era5-hourly-*-bands.json'))
for bj in reversed(hw):
    meta = json.loads(bj.read_text()); tif = bj.with_name(bj.name.replace('-bands.json', '.tif'))
    noon = meta['noon_scene_ids']
    if not tif.exists() or not noon: continue
    n = len(noon); day = noon[-1][:8]; dday = f'{day[:4]}-{day[4:6]}-{day[6:8]}'
    rain_ids = meta['rain_scene_ids']
    # ngày địa phương (UTC+7) = giờ 17h UTC hôm trước … 16h UTC trong ngày
    t0 = datetime.datetime.strptime(day, '%Y%m%d') - datetime.timedelta(hours=7)
    want = {(t0 + datetime.timedelta(hours=k)).strftime('%Y%m%dT%H') for k in range(24)}
    ridx = [4 * n + 1 + i for i, s in enumerate(rain_ids) if s in want]
    if len(ridx) < 24:  # ngày cuối chưa đủ giờ mưa → lùi một ngày
        n -= 1
        if n < 1: continue
        day = noon[n - 1][:8]; dday = f'{day[:4]}-{day[4:6]}-{day[6:8]}'
        t0 = datetime.datetime.strptime(day, '%Y%m%d') - datetime.timedelta(hours=7)
        want = {(t0 + datetime.timedelta(hours=k)).strftime('%Y%m%dT%H') for k in range(24)}
        ridx = [4 * len(noon) + 1 + i for i, s in enumerate(rain_ids) if s in want]
        if len(ridx) < 24: continue
    with rasterio.open(tif) as d:
        b = lambda i: d.read(i).astype('float32')
        base = 4 * (n - 1)
        t2 = b(base + 1) - 273.15; u = b(base + 3); v = b(base + 4)
        rain = sum(b(i) for i in ridx) * 1000.0
        spd = np.hypot(u, v); drc = (np.degrees(np.arctan2(-u, -v)) + 360) % 360

        def warp(a):
            dst = np.full((H, WD), np.nan, 'float32')
            reproject(a, dst, src_transform=d.transform, src_crs=d.crs, dst_transform=TR, dst_crs='EPSG:3857', resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
            return dst
        src = f'ECMWF ERA5-Land (Copernicus) qua Google Earth Engine – ngày {dday[8:]}/{dday[5:7]}/{dday[:4]}, lưới ~11 km'
        dd = f'{dday[8:]}/{dday[5:7]}'
        save('wx-era-temp', colorize(warp(t2), TEMP), f'Nhiệt độ 12 giờ ngày {dd} (ERA5-Land)', src, 'Nhiệt độ không khí 2 m lúc 12 giờ (°C) – tái phân tích, trễ ~5 ngày', LEG(TEMP, '°C'), '~11 km', 'weather', dict(date=dday))
        save('wx-era-rain', colorize(warp(rain), RAIN), f'Lượng mưa ngày {dd} (ERA5-Land)', src, 'Tổng lượng mưa 24 giờ theo ngày địa phương (mm)', LEG(RAIN, 'mm'), '~11 km', 'weather', dict(date=dday))
        save('wx-era-wind', colorize(warp(spd), WIND), f'Tốc độ gió 12 giờ ngày {dd} (ERA5-Land)', src, 'Tốc độ gió 10 m (m/s); mũi tên chỉ hướng gió', LEG(WIND, 'm/s'), '~11 km', 'weather', dict(date=dday, arrows='/api/public/weather/wind?nguon=era5'))
        pts = []
        for r in range(d.height):
            for c in range(d.width):
                x, y = d.xy(r, c)
                if not (W <= x <= E and S <= y <= N) or not np.isfinite(spd[r, c]): continue
                pts.append(dict(lon=x, lat=y, speed=float(spd[r, c]), dir=float(drc[r, c]), temp=float(t2[r, c]), rain=float(rain[r, c])))
        arrows(pts, WEB / 'wind-era.geojson', dict(source='ERA5-Land', date=dday, time='12:00'))
    break

# ---------- 3. NDMI tháng mới nhất (Sentinel-2) ----------
for p in sorted((ROOT / 'data/collected/monitoring-series').glob('sentinel-*-100m.tif'), reverse=True):
    with rasterio.open(p) as d:
        out = {}
        for k, i in (('b8', 4), ('b11', 5), ('n', 7)):
            dst = np.zeros((H, WD), 'float32')
            reproject(rasterio.band(d, i), dst, dst_transform=TR, dst_crs='EPSG:3857', resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
            out[k] = dst
    valid = (out['n'] > 0) & (out['b8'] + out['b11'] > 0) & MASK
    if valid.sum() / MASK.sum() < 0.6: continue
    nd = np.where(valid, (out['b8'] - out['b11']) / np.maximum(out['b8'] + out['b11'], 1), np.nan)
    month = p.stem.split('-')[1] + '-' + p.stem.split('-')[2]
    STOPS = [(-0.3, '#8c510a'), (-0.1, '#d8b365'), (0.05, '#f6e8c3'), (0.2, '#c7eae5'), (0.35, '#5ab4ac'), (0.5, '#01665e')]
    save('ndmi-latest', colorize(nd, STOPS, 225), f'Độ ẩm thực vật NDMI {month[5:]}/{month[:4]}',
         f'Sentinel-2 SR median tháng {month[5:]}/{month[:4]} (GEE) – NDMI tính bằng Python, lưới 100 m',
         'NDMI = (B8 − B11)/(B8 + B11): thấp (nâu) = thực vật khô, dễ cháy; cao (xanh) = ẩm. Rừng khộp mùa khô có NDMI thấp tự nhiên.',
         [dict(value=s[0], color=s[1]) for s in STOPS], '100 m', 'fire-env', dict(month=month, valid_fraction=round(float(valid.sum() / MASK.sum()), 3)))
    break

# ---------- 4. LST MODIS (nếu đã tải bằng collect_lst.py) ----------
lst = sorted((ROOT / 'data/collected/lst').glob('modis-lst-*.tif')) if (ROOT / 'data/collected/lst').exists() else []
if lst:
    p = lst[-1]
    with rasterio.open(p) as d:
        a = d.read(1).astype('float32'); a[a <= 0] = np.nan
        dst = np.full((H, WD), np.nan, 'float32')
        reproject(a, dst, src_transform=d.transform, src_crs=d.crs, dst_transform=TR, dst_crs='EPSG:3857', resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
        tags = d.tags()
    STOPS = [(15, '#313695'), (22, '#74add1'), (28, '#fee090'), (34, '#f46d43'), (40, '#d73027'), (48, '#67001f')]
    span = tags.get('period', p.stem.replace('modis-lst-', ''))
    save('lst-latest', colorize(dst, STOPS, 220), f'Nhiệt độ bề mặt đất ban ngày ({span})', 'NASA MODIS Terra MOD11A2 v6.1 (8 ngày, 1 km) qua Google Earth Engine',
         'Nhiệt độ bề mặt (°C) trung bình 8 ngày lúc ~10h30; vùng nóng bất thường + NDMI thấp + gió mạnh làm tăng nguy cơ cháy lan', [dict(value=s[0], color=s[1], label=f'{s[0]} °C') for s in STOPS],
         '1 km', 'fire-env', dict(period=span))

OV.write_text(json.dumps(overlays, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(dict(ok=True, overlays=made), ensure_ascii=False))
