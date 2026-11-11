// Dựng đồ thị đường rút gọn cho tìm đường (src/services/geotools.js) từ data/processed/osm/road-network.geojson:
// chỉ giữ nút giao/đầu mút làm đỉnh, mỗi chuỗi nút bậc 2 thành một cạnh có hình học riêng. Ghi dạng nhị phân
// (road-graph.bin + road-graph.json) để máy chủ nạp nhanh, ít bộ nhớ.
// Usage: node scripts/build_road_graph.cjs
const fs = require('fs');
const path = require('path');
const OSM = path.join(__dirname, '..', 'data', 'processed', 'osm');
const SPEED = { motorway: 80, motorway_link: 50, trunk: 60, trunk_link: 40, primary: 55, primary_link: 35, secondary: 45, secondary_link: 30, tertiary: 35, tertiary_link: 25,
  unclassified: 25, road: 25, residential: 20, living_street: 10, service: 15, track: 12, path: 4, footway: 4, pedestrian: 4, steps: 2, escape: 10, bridleway: 4, cycleway: 10 };
const CLASS = Object.keys(SPEED);
const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => { const dLat = rad(b[1] - a[1]); const dLon = rad(b[0] - a[0]); const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h))); };

const fc = JSON.parse(fs.readFileSync(path.join(OSM, 'road-network.geojson'), 'utf8'));
const idOf = new Map(); const pts = []; const deg = [];
const nid = (c) => { const k = `${c[0]},${c[1]}`; let i = idOf.get(k); if (i === undefined) { i = pts.length; idOf.set(k, i); pts.push(c); deg.push(0); } return i; };
const ways = [];
for (const f of fc.features) {
  const hw = f.properties.highway; if (!SPEED[hw]) continue;
  const ids = f.geometry.coordinates.map(nid).filter((v, i, a) => i === 0 || v !== a[i - 1]);
  if (ids.length < 2) continue;
  ways.push({ ids, cls: CLASS.indexOf(hw), oneway: f.properties.oneway === 'yes' || f.properties.oneway === '1', name: f.properties.ref || f.properties.name || '' });
  // bậc tính theo số lần xuất hiện (giữa đường = 2, đầu mút = 1); điểm chung của nhiều đường > 2
  ids.forEach((v, i) => { deg[v] += i === 0 || i === ids.length - 1 ? 1 : 2; });
}
// đỉnh = đầu mút đường hoặc nút dùng chung (bậc ≠ 2), cắt đường tại các đỉnh
const vid = new Int32Array(pts.length).fill(-1); const V = [];
const isV = (v) => deg[v] !== 2;
for (const w of ways) for (let i = 0; i < w.ids.length; i++) { const v = w.ids[i]; if ((i === 0 || i === w.ids.length - 1 || isV(v)) && vid[v] < 0) { vid[v] = V.length; V.push(v); } }
const names = ['']; const nameIdx = new Map([['', 0]]);
const E = []; const geom = [];
for (const w of ways) {
  let start = 0;
  for (let i = 1; i < w.ids.length; i++) {
    if (vid[w.ids[i]] < 0) continue;
    let len = 0; const g0 = geom.length / 2;
    for (let k = start; k <= i; k++) { const p = pts[w.ids[k]]; geom.push(p[0], p[1]); if (k > start) len += dist(pts[w.ids[k - 1]], p); }
    if (!nameIdx.has(w.name)) { nameIdx.set(w.name, names.length); names.push(w.name); }
    E.push([vid[w.ids[start]], vid[w.ids[i]], len, w.cls, w.oneway ? 1 : 0, g0, i - start + 1, nameIdx.get(w.name)]);
    start = i;
  }
}
const nV = V.length; const nE = E.length; const nG = geom.length / 2;
const vx = new Float64Array(nV * 2); V.forEach((v, i) => { vx[2 * i] = pts[v][0]; vx[2 * i + 1] = pts[v][1]; });
const ea = new Int32Array(nE * 6); const el = new Float32Array(nE);
E.forEach((e, i) => { ea.set([e[0], e[1], e[3] | (e[4] << 8), e[5], e[6], e[7]], i * 6); el[i] = e[2]; });
const ga = new Float64Array(geom);
const parts = [vx, ea, el, ga].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
fs.writeFileSync(path.join(OSM, 'road-graph.bin'), Buffer.concat(parts));
fs.writeFileSync(path.join(OSM, 'road-graph.json'), JSON.stringify({ source: fc.source, built_at: new Date().toISOString(), nV, nE, nG, classes: CLASS, speeds: SPEED, names,
  layout: ['vertices f64[nV*2]', 'edges i32[nE*6]: from,to,class|oneway<<8,geomStart,geomCount,name', 'length f32[nE]', 'geometry f64[nG*2]'] }));
console.log(JSON.stringify({ ok: true, vertices: nV, edges: nE, geometry_points: nG, bytes: parts.reduce((a, b) => a + b.length, 0) }));
