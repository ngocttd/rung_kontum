"""Đọc dữ liệu MapInfo (bộ .TAB/.DAT/.MAP/.ID hoặc cặp .MIF/.MID) → GeoJSON WGS84, giữ nguyên mọi trường thuộc tính.
  python mapinfo_to_geojson.py <tệp .tab|.mif> <out.geojson>
Hệ toạ độ đọc từ khai báo CoordSys của tệp (kể cả VN-2000 khai báo 7 tham số trong MapInfo); bảng "NonEarth" (không có hệ toạ độ) trả về
toạ độ gốc kèm cờ nonearth để bước sau áp hệ toạ độ người dùng chọn. Chạy riêng tiến trình (thư viện fiona/GDAL-OGR).
In JSON: {ok, count, crs, nonearth, fields}."""
import sys, json
try:
    import fiona
    from fiona.transform import transform_geom
except Exception as e:  # noqa
    print(json.dumps(dict(ok=False, error='Máy chủ chưa cài thư viện đọc MapInfo (fiona). Chạy: pip install -r requirements.txt'), ensure_ascii=False)); sys.exit(2)
src, out = sys.argv[1], sys.argv[2]
try:
    feats = []
    with fiona.open(src) as c:
        crs = c.crs; wkt = c.crs_wkt or ''
        nonearth = (not crs) or 'LOCAL_CS' in wkt or 'Nonearth' in wkt or 'NonEarth' in wkt
        label = 'MapInfo – không khai báo'
        try:
            d = crs.to_dict() if crs else {}
            if d.get('proj') == 'tmerc':
                lon0 = float(d.get('lon_0', 0)); k = float(d.get('k', d.get('k_0', 1))); dg = int(lon0); mn = round((lon0 - dg) * 60)
                label = f"đọc từ tệp MapInfo: Transverse Mercator, kinh tuyến trục {dg}°{mn:02d}′, k₀ = {k:g} ({'múi 3°' if abs(k - 0.9999) < 1e-6 else 'múi 6°' if abs(k - 0.9996) < 1e-6 else 'hệ số riêng'})"
            elif d.get('proj') == 'longlat': label = 'đọc từ tệp MapInfo: kinh độ, vĩ độ'
            elif d.get('proj') == 'utm': label = f"đọc từ tệp MapInfo: UTM múi {d.get('zone')}"
            elif d: label = 'đọc từ tệp MapInfo: ' + str(d.get('proj') or d.get('init') or 'hệ toạ độ khai báo trong tệp')
        except Exception: label = 'đọc từ tệp MapInfo'
        fields = list(c.schema.get('properties', {}).keys())
        for f in c:
            if f.geometry is None: continue
            gi = lambda x: x.__geo_interface__ if hasattr(x, '__geo_interface__') else dict(x)
            g0 = gi(f.geometry); g = g0
            if not nonearth:
                g = gi(transform_geom(crs, 'EPSG:4326', f.geometry, precision=7))
                if not g.get('type'): g = dict(type=g0.get('type'), coordinates=g.get('coordinates'))  # một số bản fiona trả về thiếu 'type'
            g = json.loads(json.dumps(g))  # tuple → list
            if g.get('type') not in ('Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon') or not g.get('coordinates'): continue
            feats.append(dict(type='Feature', geometry=dict(type=g['type'], coordinates=g['coordinates']), properties={k: (v if isinstance(v, (int, float, str, bool)) or v is None else str(v)) for k, v in dict(f.properties).items()}))
    with open(out, 'w', encoding='utf-8') as fo: json.dump(dict(type='FeatureCollection', features=feats), fo, ensure_ascii=False)
    print(json.dumps(dict(ok=True, count=len(feats), crs=label, nonearth=bool(nonearth), fields=fields), ensure_ascii=False))
except Exception as e:  # noqa
    print(json.dumps(dict(ok=False, error=f'Không đọc được tệp MapInfo: {type(e).__name__}: {e}'), ensure_ascii=False)); sys.exit(2)
