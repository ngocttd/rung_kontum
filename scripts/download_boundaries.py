"""Download pinned public boundary sources. Never reads project credentials."""
import json, hashlib, concurrent.futures
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/sources'
TREE = json.loads((OUT/'repository-tree.json').read_text(encoding='utf-8-sig'))
SHA = TREE['sha']
BASE = f'https://raw.githubusercontent.com/ThangLeQuoc/vietnamese-provinces-database/{SHA}/'

def fetch(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        r = requests.get(url, timeout=120)
        r.raise_for_status()
        target.write_bytes(r.content)
    return {'url':url,'path':str(target.relative_to(ROOT)).replace('\\','/'),
            'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size}

paths = [x['path'] for x in TREE['tree'] if x['path'].startswith('json/geojson/51_quang_ngai/') and x['path'].endswith('.geojson')]
paths += ['LICENSE','docs/gis/README.md','json/vn_provinces_metadata.json','json/full_json_generated_data_vn_units.json']
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    records=list(pool.map(lambda p:fetch(BASE+p, OUT/'vietnamese-provinces'/p),paths))
url='https://www.geoboundaries.org/api/current/gbOpen/VNM/ADM1/'
records.append(fetch(url,OUT/'geoboundaries-vnm-adm1-metadata.json'))
meta=json.loads((OUT/'geoboundaries-vnm-adm1-metadata.json').read_text())
records.append(fetch(meta['gjDownloadURL'],OUT/'geoboundaries-vnm-adm1.geojson'))
human_url='https://www.geoboundaries.org/api/current/gbHumanitarian/VNM/ADM1/'
records.append(fetch(human_url,OUT/'geoboundaries-humanitarian-metadata.json'))
human=json.loads((OUT/'geoboundaries-humanitarian-metadata.json').read_text())
records.append(fetch(human['gjDownloadURL'],OUT/'vnm-adm1-historical-2020.geojson'))
(OUT/'download-manifest.json').write_text(json.dumps({'retrieved_on':'2026-10-15','repository_commit':SHA,'files':records},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'downloaded_files':len(records),'repository_commit':SHA,'historical_boundary_year':human.get('boundaryYearRepresented')},ensure_ascii=False))
