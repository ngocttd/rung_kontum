import requests,json,hashlib,re,time
from pathlib import Path
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'data/collected/reference-media';out.mkdir(exist_ok=True)
session=requests.Session();session.headers['User-Agent']='KonTumForestResearch/1.0 (educational local preparation)'
records=[];seen=set()
for query in ['"Chu Mom Ray" filetype:bitmap','"Ngoc Linh" filetype:bitmap','"Mang Den" forest filetype:bitmap','"Kon Tum" forest filetype:bitmap']:
 try:
  r=session.get('https://commons.wikimedia.org/w/api.php',params={'action':'query','format':'json','generator':'search','gsrsearch':query,'gsrnamespace':6,'gsrlimit':4,'prop':'imageinfo','iiprop':'url|extmetadata','iiurlwidth':1200},timeout=60);r.raise_for_status()
  for page in r.json().get('query',{}).get('pages',{}).values():
   if page['pageid'] in seen:continue
   seen.add(page['pageid']);info=page['imageinfo'][0];meta=info.get('extmetadata',{})
   def plain(k):return BeautifulSoup(meta.get(k,{}).get('value',''),'html.parser').get_text(' ',strip=True)
   license=plain('LicenseShortName')
   if not any(t in license.lower() for t in ['cc by','public domain','cc0']):continue
   name=str(page['pageid'])+'.jpg';url=info.get('thumburl',info['url']);image=session.get(url,timeout=60);image.raise_for_status();(out/name).write_bytes(image.content)
   records.append(dict(file=name,title=page['title'],description=plain('ImageDescription'),artist=plain('Artist'),credit=plain('Credit'),license=license,license_url=plain('LicenseUrl'),source_page=info['descriptionurl'],download_url=url,sha256=hashlib.sha256(image.content).hexdigest(),query=query,status='candidate_requires_visual_and_location_review'))
 except Exception as e:print(query,type(e).__name__,flush=True)
 (out/'manifest.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print('Licensed candidate images',len(records))
