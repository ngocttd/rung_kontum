"""Download daily source grids without calculating fire-risk products on GEE."""
import sys,json,hashlib,calendar,datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools/collection'))
import ee,requests
OUT=ROOT/'data/collected/hourly-weather';OUT.mkdir(parents=True,exist_ok=True)
k=json.loads((ROOT/'.secrets/gee-key.json').read_text());ee.Initialize(ee.ServiceAccountCredentials(k['client_email'],str(ROOT/'.secrets/gee-key.json')),project=k['project_id'])
region=ee.Geometry({'type':'Polygon','coordinates':[[[107.332379264,13.919630917],[108.546889227,13.919630917],[108.546889227,15.417532588],[107.332379264,15.417532588],[107.332379264,13.919630917]]]})
jobs=[]
TODAY=datetime.date.today();CUR=(TODAY.year,TODAY.month)
for year in range(2024,TODAY.year+1):
 for month in range(1,13):
  if (year,month)>CUR:continue
  start=f'{year}-{month:02d}-01';end=f'{year+1}-01-01' if month==12 else f'{year}-{month+1:02d}-01'
  jobs.append(('era5-hourly','ECMWF/ERA5_LAND/HOURLY',['temperature_2m','dewpoint_temperature_2m','u_component_of_wind_10m','v_component_of_wind_10m','total_precipitation_hourly'],11132,start,end))
def download(job):
 name,src,bands,scale,start,end=job;p=OUT/f'{name}-{start[:7]}.tif';item=dict(file=p.name,source=src,start=start,end_exclusive=end,bands=bands,scale_m=scale)
 try:
  y_,m_=int(start[:4]),int(start[5:7]);mend=datetime.date(y_+1,1,1) if m_==12 else datetime.date(y_,m_+1,1)
  # ERA5-Land lags ~5 days: re-fetch a month until a copy made after its end + 7 days exists
  if not p.exists() or datetime.date.fromtimestamp(p.stat().st_mtime)<mend+datetime.timedelta(days=7):
   col=ee.ImageCollection(src).filterDate(start,end).select(bands)
   ids=col.aggregate_array('system:index').getInfo()
   noon=col.filter(ee.Filter.eq('hour',5)).select(bands[:4])
   noon_ids=noon.aggregate_array('system:index').getInfo()
   image=noon.toBands().addBands(col.select('total_precipitation_hourly').toBands()).toFloat()
   url=image.getDownloadURL(dict(region=region,scale=scale,crs='EPSG:4326',format='GEO_TIFF',filePerBand=False));r=requests.get(url,timeout=180);r.raise_for_status();p.write_bytes(r.content)
   (OUT/(p.stem+'-bands.json')).write_text(json.dumps({'noon_scene_ids':noon_ids,'noon_bands':bands[:4],'rain_scene_ids':ids,'rain_band':'total_precipitation_hourly','noon_utc_hour':5,'local_timezone':'Asia/Ho_Chi_Minh'},indent=2))
  item.update(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
 except Exception as e:item['error_type']=type(e).__name__
 print(p.name,item.get('bytes',item.get('error_type')),flush=True);return item
items=[]
with ThreadPoolExecutor(3) as pool:
 for item in pool.map(download,jobs):
  items.append(item);(OUT/'manifest.json').write_text(json.dumps(items,indent=2))
