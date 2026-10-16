"""Tag FIRMS snapshot hotspots with land cover (WorldCover 2021) and tree-cover status (Hansen 2024) at the point.
A 3x3 window (~30 m / ~90 m) is used; output data/web/hotspot-context.json keyed like the web app ids."""
import os,json,importlib.util
from pathlib import Path
import numpy as np
_r=Path(importlib.util.find_spec('rasterio').origin).parent
os.environ['PROJ_LIB']=str(_r/'proj_data');os.environ['PROJ_DATA']=str(_r/'proj_data');os.environ['GDAL_DATA']=str(_r/'gdal_data')
import rasterio
from rasterio.warp import transform
from rasterio.windows import Window
ROOT=Path(__file__).resolve().parents[1]
WC={10:'Cây gỗ',20:'Cây bụi',30:'Cỏ',40:'Đất trồng trọt',50:'Xây dựng',60:'Đất trống/thưa',80:'Mặt nước',90:'Đất ngập nước'}
def window_vals(ds,x,y,r=1):
 row,col=ds.index(x,y);return ds.read(1,window=Window(col-r,row-r,2*r+1,2*r+1),boundless=True,fill_value=0)
out={}
wc=rasterio.open(ROOT/'data/processed/worldcover-2021-10m.tif');ly=rasterio.open(ROOT/'data/processed/forest-lossyear-hansen-30m.tif')
tiles=[rasterio.open(p) for p in sorted((ROOT/'data/collected/history').glob('hansen-gfc-v1.12-30m-*.tif'))]
for p in sorted((ROOT/'data/collected/firms').glob('*-kon-tum-7d.geojson')):
 key=p.name.split('-kon-tum')[0]
 for f in json.loads(p.read_text(encoding='utf-8'))['features']:
  pr=f['properties'];lon,lat=f['geometry']['coordinates'];hh=pr['acq_time'].zfill(4)
  fid=f"{key}-{pr['acq_date']}-{hh}-{float(lat):.4f}-{float(lon):.4f}"
  xs,ys=transform('EPSG:4326','EPSG:32648',[lon],[lat]);x,y=xs[0],ys[0]
  v=window_vals(wc,x,y,1);vals,cnt=np.unique(v[v>0],return_counts=True)
  dom=int(vals[cnt.argmax()]) if len(vals) else None
  tc=None
  for t in tiles:
   b=t.bounds
   if b.left<=x<=b.right and b.bottom<=y<=b.top:
    row,col=t.index(x,y);tc=t.read(1,window=Window(col-1,row-1,3,3),boundless=True,fill_value=0);lyr=t.read(2,window=Window(col-1,row-1,3,3),boundless=True,fill_value=0);break
  standing=None
  if tc is not None:standing=float(((tc>=30)&(lyr==0)).mean())
  out[fid]=dict(landcover_code=dom,landcover=WC.get(dom),tree_share_90m=round(float((v==10).mean()),2),hansen_forest_share_90m=round(standing,2) if standing is not None else None,
   in_forest=bool(standing is not None and standing>=0.5),method='Cửa sổ 3×3 ô quanh điểm: WorldCover 2021 (10 m) và Hansen GFC 2024 (30 m, tán ≥30 %, chưa mất)')
(ROOT/'data/web/hotspot-context.json').write_text(json.dumps(out,ensure_ascii=False,indent=1),encoding='utf-8')
print(json.dumps(out,ensure_ascii=False,indent=1))
