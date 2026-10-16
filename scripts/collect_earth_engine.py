"""GEE catalog/download only. Business calculations belong in local Python."""
import sys,json,datetime,hashlib,zipfile,io
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/collection'))
import ee,requests
OUT=ROOT/'data/collected/earth-engine';OUT.mkdir(parents=True,exist_ok=True)
key=ROOT/'.secrets/gee-key.json'
credentials=json.loads(key.read_text())
results=[]
try:
    ee.Initialize(ee.ServiceAccountCredentials(credentials['client_email'],str(key)),project=credentials['project_id'])
    print('GEE authenticated',flush=True)
except Exception as e:
    (OUT/'status.json').write_text(json.dumps({'authenticated':False,'error_type':type(e).__name__}))
    print('GEE authentication failed:',type(e).__name__);sys.exit(0)
region=ee.Geometry({'type':'Polygon','coordinates':[[[107.332379264,13.919630917],[108.546889227,13.919630917],[108.546889227,15.417532588],[107.332379264,15.417532588],[107.332379264,13.919630917]]]})
def export(name,image,scale,source,period):
    path=OUT/(name+'.tif')
    try:
        if not path.exists():
            url=image.getDownloadURL({'region':region,'scale':scale,'crs':'EPSG:32648','format':'GEO_TIFF','filePerBand':False})
            r=requests.get(url,timeout=240);r.raise_for_status();path.write_bytes(r.content)
        results.append(dict(file=path.name,source=source,period=period,resolution_m=scale,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),extent='AOI bounding box; mask historical boundary locally'))
        print(name,path.stat().st_size,flush=True)
    except Exception as e:
        results.append(dict(file=path.name,error_type=type(e).__name__));print(name,type(e).__name__,flush=True)
    (OUT/'manifest.json').write_text(json.dumps(results,indent=2))
export('worldcover-2021-100m',ee.ImageCollection('ESA/WorldCover/v200').first().select('Map'),100,'ESA/WorldCover/v200','2021; nearest-neighbor overview, native source 10m')
export('copernicus-dem-100m',ee.ImageCollection('COPERNICUS/DEM/GLO30').select('DEM').mosaic(),100,'COPERNICUS/DEM/GLO30','DSM source acquisition 2011-2015; overview native source ~30m')
for year in [2024,2025]:
    for season,start,end in [('dry',f'{year}-01-01',f'{year}-04-01'),('wet',f'{year}-07-01',f'{year}-10-01')]:
        col=ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(region).filterDate(start,end).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',70))
        try:
            catalog=col.aggregate_array('system:index').getInfo()
            (OUT/f'sentinel-{year}-{season}-catalog.json').write_text(json.dumps({'start':start,'end_exclusive':end,'scene_ids':catalog,'cloud_filter_percent':70},indent=2))
            def mask(img):
                scl=img.select('SCL');good=scl.neq(0).And(scl.neq(1)).And(scl.neq(3)).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11))
                return img.select(['B2','B3','B4','B8','B11','B12']).updateMask(good)
            export(f'sentinel-{year}-{season}-100m',col.map(mask).median().toUint16(),100,'COPERNICUS/S2_SR_HARMONIZED',start+'/'+end+'; SCL cloud shadow snow mask; median; reflectance scale 0.0001')
        except Exception as e:print('catalog',year,season,type(e).__name__,flush=True)
(OUT/'status.json').write_text(json.dumps({'authenticated':True,'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'successful_exports':sum('sha256' in x for x in results),'note':'100m overview layers; not parcel-level analysis'},indent=2))

