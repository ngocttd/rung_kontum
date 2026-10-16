import json,csv,math,datetime,os,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];rp=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(rp/'proj_data');os.environ['PROJ_DATA']=str(rp/'proj_data');os.environ['GDAL_DATA']=str(rp/'gdal_data')
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom
OUT=ROOT/'data/processed';weather=json.loads((ROOT/'data/collected/weather/communes.json').read_text(encoding='utf-8'));coords=[(w['location']['lon'],w['location']['lat']) for w in weather]
rain=[{} for w in weather];noons=[{} for w in weather]
for p in sorted((ROOT/'data/collected/hourly-weather').glob('*.tif')):
 meta=json.loads(p.with_name(p.stem+'-bands.json').read_text());n=len(meta['noon_scene_ids']);rn=len(meta['rain_scene_ids'])
 with rasterio.open(p) as ds:
  assert ds.count==n*4+rn;values=list(ds.sample(coords))
 for j,arr in enumerate(values):
  for i,s in enumerate(meta['noon_scene_ids']):noons[j][datetime.datetime.strptime(s,'%Y%m%dT%H')]=arr[i*4:i*4+4].tolist()
  for i,s in enumerate(meta['rain_scene_ids']):rain[j][datetime.datetime.strptime(s,'%Y%m%dT%H')]=float(arr[n*4+i])*1000
rows=[]
for j,w in enumerate(weather):
 for t,v in sorted(noons[j].items()):
  temp,dew,u,windv=v;temp-=273.15;dew-=273.15
  rh=100*math.exp(17.625*dew/(243.04+dew)-17.625*temp/(243.04+temp))
  hours=[t-datetime.timedelta(hours=i) for i in range(24)];r=[rain[j].get(h) for h in hours];complete=all(x is not None and math.isfinite(x) for x in r)
  rows.append(dict(commune_code=w['commune']['code'],date_local=t.date().isoformat(),observation_utc=t.isoformat()+'Z',local_hour=12,temperature_c=temp,dewpoint_c=dew,relative_humidity_percent=rh,wind_kmh=math.hypot(u,windv)*3.6,rain_previous24h_mm=sum(r) if complete else None,rain_hours_available=sum(x is not None for x in r),negative_rain_hours=sum(x is not None and x<0 for x in r),quality_status='complete_reanalysis' if complete and all(x>=0 for x in r) and 0<=rh<=100 else 'review_required'))
with (OUT/'fire-weather-noon-inputs.csv').open('w',encoding='utf-8',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
# Monthly imagery features at commune scale: observations, not forecasts.
communes=json.loads((ROOT/'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))['features'];series=[];zonecache=None
for p in sorted((ROOT/'data/collected/monitoring-series').glob('*.tif')):
 with rasterio.open(p) as ds:
  assert ds.count==7
  if zonecache is None:zonecache=rasterize([(transform_geom('EPSG:4326',ds.crs,f['geometry']),i+1) for i,f in enumerate(communes)],out_shape=ds.shape,transform=ds.transform,dtype='uint8');grid=(ds.shape,ds.transform)
  assert grid==(ds.shape,ds.transform)
  a=ds.read().astype('float32');valid=np.all(a[:6]>0,axis=0)&(a[6]>0)
  indices=[]
  for x,y in [(3,2),(3,4),(3,5)]:
   v=np.full(ds.shape,np.nan,dtype='float32');np.divide(a[x]-a[y],a[x]+a[y],out=v,where=valid);indices.append(v)
  for i,f in enumerate(communes):
   zone=zonecache==i+1;mask=zone&valid;count=int(mask.sum())
   series.append(dict(commune_code=f['properties']['code'],month=p.stem[9:16],aoi_pixel_count=int(zone.sum()),valid_pixel_count=count,valid_fraction=count/zone.sum(),mean_ndvi=float(np.mean(indices[0][mask])) if count else None,mean_ndmi=float(np.mean(indices[1][mask])) if count else None,mean_nbr=float(np.mean(indices[2][mask])) if count else None,mean_valid_observations=float(a[6][mask].mean()) if count else None,scale_m=100,status='observed_composite_not_forecast'))
with (OUT/'monthly-sentinel-commune-features.csv').open('w',encoding='utf-8',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=list(series[0]));writer.writeheader();writer.writerows(series)
report=dict(noon_records=len(rows),unique_noon_records=len({(x['commune_code'],x['date_local']) for x in rows}),review_required=sum(x['quality_status']=='review_required' for x in rows),monthly_feature_records=len(series),monthly_count=len({x['month'] for x in series}),minimum_monthly_valid_fraction=min(x['valid_fraction'] for x in series),actual_forecasts_generated=False,alerts_generated=False,rh_formula='Magnus approximation over water: 17.625, 243.04; retain QC instead of clipping',rain_window='hourly values t-23h through t inclusive at t=05:00 UTC; first day may lack previous hours',limitations=['No station calibration or labelled event validation.','Monthly 100m commune means cannot validate parcel-level forest loss.','FWI state initialization, warm-up, local thresholds and forecast time alignment remain model prerequisites.'])
(OUT/'forecast-input-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
