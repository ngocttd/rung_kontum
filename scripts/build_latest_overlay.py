"""Add the most recent monthly Sentinel-2 composite (100 m, true colour) as a map overlay.
Appends/updates entry 's2-latest' in data/web/overlays.json; image written as PNG (to_webp.cjs converts)."""
import os,json,importlib.util
from pathlib import Path
import numpy as np
_r=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(_r/'proj_data');os.environ['PROJ_DATA']=str(_r/'proj_data');os.environ['GDAL_DATA']=str(_r/'gdal_data')
import rasterio
from rasterio.warp import reproject,Resampling,transform_bounds,transform_geom
from rasterio.features import geometry_mask
from rasterio.transform import from_bounds
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
W,S,E,N=107.33,13.91,108.56,15.43
X0,Y0,X1,Y1=transform_bounds('EPSG:4326','EPSG:3857',W,S,E,N)
H=1400;Wd=int(round(H*(X1-X0)/(Y1-Y0)));tr=from_bounds(X0,Y0,X1,Y1,Wd,H)
files=sorted((ROOT/'data/collected/monitoring-series').glob('sentinel-*-100m.tif'))
aoi=json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
mask=geometry_mask([transform_geom('EPSG:4326','EPSG:3857',aoi)],(H,Wd),tr,invert=True)
# latest month with at least 60 % valid pixels inside the AOI
for p in reversed(files):
 with rasterio.open(p) as d:
  bands=[]
  for b in (3,2,1,7):
   dst=np.zeros((H,Wd),dtype='float32')
   reproject(rasterio.band(d,b),dst,dst_transform=tr,dst_crs='EPSG:3857',resampling=Resampling.bilinear,src_nodata=0,dst_nodata=0)
   bands.append(dst)
 valid=(bands[3]>0)&mask
 if valid.sum()/mask.sum()<0.6:continue
 month=p.stem.split('-')[1]+'-'+p.stem.split('-')[2]
 rgb=np.stack([np.clip(x/1800,0,1)**0.75 for x in bands[:3]],-1)
 rgba=np.dstack([(rgb*255).astype('uint8'),(valid*255).astype('uint8')])
 out=ROOT/'public/generated/overlays/s2-latest.png';Image.fromarray(rgba).save(out)
 ov=json.loads((ROOT/'data/web/overlays.json').read_text(encoding='utf-8'))
 ov=[o for o in ov if o['id']!='s2-latest']
 ov.insert(0,dict(id='s2-latest',url='/generated/overlays/s2-latest.webp',title=f'Sentinel-2 màu tự nhiên tháng {month[5:]}/{month[:4]}',month=month,
  source='Copernicus Sentinel-2 SR (GEE), median tháng, lọc mây SCL',meaning='Ảnh tổ hợp quan sát mới nhất đủ độ phủ; vùng trống là mây/thiếu quan sát',
  resolution='100 m',coordinates=[[W,N],[E,N],[E,S],[W,S]],valid_fraction=round(float(valid.sum()/mask.sum()),3)))
 (ROOT/'data/web/overlays.json').write_text(json.dumps(ov,ensure_ascii=False,indent=1),encoding='utf-8')
 print('latest',month,round(float(valid.sum()/mask.sum()),3));break
