"""Trích mạng đường đầy đủ (giữ nguyên nút OSM, không cắt) từ tệp PBF Geofabrik cho chức năng tìm đường ngắn nhất.
Bản trích chung (extract_osm.py) bỏ sót ~8.500 đường do lỗi hình học/vị trí nút, làm mạng đường đứt đoạn.
Ra: data/processed/osm/road-network.geojson – mọi way có highway thuộc nhóm xe/đi bộ, có ít nhất một nút trong
khung Kon Tum mở rộng 0,1°, toạ độ nút giữ nguyên (6 chữ số) nên các đường nối đúng tại nút chung."""
import sys, json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/osm'))
import osmium

W, S, E, N = 107.33 - 0.1, 13.91 - 0.1, 108.56 + 0.1, 15.43 + 0.1
KEEP = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link',
        'unclassified', 'residential', 'living_street', 'service', 'track', 'path', 'footway', 'pedestrian', 'steps', 'escape', 'road', 'bridleway', 'cycleway'}
feats = []; skipped = 0


class H(osmium.SimpleHandler):
    def way(self, w):
        global skipped
        hw = w.tags.get('highway')
        if hw not in KEEP: return
        coords = []
        for n in w.nodes:
            try:
                loc = n.location
                if not loc.valid(): continue
                coords.append([round(loc.lon, 6), round(loc.lat, 6)])
            except Exception:
                continue
        if len(coords) < 2: skipped += 1; return
        if not any(W <= x <= E and S <= y <= N for x, y in coords): return
        feats.append(dict(type='Feature', geometry=dict(type='LineString', coordinates=coords),
                          properties=dict(osm_id=str(w.id), highway=hw, name=w.tags.get('name'), ref=w.tags.get('ref'), oneway=w.tags.get('oneway'))))


H().apply_file(str(ROOT / 'data/collected/osm/vietnam-261015.osm.pbf'), locations=True, idx='flex_mem')
out = ROOT / 'data/processed/osm/road-network.geojson'
out.write_text(json.dumps(dict(type='FeatureCollection', source='OpenStreetMap / Geofabrik 2026-10-15 (ODbL)', bbox=[W, S, E, N], features=feats),
                          ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(json.dumps(dict(ok=True, ways=len(feats), skipped=skipped, bytes=out.stat().st_size)))
