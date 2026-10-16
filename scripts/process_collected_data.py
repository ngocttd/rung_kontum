"""Local raster processing and website-ready source-linked data. No invented events."""
import json,hashlib,datetime,csv,math,os,importlib.util
from pathlib import Path
import numpy as np
_rasterio_dir=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(_rasterio_dir/'proj_data')
os.environ['PROJ_DATA']=str(_rasterio_dir/'proj_data')
os.environ['GDAL_DATA']=str(_rasterio_dir/'gdal_data')
import rasterio
from rasterio.merge import merge
from rasterio.warp import transform_geom
from rasterio.features import geometry_mask
from rasterio.shutil import copy as raster_copy
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];RAW=ROOT/'data/collected';OUT=ROOT/'data/processed';OUT.mkdir(exist_ok=True)
PREVIEW=ROOT/'public/data-previews';PREVIEW.mkdir(exist_ok=True)
aoi=json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
checks=[]
for name,pattern in [('worldcover-2021-10m','worldcover-2021-*.tif'),('dem-30m','dem-*.tif')]:
 sources=[rasterio.open(p) for p in sorted((RAW/'baseline-tiles').glob(pattern))]
 assert len(sources)==16
 target=OUT/(name+'.tif')
 if not target.exists():
  data,aff=merge(sources)
  geo=transform_geom('EPSG:4326',sources[0].crs,aoi)
  inside=geometry_mask([geo],data.shape[1:],aff,invert=True)
  nodata=0 if name.startswith('worldcover') else -9999
  data[:,~inside]=nodata
  profile=sources[0].profile;profile.update(height=data.shape[1],width=data.shape[2],transform=aff,nodata=nodata,compress='deflate',tiled=True,blockxsize=256,blockysize=256)
  temp=OUT/(name+'-temp.tif')
  with rasterio.open(temp,'w',**profile) as dst:dst.write(data)
  raster_copy(temp,target,driver='COG',compress='DEFLATE',blocksize=256,overview_resampling='nearest' if name.startswith('worldcover') else 'average')
  temp.unlink();del data,inside
 for d in sources:d.close()
 with rasterio.open(target) as ds:
  small=ds.read(1,out_shape=(1000,int(ds.width*1000/ds.height)),masked=True)
  if name.startswith('worldcover'):
   palette={10:(0,100,0),20:(255,187,34),30:(255,255,76),40:(240,150,255),50:(250,0,0),60:(180,180,180),70:(240,240,240),80:(0,100,200),90:(0,150,160),95:(0,207,117),100:(250,230,160)}
   rgb=np.zeros((*small.shape,4),dtype='uint8')
   for code,color in palette.items():rgb[small==code]=[*color,255]
  else:
   z=small.filled(np.nan);rgb=np.zeros((*z.shape,4),dtype='uint8');lo,hi=np.nanpercentile(z,[1,99]);t=np.clip((z-lo)/(hi-lo),0,1)
   rgb[:,:,0]=np.nan_to_num(40+190*t);rgb[:,:,1]=np.nan_to_num(100+130*t);rgb[:,:,2]=np.nan_to_num(65+150*t);rgb[:,:,3]=np.where(np.isfinite(z),255,0)
  Image.fromarray(rgb).save(PREVIEW/(name+'.png'))
  checks.append(dict(file=target.name,shape=ds.shape,crs=str(ds.crs),resolution=ds.res,overviews=ds.overviews(1),nodata=ds.nodata))
 print(name,'ready',flush=True)
# Preserve multi-spectral bands; indices computed only here, at overview scale.
for p in sorted((RAW/'earth-engine').glob('sentinel-*.tif')):
 with rasterio.open(p) as ds:
  arr=ds.read().astype('float32');geo=transform_geom('EPSG:4326',ds.crs,aoi);inside=geometry_mask([geo],ds.shape,ds.transform,invert=True)
  good=inside & np.all(arr>0,axis=0)
  idx=[]
  for ai,bi in [(3,2),(3,4),(3,5)]:
   val=np.full(ds.shape,-9999,dtype='float32');np.divide(arr[ai]-arr[bi],arr[ai]+arr[bi],out=val,where=good);idx.append(val)
  profile=ds.profile;profile.update(dtype='float32',count=3,nodata=-9999,compress='deflate',tiled=True)
  with rasterio.open(OUT/(p.stem+'-indices.tif'),'w',**profile) as dst:
   dst.write(np.array(idx));dst.set_band_description(1,'NDVI');dst.set_band_description(2,'NDMI');dst.set_band_description(3,'NBR')
  rgb=np.clip(np.moveaxis(arr[[2,1,0]],0,2)/3000,0,1)**.7
  rgba=np.dstack([(rgb*255).astype('uint8'),(good*255).astype('uint8')]);Image.fromarray(rgba).save(PREVIEW/(p.stem+'.png'))
  checks.append(dict(file=p.name,valid_pixel_fraction_in_aoi=float(good.sum()/inside.sum()),period=p.stem,note='Overview indices at 100m; not a forest-loss classification'))
 print(p.stem,'indices ready',flush=True)
# Daily grid samples at the same representative points as the live weather.
weather=json.loads((RAW/'weather/communes.json').read_text(encoding='utf-8'));coords=[(w['location']['lon'],w['location']['lat']) for w in weather]
daily={}
for p in sorted((RAW/'climate').glob('*.tif')):
 meta=json.loads((p.parent/(p.stem+'-bands.json')).read_text());bands=meta['bands_per_scene'];n=len(bands)
 with rasterio.open(p) as ds:
  assert ds.count==len(meta['scene_ids'])*n
  values=list(ds.sample(coords))
 for j,w in enumerate(weather):
  for i,scene in enumerate(meta['scene_ids']):
   date=scene[:8];date=f'{date[:4]}-{date[4:6]}-{date[6:8]}'
   key=(w['commune']['code'],date);row=daily.setdefault(key,dict(commune_code=key[0],date=date,longitude=coords[j][0],latitude=coords[j][1],sampling='nearest grid cell at representative point'))
   v={b:float(values[j][i*n+z]) if np.isfinite(values[j][i*n+z]) else None for z,b in enumerate(bands)}
   if p.stem.startswith('chirps'):row['chirps_rain_mm']=v['precipitation']
   else:
    row.update(era5_temperature_c=v['temperature_2m']-273.15,era5_dewpoint_c=v['dewpoint_temperature_2m']-273.15,era5_u10_m_s=v['u_component_of_wind_10m'],era5_v10_m_s=v['v_component_of_wind_10m'],era5_rain_mm=v['total_precipitation_sum']*1000)
rows=sorted(daily.values(),key=lambda x:(x['commune_code'],x['date']))
with (OUT/'daily-climate-2024-2025.csv').open('w',encoding='utf-8',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=sorted(set(k for r in rows for k in r)));writer.writeheader();writer.writerows(rows)
(OUT/'raster-processing-validation.json').write_text(json.dumps(dict(rasters=checks,daily_climate_records=len(rows),limitations=['ERA5 daily means are not local-noon observations required for standard FWI. No FWI produced.','CHIRPS and ERA5 are separate precipitation estimates; never silently substitute.','WorldCover tree cover is not legal forest area.','DEM is the downloaded legacy GLO30 source, not the 2024_1 replacement.']),indent=2))
print('Daily climate records',len(rows),flush=True)
