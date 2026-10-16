import requests,hashlib,json,datetime
from pathlib import Path
out=Path(__file__).resolve().parents[1]/'data/collected/osm';out.mkdir(exist_ok=True)
url='https://download.geofabrik.de/asia/vietnam-261015.osm.pbf'
p=out/'vietnam-261015.osm.pbf'
expected=requests.get(url+'.md5',timeout=60);expected.raise_for_status();md5=expected.text.split()[0]
if not p.exists():
 with requests.get(url,stream=True,timeout=120) as r:
  r.raise_for_status()
  with p.with_suffix('.part').open('wb') as f:
   for chunk in r.iter_content(1024*1024):f.write(chunk)
 p.with_suffix('.part').replace(p)
assert hashlib.md5(p.read_bytes()).hexdigest()==md5
(out/'source.json').write_text(json.dumps(dict(source=url,downloaded_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),md5=md5,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),license='ODbL-1.0',attribution='OpenStreetMap contributors / Geofabrik',snapshot='2026-10-15',bytes=p.stat().st_size),indent=2))
print('OSM snapshot verified',p.stat().st_size)
