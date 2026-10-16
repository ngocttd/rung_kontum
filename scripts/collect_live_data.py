"""Download real observations and references; never serialize credentials."""
import sys, json, hashlib, datetime, csv, io, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
import requests
from shapely.geometry import shape, Point
from bs4 import BeautifulSoup
OUT=ROOT/'data/collected'; OUT.mkdir(parents=True,exist_ok=True)
NOW=datetime.datetime.now(datetime.timezone.utc).isoformat()
records=[]
def save(name, content, source, **metadata):
    path=OUT/name;path.parent.mkdir(parents=True,exist_ok=True)
    if not isinstance(content,bytes): content=json.dumps(content,ensure_ascii=False,indent=2).encode()
    path.write_bytes(content)
    records.append(dict(file=name,source=source,retrieved_at=NOW,bytes=len(content),sha256=hashlib.sha256(content).hexdigest(),**metadata))
def get(url,**kwargs):
    r=requests.get(url,timeout=90,**kwargs);r.raise_for_status();return r
env={}
for line in (ROOT/'.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k,v=line.split('=',1);env[k]=v.strip().strip('"').strip("'")
aoi=shape(json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]['geometry'])
communes=json.loads((ROOT/'data/boundaries/kon-tum-new-communes-full.geojson').read_text(encoding='utf-8'))['features']
status={}
# API keys are request parameters only, excluded from manifests and exceptions.
weather=[]
for f in ([] if (OUT/'weather/communes.json').exists() else communes):
    p=shape(f['geometry']).intersection(aoi).representative_point()
    item={'commune':f['properties'],'location':{'lat':p.y,'lon':p.x}}
    for endpoint in ['weather','forecast']:
        try:
            r=requests.get('https://api.openweathermap.org/data/2.5/'+endpoint,params=dict(lat=p.y,lon=p.x,appid=env['OPENWEATHER_KEY'],units='metric',lang='vi'),timeout=30)
            if r.status_code!=200:
                status['openweather']=r.status_code;break
            item[endpoint]=r.json()
        except Exception as e: status['openweather']=type(e).__name__;break
        time.sleep(.3)
    if 'weather' not in item: break
    weather.append(item)
if not weather and (OUT/'weather/communes.json').exists(): weather=json.loads((OUT/'weather/communes.json').read_text(encoding='utf-8'))
save('weather/communes.json',weather,'https://openweathermap.org/api',units='metric',note='Point forecasts, not commune-wide measurements. Forecast 5 days / 3 hours; retain observation timestamps.')
status['weather_communes']=len(weather)
print('Weather communes:',len(weather),flush=True)
for sensor in ['MODIS','SUOMI_VIIRS','J1_VIIRS','J2_VIIRS']:
    folder={'MODIS':'c6','SUOMI_VIIRS':'suomi-npp-viirs-c2','J1_VIIRS':'noaa-20-viirs-c2','J2_VIIRS':'noaa-21-viirs-c2'}[sensor]
    version='C6_1' if sensor=='MODIS' else 'C2'
    url=f'https://firms.modaps.eosdis.nasa.gov/data/active_fire/{folder}/csv/{sensor}_{version}_SouthEast_Asia_7d.csv'
    try:
        r=get(url);rows=list(csv.DictReader(io.StringIO(r.text)))
        if not rows or 'latitude' not in rows[0]: raise ValueError('Not fire CSV')
        save(f'firms/{sensor}-regional-7d.csv',r.content,url,license='NASA FIRMS attribution')
        features=[]
        for row in rows:
            x,y=float(row['longitude']),float(row['latitude'])
            if aoi.covers(Point(x,y)):features.append(dict(type='Feature',geometry=dict(type='Point',coordinates=[x,y]),properties={**row,'verification_status':'unverified','source_sensor':sensor}))
        save(f'firms/{sensor}-kon-tum-7d.geojson',dict(type='FeatureCollection',features=features),url,regional_count=len(rows),aoi_count=len(features),note='Satellite thermal anomalies; not confirmed forest fires.')
        status[sensor]=len(features)
    except Exception as e: status[sensor]=type(e).__name__
    print(sensor,status[sensor],flush=True)
references={
 'forest-status-2025.pdf':'https://vanban.quangngai.gov.vn/upload/2007099/20260403/QDUB_CONG_BO_HIEN_TRANG_RUNG_NAM_2025_signed_1a066.pdf',
 'kon-tum-forest-2024.html':'https://www.kontum.gov.vn/pages/detail/54922/Nam-2024-ty-le-che-phu-rung-tren-toan-tinh-dat-6369.html',
 'commune-merger-2025.html':'https://quangngai.gov.vn/tin-tuc/nghi-quyet-ve-viec-sap-xep-cac-don-vi-hanh-chinh-cap-xa-cua-tinh-quang-ngai-nam-2025.html',
 'provincial-planning.html':'https://quangngai.gov.vn/tai-nguyen/quy-hoach-tinh',
 'forest-inventory.html':'https://quangngai.gov.vn/tin-tuc/tin-chi-dao-dieu-hanh/kinh-te/kiem-ke-rung-tren-dia-ban-tinh.html'}
for name,url in references.items():
    try:
        r=get(url)
        if name.endswith('.pdf') and not r.content.startswith(b'%PDF'):raise ValueError('Not PDF')
        save('references/'+name,r.content,url,redistribution='Source review required before publishing full content')
        if name.endswith('.html'):
            soup=BeautifulSoup(r.content,'html.parser')
            for tag in soup(['script','style','nav']):tag.decompose()
            save('references/'+name+'.txt',soup.get_text('\n',strip=True).encode(),url)
            links=[{'text':a.get_text(' ',strip=True),'href':requests.compat.urljoin(url,a['href'])} for a in soup.select('a[href]') if any(s in a['href'].lower() for s in ['.pdf','.doc','.zip'])]
            save('references/'+name+'.links.json',links,url)
        status[name]='downloaded'
    except Exception as e:status[name]=type(e).__name__
    print(name,status[name],flush=True)
try:
    r=requests.get('https://api.mapbox.com/styles/v1/mapbox/outdoors-v12',params={'access_token':env['MAPBOX_TOKEN']},timeout=30)
    status['mapbox_style_http']=r.status_code
except Exception as e:status['mapbox_style_http']=type(e).__name__
(OUT/'manifest.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'collection-status.json').write_text(json.dumps(dict(collected_at=NOW,status=status),ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(status,ensure_ascii=True))
