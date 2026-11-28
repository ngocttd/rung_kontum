// Vùng khoanh vẽ trên web: cán bộ khoanh vùng nghi vấn (mất rừng, cháy, lấn chiếm…) khi giải đoán ảnh vệ tinh,
// lưu kèm diện tích – xã, xuất ra tệp (GeoJSON/KML/Shapefile/Excel theo hệ toạ độ chọn) và giao kiểm tra hiện trường (MobileGIS).
const store = require('../data/store');
const repo = require('../data/repo');

const KINDS = { forest_loss: 'Nghi vấn mất rừng', fire: 'Nghi vấn cháy rừng', encroach: 'Nghi vấn lấn chiếm đất rừng', logging: 'Nghi vấn khai thác trái phép', check: 'Cần kiểm tra hiện trạng', other: 'Khác' };
const STATUS = { new: ['b-orange', 'Mới khoanh'], assigned: ['b-blue', 'Đã giao kiểm tra'], verified: ['b-purple', 'Đã xác nhận'], rejected: ['b-gray', 'Không có vi phạm'], closed: ['b-green', 'Đã xử lý xong'] };
class InputError extends Error {}

const R = 6378137;
function ringArea(ring) { // diện tích trên mặt cầu (m²)
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]; const [x2, y2] = ring[i + 1];
    a += ((x2 - x1) * Math.PI / 180) * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180));
  }
  return Math.abs(a * R * R / 2);
}
const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
function areaHa(g) { return polys(g).reduce((s, p) => s + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0) / 1e4; }
function centroid(g) {
  const p = polys(g).sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0];
  if (!p) return null;
  const r = p[0].slice(0, -1);
  return [r.reduce((s, c) => s + c[0], 0) / r.length, r.reduce((s, c) => s + c[1], 0) / r.length];
}
function cleanGeom(g) {
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) throw new InputError('Vùng khoanh phải là đa giác.');
  const fix = (ring) => {
    const r = ring.map((c) => [Number(Number(c[0]).toFixed(7)), Number(Number(c[1]).toFixed(7))]);
    if (r.some(([x, y]) => !(x >= 102 && x <= 110 && y >= 8 && y <= 24))) throw new InputError('Toạ độ nằm ngoài phạm vi – kiểm tra hệ toạ độ.');
    if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]);
    if (r.length < 4) throw new InputError('Vùng khoanh cần ít nhất 3 đỉnh.');
    return r;
  };
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: g.coordinates.map(fix) } : { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(fix)) };
}

function create(user, b) {
  const geometry = cleanGeom(b.geometry);
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) throw new InputError('Nhập tên vùng khoanh.');
  const c = centroid(geometry); const cm = c ? repo.communeAt(c[0], c[1]) : null;
  const z = store.insert('zones', { code: store.nextCode('KV'), title, kind: KINDS[b.kind] ? b.kind : 'forest_loss', status: 'new', note: String(b.note || '').slice(0, 1000),
    commune_code: cm ? cm.code : null, commune_name: cm ? cm.fullName : null, area_ha: Number(areaHa(geometry).toFixed(2)), created_by: user.username, geometry,
    lon: c ? Number(c[0].toFixed(6)) : null, lat: c ? Number(c[1].toFixed(6)) : null, source_image: String(b.source_image || '').slice(0, 200), history: [{ at: store.now(), by: user.username, status: 'new', note: 'Khoanh vùng' }] });
  store.audit(user, 'zone.create', z.code, { area_ha: z.area_ha, commune: z.commune_name });
  return z;
}
function update(user, id, b) {
  const z = store.get('zones', id);
  if (!z) throw new InputError('Không tìm thấy vùng khoanh.');
  const patch = {};
  if (b.title !== undefined) patch.title = String(b.title).trim().slice(0, 200) || z.title;
  if (b.note !== undefined) patch.note = String(b.note).slice(0, 1000);
  if (b.kind && KINDS[b.kind]) patch.kind = b.kind;
  if (b.status && STATUS[b.status] && b.status !== z.status) { patch.status = b.status; patch.history = [...(z.history || []), { at: store.now(), by: user.username, status: b.status, note: String(b.status_note || '').slice(0, 300) }]; }
  store.update('zones', id, patch); store.audit(user, 'zone.update', z.code, patch.status ? { status: patch.status } : undefined);
  return store.get('zones', id);
}
function remove(user, id) { const z = store.get('zones', id); if (!z) return; store.remove('zones', id); store.audit(user, 'zone.delete', z.code); }
function list(filter = {}) {
  return store.all('zones').filter((z) => (!filter.status || z.status === filter.status) && (!filter.kind || z.kind === filter.kind) && (!filter.communes || !z.commune_code || filter.communes.includes(String(z.commune_code))))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
function feature(z) {
  return { type: 'Feature', geometry: z.geometry, properties: { code: z.code, name: z.title, loai: KINDS[z.kind], trang_thai: (STATUS[z.status] || [])[1], xa: z.commune_name, dien_tich_ha: z.area_ha, ghi_chu: z.note || '', nguoi_khoanh: z.created_by,
    ngay_khoanh: String(z.created_at).slice(0, 10), nhiem_vu: z.assignment_code || '', id: z.id, status: z.status, kind: z.kind } };
}
const collection = (zs) => ({ type: 'FeatureCollection', features: zs.filter((z) => z.geometry).map(feature) });

// giao kiểm tra hiện trường: tạo nhiệm vụ khảo sát (MobileGIS) tại tâm vùng, kèm mã vùng và diện tích trong hướng dẫn
async function assign(user, id, { assignee_id: assignee, due_at: due, instructions }) {
  const z = store.get('zones', id);
  if (!z) throw new InputError('Không tìm thấy vùng khoanh.');
  const field = require('./field');
  const a = await field.createAssignment(user, { kind: 'survey', title: `Kiểm tra hiện trường vùng khoanh ${z.code}: ${z.title}`.slice(0, 300),
    instructions: [`${KINDS[z.kind]} – diện tích khoanh ${z.area_ha} ha${z.commune_name ? `, ${z.commune_name}` : ''}.`, z.note, instructions, `Tâm vùng: ${z.lat}, ${z.lon}. Ranh vùng khoanh xem trên web quản trị (Khoanh vùng › ${z.code}) hoặc tệp KML đính kèm nhiệm vụ.`].filter(Boolean).join('\n'),
    assignee_id: assignee || null, due_at: due || null, lat: z.lat, lon: z.lon, scope_id: z.commune_code || null });
  store.update('zones', id, { status: 'assigned', assignment_id: a.id, assignment_code: a.code, history: [...(z.history || []), { at: store.now(), by: user.username, status: 'assigned', note: `Giao nhiệm vụ ${a.code}` }] });
  return a;
}

module.exports = { KINDS, STATUS, InputError, create, update, remove, list, feature, collection, assign, areaHa, centroid };
