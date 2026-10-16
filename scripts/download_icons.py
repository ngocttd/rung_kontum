import requests,concurrent.futures,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/icons'; OUT.mkdir(exist_ok=True,parents=True)
names='house-fill map-fill tree-fill fire cloud-sun-fill bar-chart-fill camera-fill newspaper file-earmark-pdf-fill info-circle-fill question-circle-fill search layers-fill geo-alt-fill crosshair compass-fill rulers bounding-box share-fill download upload zoom-in zoom-out fullscreen fullscreen-exit plus-lg dash-lg x-lg chevron-left chevron-right chevron-down check-lg funnel-fill calendar3 clock-history eye-fill eye-slash-fill bell-fill person-fill people-fill shield-fill-check lock-fill unlock-fill key-fill gear-fill database-fill cloud-arrow-up-fill cloud-arrow-down-fill arrow-repeat wifi-off trash-fill pencil-fill three-dots folder-fill file-earmark-excel-fill filetype-csv file-earmark-text-fill clipboard-check-fill exclamation-triangle-fill megaphone-fill truck droplet-fill wind thermometer-half sun-fill cloud-rain-fill cloud-lightning-rain-fill moon-stars-fill globe2 translate box-arrow-right phone-fill envelope-fill telephone-fill send-fill pin-map-fill signpost-split-fill building-fill grid-fill graph-up-arrow lightning-fill cursor-fill vector-pen circle-fill square-fill check-circle-fill x-circle-fill hourglass-split archive-fill image-fill collection-fill geo-fill snow2 bug-fill flower1'.split()
base='https://raw.githubusercontent.com/twbs/icons/v1.13.1/'
def one(name):
    url=base+'icons/'+name+'.svg'; p=OUT/(name+'.svg')
    r=requests.get(url,timeout=60);r.raise_for_status();p.write_bytes(r.content)
    return {'name':name,'url':url,'sha256':hashlib.sha256(r.content).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: rows=list(pool.map(one,names))
r=requests.get(base+'LICENSE',timeout=60);r.raise_for_status();(OUT/'LICENSE-bootstrap-icons.txt').write_bytes(r.content)
(ROOT/'notes/icon-sources.json').write_text(json.dumps({'version':'1.13.1','license':'MIT','icons':rows},indent=2),encoding='utf-8')
print('Downloaded',len(rows),'licensed SVG icons')

