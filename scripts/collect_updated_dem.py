"""Native-resolution baseline downloads in bounded tiles; no analysis on GEE."""
import sys,json,hashlib,datetime,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools/collection'))
import ee,requests
OUT=ROOT/'data/collected/dem-2024-1-tiles';OUT.mkdir(parents=True,exist_ok=True)
k=json.loads((ROOT/'.secrets/gee-key.json').read_text());ee.Initialize(ee.ServiceAccountCredentials(k['client_email'],str(ROOT/'.secrets/gee-key.json')),project=k['project_id'])
layers=[('dem-2024-1',ee.ImageCollection('COPERNICUS/DEM/GLO30_2024_1').select('DEM').mosaic(),30,'COPERNICUS/DEM/GLO30_2024_1','Copernicus DEM license')]
jobs=[]
for name,img,res,src,license in layers:
 for y in range(4):
  for x in range(4):
   west=107.332379264+x*(108.546889227-107.332379264)/4;east=107.332379264+(x+1)*(108.546889227-107.332379264)/4
   south=13.919630917+y*(15.417532588-13.919630917)/4;north=13.919630917+(y+1)*(15.417532588-13.919630917)/4
   jobs.append((name,img,res,src,license,x,y,[west,south,east,north]))
def download(job):
 name,img,res,src,license,x,y,bbox=job;path=OUT/f'{name}-{y}-{x}.tif';west,south,east,north=bbox
 item=dict(file=path.name,source=src,license=license,resolution_m=res,bbox=bbox,retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
 try:
  if not path.exists():
   region=ee.Geometry({'type':'Polygon','coordinates':[[[west,south],[east,south],[east,north],[west,north],[west,south]]]})
   url=img.getDownloadURL({'region':region,'scale':res,'crs':'EPSG:32648','format':'GEO_TIFF','filePerBand':False})
   r=requests.get(url,timeout=240);r.raise_for_status();path.write_bytes(r.content)
  item.update(bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
 except Exception as e:item['error_type']=type(e).__name__
 print(path.name,item.get('bytes',item.get('error_type')),flush=True);return item
results=[]
with ThreadPoolExecutor(3) as pool:
 for item in pool.map(download,jobs):
  results.append(item);(OUT/'manifest.json').write_text(json.dumps(results,indent=2))
