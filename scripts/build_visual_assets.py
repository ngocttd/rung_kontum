"""Build vector UI assets and GIS-derived thumbnails. No synthetic GIS data."""
import json,re,sys,html
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; A=ROOT/'public/assets'
sys.path.insert(0,str(ROOT/'.tools/python'))
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer
IC=A/'icons'; MARK=A/'markers'; SYM=A/'symbols'
def inner(name):
    if name=='paw': return '<ellipse cx="8" cy="10.8" rx="4.2" ry="3.6"/><ellipse cx="2.8" cy="6.5" rx="1.8" ry="2.3"/><ellipse cx="6" cy="3.6" rx="1.8" ry="2.3"/><ellipse cx="10.2" cy="3.6" rx="1.8" ry="2.3"/><ellipse cx="13.4" cy="6.5" rx="1.8" ry="2.3"/>'
    return re.sub(r'^.*?<svg[^>]*>|</svg>\s*$','',(IC/(name+'.svg')).read_text(),flags=re.S).strip()
def svg(body,w=64,h=64): return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{body}</svg>'
def save(p,s): p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf-8')
icons={
'home':('house-fill','#00664d'),'map':('map-fill','#168ad5'),'forest':('tree-fill','#16834c'),
'fire':('fire','#ef3434'),'weather':('cloud-sun-fill','#168bd2'),'statistics':('bar-chart-fill','#238bd0'),
'report':('camera-fill','#8d4ed5'),'news':('newspaper','#14577a'),'documents':('file-earmark-pdf-fill','#dc343e'),
'about':('info-circle-fill','#087e99'),'guide':('question-circle-fill','#dc8117'),'satellite':('globe2','#169bb7'),
'layers':('layers-fill','#154c6a'),'users':('people-fill','#7742b5'),'security':('shield-fill-check','#078660'),
'database':('database-fill','#008777'),'api':('key-fill','#176fae'),'jobs':('gear-fill','#537186'),
'audit':('clock-history','#285b74'),'notifications':('bell-fill','#ee7c21'),'gps':('crosshair','#198ee2'),
'camera':('camera-fill','#8757be'),'offline':('wifi-off','#687887'),'sync':('arrow-repeat','#148670'),
'pdf':('file-earmark-pdf-fill','#f03746'),'excel':('file-earmark-excel-fill','#138255'),'csv':('filetype-csv','#178cf0'),
'water':('droplet-fill','#199de3'),'wind':('wind','#388cb9'),'temperature':('thermometer-half','#ec9147'),
'rain':('cloud-rain-fill','#258bbd'),'sun':('sun-fill','#f6ae00'),'storm':('cloud-lightning-rain-fill','#5b65a1'),
'protected':('shield-fill-check','#007b55'),'plantation':('tree-fill','#75b729'),'fieldwork':('clipboard-check-fill','#167c67'),
'transport':('truck','#168ce5'),'violation':('exclamation-triangle-fill','#f6a000'),'community':('people-fill','#e48919')}
for name,(icon,color) in icons.items():
    body=f'<rect x="2" y="2" width="60" height="60" rx="16" fill="{color}" fill-opacity=".10"/><g transform="translate(14 14) scale(2.25)" fill="{color}">{inner(icon)}</g>'
    save(IC/'colored'/(name+'.svg'),svg(body))
markers={
'hotspot-unverified':('fire','#ed3a32'),'fire-confirmed':('fire','#b81725'),'fire-investigating':('fire','#f58b1f'),
'fire-resolved':('check-circle-fill','#128065'),'fire-rejected':('x-circle-fill','#6b7280'),
'forest':('tree-fill','#179a57'),'protected-area':('shield-fill-check','#006f48'),
'forest-violation':('tree-fill','#dc6438'),'land-encroachment':('exclamation-triangle-fill','#f4a000'),
'timber-transport':('truck','#168be4'),'wildlife':('paw','#a34ad5'),
'report-other':('three-dots','#718096'),'report-photo':('camera-fill','#8955c7'),
'ranger-station':('building-fill','#155b72'),'settlement':('house-fill','#78815a'),
'water-station':('droplet-fill','#229cd4'),'gps':('crosshair','#168bf0'),'survey':('clipboard-check-fill','#028e7e')}
for name,(icon,color) in markers.items():
    body=f'<path d="M32 58L22 43H42Z" fill="{color}" stroke="white" stroke-width="2"/><circle cx="32" cy="26" r="22" fill="{color}" stroke="white" stroke-width="3"/><g transform="translate(20 14) scale(1.5)" fill="white">{inner(icon)}</g>'
    save(MARK/(name+'.svg'),svg(body))
colors={'risk-1':'#007b4b','risk-2':'#81cb1a','risk-3':'#ffd21f','risk-4':'#ff8a00','risk-5':'#f02d2d',
'forest-special-use':'#006b38','forest-protection':'#75bb25','forest-production':'#f8ce42',
'forest-evergreen':'#176c35','forest-semi-deciduous':'#4d9340','forest-dipterocarp':'#bd9851',
'forest-conifer':'#246853','forest-mixed':'#537e3e','forest-bamboo':'#96b93b','forest-planted':'#b567d7',
'land-perennial-crops':'#ddab68','land-shrub':'#becc8b','land-bare':'#c9b69c','land-water':'#329ed0','land-built':'#bd7272',
'status-new':'#e85d45','status-verifying':'#eaa12a','status-confirmed':'#bd2430','status-closed':'#208a63','status-rejected':'#7b8791'}
for name,color in colors.items():
    save(SYM/(name+'.svg'),svg(f'<rect x="5" y="5" width="54" height="54" rx="12" fill="{color}" stroke="white" stroke-width="3"/>'))
for name,color,dash in [('boundary-historical','#b54cff',''),('boundary-commune','#f3f7fb',''),('boundary-current-province','#307eae','7 4'),('change-suspected','#ff971b','6 4')]:
    save(SYM/(name+'.svg'),svg(f'<path d="M3 45L17 20L30 35L45 13L61 26" fill="none" stroke="{color}" stroke-width="4" stroke-dasharray="{dash}"/>'))
save(SYM/'wind-direction.svg',svg('<path d="M32 5L49 49L32 39L15 49Z" fill="#2d8fb9" stroke="white" stroke-width="2"/>'))
# True administrative geometry previews: no fabricated forest/fire thematic surfaces.
old=json.loads((ROOT/'data/boundaries/kon-tum-historical-province.geojson').read_text(encoding='utf-8'))['features'][0]
wards=json.loads((ROOT/'data/boundaries/kon-tum-new-communes-full.geojson').read_text(encoding='utf-8'))['features']
project=Transformer.from_crs(4326,32648,always_xy=True).transform
g=transform(project,shape(old['geometry'])); xmin,ymin,xmax,ymax=g.bounds
scale=min(1000/(xmax-xmin),650/(ymax-ymin)); xoff=(1200-(xmax-xmin)*scale)/2; yoff=65
def path(geom):
    ps=list(geom.geoms) if geom.geom_type=='MultiPolygon' else [geom]
    out=[]
    for p in ps:
        for ring in [p.exterior,*p.interiors]:
            pts=[(xoff+(x-xmin)*scale,yoff+(ymax-y)*scale) for x,y,*_ in ring.coords]
            out.append('M'+'L'.join(f'{x:.2f},{y:.2f}' for x,y in pts)+'Z')
    return ''.join(out)
for name,show_wards,bg,fill in [('administrative-overview',True,'#eaf4f0','#c9dfd2'),('historical-province',False,'#102c3e','#1b604d'),('communes-detail',True,'#102c3e','#1b604d')]:
    body=f'<rect width="1200" height="800" fill="{bg}"/><path d="{path(g)}" fill="{fill}" fill-rule="evenodd"/>'
    if show_wards:
        for f in wards:
            wg=transform(project,shape(f['geometry']))
            body+=f'<path d="{path(wg)}" fill="none" stroke="'+('#4a8472' if bg[1]=='e' else '#cbe4d7')+'" stroke-width="1.1"/>'
    body+=f'<path d="{path(g)}" fill="none" stroke="#b54cff" stroke-width="3"/>'
    body+='<text x="32" y="760" font-family="Arial,sans-serif" font-size="18" fill="'+('#17493e' if bg[1]=='e' else '#d5e9e3')+'">Kon Tum • Historical boundary 2020 / communes v5.2.0</text>'
    save(A/'maps'/(name+'.svg'),svg(body,1200,800))
save(A/'visual-tokens.json',json.dumps({'ui':{'forest':'#00664d','navy':'#092d49','surface':'#ffffff','border':'#dce8ef'},'legend':colors,'riskThresholds':None,'riskThresholdNote':'Colors only; configure thresholds after model calibration.','markerSemantics':{k:{'icon':v[0],'color':v[1]} for k,v in markers.items()}},ensure_ascii=False,indent=2))
print(json.dumps({'colored_icons':len(icons),'markers':len(markers),'symbols':len(colors)+5,'gis_previews':3}))
