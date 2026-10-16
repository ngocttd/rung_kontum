import sys,json,hashlib,datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
import requests
OUT=ROOT/'data/collected';manifest=[]
urls={
 'forest-status-2025-complete.pdf':'https://kiemlam.quangngai.gov.vn/items/doc/2026/685_1047qd-ubnd.pdf',
 'forest-status-implementation-2026.pdf':'https://kiemlam.quangngai.gov.vn/items/doc/2026/700_2807ubnd-nnmt.pdf',
 'forestry-decision-614.pdf':'https://kiemlam.quangngai.gov.vn/items/doc/2026/707_614qd-ttg.pdf',
 'forest-coordination-2026.pdf':'https://kiemlam.quangngai.gov.vn/items/doc/2026/683_02qcph-cckl.pdf'}
for name,url in urls.items():
 try:
  r=requests.get(url,timeout=90);r.raise_for_status();assert r.content.startswith(b'%PDF')
  p=OUT/'references'/name;p.write_bytes(r.content)
  manifest.append(dict(file=str(p.relative_to(OUT)),source=url,sha256=hashlib.sha256(r.content).hexdigest(),bytes=len(r.content)))
  print(name,len(r.content),flush=True)
 except Exception as e:print(name,type(e).__name__,flush=True)
(OUT/'reference-manifest.json').write_text(json.dumps(manifest,indent=2))
bbox='13.919630917,107.332379264,15.417532588,108.546889227'
queries={
 'roads':f'way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|path)$"]({bbox});',
 'rivers':f'way[waterway~"^(river|stream|canal)$"]({bbox});',
 'places':f'nwr[place~"^(city|town|village|hamlet)$"]({bbox});nwr[amenity~"^(fire_station|hospital|police)$"]({bbox});nwr[leisure=nature_reserve]({bbox});'}
for name,query in queries.items():
 p=OUT/'osm'/f'{name}.json';p.parent.mkdir(exist_ok=True)
 if p.exists():continue
 for host in ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']:
  try:
   r=requests.get(host,headers={'User-Agent':'KonTumForestResearch/1.0 (local GIS data preparation; no tile scraping)'},params={'data':'[out:json][timeout:180];('+query+');out geom;'},timeout=220);r.raise_for_status();data=r.json();assert 'elements' in data;p.write_bytes(r.content)
   manifest.append(dict(file=str(p.relative_to(OUT)),source=host,query=query,license='ODbL 1.0',attribution='© OpenStreetMap contributors',retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),count=len(data['elements']),sha256=hashlib.sha256(r.content).hexdigest()))
   print(name,len(data['elements']),flush=True);break
  except Exception as e:print(name,type(e).__name__,flush=True)
 (OUT/'osm-reference-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
