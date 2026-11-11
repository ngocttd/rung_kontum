"""Forest-change history, current change candidates and a validated loss-risk forecast on a 100 m grid.

1) Hansen GFC v1.12 tree-cover loss 2001-2024 per commune (tree cover 2000 >= 30 %).
2) Change candidates: same-season Sentinel-2 NDVI/NBR drop for every seasonal window (01–04, 05–06, 07–09, 10–12) that
   has ≥ 2 months of imagery in the last 12 months, against the same months of the 1–2 previous years, inside Hansen
   forest still standing at end-2024. Stable ids (window + centroid cell). Unverified; dry-season windows flagged.
   Also writes the ΔNDVI map of the latest window as public overlay 'change-latest'.
3) Loss-risk forecast: Random Forest trained on loss 2019-2020 from features at end-2018, temporally validated on
   loss 2023-2024 from features at end-2022, then applied to features at end-2024 for horizon 2025-2026.
Outputs: data/processed/forest-*.tif|csv, data/web/forest-change.json, data/web/change-candidates.geojson
"""
import os,json,csv,datetime,importlib.util,collections
from pathlib import Path
import numpy as np
_r=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(_r/'proj_data');os.environ['PROJ_DATA']=str(_r/'proj_data');os.environ['GDAL_DATA']=str(_r/'gdal_data')
import rasterio
from rasterio.merge import merge
from rasterio.warp import reproject,Resampling,transform_geom,transform
from rasterio.features import rasterize,shapes,geometry_mask
from rasterio.transform import from_origin
from scipy import ndimage
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score,brier_score_loss
from sklearn.isotonic import IsotonicRegression
ROOT=Path(__file__).resolve().parents[1];P=ROOT/'data/processed';WEB=ROOT/'data/web';WEB.mkdir(parents=True,exist_ok=True)
CRS='EPSG:32648';T100=from_origin(750300,1707700,100,100);SH=(1677,1331)
aoi=json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
inside=geometry_mask([transform_geom('EPSG:4326',CRS,aoi)],SH,T100,invert=True)
fc=json.loads((ROOT/'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))
codes=[f['properties']['code'] for f in fc['features']];names={f['properties']['code']:f['properties']['fullName'] for f in fc['features']}
cgrid=rasterize([(transform_geom('EPSG:4326',CRS,f['geometry']),i+1) for i,f in enumerate(fc['features'])],out_shape=SH,transform=T100,fill=0,dtype='int16')
# ---------- Hansen 30 m mosaic ----------
tiles=[rasterio.open(p) for p in sorted((ROOT/'data/collected/history').glob('hansen-gfc-v1.12-30m-*.tif'))]
h,ht=merge(tiles,bounds=(750300,1540050,883410,1707660),res=30,nodata=0);[t.close() for t in tiles]
tc,ly,dm=h[0],h[1],h[2];H30=h.shape[1:]
inside30=geometry_mask([transform_geom('EPSG:4326',CRS,aoi)],H30,ht,invert=True)
forest2000=(tc>=30)&(dm==1)&inside30
c30=rasterize([(transform_geom('EPSG:4326',CRS,f['geometry']),i+1) for i,f in enumerate(fc['features'])],out_shape=H30,transform=ht,fill=0,dtype='int16')
PIX_HA=0.09
annual={c:{} for c in codes};forest2000_ha={}
for i,c in enumerate(codes):
 m=(c30==i+1)&forest2000;forest2000_ha[c]=round(float(m.sum())*PIX_HA,1)
 cnt=np.bincount(ly[m],minlength=25)
 annual[c]={str(2000+y):round(float(cnt[y])*PIX_HA,2) for y in range(1,25)}
aoi_annual={str(2000+y):round(sum(annual[c][str(2000+y)] for c in codes),1) for y in range(1,25)}
with open(P/'forest-loss-hansen-by-commune.csv','w',newline='',encoding='utf-8') as f:
 w=csv.writer(f);w.writerow(['commune_code','commune_name','treecover2000_ge30_ha']+[str(2000+y) for y in range(1,25)])
 for c in codes:w.writerow([c,names[c],forest2000_ha[c]]+[annual[c][str(2000+y)] for y in range(1,25)])
# loss-year raster at 30 m for display (0 = none)
prof=dict(driver='GTiff',height=H30[0],width=H30[1],count=1,dtype='uint8',crs=CRS,transform=ht,nodata=0,compress='deflate',tiled=True)
with rasterio.open(P/'forest-lossyear-hansen-30m.tif','w',**prof) as d:d.write(np.where(forest2000,ly,0).astype('uint8'),1)
def agg(mask30):
 dst=np.zeros(SH,dtype='float32');reproject(mask30.astype('float32'),dst,src_transform=ht,src_crs=CRS,dst_transform=T100,dst_crs=CRS,resampling=Resampling.average);return dst
def forest_at(year):return forest2000&((ly==0)|(ly>year-2000))
def loss_in(a,b):return forest2000&(ly>=a-2000)&(ly<=b-2000)
# ---------- static features ----------
dem=np.zeros(SH,dtype='float32')
with rasterio.open(P/'dem-2024-1-30m.tif') as d:
 reproject(rasterio.band(d,1),dem,dst_transform=T100,dst_crs=CRS,resampling=Resampling.average,src_nodata=-9999,dst_nodata=np.nan)
gy,gx=np.gradient(np.nan_to_num(dem,nan=float(np.nanmean(dem))),100);slope=np.degrees(np.arctan(np.hypot(gx,gy)))
built=np.zeros(SH,dtype='float32')
with rasterio.open(P/'worldcover-2021-10m.tif') as d:
 wc=d.read(1,out_shape=(d.height//3,d.width//3),resampling=Resampling.nearest)
 wt=d.transform*d.transform.scale(d.width/wc.shape[1],d.height/wc.shape[0])
 for code,arr in [(50,built)]:
  reproject((wc==code).astype('float32'),arr,src_transform=wt,src_crs=CRS,dst_transform=T100,dst_crs=CRS,resampling=Resampling.average)
 crop=np.zeros(SH,dtype='float32')
 reproject(np.isin(wc,[30,40]).astype('float32'),crop,src_transform=wt,src_crs=CRS,dst_transform=T100,dst_crs=CRS,resampling=Resampling.average)
dist_built=ndimage.distance_transform_edt(built<0.05)*0.1
def features(year):
 """Features describing state at end of `year` (uses only loss up to `year`)."""
 ff=agg(forest_at(year));recent=agg(loss_in(year-2,year));older=agg(loss_in(2001,year-3))
 dist_recent=ndimage.distance_transform_edt(recent<0.01)*0.1
 dens1=ndimage.uniform_filter(recent,11);dens5=ndimage.uniform_filter(recent,51)
 nonforest=ff<0.3;dist_edge=ndimage.distance_transform_edt(~nonforest)*0.1
 X=np.stack([ff,recent,older,dist_recent,dens1,dens5,dist_edge,dem,slope,dist_built,ndimage.uniform_filter(crop,11)],-1)
 return X,ff
FEAT=['forest_fraction','loss_last3y','loss_older','dist_recent_loss_km','recent_loss_density_1km','recent_loss_density_5km','dist_nonforest_km','elevation_m','slope_deg','dist_builtup_km','cropland_share_1km']
def label(a,b):return agg(loss_in(a,b))>0.0
rng=np.random.default_rng(42)
def sample(X,ff,y,n=250000):
 idx=np.flatnonzero((ff.ravel()>=0.3)&inside.ravel()&np.isfinite(X.reshape(-1,X.shape[-1])).all(1))
 if len(idx)>n:idx=rng.choice(idx,n,replace=False)
 return X.reshape(-1,X.shape[-1])[idx],y.ravel()[idx],idx
Xa,ffa=features(2018);ya=label(2019,2020);Xs,ys,_=sample(Xa,ffa,ya)
rf=RandomForestClassifier(n_estimators=200,max_depth=14,min_samples_leaf=20,n_jobs=-1,random_state=1,class_weight=None).fit(Xs,ys)
Xb,ffb=features(2022);yb=label(2023,2024);Xv,yv,_=sample(Xb,ffb,yb,400000)
pv=rf.predict_proba(Xv)[:,1]
order=np.argsort(-pv);top10=order[:len(order)//10]
deciles=[]
qs=np.quantile(pv,[0.5,0.75,0.9,0.97])
def risk_class(p):return np.digitize(p,qs)+1
cls_v=risk_class(pv)
for k in range(1,6):
 m=cls_v==k;deciles.append(dict(risk_class=k,cells=int(m.sum()),observed_loss_rate=round(float(yv[m].mean()),4) if m.any() else None,mean_predicted=round(float(pv[m].mean()),4) if m.any() else None))
validation=dict(train=dict(features_as_of='2018-12-31',label='Hansen loss 2019-2020',cells=int(len(ys)),positive_rate=round(float(ys.mean()),4)),
 test=dict(features_as_of='2022-12-31',label='Hansen loss 2023-2024',cells=int(len(yv)),positive_rate=round(float(yv.mean()),4)),
 auc=round(float(roc_auc_score(yv,pv)),4),brier=round(float(brier_score_loss(yv,pv)),4),
 top10pct_capture=round(float(yv[top10].sum()/max(yv.sum(),1)),4),by_risk_class=deciles,
 class_quantile_thresholds=[round(float(q),5) for q in qs],
 feature_importance={k:round(float(v),4) for k,v in sorted(zip(FEAT,rf.feature_importances_),key=lambda t:-t[1])},
 caveat='Validation uses Hansen tree-cover loss as reference (any cause, includes plantation harvest); not verified legal deforestation.')
print(json.dumps(validation,indent=1),flush=True)
# retrain on latest complete window and forecast 2025-2026
Xc,ffc=features(2020);yc=label(2021,2022);Xs2,ys2,_=sample(Xc,ffc,yc)
rf2=RandomForestClassifier(n_estimators=200,max_depth=14,min_samples_leaf=20,n_jobs=-1,random_state=2).fit(np.vstack([Xs,Xs2]),np.concatenate([ys,ys2]))
Xf,fff=features(2024);flat=Xf.reshape(-1,Xf.shape[-1]);ok=(fff.ravel()>=0.3)&inside.ravel()&np.isfinite(flat).all(1)
iso=IsotonicRegression(out_of_bounds='clip').fit(pv,yv)
validation['calibration']='isotonic on test period (2023-2024); probabilities below are calibrated to the latest observed loss rate'
validation['brier_calibrated']=round(float(brier_score_loss(yv,iso.predict(pv))),4)
for dcl in deciles:
 m=cls_v==dcl['risk_class'];dcl['mean_calibrated']=round(float(iso.predict(pv[m]).mean()),4) if m.any() else None
prob=np.full(flat.shape[0],np.nan,dtype='float32');raw=rf2.predict_proba(flat[ok])[:,1];prob[ok]=iso.predict(raw);prob=prob.reshape(SH)
rawgrid=np.full(flat.shape[0],np.nan,dtype='float32');rawgrid[ok]=raw;rawgrid=rawgrid.reshape(SH)
rclass=np.where(np.isfinite(rawgrid),risk_class(np.nan_to_num(rawgrid)),0).astype('uint8')
prof=dict(driver='GTiff',height=SH[0],width=SH[1],count=2,dtype='float32',crs=CRS,transform=T100,nodata=-1,compress='deflate')
with rasterio.open(P/'forest-loss-risk-2025-2026-100m.tif','w',**prof) as d:
 d.write(np.nan_to_num(prob,nan=-1),1);d.write(rclass.astype('float32'),2);d.set_band_description(1,'probability_loss_2025_2026');d.set_band_description(2,'risk_class_1_5')
risk_by_commune={}
for i,c in enumerate(codes):
 m=(cgrid==i+1)&np.isfinite(prob)
 if not m.any():risk_by_commune[c]=None;continue
 cnts=np.bincount(rclass[m],minlength=6)
 risk_by_commune[c]=dict(forest_cells=int(m.sum()),mean_probability=round(float(prob[m].mean()),4),
  expected_loss_ha=round(float((prob[m]*fff[m]).sum()),1),high_risk_ha=round(float(((rclass[m]>=4)*fff[m]).sum()),1),
  class_cells={str(k):int(cnts[k]) for k in range(1,6)})
# ---------- change candidates from Sentinel series ----------
MS=ROOT/'data/collected/monitoring-series'
def season(year,months):
 nd=[];nb=[]
 for m in months:
  p=MS/f'sentinel-{year}-{m:02}-100m.tif'
  if not p.exists():continue
  with rasterio.open(p) as d:a=d.read().astype('float32')
  good=(a[3]>0)&(a[2]>0)&(a[6]>0)
  with np.errstate(invalid='ignore',divide='ignore'):
   nd.append(np.where(good,(a[3]-a[2])/(a[3]+a[2]),np.nan));nb.append(np.where(good,(a[3]-a[5])/(a[3]+a[5]),np.nan))
 if not nd:return None,None,None
 with np.errstate(all='ignore'):return np.nanmedian(nd,0),np.nanmedian(nb,0),np.array(nd)
standing=agg(forest_at(2024))>=0.5
def auto_thresholds(dn,db,mask,n_months):
 """Ngưỡng tự thích nghi: mức nghiêm ngặt hơn giữa ngưỡng chuẩn (ΔNDVI −0,15; ΔNBR −0,10) và trung vị − 3×MAD của rừng ổn định trong kỳ."""
 out={}
 for k,a,base in (('dndvi',dn,-0.15),('dnbr',db,-0.10)):
  v=a[mask&np.isfinite(a)]
  if v.size<1000:out[k]=base;continue
  med=float(np.median(v));mad=1.4826*float(np.median(np.abs(v-med)))
  out[k]=round(min(base,med-3*mad),3)
 out['persist']=2 if n_months>=2 else 1;out['min_ha']=3;out['mode']='auto'
 return out
# lưu mặt nạ rừng còn đến 2024 (lưới 100 m) cho phân tích biến động theo thời gian tuỳ chọn (analyze_change_custom.py)
with rasterio.open(P/'forest-standing-2024-100m.tif','w',driver='GTiff',width=SH[1],height=SH[0],count=1,dtype='uint8',crs=CRS,transform=T100,compress='deflate') as d:d.write((standing&inside).astype('uint8'),1)
# Kỳ so sánh tự sinh theo dữ liệu thực có (không gán cứng): mỗi năm chia 4 kỳ theo mùa; kỳ nào có ≥ 2 tháng ảnh
# và kết thúc trong 12 tháng gần nhất thì được phân tích, so với cùng các tháng của 1–2 năm trước (loại dao động mùa vụ).
SEASONS=[('01..04',[1,2,3,4],'mùa khô'),('05..06',[5,6],'đầu mùa mưa'),('07..09',[7,8,9],'mùa mưa'),('10..12',[10,11,12],'cuối mùa mưa – đầu mùa khô')]
DRY={11,12,1,2,3,4}
avail={(int(f.stem.split('-')[1]),int(f.stem.split('-')[2])) for f in MS.glob('sentinel-*-100m.tif')}
if not avail:raise SystemExit('Chưa có ảnh Sentinel-2 tháng nào trong data/collected/monitoring-series')
latest=max(avail);mi=lambda ym:ym[0]*12+ym[1]
windows=[]
for y in range(2025,latest[0]+1):
 for code,months,label in SEASONS:
  have=[m for m in months if (y,m) in avail]
  if len(have)<2 or mi(latest)-mi((y,have[-1]))>=12:continue
  base=[b for b in (y-1,y-2) if sum((b,m) in avail for m in have)>=2]
  if not base:continue
  dry=any(m in DRY for m in have)
  windows.append(dict(year=y,code=code,months=have,label=label,base=sorted(base),dry=dry,
   title=f"{y}-{have[0]:02}..{have[-1]:02} so với cùng kỳ {'–'.join(map(str,sorted(base)))}"))
windows.sort(key=lambda w:(w['year'],w['months'][-1]),reverse=True)
print(f"Ảnh Sentinel-2 có đến {latest[1]:02}/{latest[0]}; {len(windows)} kỳ so sánh: "+'; '.join(w['title'] for w in windows),flush=True)
features_out=[];cand_summary=[];latest_dn=None
from rasterio.transform import xy
for w in windows:
 n_cur,b_cur,m_cur=season(w['year'],w['months'])
 bases=[season(b,w['months'])[:2] for b in w['base']]
 bases=[x for x in bases if x[0] is not None]
 if n_cur is None or not bases:continue
 with np.errstate(all='ignore'):
  base_n=np.fmin.reduce([x[0] for x in bases]) if len(bases)>1 else bases[0][0]
  base_b=np.fmin.reduce([x[1] for x in bases]) if len(bases)>1 else bases[0][1]
 dn=n_cur-base_n;db=b_cur-base_b
 with np.errstate(invalid='ignore'):persist=((m_cur-base_n[None])<=-0.10).sum(0)
 valid=standing&inside&np.isfinite(dn)
 th=auto_thresholds(dn,db,valid,len(w['months']))
 cand=valid&(dn<=th['dndvi'])&(db<=th['dnbr'])&(persist>=th['persist'])
 if latest_dn is None:latest_dn=(w,np.where(standing&inside,dn,np.nan),float(valid.sum())/max(1,float((standing&inside).sum())))
 lab,n=ndimage.label(cand);sizes=ndimage.sum(cand,lab,range(1,n+1))
 keep=np.isin(lab,np.flatnonzero(sizes>=th['min_ha'])+1)
 cnt=0
 for geom,val in shapes(lab.astype('int32'),mask=keep,transform=T100):
  m=lab==int(val);area=float(m.sum());rows_,cols_=np.nonzero(m);r0,c0=int(round(rows_.mean())),int(round(cols_.mean()))
  cx,cy=xy(T100,rows_.mean(),cols_.mean());lon,lat=transform(CRS,'EPSG:4326',[cx],[cy]);ci=np.bincount(cgrid[m]).argmax()
  g=transform_geom(CRS,'EPSG:4326',geom)
  # mã ổn định: kỳ + ô lưới tâm vùng → chạy lại (thêm tháng mới) vẫn giữ mã, quyết định xác minh không bị lệch
  features_out.append(dict(type='Feature',geometry=g,properties=dict(id=f"CC-{w['year']}{w['code'][:2]}-{r0:04d}{c0:04d}",window=w['title'],area_ha=area,
   mean_dndvi=round(float(np.nanmean(dn[m])),3),mean_dnbr=round(float(np.nanmean(db[m])),3),
   commune_code=codes[ci-1] if ci>0 else None,commune_name=names[codes[ci-1]] if ci>0 else None,
   lon=round(lon[0],5),lat=round(lat[0],5),seasonal_leaf_fall_possible=w['dry'],verification_status='unverified',baseline_years=w['base'],low_confidence=len(w['base'])<2,
   evidence=f"Sentinel-2 median tháng 100 m, {w['label']}; ΔNDVI ≤ {th['dndvi']} và ΔNBR ≤ {th['dnbr']} (ngưỡng tự thích nghi) so với giá trị thấp hơn của cùng kỳ {', '.join(map(str,w['base']))}, lặp lại ≥ 2 tháng; trong rừng Hansen còn đến 2024")));cnt+=1
 cand_summary.append(dict(window=w['title'],months=w['months'],year=w['year'],season=w['label'],baseline_years=w['base'],low_confidence=len(w['base'])<2,thresholds=th,candidates=cnt,area_ha=float(keep.sum()),dry_season=w['dry'],valid_fraction=round(float(valid.sum())/max(1,float((standing&inside).sum())),3)))
 print(f"  {w['title']} ({w['label']}): {cnt} vùng nghi vấn, {float(keep.sum()):.0f} ha",flush=True)
# lớp bản đồ công khai: ΔNDVI kỳ mới nhất trong rừng còn đến 2024 (đỏ = giảm, xanh = tăng)
if latest_dn is not None:
 from rasterio.warp import transform_bounds
 from rasterio.transform import from_bounds
 from PIL import Image
 w,dnv,vf=latest_dn
 Wb,Sb,Eb,Nb=107.33,13.91,108.56,15.43
 X0,Y0,X1,Y1=transform_bounds('EPSG:4326','EPSG:3857',Wb,Sb,Eb,Nb);OH=1400;OW=int(round(OH*(X1-X0)/(Y1-Y0)));otr=from_bounds(X0,Y0,X1,Y1,OW,OH)
 dst=np.full((OH,OW),np.nan,dtype='float32')
 reproject(dnv.astype('float32'),dst,src_transform=T100,src_crs=CRS,dst_transform=otr,dst_crs='EPSG:3857',resampling=Resampling.nearest,src_nodata=np.nan,dst_nodata=np.nan)
 stops=[(-0.3,(165,0,38)),(-0.15,(244,109,67)),(-0.05,(254,224,139)),(0.0,(247,247,247)),(0.05,(217,239,139)),(0.15,(102,189,99)),(0.3,(0,104,55))]
 xs=np.array([s_[0] for s_ in stops]);cs=np.array([s_[1] for s_ in stops],dtype='float32')
 v=np.clip(np.nan_to_num(dst,nan=0),-0.3,0.3)
 rgb=np.stack([np.interp(v,xs,cs[:,k]) for k in range(3)],-1).astype('uint8')
 alpha=np.where(np.isfinite(dst),220,0).astype('uint8')
 OV=ROOT/'public/generated/overlays';OV.mkdir(parents=True,exist_ok=True)
 Image.fromarray(np.dstack([rgb,alpha])).save(OV/'change-latest.png')
 ovf=WEB/'overlays.json';ov=json.loads(ovf.read_text(encoding='utf-8'))
 ov=[o for o in ov if o['id']!='change-latest']
 mlabel=f"{w['months'][0]:02}" + (f"–{w['months'][-1]:02}" if len(w['months'])>1 else '')
 entry=dict(id='change-latest',url='/generated/overlays/change-latest.webp',title=f"Biến động NDVI {mlabel}/{w['year']} so với cùng kỳ {'–'.join(map(str,w['base']))}",
  source='Copernicus Sentinel-2 SR (GEE), median tháng 100 m – phân tích Python',
  meaning=f"Chênh lệch NDVI so với giá trị thấp hơn của cùng kỳ các năm trước, chỉ trong rừng còn đến 2024. Đỏ = giảm (nghi vấn mất/suy giảm rừng, cần xác minh), xanh = tăng. {w['label'].capitalize()}" + ('; mùa khô: rừng khộp rụng lá có thể làm NDVI giảm' if w['dry'] else '') + '.',
  legend=[dict(value=-0.3,color='#a50026'),dict(value=-0.15,color='#f46d43'),dict(value=-0.05,color='#fee08b'),dict(value=0,color='#f7f7f7'),dict(value=0.05,color='#d9ef8b'),dict(value=0.15,color='#66bd63'),dict(value=0.3,color='#006837')],
  resolution='100 m',coordinates=[[Wb,Nb],[Eb,Nb],[Eb,Sb],[Wb,Sb]],window=w['title'],valid_fraction=round(vf,3),group='change')
 idx=next((i for i,o in enumerate(ov) if o['id']=='s2-latest'),-1)
 ov.insert(idx+1 if idx>=0 else 0,entry)
 ovf.write_text(json.dumps(ov,ensure_ascii=False,indent=1),encoding='utf-8')
 print(f"Lớp bản đồ: {entry['title']} (phủ {vf*100:.0f}% diện tích rừng)",flush=True)
(WEB/'change-candidates.geojson').write_text(json.dumps(dict(type='FeatureCollection',features=features_out),ensure_ascii=False),encoding='utf-8')
payload=dict(generated_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
 history=dict(source='Hansen/UMD Global Forest Change v1.12 (2000–2024), tree cover ≥ 30 %',license='CC BY 4.0',
  meaning='Mất tán cây (thay thế lớp phủ, mọi nguyên nhân, gồm cả khai thác rừng trồng); không đồng nhất với mất rừng theo pháp luật',
  aoi_annual_loss_ha=aoi_annual,treecover2000_ha=forest2000_ha,annual_loss_by_commune=annual),
 forecast=dict(product='forest_loss_risk',horizon='2025-01-01..2026-12-31',model='RandomForest (scikit-learn) 100 m',features=FEAT,
  validation=validation,risk_by_commune=risk_by_commune,status='model_output_unverified_not_official_warning'),
 candidates=dict(windows=cand_summary,latest_month=f'{latest[0]}-{latest[1]:02}',status='unverified_change_candidates'))
(WEB/'forest-change.json').write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
print('saved')
