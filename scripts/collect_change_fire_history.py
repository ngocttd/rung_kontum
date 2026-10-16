"""Historical labels for forecasting: Hansen GFC tree-cover loss, GEE FIRMS fire pixels and MODIS burned area.

Outputs go to data/collected/history/. Hansen loss is tree-cover loss (any cause), not legal deforestation;
FIRMS/MCD64A1 are satellite detections, not verified forest-fire incidents.
"""
import sys,json,hashlib,datetime,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'.tools/collection'))
import ee,requests
out=ROOT/'data/collected/history';out.mkdir(parents=True,exist_ok=True)
k=json.loads((ROOT/'.secrets/gee-key.json').read_text());ee.Initialize(ee.ServiceAccountCredentials(k['client_email'],str(ROOT/'.secrets/gee-key.json')),project=k['project_id'])
aoi_geo=json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
aoi=ee.Geometry(aoi_geo).simplify(100)
W,S,E,N=107.332379264,13.919630917,108.546889227,15.417532588
manifest=[]
def save(item):
 manifest.append(item);(out/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False),encoding='utf-8')
def download(img,name,region,scale):
 p=out/name
 if not p.exists():
  for attempt in range(3):
   try:
    url=img.getDownloadURL(dict(region=region,scale=scale,crs='EPSG:32648',format='GEO_TIFF',filePerBand=False))
    r=requests.get(url,timeout=600);r.raise_for_status();p.write_bytes(r.content);break
   except Exception as e:
    print(name,'retry',type(e).__name__,str(e)[:200],flush=True);time.sleep(5)
 return p
# 1. Hansen GFC tiles (2x2) at 30 m
HANSEN='UMD/hansen/global_forest_change_2024_v1_12'
h=ee.Image(HANSEN).select(['treecover2000','lossyear','datamask']).toUint8()
xs=[W,(W+E)/2,E];ys=[S,(S+N)/2,N]
for i in range(2):
 for j in range(2):
  reg=ee.Geometry.Rectangle([xs[i],ys[j],xs[i+1],ys[j+1]])
  p=download(h,f'hansen-gfc-v1.12-30m-{i}{j}.tif',reg,30)
  ok=p.exists();save(dict(file=p.name,source=HANSEN,bands=['treecover2000','lossyear','datamask'],scale_m=30,crs='EPSG:32648',
   bytes=p.stat().st_size if ok else None,sha256=hashlib.sha256(p.read_bytes()).hexdigest() if ok else None,
   license='CC BY 4.0, Hansen/UMD/Google/USGS/NASA',meaning='tree-cover loss (stand-replacement, any cause); not legal deforestation'))
  print(p.name,ok,flush=True)
# 2. FIRMS (GEE, MODIS-derived 1 km) and MCD64A1 burned area, month by month, sampled as points
def month_iter(start=(2024,1)):
 y,m=start;today=datetime.date.today()
 while (y,m)<=(today.year,today.month):
  yield y,m
  y,m=(y+1,1) if m==12 else (y,m+1)
fires=[];burned=[]
for y,m in month_iter():
 s=f'{y}-{m:02}-01';e=f'{y+1}-01-01' if m==12 else f'{y}-{m+1:02}-01'
 def fsample(img):
  t=img.select('T21');d=ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
  return img.select(['T21','confidence']).updateMask(t.gt(0)).sample(region=aoi,scale=1000,geometries=True).map(lambda f:f.set('date',d))
 try:
  fc=ee.ImageCollection('FIRMS').filterDate(s,e).filterBounds(aoi).map(fsample).flatten()
  for f in fc.getInfo()['features']:
   lon,lat=f['geometry']['coordinates'];pr=f['properties']
   fires.append(dict(date=pr['date'],lon=round(lon,5),lat=round(lat,5),t21_k=pr.get('T21'),confidence=pr.get('confidence')))
 except Exception as ex:print('FIRMS',s,type(ex).__name__,str(ex)[:200],flush=True)
 try:
  ba=ee.ImageCollection('MODIS/061/MCD64A1').filterDate(s,e).select('BurnDate')
  if ba.size().getInfo()>0:
   img=ba.max();fc=img.updateMask(img.gt(0)).sample(region=aoi,scale=463.3127,geometries=True)
   for f in fc.getInfo()['features']:
    lon,lat=f['geometry']['coordinates'];doy=f['properties']['BurnDate']
    burned.append(dict(date=(datetime.date(y,1,1)+datetime.timedelta(days=int(doy)-1)).isoformat(),lon=round(lon,5),lat=round(lat,5),pixel_km2=0.2146))
 except Exception as ex:print('MCD64A1',s,type(ex).__name__,str(ex)[:200],flush=True)
 print(s,'fires',len(fires),'burned',len(burned),flush=True)
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
(out/'firms-gee-modis-2024-now.json').write_text(json.dumps(dict(source='GEE FIRMS (NASA LANCE MODIS MCD14DL/MCD14ML rasterised 1 km)',collected_at=now,
 meaning='thermal anomaly pixels; unverified; not confirmed forest fires',points=fires),ensure_ascii=False),encoding='utf-8')
(out/'mcd64a1-burned-2024-now.json').write_text(json.dumps(dict(source='MODIS/061/MCD64A1 BurnDate 500 m',collected_at=now,
 meaning='burned-area pixels (any land cover); monthly product with latency',points=burned),ensure_ascii=False),encoding='utf-8')
save(dict(file='firms-gee-modis-2024-now.json',count=len(fires),collected_at=now));save(dict(file='mcd64a1-burned-2024-now.json',count=len(burned),collected_at=now))
print('done',len(fires),len(burned))
