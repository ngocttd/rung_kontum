// Công cụ không gian dùng dữ liệu OpenStreetMap đã trích xuất (data/processed/osm, Geofabrik):
//  - nearest(): khoảng cách tới khu dân cư (thôn, làng, thị trấn), đường giao thông và cơ sở ứng cứu gần nhất
//  - route(): đường đi ngắn nhất (theo thời gian ước lượng) trên mạng đường OSM, dùng cho cán bộ di chuyển tới điểm
//    cháy/phản ánh trên WebGIS và MobileGIS. Đoạn từ đường gần nhất tới đích (trong rừng, OSM không có đường) trả về
//    riêng là "đi bộ theo đường thẳng".
// Đồ thị rút gọn dựng sẵn bởi scripts/build_road_graph.cjs (road-graph.bin/json); nạp lười một lần.
// Dữ liệu cộng đồng, chưa xác minh hiện trường.
const fs = require('fs');
const path = require('path');
const { paths } = require('../config');

const OSM = path.join(paths.processed, 'osm');
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function dist(a, b) { // haversine (m), a/b = [lon, lat]
  const dLat = rad(b[1] - a[1]); const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const PLACE = { city: 'Thành phố', town: 'Thị trấn', village: 'Làng/xã', hamlet: 'Thôn/làng' };
const FAC = { fire_station: 'Phòng cháy chữa cháy', police: 'Công an', hospital: 'Bệnh viện', clinic: 'Phòng khám/Trạm y tế' };
const HW_LABEL = { motorway: 'cao tốc', trunk: 'quốc lộ', primary: 'đường tỉnh/chính', secondary: 'đường tỉnh/huyện', tertiary: 'đường huyện/xã', unclassified: 'đường xã', road: 'đường', residential: 'đường dân sinh',
  living_street: 'đường khu dân cư', service: 'đường nội bộ', track: 'đường mòn/lâm nghiệp', path: 'lối mòn', footway: 'đường đi bộ', pedestrian: 'đường đi bộ', steps: 'bậc thang', escape: 'đường cứu nạn', bridleway: 'lối mòn', cycleway: 'đường xe đạp' };
const WALK_KMH = 3; // băng rừng
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(OSM, f), 'utf8')); } catch { return { features: [] }; } };
const err = (msg, status) => Object.assign(new Error(msg), { status });

let pois = null;
function loadPois() {
  if (pois) return pois;
  const centroid = (g) => { if (g.type === 'Point') return g.coordinates; const r = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]; const s = r.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]); return [s[0] / r.length, s[1] / r.length]; };
  pois = {
    places: read('places.geojson').features.filter((f) => PLACE[f.properties.place]).map((f) => ({ name: f.properties['name:vi'] || f.properties.name || '(không tên)', kindLabel: PLACE[f.properties.place], c: f.geometry.coordinates })),
    facilities: read('facilities.geojson').features.filter((f) => FAC[f.properties.amenity]).map((f) => ({ name: f.properties['name:vi'] || f.properties.name || FAC[f.properties.amenity], kind: f.properties.amenity, kindLabel: FAC[f.properties.amenity], c: centroid(f.geometry) })),
  };
  return pois;
}

// ---------- đồ thị ----------
const CELL = 0.01;
let G = null;
function graph() {
  if (G) return G;
  const metaPath = path.join(OSM, 'road-graph.json');
  if (!fs.existsSync(metaPath)) throw err('Chưa dựng đồ thị đường (chạy scripts/extract_osm_roads.py rồi scripts/build_road_graph.cjs)', 503);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const buf = fs.readFileSync(path.join(OSM, 'road-graph.bin'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let o = 0;
  const vx = new Float64Array(ab, o, meta.nV * 2); o += meta.nV * 16;
  const ea = new Int32Array(ab, o, meta.nE * 6); o += meta.nE * 24;
  const el = new Float32Array(ab, o, meta.nE); o += meta.nE * 4;
  const ga = new Float64Array(ab, o, meta.nG * 2);
  const speed = meta.classes.map((c) => meta.speeds[c]);
  // danh sách kề dạng CSR: (cạnh, hướng) cho mỗi đỉnh
  const cnt = new Int32Array(meta.nV + 1);
  for (let e = 0; e < meta.nE; e++) { const ow = (ea[e * 6 + 2] >> 8) & 1; cnt[ea[e * 6] + 1]++; if (!ow) cnt[ea[e * 6 + 1] + 1]++; }
  for (let i = 0; i < meta.nV; i++) cnt[i + 1] += cnt[i];
  const adjE = new Int32Array(cnt[meta.nV]); const pos = cnt.slice(0, meta.nV);
  for (let e = 0; e < meta.nE; e++) { const ow = (ea[e * 6 + 2] >> 8) & 1; adjE[pos[ea[e * 6]]++] = e * 2; if (!ow) adjE[pos[ea[e * 6 + 1]]++] = e * 2 + 1; }
  const cost = new Float32Array(meta.nE); for (let e = 0; e < meta.nE; e++) cost[e] = el[e] / (speed[ea[e * 6 + 2] & 255] / 3.6);
  // lưới đoạn để bắt điểm vào đường: ô → [cạnh, chỉ số điểm đầu đoạn]
  const grid = new Map();
  for (let e = 0; e < meta.nE; e++) {
    const g0 = ea[e * 6 + 3]; const n = ea[e * 6 + 4];
    for (let k = 0; k < n - 1; k++) {
      const x = (ga[(g0 + k) * 2] + ga[(g0 + k + 1) * 2]) / 2; const y = (ga[(g0 + k) * 2 + 1] + ga[(g0 + k + 1) * 2 + 1]) / 2;
      const key = Math.floor(x / CELL) * 100000 + Math.floor(y / CELL);
      let a = grid.get(key); if (!a) { a = []; grid.set(key, a); } a.push(e, k);
    }
  }
  G = { meta, vx, ea, el, ga, cnt, adjE, cost, grid, speed };
  return G;
}

function projectOnSeg(p, a, b) {
  const kx = Math.cos(rad(p[1])); const ax = (a[0] - p[0]) * kx; const ay = a[1] - p[1]; const bx = (b[0] - p[0]) * kx; const by = b[1] - p[1];
  const dx = bx - ax; const dy = by - ay; const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return { q: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], t };
}
const gpt = (g, i) => [g.ga[i * 2], g.ga[i * 2 + 1]];
// cạnh gần nhất: { d, point, edge, seg, along (m dọc cạnh từ đầu cạnh), len }
function nearestEdge(p, maxRing = 40) {
  const g = graph();
  const cx = Math.floor(p[0] / CELL); const cy = Math.floor(p[1] / CELL);
  let best = null;
  for (let r = 0; r <= maxRing; r++) {
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
      const a = g.grid.get((cx + i) * 100000 + cy + j); if (!a) continue;
      for (let k = 0; k < a.length; k += 2) {
        const e = a[k]; const s = a[k + 1]; const g0 = g.ea[e * 6 + 3];
        const { q } = projectOnSeg(p, gpt(g, g0 + s), gpt(g, g0 + s + 1)); const d = dist(p, q);
        if (!best || d < best.d) best = { d, point: q, edge: e, seg: s };
      }
    }
    if (best && best.d < (r - 0.5) * CELL * 105000) break;
  }
  if (!best) return null;
  const g0 = g.ea[best.edge * 6 + 3]; let along = 0;
  for (let k = 0; k < best.seg; k++) along += dist(gpt(g, g0 + k), gpt(g, g0 + k + 1));
  along += dist(gpt(g, g0 + best.seg), best.point);
  best.along = along; best.len = g.el[best.edge];
  const cls = g.meta.classes[g.ea[best.edge * 6 + 2] & 255];
  best.highway = cls; best.highwayLabel = HW_LABEL[cls] || cls; best.name = g.meta.names[g.ea[best.edge * 6 + 5]] || null;
  return best;
}

function nearestIn(list, p, n) { return list.map((x) => ({ ...x, d: dist(p, x.c) })).sort((a, b) => a.d - b.d).slice(0, n); }

function nearest(lon, lat) {
  const p = [Number(lon), Number(lat)];
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw err('Toạ độ không hợp lệ', 400);
  const { places, facilities } = loadPois();
  const settle = nearestIn(places, p, 5).map((x) => ({ name: x.name, kind: x.kindLabel, distance_m: Math.round(x.d), lon: x.c[0], lat: x.c[1] }));
  let road = null;
  try { const e = nearestEdge(p); if (e) road = { distance_m: Math.round(e.d), highway: e.highwayLabel, name: e.name, lon: e.point[0], lat: e.point[1] }; } catch { road = null; }
  const fac = Object.keys(FAC).map((k) => nearestIn(facilities.filter((f) => f.kind === k), p, 1)[0]).filter(Boolean)
    .map((x) => ({ name: x.name, kind: x.kindLabel, distance_m: Math.round(x.d), lon: x.c[0], lat: x.c[1] })).sort((a, b) => a.distance_m - b.distance_m);
  return { point: { lon: p[0], lat: p[1] }, settlements: settle, road, facilities: fac,
    source: 'OpenStreetMap (Geofabrik) – dữ liệu cộng đồng, chưa xác minh hiện trường; khoảng cách đường chim bay' };
}

// Dijkstra (heap nhị phân) từ nhiều nguồn tới nhiều đích (đỉnh, chi phí cộng thêm)
function shortest(srcs, dsts) {
  const g = graph(); const n = g.meta.nV;
  const best = new Float64Array(n).fill(Infinity); const prevE = new Int32Array(n).fill(-1);
  const hd = []; const hv = [];
  const push = (d, v) => { hd.push(d); hv.push(v); let i = hd.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hd[p] <= hd[i]) break; [hd[p], hd[i]] = [hd[i], hd[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
  const pop = () => { const d = hd[0]; const v = hv[0]; const ld = hd.pop(); const lv = hv.pop(); if (hd.length) { hd[0] = ld; hv[0] = lv; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < hd.length && hd[l] < hd[m]) m = l; if (r < hd.length && hd[r] < hd[m]) m = r; if (m === i) break; [hd[m], hd[i]] = [hd[i], hd[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return [d, v]; };
  const tgt = new Map(); for (const t of dsts) if (!tgt.has(t.v) || tgt.get(t.v) > t.extra) tgt.set(t.v, t.extra);
  for (const s of srcs) if (s.extra < best[s.v]) { best[s.v] = s.extra; push(s.extra, s.v); }
  let done = -1; let doneCost = Infinity;
  while (hd.length) {
    const [d, v] = pop();
    if (d > best[v]) continue;
    if (d >= doneCost) break;
    if (tgt.has(v) && d + tgt.get(v) < doneCost) { doneCost = d + tgt.get(v); done = v; }
    for (let k = g.cnt[v]; k < g.cnt[v + 1]; k++) {
      const ed = g.adjE[k]; const e = ed >> 1; const w = (ed & 1) ? g.ea[e * 6] : g.ea[e * 6 + 1];
      const nd = d + g.cost[e];
      if (nd < best[w]) { best[w] = nd; prevE[w] = ed; push(nd, w); }
    }
  }
  if (done < 0) return null;
  const steps = []; for (let v = done; prevE[v] >= 0;) { const ed = prevE[v]; steps.push(ed); const e = ed >> 1; v = (ed & 1) ? g.ea[e * 6 + 1] : g.ea[e * 6]; if (steps.length > 1e6) break; }
  return { steps: steps.reverse(), end: done, cost: doneCost };
}

// hình học một phần cạnh từ vị trí a tới b (m dọc cạnh; a > b = đi ngược)
function edgeCoords(e, fromM, toM) {
  const g = graph(); const g0 = g.ea[e * 6 + 3]; const n = g.ea[e * 6 + 4];
  const rev = fromM > toM; const lo = Math.min(fromM, toM); const hi = Math.max(fromM, toM);
  const out = []; let acc = 0;
  for (let k = 0; k < n - 1; k++) {
    const a = gpt(g, g0 + k); const b = gpt(g, g0 + k + 1); const L = dist(a, b);
    const s = Math.max(lo, acc); const t = Math.min(hi, acc + L);
    if (t >= s && L > 0) {
      const pa = [a[0] + (b[0] - a[0]) * ((s - acc) / L), a[1] + (b[1] - a[1]) * ((s - acc) / L)];
      const pb = [a[0] + (b[0] - a[0]) * ((t - acc) / L), a[1] + (b[1] - a[1]) * ((t - acc) / L)];
      if (!out.length) out.push(pa); out.push(pb);
    }
    acc += L;
  }
  return rev ? out.reverse() : out;
}

function route(from, to) {
  const A = from.map(Number); const B = to.map(Number);
  if (![...A, ...B].every(Number.isFinite)) throw err('Toạ độ không hợp lệ', 400);
  if (dist(A, B) > 300000) throw err('Khoảng cách quá xa (> 300 km)', 400);
  const g = graph();
  const ra = nearestEdge(A, 80); const rb = nearestEdge(B, 80);
  if (!ra || !rb) throw err('Không tìm thấy đường giao thông gần điểm đi/điểm đến', 404);
  const walk = (m) => m / (WALK_KMH / 3.6);
  const v0 = (e) => g.ea[e * 6]; const v1 = (e) => g.ea[e * 6 + 1];
  const ow = (e) => (g.ea[e * 6 + 2] >> 8) & 1;
  const sec = (e, m) => m / (g.speed[g.ea[e * 6 + 2] & 255] / 3.6);
  const parts = []; let roadM = 0; let secs = 0;
  if (ra.edge === rb.edge && (!ow(ra.edge) || rb.along >= ra.along)) {
    parts.push(...edgeCoords(ra.edge, ra.along, rb.along)); roadM = Math.abs(rb.along - ra.along); secs = sec(ra.edge, roadM);
  } else {
    const srcs = [{ v: v1(ra.edge), extra: sec(ra.edge, ra.len - ra.along) }];
    if (!ow(ra.edge)) srcs.push({ v: v0(ra.edge), extra: sec(ra.edge, ra.along) });
    const dsts = [{ v: v0(rb.edge), extra: sec(rb.edge, rb.along) }];
    if (!ow(rb.edge)) dsts.push({ v: v1(rb.edge), extra: sec(rb.edge, rb.len - rb.along) });
    const sp = shortest(srcs, dsts);
    if (!sp) throw err('Không có đường nối giữa hai điểm trên mạng đường OSM', 404);
    const first = sp.steps.length ? ((sp.steps[0] & 1) ? v1(sp.steps[0] >> 1) : v0(sp.steps[0] >> 1)) : sp.end;
    if (first === v1(ra.edge) && (ow(ra.edge) || ra.len - ra.along <= ra.along || first !== v0(ra.edge))) { parts.push(...edgeCoords(ra.edge, ra.along, ra.len)); roadM += ra.len - ra.along; } else { parts.push(...edgeCoords(ra.edge, ra.along, 0)); roadM += ra.along; }
    for (const ed of sp.steps) { const e = ed >> 1; const L = g.el[e]; parts.push(...((ed & 1) ? edgeCoords(e, L, 0) : edgeCoords(e, 0, L))); roadM += L; }
    if (sp.end === v0(rb.edge) && (ow(rb.edge) || rb.along <= rb.len - rb.along || sp.end !== v1(rb.edge))) { parts.push(...edgeCoords(rb.edge, 0, rb.along)); roadM += rb.along; } else { parts.push(...edgeCoords(rb.edge, rb.len, rb.along)); roadM += rb.len - rb.along; }
    secs = sp.cost;
  }
  const walkStart = Math.round(ra.d); const walkEnd = Math.round(rb.d);
  secs += walk(walkStart + walkEnd);
  const clean = parts.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  const line = (c, props) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: props });
  return {
    type: 'FeatureCollection',
    features: [
      ...(clean.length > 1 ? [line(clean, { kind: 'road', distance_m: Math.round(roadM) })] : []),
      ...(walkStart > 5 ? [line([A, ra.point], { kind: 'walk', distance_m: walkStart })] : []),
      ...(walkEnd > 5 ? [line([rb.point, B], { kind: 'walk', distance_m: walkEnd })] : []),
    ],
    summary: {
      distance_m: Math.round(roadM + walkStart + walkEnd), road_m: Math.round(roadM), walk_start_m: walkStart, walk_end_m: walkEnd, duration_min: Math.max(1, Math.round(secs / 60)),
      start_road: ra.name || ra.highwayLabel, end_road: rb.name || rb.highwayLabel,
      note: 'Tính trên mạng đường OpenStreetMap (dữ liệu cộng đồng); thời gian ước lượng theo cấp đường, đoạn không có đường tính đi bộ 3 km/h theo đường thẳng. Cần kiểm tra thực tế (đường đất, mùa mưa).',
    },
  };
}

module.exports = { nearest, route, dist, graph };
