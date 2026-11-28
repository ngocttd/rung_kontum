// Chủ rừng và thông báo gửi chủ rừng.
// Khi phát hiện điểm nóng/cháy, vùng biến động nghi vấn hay vùng khoanh nghi mất rừng, kiểm lâm bấm “Báo chủ rừng”:
//  1) hệ thống xác định chủ rừng của vị trí: theo LỚP BẢN ĐỒ CHỦ RỪNG (lớp vector đã nhập – kiểm kê/hiện trạng – có trường tên chủ rừng,
//     tra bằng truy vấn không gian trong PostGIS), nếu không có thì theo XÃ mà chủ rừng được khai báo phụ trách;
//  2) tạo thông báo (mã TB-…) kèm liên kết riêng để chủ rừng mở xem vị trí, xác nhận đã nhận và phản hồi kết quả kiểm tra – không cần tài khoản;
//  3) nếu chủ rừng có tài khoản liên kết thì nhận thêm thông báo đẩy trên MobileGIS.
// Hệ thống không tự gửi SMS/email: kiểm lâm sao chép nội dung + liên kết để gửi qua kênh sẵn có (điện thoại, Zalo, email) và ghi nhận đã báo.
const crypto = require('crypto');
const store = require('../data/store');
const repo = require('../data/repo');
const db = require('../db/pool');

const KINDS = { bql: 'Ban quản lý rừng (đặc dụng, phòng hộ)', company: 'Công ty / tổ chức kinh tế', commune: 'UBND xã, phường', community: 'Cộng đồng dân cư', household: 'Hộ gia đình, cá nhân', force: 'Lực lượng vũ trang', other: 'Khác' };
const STATUS = { sent: ['b-orange', 'Đã gửi – chờ chủ rừng xem'], seen: ['b-blue', 'Chủ rừng đã mở xem'], acknowledged: ['b-blue', 'Chủ rừng đã xác nhận'], responded: ['b-green', 'Chủ rừng đã phản hồi kết quả'], closed: ['b-gray', 'Đã đóng'] };
const OBJ = { hotspot: 'Điểm nóng / điểm cháy', candidate: 'Vùng biến động nghi vấn (nghi mất rừng)', zone: 'Vùng khoanh trên bản đồ', other: 'Khác' };
class InputError extends Error {}
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const csv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

function list() { return store.all('forest_owners').slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')); }
function save(user, id, b) {
  const name = String(b.name || '').trim().slice(0, 200);
  if (!name) throw new InputError('Nhập tên chủ rừng.');
  const phone = String(b.phone || '').replace(/[^\d+ ]/g, '').slice(0, 20); const email = String(b.email || '').trim().slice(0, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new InputError('Email không hợp lệ.');
  const communes = require('../lib/scope').normalize(b.communes);
  const acc = b.username ? store.find('users', (u) => u.username === String(b.username).trim().toLowerCase() && u.active) : null;
  if (b.username && !acc) throw new InputError('Không tìm thấy tài khoản liên kết (nhập đúng tên đăng nhập đang hoạt động).');
  const rec = { name, kind: KINDS[b.kind] ? b.kind : 'other', contact_name: String(b.contact_name || '').slice(0, 120), phone: phone || null, email: email || null, communes, user_id: acc ? acc.id : null,
    active: b.active !== '0', aliases: String(b.aliases || '').slice(0, 400), note: String(b.note || '').slice(0, 500) };
  const row = id ? store.update('forest_owners', id, rec) : store.insert('forest_owners', rec);
  store.audit(user, id ? 'owner.update' : 'owner.create', name);
  return row;
}
function remove(user, id) { const o = store.get('forest_owners', id); if (!o) return; store.remove('forest_owners', id); store.audit(user, 'owner.delete', o.name); }

// lớp bản đồ chủ rừng: lớp vector đã công bố/chờ duyệt mà quản trị chỉ định trường chứa tên chủ rừng (style.owner_field)
function ownerLayers() { return store.all('layers').filter((l) => l.status !== 'invalid' && l.style && l.style.owner_field); }
function setOwnerField(user, layerId, field) {
  const l = store.get('layers', layerId); if (!l) throw new InputError('Không tìm thấy lớp.');
  const style = { ...(l.style || {}) };
  if (field && ((l.validation || {}).fields || []).some((f) => f.name === field)) style.owner_field = field; else delete style.owner_field;
  store.update('layers', layerId, { style }); store.audit(user, 'layer.owner_field', l.title, { field: style.owner_field || null });
}
// tên chủ rừng tại một điểm theo các lớp bản đồ chủ rừng (PostGIS; lớp nhỏ đã nằm trong bảng layer_features như lớp lớn)
async function namesAt(lon, lat) {
  const out = [];
  if (!db.enabled || !Number.isFinite(lon) || !Number.isFinite(lat)) return out;
  for (const l of ownerLayers()) {
    const r = await db.query(`SELECT props FROM spatial.layer_features WHERE layer_id = $1 AND ST_Intersects(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)) LIMIT 3`, [l.id, lon, lat]).catch(() => ({ rows: [] }));
    for (const x of r.rows) { const v = x.props && x.props[l.style.owner_field]; if (v !== null && v !== undefined && String(v).trim()) out.push({ name: String(v).trim(), layer: l.title, props: x.props }); }
  }
  return out;
}
// chủ rừng liên quan tới một vị trí: [{ owner | null, name, reason }]
async function findFor({ lon, lat, commune }) {
  const all = list().filter((o) => o.active !== false); const res = []; const seen = new Set();
  const add = (owner, name, reason, extra) => { const k = owner ? owner.id : `raw:${norm(name)}`; if (seen.has(k)) return; seen.add(k); res.push({ owner, name: owner ? owner.name : name, reason, ...extra }); };
  for (const n of await namesAt(Number(lon), Number(lat))) {
    const key = norm(n.name);
    const o = all.find((x) => norm(x.name) === key || csv(x.aliases).some((a) => norm(a) === key)) || all.find((x) => key.length >= 5 && (norm(x.name).includes(key) || key.includes(norm(x.name))));
    add(o || null, n.name, `Theo lớp bản đồ “${n.layer}”`, { props: n.props, unregistered: !o });
  }
  const code = commune || (Number.isFinite(Number(lon)) ? (repo.communeAt(Number(lon), Number(lat)) || {}).code : null);
  if (code) for (const o of all.filter((x) => csv(x.communes).includes(String(code)))) add(o, o.name, 'Theo xã phụ trách đã khai báo');
  return res;
}

// đối tượng cần báo → vị trí, mô tả
function target(kind, ref) {
  if (kind === 'hotspot') { const h = repo.hotspots({ staff: true }).find((x) => x.id === ref); return h && { lon: h.lon, lat: h.lat, commune: h.communeCode, commune_name: h.commune, title: `${h.manual ? `Điểm cháy báo tin ${h.manual.code}` : `Điểm nóng vệ tinh ${h.sensorLabel || ''}`}${h.commune ? ` tại ${h.commune}` : ''}`, detail: `Phát hiện: ${h.datetime || h.acq_datetime || ''}. Trạng thái: ${h.statusLabel || h.status || 'chưa xác minh'}.`, incident: 'cháy rừng' }; }
  if (kind === 'candidate') { const f = repo.changeCandidates({ staff: true }).features.find((x) => String(x.properties.id) === String(ref)); if (!f) return null; const p = f.properties;
    return { lon: p.lon, lat: p.lat, commune: p.commune_code, commune_name: p.commune_name, area_ha: p.area_ha, geometry: f.geometry, title: `Vùng nghi vấn biến động rừng ${p.id}${p.commune_name ? ` tại ${p.commune_name}` : ''}`, detail: `Diện tích khoảng ${p.area_ha} ha; ${p.kind === 'treeloss' ? `mất tán cây năm ${p.loss_years} (Hansen)` : `kỳ ${p.window}, ΔNDVI ${p.mean_dndvi}`}.`, incident: 'mất rừng' }; }
  if (kind === 'zone') { const z = store.get('zones', ref) || store.find('zones', (x) => x.code === ref); const zones = require('./zones');
    return z && { lon: z.lon, lat: z.lat, commune: z.commune_code, commune_name: z.commune_name, area_ha: z.area_ha, geometry: z.geometry, title: `${zones.KINDS[z.kind]} – vùng khoanh ${z.code}: ${z.title}`, detail: `Diện tích khoanh ${z.area_ha} ha. ${z.note || ''}`.trim(), incident: z.kind === 'fire' ? 'cháy rừng' : 'mất rừng' }; }
  return null;
}
function defaultMessage(t) {
  return `Hạt Kiểm lâm thông báo: phát hiện dấu hiệu nghi ${t.incident} trong khu vực do đơn vị quản lý – ${t.title}. ${t.detail} Vị trí (WGS84): ${Number(t.lat).toFixed(5)}, ${Number(t.lon).toFixed(5)}. Đề nghị chủ rừng kiểm tra hiện trường và phản hồi kết quả. Thông tin từ ảnh vệ tinh là NGHI VẤN, cần xác minh.`;
}

async function notify(user, { kind, ref, owner_ids: ownerIds, extra_name: extraName, message, due }, baseUrl) {
  const t = target(kind, ref);
  if (!t) throw new InputError('Không tìm thấy đối tượng cần báo.');
  const ids = [].concat(ownerIds || []).filter(Boolean);
  const owners = ids.map((i) => store.get('forest_owners', i)).filter(Boolean).map((o) => ({ owner: o, name: o.name }));
  if (extraName && String(extraName).trim()) owners.push({ owner: null, name: String(extraName).trim().slice(0, 200) });
  if (!owners.length) throw new InputError('Chọn ít nhất một chủ rừng (hoặc nhập tên chủ rừng chưa có trong danh bạ).');
  const text = String(message || defaultMessage(t)).slice(0, 2000); const out = [];
  for (const { owner, name } of owners) {
    const token = crypto.randomBytes(18).toString('base64url');
    const n = store.insert('owner_notices', { code: store.nextCode('TB'), owner_id: owner ? owner.id : null, owner_name: name, kind, ref_id: String(ref), title: t.title.slice(0, 300), status: 'sent', token, commune_code: t.commune || null, sent_by: user.username,
      message: text, lon: t.lon, lat: t.lat, commune_name: t.commune_name || null, area_ha: t.area_ha || null, geometry: t.geometry || null, due: /^\d{4}-\d{2}-\d{2}$/.test(String(due || '')) ? due : null, contact: owner ? { name: owner.contact_name, phone: owner.phone, email: owner.email } : null,
      history: [{ at: store.now(), by: user.username, status: 'sent', note: 'Tạo thông báo gửi chủ rừng' }] });
    // tài khoản liên kết → thông báo đẩy trong MobileGIS
    if (owner && owner.user_id) { try { await require('./notifier').create({ source_ref: `owner-notice:${n.id}`, kind: 'system', title: `Kiểm lâm báo: nghi ${t.incident}`, body: `${t.title}. Mở liên kết để xem vị trí và phản hồi.`, data: { screen: 'link', url: `${baseUrl}/thong-bao-chu-rung/${token}`, code: n.code }, target_user: owner.user_id, priority: 'high' }); } catch (e) { console.warn('[owners] push', e.message); } }
    store.audit(user, 'owner.notify', n.code, { owner: name, kind, ref });
    out.push(n);
  }
  return out;
}
const notices = (f = {}) => store.all('owner_notices').filter((n) => (!f.status || n.status === f.status) && (!f.communes || !n.commune_code || f.communes.includes(String(n.commune_code)))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
const byToken = (t) => (/^[\w-]{16,40}$/.test(String(t || '')) ? store.find('owner_notices', (n) => n.token === t) : null);
const forRef = (kind, ref) => store.all('owner_notices').filter((n) => n.kind === kind && String(n.ref_id) === String(ref));
function touch(n, status, by, note, patch = {}) {
  const order = ['sent', 'seen', 'acknowledged', 'responded', 'closed'];
  const next = order.indexOf(status) > order.indexOf(n.status) || status === 'closed' ? status : n.status;
  return store.update('owner_notices', n.id, { ...patch, status: next, history: [...(n.history || []), { at: store.now(), by, status, note: String(note || '').slice(0, 300) }] });
}
// chủ rừng mở liên kết / xác nhận / phản hồi
function ownerOpen(n) { return n.status === 'sent' ? touch(n, 'seen', 'chủ rừng', 'Mở liên kết thông báo') : n; }
function ownerRespond(n, b) {
  const result = { none: 'Không phát hiện vi phạm', confirmed: 'Có mất rừng / cháy rừng', legal: 'Khai thác, tác động hợp pháp (có hồ sơ)', other: 'Khác' }[b.result];
  const text = String(b.response || '').trim().slice(0, 2000);
  if (b.action === 'ack') return touch(n, 'acknowledged', n.owner_name, 'Chủ rừng xác nhận đã nhận thông báo', { ack_at: store.now(), ack_by: String(b.person || '').slice(0, 120) });
  if (!result || text.length < 5) throw new InputError('Chọn kết quả kiểm tra và ghi nội dung phản hồi (ít nhất 5 ký tự).');
  return touch(n, 'responded', n.owner_name, `Phản hồi: ${result}`, { response: { result: b.result, result_label: result, text, person: String(b.person || '').slice(0, 120), phone: String(b.phone || '').replace(/[^\d+ ]/g, '').slice(0, 20), at: store.now() } });
}
function staffUpdate(user, id, b) {
  const n = store.get('owner_notices', id); if (!n) throw new InputError('Không tìm thấy thông báo.');
  if (b.action === 'called') return touch(n, n.status, user.username, `Đã báo trực tiếp qua ${String(b.channel || 'điện thoại').slice(0, 40)}`, { called_at: store.now(), called_by: user.username, channel: String(b.channel || 'điện thoại').slice(0, 40) });
  if (b.action === 'close') return touch(n, 'closed', user.username, String(b.note || 'Đóng thông báo'));
  throw new InputError('Thao tác không hợp lệ.');
}

module.exports = { KINDS, STATUS, OBJ, InputError, list, save, remove, ownerLayers, setOwnerField, findFor, target, defaultMessage, notify, notices, byToken, forRef, ownerOpen, ownerRespond, staffUpdate };
