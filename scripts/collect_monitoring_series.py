"""Monthly six-band/SCL-masked composites plus valid-observation count for monitoring preparation."""
import sys,json,hashlib,datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools/collection'))
import ee,requests
out=ROOT/'data/collected/monitoring-series';out.mkdir(exist_ok=True)
k=json.loads((ROOT/'.secrets/gee-key.json').read_text());ee.Initialize(ee.ServiceAccountCredentials(k['client_email'],str(ROOT/'.secrets/gee-key.json')),project=k['project_id'])
region=ee.Geometry({'type':'Polygon','coordinates':[[[107.332379264,13.919630917],[108.546889227,13.919630917],[108.546889227,15.417532588],[107.332379264,15.417532588],[107.332379264,13.919630917]]]})
def mask(img):
 s=img.select('SCL');valid=s.neq(0).And(s.neq(1)).And(s.neq(3)).And(s.neq(8)).And(s.neq(9)).And(s.neq(10)).And(s.neq(11))
 return img.select(['B2','B3','B4','B8','B11','B12']).updateMask(valid)
TODAY=datetime.date.today();CUR=(TODAY.year,TODAY.month)
jobs=[(y,m) for y in range(2024,TODAY.year+1) for m in range(1,13) if (y,m)<CUR]  # complete months only: a partial composite would create false change candidates
def stale(p,y,m):
 # the month just finished is re-fetched until 5 days after its end (late scenes arrive with a delay)
 if not p.exists():return True
 end=datetime.date(y+1,1,1) if m==12 else datetime.date(y,m+1,1)
 return datetime.date.fromtimestamp(p.stat().st_mtime)<end+datetime.timedelta(days=5)
def download(job):
 y,m=job;start=f'{y}-{m:02}-01';end=f'{y+1}-01-01' if m==12 else f'{y}-{m+1:02}-01';p=out/f'sentinel-{y}-{m:02}-100m.tif'
 item=dict(file=p.name,start=start,end_exclusive=end,scale_m=100,source='COPERNICUS/S2_SR_HARMONIZED',purpose='exploratory monthly monitoring; not parcel-level alerts',bands=['B2','B3','B4','B8','B11','B12','valid_observations'])
 try:
  col=ee.ImageCollection(item['source']).filterBounds(region).filterDate(start,end).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',70))
  if stale(p,y,m):
   ids=col.aggregate_array('system:index').getInfo();(out/(p.stem+'-scenes.json')).write_text(json.dumps(ids))
   if not ids:raise LookupError('no scene yet')
   clean=col.map(mask);img=clean.median().addBands(clean.select('B4').count().rename('valid_observations')).toUint16()
   url=img.getDownloadURL(dict(region=region,scale=100,crs='EPSG:32648',format='GEO_TIFF',filePerBand=False));r=requests.get(url,timeout=240);r.raise_for_status();p.write_bytes(r.content)
  item.update(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
 except Exception as e:item['error_type']=type(e).__name__
 print(p.name,item.get('bytes',item.get('error_type')),flush=True);return item
items=[]
with ThreadPoolExecutor(3) as pool:
 for item in pool.map(download,jobs):
  items.append(item);(out/'manifest.json').write_text(json.dumps(items,indent=2))
