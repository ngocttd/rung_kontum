"""Hourly weather (recent past + forecast) at the 40 commune representative points from Open-Meteo.

Used to bridge the ERA5-Land latency gap and to extend fire-danger indices into the forecast horizon.
Open-Meteo data: CC BY 4.0 (https://open-meteo.com/). No API key; one request per commune.
"""
import json,datetime,time,hashlib,sys
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'data/collected/open-meteo';out.mkdir(parents=True,exist_ok=True)
communes=json.loads((ROOT/'data/collected/weather/communes.json').read_text(encoding='utf-8'))
HOURLY='temperature_2m,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code'
DAILY='temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_min'
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
res=[]
for c in communes:
 code=c['commune']['code'];lat=c['location']['lat'];lon=c['location']['lon']
 params=dict(latitude=round(lat,4),longitude=round(lon,4),hourly=HOURLY,daily=DAILY,past_days=31,forecast_days=16,
  timezone='Asia/Ho_Chi_Minh',wind_speed_unit='kmh')
 for attempt in range(4):
  try:
   r=requests.get('https://api.open-meteo.com/v1/forecast',params=params,timeout=60);r.raise_for_status();data=r.json();break
  except Exception as e:
   print(code,'retry',type(e).__name__,flush=True);time.sleep(3*(attempt+1));data=None
 if data is None:sys.exit(f'failed {code}')
 res.append(dict(commune_code=code,lat=lat,lon=lon,data=data));print(code,len(data['hourly']['time']),flush=True);time.sleep(0.3)
payload=dict(source='Open-Meteo Forecast API (best_match models)',license='CC BY 4.0',attribution='Weather data by Open-Meteo.com',
 collected_at_utc=now,timezone='Asia/Ho_Chi_Minh',past_days=31,forecast_days=16,
 note='Past hours are model analysis/short-range forecasts, not station observations. Point at commune representative location.',communes=res)
p=out/'hourly-communes.json';p.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
(out/'manifest.json').write_text(json.dumps(dict(file=p.name,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),collected_at_utc=now),indent=2),encoding='utf-8')
print('saved',p.stat().st_size)
