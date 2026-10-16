"""Website-ready derivatives (no new facts): map overlays in EPSG:3857, simplified boundaries, per-commune
land-cover/terrain statistics, document catalogue with real first-page thumbnails.
Outputs: public/generated/{overlays,docs}/, data/web/*.json|geojson
"""
import os,sys,json,hashlib,datetime,importlib.util
from pathlib import Path
import numpy as np
_r=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(_r/'proj_data');os.environ['PROJ_DATA']=str(_r/'proj_data');os.environ['GDAL_DATA']=str(_r/'gdal_data')
import rasterio
from rasterio.warp import reproject,Resampling,transform_geom,transform_bounds,transform
from rasterio.features import geometry_mask,rasterize
from rasterio.transform import from_bounds
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];P=ROOT/'data/processed';WEB=ROOT/'data/web';WEB.mkdir(parents=True,exist_ok=True)
GEN=ROOT/'public/generated';(GEN/'overlays').mkdir(parents=True,exist_ok=True);(GEN/'docs').mkdir(parents=True,exist_ok=True)
aoi=json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']
W,S,E,N=107.33,13.91,108.56,15.43
X0,Y0,X1,Y1=transform_bounds('EPSG:4326','EPSG:3857',W,S,E,N)
def grid(height):
 width=int(round(height*(X1-X0)/(Y1-Y0)));return from_bounds(X0,Y0,X1,Y1,width,height),(height,width)
def warp(src_path,band,height,resampling,src_nodata=None,out_dtype='float32',decim=1):
 tr,sh=grid(height);dst=np.full(sh,np.nan,dtype='float32')
 with rasterio.open(src_path) as d:
  if decim>1:
   a=d.read(band,out_shape=(d.height//decim,d.width//decim),resampling=Resampling.average if resampling!=Resampling.nearest else Resampling.nearest).astype('float32')
   st=d.transform*d.transform.scale(d.width/a.shape[1],d.height/a.shape[0])
  else:a=d.read(band).astype('float32');st=d.transform
  nd=d.nodata if src_nodata is None else src_nodata
  if nd is not None:a[a==nd]=np.nan
  reproject(a,dst,src_transform=st,src_crs=d.crs,dst_transform=tr,dst_crs='EPSG:3857',resampling=resampling,src_nodata=np.nan,dst_nodata=np.nan)
 return dst,tr,sh
def aoi_mask(tr,sh):return geometry_mask([transform_geom('EPSG:4326','EPSG:3857',aoi)],sh,tr,invert=True)
overlays=[]
def save(name,rgba,title,source,meaning,legend=None,scale=None):
 p=GEN/'overlays'/f'{name}.png';Image.fromarray(rgba).save(p,optimize=False)
 overlays.append(dict(id=name,url=f'/generated/overlays/{name}.webp',title=title,source=source,meaning=meaning,legend=legend,resolution=scale,
  coordinates=[[W,N],[E,N],[E,S],[W,S]]));print(name,p.stat().st_size,flush=True)
def hexrgb(h):h=h.lstrip('#');return [int(h[i:i+2],16) for i in (0,2,4)]
# Sentinel true / false colour 2025 (30 m source, displayed at ~60 m)
for season,label in [('dry','mùa khô (01–04/2025)'),('wet','mùa mưa (06–10/2025)')]:
 src=P/f'sentinel-2025-{season}-30m.tif';bands={}
 for b,i in [('B2',1),('B3',2),('B4',3),('B8',4),('B11',5)]:bands[b],tr,sh=warp(src,i,2400,Resampling.bilinear,src_nodata=0,decim=2)
 m=aoi_mask(tr,sh)
 for name,(r,g,bb),div in [('true',('B4','B3','B2'),1800),('false',('B8','B4','B3'),[4500,1800,1800])]:
  divs=div if isinstance(div,list) else [div]*3
  rgb=np.stack([np.clip(np.nan_to_num(bands[x])/dv,0,1)**0.75 for x,dv in zip((r,g,bb),divs)],-1)
  ok=m&np.isfinite(bands['B4'])
  rgba=np.dstack([(rgb*255).astype('uint8'),(ok*255).astype('uint8')])
  save(f's2-2025-{season}-{name}',rgba,f"Sentinel-2 {'màu tự nhiên' if name=='true' else 'giả màu hồng ngoại'} {label}",
   'Copernicus Sentinel-2 SR (GEE), tổ hợp median, xử lý Python','Ảnh tổ hợp quan sát; không phải bản đồ phân loại rừng',scale='hiển thị ~60 m (nguồn 10–20 m, lưới xuất 30 m)')
# NDVI seasonal (100 m indices)
ndvi_stops=[(-0.1,'#a50026'),(0.2,'#f46d43'),(0.4,'#fee08b'),(0.6,'#a6d96a'),(0.8,'#1a9850'),(0.9,'#006837')]
def ramp(v,stops):
 xs=[s[0] for s in stops];cs=np.array([hexrgb(s[1]) for s in stops],dtype='float32')
 out=np.stack([np.interp(v,xs,cs[:,k]) for k in range(3)],-1);return out.astype('uint8')
for y in (2024,2025):
 for season in ('dry','wet'):
  v,tr,sh=warp(P/f'sentinel-{y}-{season}-100m-indices.tif',1,1200,Resampling.bilinear,src_nodata=-9999)
  ok=aoi_mask(tr,sh)&np.isfinite(v)
  rgba=np.dstack([ramp(np.nan_to_num(v),ndvi_stops),(ok*235).astype('uint8')])
  save(f'ndvi-{y}-{season}',rgba,f"NDVI {'mùa khô' if season=='dry' else 'mùa mưa'} {y}",'Sentinel-2 (GEE) – NDVI tính bằng Python, lưới 100 m',
   'Chỉ số thực vật; NDVI giảm mùa khô ở rừng rụng lá không phải mất rừng',legend=[dict(value=s[0],color=s[1]) for s in ndvi_stops],scale='100 m')
# WorldCover 2021
WC={10:('Cây gỗ','#006400'),20:('Cây bụi','#ffbb22'),30:('Cỏ','#ffff4c'),40:('Đất trồng trọt','#f096ff'),50:('Xây dựng','#fa0000'),60:('Đất trống/thưa','#b4b4b4'),80:('Mặt nước','#0064c8'),90:('Đất ngập nước','#0096a0')}
v,tr,sh=warp(P/'worldcover-2021-10m.tif',1,2400,Resampling.nearest,src_nodata=0,decim=3)
rgba=np.zeros((*sh,4),dtype='uint8');m=aoi_mask(tr,sh)
for code,(lab,col) in WC.items():
 sel=(v==code)&m;rgba[sel,:3]=hexrgb(col);rgba[sel,3]=230
save('worldcover-2021',rgba,'Lớp phủ đất ESA WorldCover 2021','ESA WorldCover 2021 v200 (CC BY 4.0)','Lớp phủ tham khảo; “cây gỗ” không đồng nhất với rừng pháp lý',
 legend=[dict(value=k,label=l,color=c) for k,(l,c) in WC.items()],scale='10 m (hiển thị ~30 m)')
# DEM hypsometric + hillshade
z,tr,sh=warp(P/'dem-2024-1-30m.tif',1,1800,Resampling.bilinear,src_nodata=-9999,decim=2)
m=aoi_mask(tr,sh)&np.isfinite(z);zz=np.nan_to_num(z,nan=float(np.nanmean(z)))
px=(X1-X0)/sh[1]*0.97
gy,gx=np.gradient(zz,px);slope=np.arctan(np.hypot(gx,gy));aspect=np.arctan2(-gx,gy)
az,alt=np.radians(315),np.radians(45);hs=np.clip(np.sin(alt)*np.cos(slope)+np.cos(alt)*np.sin(slope)*np.cos(az-aspect),0,1)
dem_stops=[(200,'#2c7f3f'),(500,'#8fbf5a'),(800,'#e8d98a'),(1200,'#c99a5b'),(1700,'#9b6a4b'),(2200,'#f2f2f2')]
col=ramp(zz,dem_stops).astype('float32')*(0.45+0.55*hs[...,None])
save('dem-2024',np.dstack([np.clip(col,0,255).astype('uint8'),(m*235).astype('uint8')]),'Địa hình Copernicus DEM GLO-30 (2024_1)',
 'Copernicus DEM GLO-30 © DLR/Airbus, cung cấp bởi ESA/EU','Mô hình bề mặt (DSM), có cả tán cây/công trình',legend=[dict(value=s[0],color=s[1]) for s in dem_stops],scale='30 m (hiển thị ~70 m)')
# Hansen loss year
v,tr,sh=warp(P/'forest-lossyear-hansen-30m.tif',1,2600,Resampling.nearest,src_nodata=0)
loss_stops=[(1,'#fde68a'),(8,'#fb923c'),(16,'#e11d48'),(24,'#7e1d6b')]
ok=np.isfinite(v)&(v>0)&aoi_mask(tr,sh)
save('hansen-loss',np.dstack([ramp(np.nan_to_num(v),loss_stops),(ok*255).astype('uint8')]),'Mất tán cây 2001–2024 (Hansen GFC v1.12)',
 'Hansen/UMD/Google/USGS/NASA – CC BY 4.0','Mất tán cây mọi nguyên nhân (gồm khai thác rừng trồng); không đồng nhất với mất rừng pháp lý',
 legend=[dict(value=2000+s[0],color=s[1]) for s in loss_stops],scale='30 m')
# forest-loss risk classes
RISK=json.loads((ROOT/'public/assets/visual-tokens.json').read_text(encoding='utf-8'))['legend']
v,tr,sh=warp(P/'forest-loss-risk-2025-2026-100m.tif',2,1400,Resampling.nearest,src_nodata=-1)
rgba=np.zeros((*sh,4),dtype='uint8');m=aoi_mask(tr,sh)
for k in range(1,6):
 sel=(v==k)&m;rgba[sel,:3]=hexrgb(RISK[f'risk-{k}']);rgba[sel,3]=[90,140,190,220,240][k-1]
save('forest-loss-risk',rgba,'Dự báo nguy cơ mất rừng 2025–2026','Mô hình Random Forest của hệ thống (Hansen GFC, DEM, WorldCover)',
 'Mô hình chưa được cơ quan chuyên môn phê duyệt; dùng để ưu tiên kiểm tra',legend=[dict(value=k,color=RISK[f'risk-{k}']) for k in range(1,6)],scale='100 m')
(WEB/'overlays.json').write_text(json.dumps(overlays,ensure_ascii=False,indent=1),encoding='utf-8')
# ---------- simplified boundaries ----------
def rdp(pts,eps):
 if len(pts)<5:return pts
 keep=np.zeros(len(pts),bool);keep[0]=keep[-1]=True;stack=[(0,len(pts)-1)];a=np.array(pts)
 while stack:
  i,j=stack.pop()
  if j<=i+1:continue
  seg=a[j]-a[i];d=np.abs(np.cross(seg,a[i+1:j]-a[i]))/(np.hypot(*seg) or 1e-12)
  k=int(np.argmax(d))+i+1
  if d[k-i-1]>eps:keep[k]=True;stack+= [(i,k),(k,j)]
 return [[round(x,5),round(y,5)] for x,y in a[keep]]
def rdp_ring(ring,eps):
 # closed ring: split at the vertex farthest from the first one so both halves are open polylines
 a=np.array(ring);k=int(np.argmax(np.hypot(*(a-a[0]).T)))
 if k==0 or len(ring)<8:return [[round(x,5),round(y,5)] for x,y in ring]
 left=rdp(ring[:k+1],eps);right=rdp(ring[k:],eps)
 return left[:-1]+right
def simplify(g,eps=0.00025):
 if g['type']=='Polygon':return dict(type='Polygon',coordinates=[rdp_ring(r,eps) for r in g['coordinates']])
 return dict(type='MultiPolygon',coordinates=[[rdp_ring(r,eps) for r in p] for p in g['coordinates']])
prov=json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))
for f in prov['features']:f['geometry']=simplify(f['geometry'],0.0002)
(WEB/'province.geojson').write_text(json.dumps(prov,ensure_ascii=False),encoding='utf-8')
fc=json.loads((ROOT/'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))
keep_props=['code','name','fullName','areaKm2','overlapFraction']
for f in fc['features']:
 f['properties']={k:f['properties'][k] for k in keep_props};f['geometry']=simplify(f['geometry'])
(WEB/'communes.geojson').write_text(json.dumps(fc,ensure_ascii=False),encoding='utf-8')
# ---------- per-commune land cover / terrain ----------
CRS='EPSG:32648';stats={}
with rasterio.open(P/'worldcover-2021-10m.tif') as d:
 wc=d.read(1,out_shape=(d.height//3,d.width//3),resampling=Resampling.nearest);wt=d.transform*d.transform.scale(d.width/wc.shape[1],d.height/wc.shape[0])
with rasterio.open(P/'dem-2024-1-30m.tif') as d:
 dem=d.read(1,out_shape=(d.height//2,d.width//2),resampling=Resampling.average);dt=d.transform*d.transform.scale(d.width/dem.shape[1],d.height/dem.shape[0])
src_fc=json.loads((ROOT/'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))
lab_wc=rasterize([(transform_geom('EPSG:4326',CRS,f['geometry']),i+1) for i,f in enumerate(src_fc['features'])],out_shape=wc.shape,transform=wt,fill=0,dtype='int16')
lab_dem=rasterize([(transform_geom('EPSG:4326',CRS,f['geometry']),i+1) for i,f in enumerate(src_fc['features'])],out_shape=dem.shape,transform=dt,fill=0,dtype='int16')
pix_ha=abs(wt.a*wt.e)/1e4
aoi_wc={}
for i,f in enumerate(src_fc['features']):
 c=f['properties']['code'];m=lab_wc==i+1;vals,cnt=np.unique(wc[m],return_counts=True)
 classes={str(int(k)):round(float(n)*pix_ha,1) for k,n in zip(vals,cnt) if k>0}
 for k,v in classes.items():aoi_wc[k]=aoi_wc.get(k,0)+v
 z=dem[(lab_dem==i+1)&(dem>-9999)]
 stats[c]=dict(worldcover_ha=classes,tree_cover_share=round(classes.get('10',0)/max(sum(classes.values()),1),4),
  elevation_mean_m=round(float(z.mean()),0) if z.size else None,elevation_min_m=round(float(z.min()),0) if z.size else None,elevation_max_m=round(float(z.max()),0) if z.size else None)
(WEB/'commune-landcover-terrain.json').write_text(json.dumps(dict(source='ESA WorldCover 2021 (20–30 m tổng hợp), Copernicus DEM GLO-30 2024_1',scope='phần xã nằm trong ranh Kon Tum lịch sử',
 classes={str(k):v[0] for k,v in WC.items()},aoi_worldcover_ha={k:round(v,1) for k,v in aoi_wc.items()},communes=stats),ensure_ascii=False),encoding='utf-8')
# ---------- documents ----------
sys.path.insert(0,str(ROOT/'.tools/pdf'))
import fitz
REF=ROOT/'data/collected/references'
DOCS=[
 dict(id='qd-1047-2026',file='685_1047qd-ubnd.pdf',title='Quyết định 1047/QĐ-UBND công bố hiện trạng rừng tỉnh Quảng Ngãi năm 2025',category='van-ban-phap-ly',
  issuer='UBND tỉnh Quảng Ngãi',number='1047/QĐ-UBND',issued='2026-03-31',source='https://kiemlam.quangngai.gov.vn/items/doc/2026/685_1047qd-ubnd.pdf'),
 dict(id='phu-luc-1047-bieu',file='79_phu-luc.pdf',title='Phụ lục biểu thống kê diện tích rừng kèm Quyết định 1047/QĐ-UBND',category='bao-cao-chuyen-nganh',
  issuer='UBND tỉnh Quảng Ngãi',number='Phụ lục QĐ 1047/QĐ-UBND',issued='2026-03-31',source='https://kiemlam.quangngai.gov.vn/items/phuluc/79_phu-luc.pdf'),
 dict(id='phu-luc-1047-xlsx',file='80_phu-luc-1.xlsx',title='Phụ lục số liệu hiện trạng rừng theo đơn vị hành chính năm 2025 (Excel)',category='du-lieu-chuyen-nganh',
  issuer='UBND tỉnh Quảng Ngãi',number='Phụ lục QĐ 1047/QĐ-UBND',issued='2026-03-31',source='https://kiemlam.quangngai.gov.vn/items/phuluc/80_phu-luc-1.xlsx'),
 dict(id='cv-trien-khai-hien-trang-2025',file='700_2807ubnd-nnmt.pdf',title='Công văn triển khai thực hiện kết quả công bố hiện trạng rừng năm 2025',category='van-ban-phap-ly',
  issuer='UBND tỉnh Quảng Ngãi',number='/UBND-NNMT',issued='2026-04',source='https://kiemlam.quangngai.gov.vn/items/doc/2026/700_2807ubnd-nnmt.pdf'),
 dict(id='qd-614-ttg',file='707_614qd-ttg.pdf',title='Quyết định 614/QĐ-TTg phê duyệt điều chỉnh Quy hoạch vùng duyên hải Nam Trung Bộ và Tây Nguyên 2021–2030',category='quy-hoach',
  issuer='Thủ tướng Chính phủ',number='614/QĐ-TTg',issued='2026-04-04',source='https://kiemlam.quangngai.gov.vn/items/doc/2026/707_614qd-ttg.pdf'),
 dict(id='quy-che-phoi-hop-02',file='683_02qcph-cckl.pdf',title='Quy chế phối hợp trong lĩnh vực lâm nghiệp vùng giáp ranh giữa TP Đà Nẵng và tỉnh Quảng Ngãi',category='van-ban-phap-ly',
  issuer='Chi cục Kiểm lâm TP Đà Nẵng – tỉnh Quảng Ngãi',number='02/QCPH-CCKL',issued='2026-03-24',source='https://kiemlam.quangngai.gov.vn/items/doc/2026/683_02qcph-cckl.pdf'),
]
for p in sorted(REF.glob('*.pdf')):
 with fitz.open(p) as d:print('pdf',p.name,d.page_count,p.stat().st_size)
cat=[]
for doc in DOCS:
 p=REF/doc['file'];doc['bytes']=p.stat().st_size;doc['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();doc['type']=p.suffix[1:]
 if doc['type']=='pdf':
  with fitz.open(p) as d:
   doc['pages']=d.page_count;pix=d[0].get_pixmap(matrix=fitz.Matrix(0.9,0.9))
   img=Image.frombytes('RGB',(pix.width,pix.height),pix.samples);img.thumbnail((520,720));t=GEN/'docs'/f"{doc['id']}.png";img.save(t)
   doc['thumbnail']=f"/generated/docs/{doc['id']}.webp"
 doc['publication_status']='public_source_document';doc['note']='Bản sao văn bản đã công bố công khai trên cổng thông tin của cơ quan ban hành; giữ nguyên bản gốc'
 cat.append(doc)
(WEB/'documents.json').write_text(json.dumps(cat,ensure_ascii=False,indent=1),encoding='utf-8')
print('docs',len(cat))
