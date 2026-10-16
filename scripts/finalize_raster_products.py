import os,importlib.util,json,csv
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
rp=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(rp/'proj_data');os.environ['PROJ_DATA']=str(rp/'proj_data');os.environ['GDAL_DATA']=str(rp/'gdal_data')
import rasterio
from rasterio.merge import merge
from rasterio.warp import transform_geom
from rasterio.features import rasterize
from rasterio.shutil import copy as copy_raster
OUT=ROOT/'data/processed';communes=json.loads((ROOT/'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))['features'];aoi=json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
products=[('dem-2024-1-30m','dem-2024-1-tiles','dem-*.tif',1),('sentinel-2025-dry-30m','sentinel-tiles','sentinel-2025-dry-*.tif',6),('sentinel-2025-wet-30m','sentinel-tiles','sentinel-2025-wet-*.tif',6)]
quality=[]
for name,folder,pattern,count in products:
 target=OUT/(name+'.tif');sources=[rasterio.open(p) for p in sorted((ROOT/'data/collected'/folder).glob(pattern))];assert len(sources)==16
 if not target.exists():
  arr,aff=merge(sources);profile=sources[0].profile;profile.update(transform=aff,width=arr.shape[2],height=arr.shape[1],compress='deflate',tiled=True,nodata=-9999 if count==1 else 0)
  mask=rasterize([(transform_geom('EPSG:4326',sources[0].crs,aoi),1)],out_shape=arr.shape[1:],transform=aff,dtype='uint8');arr[:,mask==0]=profile['nodata']
  tmp=OUT/(name+'-temp.tif')
  with rasterio.open(tmp,'w',**profile) as d:
   d.write(arr)
   for i,b in enumerate(['DEM'] if count==1 else ['B2','B3','B4','B8','B11','B12'],1):d.set_band_description(i,b)
  copy_raster(tmp,target,driver='COG',compress='DEFLATE',overview_resampling='average');tmp.unlink();del arr,mask
 for d in sources:d.close()
 with rasterio.open(target) as ds:
  for f in communes:
   geom=transform_geom('EPSG:4326',ds.crs,f['geometry'])
   from rasterio.features import geometry_window
   window=geometry_window(ds,[geom]);data=ds.read(window=window,masked=True)
   zone=rasterize([(geom,1)],out_shape=data.shape[1:],transform=ds.window_transform(window),dtype='uint8').astype(bool)
   valid=zone & np.all(~np.ma.getmaskarray(data),axis=0)
   quality.append(dict(product=name,commune_code=f['properties']['code'],aoi_pixels=int(zone.sum()),valid_pixels=int(valid.sum()),valid_fraction=float(valid.sum()/zone.sum()) if zone.sum() else None,quality_scope='valid pixels after source mask; residual cloud and thematic accuracy unverified'))
 print(name,'ready',flush=True)
with (OUT/'raster-quality-by-commune.csv').open('w',newline='',encoding='utf-8') as f:
 w=csv.DictWriter(f,fieldnames=list(quality[0]));w.writeheader();w.writerows(quality)
(OUT/'raster-quality-summary.json').write_text(json.dumps(dict(records=len(quality),products={name:dict(min_valid_fraction=min(r['valid_fraction'] for r in quality if r['product']==name),max_valid_fraction=max(r['valid_fraction'] for r in quality if r['product']==name)) for name,_,_,_ in products},scientific_accuracy_validated=False),indent=2))
