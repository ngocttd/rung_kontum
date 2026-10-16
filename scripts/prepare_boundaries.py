"""Preserve historical province geometry; select new wards by spatial overlap.
Selection is spatial, not a legally certified old-to-new administrative crosswalk.
"""
import sys,json,hashlib,csv,copy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'.tools/python'))
from shapely.geometry import shape,mapping
from shapely.ops import transform,unary_union
from shapely.validation import explain_validity
from pyproj import Transformer

SRC=ROOT/'data/sources'; OUT=ROOT/'data/boundaries'; OUT.mkdir(exist_ok=True)
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,data): p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
def fc(fs,**kw): return dict(type='FeatureCollection',features=fs,**kw)
historical=read(SRC/'vnm-adm1-historical-2020.geojson')
old=next(f for f in historical['features'] if f['properties']['shapeName'].lower()=='kon tum')
original_geometry=copy.deepcopy(old['geometry'])
aoi=shape(original_geometry)
assert aoi.is_valid,explain_validity(aoi)
old=copy.deepcopy(old)
old['properties'].update({'historicalProvinceCode':'62','boundaryYear':2020,'scope':'Kon Tum before 2025 merger','source':'Government of Viet Nam / HDX via geoBoundaries gbHumanitarian','geometryModified':False})
write(OUT/'kon-tum-historical-province.geojson',fc([old]))
project=Transformer.from_crs(4326,32648,always_xy=True).transform
area=lambda g: transform(project,g).area/1e6
aoi_area=area(aoi)
units=read(SRC/'vietnamese-provinces/json/full_json_generated_data_vn_units.json')
province=next(p for p in units if p['Code']=='51')
codes={w['Code']:w for w in province['Wards']}
selected=[]; clipped=[]; rows=[]; invalid=[]; source_geoms={}
for p in sorted((SRC/'vietnamese-provinces/json/geojson/51_quang_ngai/wards').glob('*.geojson')):
    for f in read(p)['features']:
        g=shape(f['geometry']); prop=f['properties']; code=prop['code']
        assert code in codes,code
        if not g.is_valid:
            invalid.append({'code':code,'reason':explain_validity(g)})
            continue
        overlap=g.intersection(aoi)
        frac=area(overlap)/area(g) if not overlap.is_empty else 0
        chosen=frac>0.5
        rows.append({'code':code,'name':prop['fullName'],'province_code':'51','area_km2':round(area(g),6),'aoi_overlap_fraction':round(frac,8),'selected':chosen,'selection':'majority-area-overlap','needs_review':0.01<frac<0.99})
        if chosen:
            source_geoms[code]=copy.deepcopy(f['geometry'])
            f=copy.deepcopy(f)
            f['properties'].update({'provinceCode':'51','provinceName':province['FullName'],'studyArea':'Kon Tum historical','overlapFraction':round(frac,8),'selectionMethod':'majority-area-overlap','boundarySourceVersion':'v5.2.0','geometryModified':False,'legalCrosswalkVerified':False})
            selected.append(f)
            c=copy.deepcopy(f);c['geometry']=mapping(overlap)
            c['properties'].update({'geometryModified':True,'purpose':'AOI-clipped derivative for display and AOI statistics only'})
            clipped.append(c)
assert not invalid,invalid
assert len({f['properties']['code'] for f in selected})==len(selected)
assert all(f['geometry']==source_geoms[f['properties']['code']] for f in selected)
assert read(OUT/'kon-tum-historical-province.geojson')['features'][0]['geometry']==original_geometry
write(OUT/'kon-tum-new-communes-full.geojson',fc(selected))
write(OUT/'kon-tum-new-communes-clipped.geojson',fc(clipped))
with (OUT/'commune-spatial-crosswalk.csv').open('w',encoding='utf-8-sig',newline='') as out:
    writer=csv.DictWriter(out,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
union=unary_union([shape(f['geometry']) for f in selected])
report={'crs':'EPSG:4326','area_calculation_crs':'EPSG:32648','historical_source_year':2020,'historical_geometry_unchanged':True,'new_ward_geometry_unchanged_in_full_file':True,'source_wards_count':len(rows),'selected_count':len(selected),'selected_communes':sum(f['properties']['fullName'].startswith('Xã ') for f in selected),'selected_urban_wards':sum(f['properties']['fullName'].startswith('Phường ') for f in selected),'valid_geometries':len(rows),'aoi_area_km2':aoi_area,'uncovered_historical_aoi_km2':area(aoi.difference(union)),'new_wards_outside_historical_aoi_km2':area(union.difference(aoi)),'within_ward_overlap_km2':sum(area(shape(f['geometry'])) for f in selected)-area(union),'bbox':list(aoi.bounds),'needs_review':[r for r in rows if r['needs_review']],'legal_crosswalk_verified':False,'note':'Boundary sources have different vintages and generalization. Do not snap, dissolve, or replace historical province with new province. Full wards preserve original geometry; clipped file is an explicit derivative.'}
write(OUT/'validation.json',report)
write(OUT/'manifest.json',{'source_commit':read(SRC/'repository-tree.json')['sha'],'source_version':read(SRC/'vietnamese-provinces/json/vn_provinces_metadata.json'),'files':[{'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(OUT.iterdir()) if p.is_file() and p.name!='manifest.json']})
print(json.dumps({k:v for k,v in report.items() if k!='needs_review'},ensure_ascii=False,indent=2))
