import json,hashlib,csv,os,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
rp=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(rp/'proj_data');os.environ['PROJ_DATA']=str(rp/'proj_data');os.environ['GDAL_DATA']=str(rp/'gdal_data')
import rasterio
import numpy as np
raw=ROOT/'data/collected';records=[];failures=[]
for p in sorted(raw.rglob('*')):
 if not p.is_file() or p.name=='inventory.json' or p.suffix=='.part':continue
 entry=dict(file=str(p.relative_to(ROOT)),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
 if p.suffix=='.tif':
  try:
   with rasterio.open(p) as ds:
    data=ds.read(out_shape=(ds.count,min(100,ds.height),min(100,ds.width)),masked=True)
    assert ds.crs and data.count()>0
    entry.update(bands=ds.count,width=ds.width,height=ds.height,crs=str(ds.crs),sample_valid=int(data.count()))
  except Exception as e:failures.append(dict(file=entry['file'],error=type(e).__name__))
 records.append(entry)
climate=list(csv.DictReader((ROOT/'data/processed/daily-climate-2024-2025.csv').open()))
assert len(climate)==29240 and len({(r['commune_code'],r['date']) for r in climate})==29240
assert all(r['era5_temperature_c'] and r['chirps_rain_mm'] for r in climate)
stats=json.loads((ROOT/'data/processed/forest-statistics-2025-kon-tum-communes.json').read_text(encoding='utf-8'));assert len(stats)==40
weather=json.loads((raw/'weather/communes.json').read_text(encoding='utf-8'));assert len(weather)==40
sentinel=list((raw/'sentinel-tiles').glob('*.tif'));assert len(sentinel)==32
secret_values=[]
for line in (ROOT/'.env').read_text().splitlines():
 if '=' in line:
  key,value=line.split('=',1)
  if key in ['OPENWEATHER_KEY','MAPBOX_TOKEN'] and len(value.strip())>8:secret_values.append(value.strip().encode())
leaks=[]
for folder in ['public','notes','scripts','data/collected','data/processed','data/content']:
 for p in (ROOT/folder).rglob('*'):
  if p.is_file() and p.suffix in ['.json','.csv','.geojson','.md','.txt','.html','.py','.js']:
   b=p.read_bytes()
   if any(s in b for s in secret_values) or (b'-----BEGIN '+b'PRIVATE KEY-----') in b:leaks.append(str(p.relative_to(ROOT)))
report=dict(files=len(records),bytes=sum(r['bytes'] for r in records),raster_files=sum('bands' in r for r in records),raster_errors=failures,sentinel_30m_tiles=len(sentinel),weather_communes=40,forecast_records=sum(len(w['forecast']['list']) for w in weather),official_commune_records=40,climate_daily_records=len(climate),secret_leaks=leaks,browser_qa=False,limitations=['Raster QA samples pixels; not a scientific accuracy assessment.','Daily means not sufficient for calibrated local-noon FWI.'])
report['supplemental']={}
for label,file in [('forecast_inputs','data/processed/forecast-input-validation.json'),('raster_quality','data/processed/raster-quality-summary.json'),('osm','data/processed/osm/validation.json')]:
 p=ROOT/file
 report['supplemental'][label]=json.loads(p.read_text(encoding='utf-8')) if p.exists() else {'status':'not_completed'}
(raw/'inventory.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
(ROOT/'notes/collection-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
assert not failures and not leaks
print(json.dumps(report,ensure_ascii=True))
