"""Read-only artifact, source integrity, and secret-exposure checks."""
import json,hashlib,re,xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]; A=ROOT/'public/assets'
manifest=json.loads((A/'manifest.json').read_text(encoding='utf-8'))
errors=[]
for item in manifest['assets']:
    p=A/item['path']
    if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']: errors.append('hash:'+item['path'])
    if p.suffix=='.svg': ET.parse(p)
    elif p.suffix!='.webp':
        with Image.open(p) as im:
            if list(im.size)!=[item['width'],item['height']]: errors.append('size:'+item['path'])
            im.verify()
webp_report=json.loads((ROOT/'notes/image-decode-validation.json').read_text())
assert webp_report['decoded_images']==sum(not x['path'].endswith('.svg') for x in manifest['assets'])
for ratio in [1,2]:
    name='markers'+('@2x' if ratio==2 else '')
    atlas=json.loads((A/'sprites'/(name+'.json')).read_text())
    with Image.open(A/'sprites'/(name+'.png')) as im:
        assert len(atlas)==18
        assert im.mode=='RGBA'
        assert im.getpixel((0,0))[3]==0
        assert all(v['pixelRatio']==ratio and v['x']+v['width']<=im.width and v['y']+v['height']<=im.height for v in atlas.values())
html=(A/'index.html').read_text(encoding='utf-8')
links=re.findall(r'(?:src|href)="([^"#]+)"',html)
assert all((A/link).is_file() for link in links)
source=json.loads((ROOT/'notes/docs-manifest.json').read_text(encoding='utf-8-sig'))
assert all(hashlib.sha256((ROOT/f['path']).read_bytes()).hexdigest().lower()==f['sha256'].lower() for f in source)
env={k:v for k,v in (line.split('=',1) for line in (ROOT/'.env').read_text(encoding='utf-8-sig').splitlines() if '=' in line and not line.startswith('#'))}
key=json.loads((ROOT/'.secrets/gee-key.json').read_text(encoding='utf-8-sig'))
assert key['type']=='service_account' and key['private_key'] and key['client_email']
secrets=[v.encode() for k,v in env.items() if k in ['MAPBOX_TOKEN','OPENWEATHER_KEY']]+[key['private_key'].encode(),key['client_email'].encode()]
leaks=[]
for directory in ['public','notes','scripts','data/boundaries']:
    for p in (ROOT/directory).rglob('*'):
        if p.is_file() and any(s in p.read_bytes() for s in secrets): leaks.append(str(p.relative_to(ROOT)))
assert not leaks,'Secret leak paths: '+str(leaks)
assert not errors,errors
report={'asset_files_verified':len(manifest['assets']),'gallery_asset_links_verified':len(links),'original_docs_unchanged':len(source),'secrets_in_public_or_notes':0,'env_and_service_account_structure':'valid','api_authentication_tested':False,'browser_visual_qa':False}
(ROOT/'notes/preparation-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
