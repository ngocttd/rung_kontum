import sys,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/osm'));sys.path.insert(0,str(ROOT/'.tools/python'))
import osmium
from shapely.geometry import shape,Point,LineString,Polygon,mapping
from shapely.prepared import prep
aoi=shape(json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry']);prepared=prep(aoi)
layers={k:[] for k in ['roads','rivers','places','facilities','waterbodies','protected-areas']};errors=0
west,south,east,north=aoi.bounds
class Extract(osmium.SimpleHandler):
 def node(self,n):
  if not n.location.valid() or not (west<=n.location.lon<=east and south<=n.location.lat<=north):return
  tags=dict(n.tags);layer='places' if tags.get('place') in ['city','town','village','hamlet'] else 'facilities' if tags.get('amenity') in ['hospital','clinic','police','fire_station'] or tags.get('office')=='forestry' else None
  if layer and n.location.valid():
   p=Point(n.location.lon,n.location.lat)
   if prepared.covers(p):self.add(layer,n.id,'node',p,tags)
 def add(self,layer,id,kind,geom,tags):
  layers[layer].append(dict(type='Feature',geometry=mapping(geom),properties=dict(osm_id=str(id),osm_type=kind,**tags,source='OpenStreetMap / Geofabrik 2026-10-15',verification_status='community_data_not_field_verified')))
 def way(self,w):
  global errors
  tags=dict(w.tags)
  layer='roads' if 'highway' in tags else 'rivers' if tags.get('waterway') in ['river','stream','canal','drain'] else 'waterbodies' if tags.get('natural')=='water' or tags.get('landuse')=='reservoir' else 'protected-areas' if tags.get('leisure')=='nature_reserve' or tags.get('boundary')=='protected_area' else 'facilities' if tags.get('amenity') in ['hospital','clinic','police','fire_station'] else None
  if not layer:return
  try:
   xy=[(n.lon,n.lat) for n in w.nodes]
   if len(xy)<2:return
   geom=Polygon(xy) if layer in ['waterbodies','protected-areas','facilities'] and len(xy)>3 and xy[0]==xy[-1] else LineString(xy)
   if not prepared.intersects(geom):return
   if not geom.is_valid:geom=geom.buffer(0)
   clipped=geom if prepared.covers(geom) else geom.intersection(aoi)
   if not clipped.is_empty:self.add(layer,w.id,'way',clipped,tags)
   if sum(len(x) for x in layers.values())%1000==0:print('Extracted features',sum(len(x) for x in layers.values()),flush=True)
  except Exception:errors+=1
Extract().apply_file(str(ROOT/'data/collected/osm/vietnam-261015.osm.pbf'),locations=True,idx='flex_mem')
out=ROOT/'data/processed/osm';out.mkdir(exist_ok=True)
for name,features in layers.items():
 (out/(name+'.geojson')).write_text(json.dumps(dict(type='FeatureCollection',features=features),ensure_ascii=False,separators=(',',':')),encoding='utf-8')
report=dict(counts={k:len(v) for k,v in layers.items()},processing_errors=errors,license='ODbL-1.0',attribution='© OpenStreetMap contributors / Geofabrik',geometry='clipped to historical Kon Tum AOI',limitations=['Nodes and ways extracted; multipolygon relations not assembled. Protected area layer is incomplete and not official.','Road access and emergency-service status require local verification.'])
(out/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=True))
