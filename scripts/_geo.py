"""Small shared helpers: commune lookup grid (lon/lat -> commune code) without shapely."""
import json
from pathlib import Path
import numpy as np
from rasterio.features import rasterize
from rasterio.transform import from_origin
ROOT=Path(__file__).resolve().parents[1]
W,S,E,N=107.30,13.90,108.57,15.44;RES=0.002
def commune_grid():
 fc=json.loads((ROOT/'data/boundaries/kon-tum-new-communes-clipped.geojson').read_text(encoding='utf-8'))
 codes=[f['properties']['code'] for f in fc['features']]
 tr=from_origin(W,N,RES,RES);shape=(int(round((N-S)/RES)),int(round((E-W)/RES)))
 grid=rasterize([(f['geometry'],i+1) for i,f in enumerate(fc['features'])],out_shape=shape,transform=tr,fill=0,dtype='int16')
 def lookup(lon,lat):
  c=int((lon-W)/RES);r=int((N-lat)/RES)
  if 0<=r<shape[0] and 0<=c<shape[1] and grid[r,c]>0:return codes[grid[r,c]-1]
  return None
 return lookup,codes,fc
