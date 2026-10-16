"""Download daily source grids without calculating fire-risk products on GEE."""
import sys,json,hashlib,calendar,datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools/collection'))
import ee,requests
OUT=ROOT/'data/collected/climate';OUT.mkdir(parents=True,exist_ok=True)
k=json.loads((ROOT/'.secrets/gee-key.json').read_text());ee.Initialize(ee.ServiceAccountCredentials(k['client_email'],str(ROOT/'.secrets/gee-key.json')),project=k['project_id'])
region=ee.Geometry({'type':'Polygon','coordinates':[[[107.332379264,13.919630917],[108.546889227,13.919630917],[108.546889227,15.417532588],[107.332379264,15.417532588],[107.332379264,13.919630917]]]})
jobs=[]
for year in [2024,2025]:
 for month in range(1,13):
  start=f'{year}-{month:02d}-01';end=f'{year+1}-01-01' if month==12 else f'{year}-{month+1:02d}-01'
  for name,src,bands,scale in [('chirps','UCSB-CHG/CHIRPS/DAILY',['precipitation'],5566),('era5','ECMWF/ERA5_LAND/DAILY_AGGR',['temperature_2m','dewpoint_temperature_2m','u_component_of_wind_10m','v_component_of_wind_10m','total_precipitation_sum'],11132)]:jobs.append((name,src,bands,scale,start,end))
def download(job):
 name,src,bands,scale,start,end=job;p=OUT/f'{name}-{start[:7]}.tif';item=dict(file=p.name,source=src,start=start,end_exclusive=end,bands=bands,scale_m=scale)
 try:
  if not p.exists():
   col=ee.ImageCollection(src).filterDate(start,end).select(bands)
   ids=col.aggregate_array('system:index').getInfo()
   image=col.toBands().toFloat()
   url=image.getDownloadURL(dict(region=region,scale=scale,crs='EPSG:4326',format='GEO_TIFF',filePerBand=False));r=requests.get(url,timeout=180);r.raise_for_status();p.write_bytes(r.content)
   (OUT/(p.stem+'-bands.json')).write_text(json.dumps({'scene_ids':ids,'bands_per_scene':bands},indent=2))
  item.update(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
 except Exception as e:item['error_type']=type(e).__name__
 print(p.name,item.get('bytes',item.get('error_type')),flush=True);return item
items=[]
with ThreadPoolExecutor(3) as pool:
 for item in pool.map(download,jobs):
  items.append(item);(OUT/'manifest.json').write_text(json.dumps(items,indent=2))
