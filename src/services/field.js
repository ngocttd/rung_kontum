// MobileGIS field work (Đặc tả MobileGIS M11, M15–M17, mục 6–7): attachments, citizen reports from the app,
// field assignments by commune scope, surveys (incl. dipterocarp/rừng khộp rules), immutable verifications
// with separate review, offline sync with idempotency keys and conflict queue, notifications.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const db = require('../db/pool');
const store = require('../data/store');
const repo = require('../data/repo');
const reports = require('./reports');
const { can } = require('../middleware/security');

class FieldError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const need = (cond, status, code, message) => { if (!cond) throw new FieldError(status, code, message); };
const requireDb = () => need(db.enabled, 503, 'DB_REQUIRED', 'Chức năng hiện trường cần cơ sở dữ liệu PostGIS.');
const userRec = (auth) => store.get('users', auth.sub);
const actor = (auth) => { const u = userRec(auth); return { id: auth.sub, username: u ? u.username : auth.sub, role: auth.role, scope: auth.scope }; };

// ---------- catalogs shared with the app (bootstrap) ----------
const FOREST_TYPES = {
  'rung-thuong-xanh': 'Rừng lá rộng thường xanh',
  'rung-khop': 'Rừng khộp (rụng lá theo mùa)',
  'rung-nua-rung-la': 'Rừng nửa rụng lá',
  'rung-la-kim': 'Rừng lá kim',
  'rung-hon-giao': 'Rừng hỗn giao',
  'rung-tre-nua': 'Rừng tre nứa',
  'rung-trong': 'Rừng trồng',
  'dat-chua-co-rung': 'Đất chưa có rừng',
  khac: 'Khác',
};
const VERDICTS = {
  hotspot: { fire_confirmed: 'Có cháy rừng', fire_not_forest: 'Có cháy nhưng không phải rừng (nương rẫy, phụ phẩm…)', no_fire: 'Không phát hiện cháy' },
  candidate: { loss_confirmed: 'Xác nhận mất rừng', not_loss: 'Không phải mất rừng', seasonal: 'Rụng lá theo mùa (rừng khộp)' },
  report: { confirmed: 'Đúng phản ánh', partly: 'Đúng một phần', not_confirmed: 'Không đúng phản ánh' },
};
// approved verdict → status on the alert itself
const VERDICT_STATUS = {
  hotspot: { fire_confirmed: 'confirmed', fire_not_forest: 'rejected', no_fire: 'rejected' },
  candidate: { loss_confirmed: 'confirmed', not_loss: 'rejected', seasonal: 'seasonal' },
  report: { confirmed: 'processing', partly: 'processing', not_confirmed: 'rejected' },
};
const CHANGE_CAUSES = { 'khai-thac': 'Khai thác', 'chay': 'Cháy', 'chuyen-doi': 'Chuyển đổi mục đích sử dụng', 'lan-chiem': 'Lấn chiếm', 'tu-nhien': 'Tự nhiên (gió, sạt lở…)', 'rung-la-mua-kho': 'Rụng lá mùa khô', 'khong-ro': 'Chưa rõ' };
const ASSIGNMENT_STATUS = { assigned: 'Mới giao', accepted: 'Đã nhận', in_progress: 'Đang thực hiện', submitted: 'Đã nộp kết quả', approved: 'Đã duyệt', returned: 'Trả lại làm lại', cancelled: 'Huỷ' };

// ---------- attachments (presigned one-time upload URLs) ----------
const UPLOAD_DIR = reports.PHOTO_DIR; // same store as web reports so the admin report page shows them
const tickets = new Map();
const MIME = { 'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/heic': 'image', 'video/mp4': 'video', 'video/quicktime': 'video' };
const LIMIT = { image: 15 * 1048576, video: 60 * 1048576 };

function presign(auth, { mime, bytes, owner_kind: kind }) {
  const t = MIME[mime];
  need(t, 400, 'VALIDATION', 'Chỉ nhận ảnh JPG/PNG/WebP/HEIC hoặc video MP4/MOV.');
  need(Number(bytes) > 0 && Number(bytes) <= LIMIT[t], 413, 'TOO_LARGE', `Tệp vượt giới hạn ${LIMIT[t] / 1048576} MB.`);
  need(['report', 'survey', 'verification'].includes(kind), 400, 'VALIDATION', 'owner_kind không hợp lệ.');
  const token = crypto.randomBytes(24).toString('base64url');
  tickets.set(token, { mime, kind: t, owner_kind: kind, max: LIMIT[t], user: auth ? auth.sub : null, exp: Date.now() + 15 * 60e3 });
  for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k);
  return { upload_url: `/api/mobile/uploads/${token}`, method: 'PUT', headers: { 'Content-Type': mime }, expires_at: new Date(Date.now() + 15 * 60e3).toISOString() };
}

const isVideo = (b) => b.length > 12 && b.toString('ascii', 4, 8) === 'ftyp';
async function receiveUpload(token, buf, meta) {
  const t = tickets.get(token);
  need(t && t.exp > Date.now(), 410, 'UPLOAD_EXPIRED', 'Liên kết tải tệp đã hết hạn, hãy thử lại.');
  tickets.delete(token);
  need(buf && buf.length && buf.length <= t.max, 413, 'TOO_LARGE', 'Tệp rỗng hoặc vượt giới hạn.');
  let name;
  if (t.kind === 'image') {
    // re-encode: verifies it is an image, strips EXIF (hidden GPS of the reporter), bounds the size
    name = `${crypto.randomUUID()}.webp`;
    try { await sharp(buf).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(UPLOAD_DIR, name)); }
    catch { throw new FieldError(415, 'BAD_FILE', 'Tệp không phải ảnh hợp lệ.'); }
  } else {
    need(isVideo(buf), 415, 'BAD_FILE', 'Tệp không phải video MP4/MOV hợp lệ.');
    name = `${crypto.randomUUID()}.${t.mime === 'video/quicktime' ? 'mov' : 'mp4'}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  }
  const row = {
    id: crypto.randomUUID(), owner_kind: t.owner_kind, object_key: name, mime: t.kind === 'image' ? 'image/webp' : t.mime, bytes: fs.statSync(path.join(UPLOAD_DIR, name)).size,
    captured_at: meta.captured_at || null, lat: num(meta.lat), lon: num(meta.lon), gps_accuracy: num(meta.accuracy), uploaded_by: t.user,
  };
  if (db.enabled) {
    await db.query(`INSERT INTO mobile.field_attachments (id, owner_kind, object_key, mime, bytes, captured_at, lat, lon, gps_accuracy, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [row.id, row.owner_kind, row.object_key, row.mime, row.bytes, row.captured_at, row.lat, row.lon, row.gps_accuracy, row.uploaded_by]);
  } else { memAttach.set(row.object_key, row); }
  return { object_key: name, mime: row.mime, bytes: row.bytes };
}
const memAttach = new Map();
const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

// attachments must exist, be unclaimed and (when signed in) belong to the submitter
async function claimAttachments(keys, ownerKind, ownerId, auth) {
  const list = [...new Set((keys || []).map(String))].slice(0, 10);
  if (!list.length) return [];
  if (!db.enabled) return list.filter((k) => memAttach.has(k));
  const r = await db.query('SELECT object_key, mime, uploaded_by, owner_id FROM mobile.field_attachments WHERE object_key = ANY($1)', [list]);
  for (const a of r.rows) {
    need(!a.owner_id || a.owner_id === String(ownerId), 409, 'ATTACHMENT_USED', 'Tệp đính kèm đã thuộc hồ sơ khác.');
    need(!a.uploaded_by || (auth && a.uploaded_by === auth.sub), 403, 'FORBIDDEN', 'Tệp đính kèm không thuộc tài khoản này.');
  }
  await db.query('UPDATE mobile.field_attachments SET owner_id = $2, owner_kind = $3 WHERE object_key = ANY($1)', [r.rows.map((a) => a.object_key), String(ownerId), ownerKind]);
  return r.rows.map((a) => ({ key: a.object_key, mime: a.mime }));
}

async function attachmentFor(key, auth) {
  const file = path.join(UPLOAD_DIR, path.basename(key));
  if (!fs.existsSync(file)) return null;
  const staff = auth && ['admin', 'leader', 'specialist'].includes(auth.role);
  if (staff) return file;
  if (db.enabled) {
    const a = (await db.query('SELECT uploaded_by, owner_kind, owner_id FROM mobile.field_attachments WHERE object_key = $1', [path.basename(key)])).rows[0];
    if (a && auth && a.uploaded_by === auth.sub) return file;
  }
  const rep = store.find('reports', (x) => (x.photos || []).includes(path.basename(key)));
  return rep && rep.public && rep.public_photos ? file : null;
}

// ---------- citizen reports from the app ----------
async function createReport(auth, body, clientUuid) {
  const desc = String(body.description || '').trim();
  need(desc.length >= 10, 400, 'VALIDATION', 'Vui lòng mô tả hiện trạng (ít nhất 10 ký tự).');
  const lat = num(body.lat); const lon = num(body.lon);
  need(lat !== null && lon !== null && lat > 13 && lat < 16.5 && lon > 106.5 && lon < 109.5, 400, 'VALIDATION', 'Vị trí nằm ngoài khu vực Kon Tum hoặc chưa có toạ độ.');
  if (clientUuid) {
    const dup = store.find('reports', (r) => r.client_uuid === clientUuid);
    if (dup) return { report: dup, duplicate: true };
  }
  const u = auth ? userRec(auth) : null;
  const row = await reports.create({
    type: body.type, description: desc, lat, lon, location_text: body.location_text, observed_at: body.observed_at,
    name: body.name || (u && u.name) || '', phone: body.phone || (u && u.phone) || '', email: body.email || (u && u.email) || '',
  }, []);
  const att = await claimAttachments(body.attachments, 'report', row.id, auth);
  const patch = {
    client_uuid: clientUuid || null, source: 'mobile', created_by: auth ? auth.sub : null,
    gps_accuracy: num(body.gps_accuracy), location_source: ['gps', 'manual', 'map'].includes(body.location_source) ? body.location_source : 'gps',
    photos: att.filter((a) => a.mime.startsWith('image/')).map((a) => a.key), videos: att.filter((a) => a.mime.startsWith('video/')).map((a) => a.key),
  };
  let saved = store.update('reports', row.id, patch);
  const who = u ? { username: u.username, role: u.role } : null;
  store.audit(who, 'report.create', row.code, { source: 'mobile' });
  // cán bộ có quyền xác minh báo cháy tại hiện trường (GPS) = xác nhận cháy: tạo điểm cháy "Xác nhận cháy"
  // trong luồng cảnh báo → thông báo công khai tới người dân trong xã (notifier mục b)
  if (saved.type === 'chay-rung' && who && can(who, 'alerts.verify') && saved.location_source === 'gps') {
    try {
      require('./firepoints').fromReport(who, saved, { confirm: true, note: `Cán bộ ${who.username} báo cháy tại hiện trường qua MobileGIS (${saved.code})` });
      saved = store.get('reports', row.id);
    } catch (e) { console.warn('[field] không tạo được điểm cháy từ', saved.code, e.message); }
  }
  return { report: saved, duplicate: false };
}
function myReports(auth) {
  return store.filter('reports', (r) => r.created_by === auth.sub).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(ownView);
}
function ownView(r) {
  const v = reports.publicView(r);
  return { ...v, id: r.id, lat: r.lat, lon: r.lon, location_text: r.location_text, gps_accuracy: r.gps_accuracy || null, photos: (r.photos || []).map((p) => `/api/mobile/files/${p}`), videos: (r.videos || []).map((p) => `/api/mobile/files/${p}`), updated_at: r.updated_at };
}

// ---------- assignments ----------
const pt = (lon, lat) => (Number.isFinite(lon) && Number.isFinite(lat) ? `SRID=4326;POINT(${lon} ${lat})` : null);
function asgView(a) {
  return { ...a, statusLabel: ASSIGNMENT_STATUS[a.status], lat: a.lat ?? null, lon: a.lon ?? null, overdue: Boolean(a.due_at && new Date(a.due_at) < new Date() && !['approved', 'cancelled', 'submitted'].includes(a.status)) };
}
const ASG_SELECT = `SELECT a.*, ST_Y(a.geom) AS lat, ST_X(a.geom) AS lon, u.username AS assignee, u.name AS assignee_name
  FROM mobile.field_assignments a LEFT JOIN identity.users u ON u.id = a.assignee_id`;

// where the alert is (for map + scope)
function locate(kind, ref) {
  if (kind === 'hotspot') { const h = repo.hotspots({ staff: true }).find((x) => x.id === ref); return h && { lon: h.lon, lat: h.lat, commune: h.communeCode, title: `Xác minh ${h.manual ? `điểm cháy báo tin ${h.manual.code}` : `điểm nóng ${h.sensorLabel}`}${h.commune ? ` tại ${h.commune}` : ''}` }; }
  if (kind === 'candidate') {
    const f = repo.changeCandidates().features.find((x) => String(x.properties.id) === String(ref));
    if (!f) return null;
    const p = f.properties; const [lon, lat] = f.geometry.type === 'Point' ? f.geometry.coordinates : [p.lon ?? p.center_lon, p.lat ?? p.center_lat];
    const c = Number.isFinite(lon) ? repo.communeAt(lon, lat) : null;
    return { lon, lat, commune: c ? c.code : p.commune_code, title: `Xác minh biến động nghi vấn ${p.id}${c ? ` tại ${c.fullName}` : ''}` };
  }
  if (kind === 'report') { const r = store.find('reports', (x) => x.code === ref || x.id === ref); return r && { lon: r.lon, lat: r.lat, commune: r.commune_code, title: `Xác minh phản ánh ${r.code}` }; }
  return null;
}

async function createAssignment(user, { kind, ref_id: ref, title, instructions, assignee_id: assignee, due_at: due, lat, lon, scope_id: scope }) {
  requireDb();
  need(['hotspot', 'candidate', 'report', 'survey'].includes(kind), 400, 'VALIDATION', 'Loại nhiệm vụ không hợp lệ.');
  const loc = ref ? locate(kind, ref) : null;
  need(kind === 'survey' || loc, 404, 'NOT_FOUND', 'Không tìm thấy đối tượng cần xác minh.');
  const a = assignee ? store.get('users', assignee) : null;
  need(!assignee || (a && a.role === 'specialist' && a.active), 400, 'VALIDATION', 'Người được giao phải là cán bộ chuyên môn đang hoạt động.');
  const pLon = loc ? loc.lon : num(lon); const pLat = loc ? loc.lat : num(lat);
  const sc = scope || (loc && loc.commune) || (Number.isFinite(pLon) ? (repo.communeAt(pLon, pLat) || {}).code : null) || null;
  need(!a || !a.scope || !sc || a.scope === sc, 400, 'OUT_OF_SCOPE', 'Cán bộ được giao không phụ trách địa bàn này.');
  if (ref) {
    const open = await db.query("SELECT code FROM mobile.field_assignments WHERE kind = $1 AND ref_id = $2 AND status NOT IN ('approved','cancelled')", [kind, ref]);
    need(!open.rowCount, 409, 'EXISTS', `Đối tượng đã có nhiệm vụ đang mở (${open.rows[0] && open.rows[0].code}).`);
  }
  const id = crypto.randomUUID(); const code = store.nextCode('NV');
  const hist = [{ at: new Date().toISOString(), by: user.username, status: 'assigned', note: 'Giao nhiệm vụ' }];
  await db.query(`INSERT INTO mobile.field_assignments (id, code, kind, ref_id, title, instructions, scope_id, geom, assignee_id, created_by, due_at, history)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::geometry,$9,$10,$11,$12)`,
  [id, code, kind, ref || null, String(title || (loc && loc.title) || 'Khảo sát hiện trạng rừng').slice(0, 300), instructions || null, sc, pt(pLon, pLat), assignee || null, user.username, due || null, JSON.stringify(hist)]);
  if (kind === 'hotspot') store.setDecision('hotspot', ref, { status: 'assigned', assignee: a ? a.username : null, note: `Giao nhiệm vụ ${code}` }, user);
  if (kind === 'candidate') store.setDecision('candidate', ref, { status: 'verifying', note: `Giao nhiệm vụ ${code}` }, user);
  store.audit(user, 'field.assign', code, { kind, ref, assignee: a && a.username });
  return getAssignment(id);
}

async function getAssignment(id) {
  const r = await db.query(`${ASG_SELECT} WHERE a.id::text = $1 OR a.code = $1`, [String(id)]);
  return r.rows[0] ? asgView(r.rows[0]) : null;
}

// TC05: a specialist only sees tasks given to them or (unassigned) tasks inside their commune scope
function canOpen(auth, a) {
  if (['leader'].includes(auth.role)) return true;
  if (auth.role !== 'specialist') return false;
  if (a.assignee_id === auth.sub) return true;
  return !a.assignee_id && (!auth.scope || auth.scope === a.scope_id);
}

async function listAssignments(auth, { status, mine } = {}) {
  requireDb();
  const vals = []; const where = [];
  if (auth.role === 'specialist') {
    vals.push(auth.sub, auth.scope);
    where.push(mine === 'true' ? 'a.assignee_id = $1' : '(a.assignee_id = $1 OR (a.assignee_id IS NULL AND ($2::text IS NULL OR a.scope_id = $2)))');
  } else need(auth.role === 'leader', 403, 'FORBIDDEN', 'Không có quyền xem nhiệm vụ hiện trường.');
  if (status) { vals.push(String(status).split(',')); where.push(`a.status = ANY($${vals.length})`); }
  const r = await db.query(`${ASG_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (a.status IN ('approved','cancelled')), a.due_at NULLS LAST, a.created_at DESC LIMIT 300`, vals);
  return r.rows.map(asgView);
}

async function openAssignment(auth, id) {
  requireDb();
  const a = await getAssignment(id);
  need(a, 404, 'NOT_FOUND', 'Không tìm thấy nhiệm vụ.');
  need(canOpen(auth, a), 403, 'OUT_OF_SCOPE', 'Nhiệm vụ không thuộc địa bàn hoặc không được giao cho bạn.');
  const target = a.ref_id ? targetInfo(a.kind, a.ref_id) : null;
  const ver = await db.query('SELECT v.*, ST_Y(v.geom) lat, ST_X(v.geom) lon FROM mobile.incident_verifications v WHERE assignment_id = $1 ORDER BY created_at', [a.id]);
  return { ...a, target, verifications: ver.rows };
}
function targetInfo(kind, ref) {
  if (kind === 'hotspot') { const h = repo.hotspots({ staff: true }).find((x) => x.id === ref); return h ? { ...h, decision: undefined } : null; }
  if (kind === 'candidate') { const f = repo.changeCandidates().features.find((x) => String(x.properties.id) === String(ref)); return f ? f.properties : null; }
  if (kind === 'report') { const r = store.find('reports', (x) => x.code === ref || x.id === ref); return r ? ownView(r) : null; }
  return null;
}

const ASG_FLOW = { accept: ['assigned', 'accepted'], start: ['assigned', 'accepted', 'returned'] };
async function changeAssignment(auth, id, action, baseVersion) {
  requireDb();
  const a = await getAssignment(id);
  need(a, 404, 'NOT_FOUND', 'Không tìm thấy nhiệm vụ.');
  need(auth.role === 'specialist' && canOpen(auth, a), 403, 'OUT_OF_SCOPE', 'Nhiệm vụ không thuộc địa bàn hoặc không được giao cho bạn.');
  need(ASG_FLOW[action], 400, 'VALIDATION', 'Thao tác không hợp lệ.');
  if (baseVersion !== undefined && baseVersion !== null && Number(baseVersion) !== a.version) {
    throw new FieldError(409, 'CONFLICT', 'Nhiệm vụ đã được thay đổi trên máy chủ.', { server: a });
  }
  need(ASG_FLOW[action].includes(a.status), 409, 'BAD_STATE', `Không thể ${action === 'accept' ? 'nhận' : 'bắt đầu'} nhiệm vụ ở trạng thái “${a.statusLabel}”.`);
  const status = action === 'accept' ? 'accepted' : 'in_progress';
  const u = actor(auth);
  await db.query(`UPDATE mobile.field_assignments SET status = $2, assignee_id = COALESCE(assignee_id, $3), version = version + 1, updated_at = now(),
    history = history || $4::jsonb WHERE id = $1`, [a.id, status, auth.sub, JSON.stringify([{ at: new Date().toISOString(), by: u.username, status }])]);
  return getAssignment(a.id);
}

// ---------- surveys ----------
function geomOf(g) {
  need(g && ['Point', 'LineString', 'Polygon'].includes(g.type) && Array.isArray(g.coordinates), 400, 'VALIDATION', 'Hình học khảo sát không hợp lệ (điểm, đường hoặc vùng).');
  const flat = JSON.stringify(g.coordinates).match(/-?\d+(\.\d+)?/g).map(Number);
  for (let i = 0; i < flat.length; i += 2) need(flat[i] > 106.5 && flat[i] < 109.5 && flat[i + 1] > 13 && flat[i + 1] < 16.5, 400, 'VALIDATION', 'Toạ độ khảo sát ngoài khu vực Kon Tum.');
  if (g.type === 'Polygon') need(g.coordinates[0] && g.coordinates[0].length >= 4, 400, 'VALIDATION', 'Vùng cần ít nhất 3 đỉnh.');
  if (g.type === 'LineString') need(g.coordinates.length >= 2, 400, 'VALIDATION', 'Đường cần ít nhất 2 điểm.');
  return { json: JSON.stringify(g), type: { Point: 'point', LineString: 'line', Polygon: 'polygon' }[g.type] };
}

// TC06 / 6.3: in dipterocarp forest a dry-season visit with low NDVI or leafless canopy is not evidence of loss
function dipterocarpCheck(b) {
  const khop = b.forest_type === 'rung-khop' || b.is_dipterocarp === true || b.is_dipterocarp === 'true';
  const notes = [];
  let cause = b.change_cause || null;
  if (khop) {
    if (b.season === 'dry' && ['khai-thac', 'chuyen-doi', 'lan-chiem'].includes(cause) && !b.loss_evidence) {
      notes.push('Rừng khộp khảo sát mùa khô: chưa đủ căn cứ kết luận mất rừng (cần bằng chứng gốc chặt, chuyển đổi đất hoặc khảo sát lại mùa mưa).');
    }
    if (b.season === 'dry' && (b.leaf_state === 'leafless' || b.leaf_state === 'partial') && !cause) { cause = 'rung-la-mua-kho'; notes.push('Ghi nhận rụng lá theo mùa – không phải mất rừng.'); }
  }
  return { khop, cause, notes };
}

async function createSurvey(auth, b, clientUuid) {
  requireDb();
  need(can({ role: auth.role }, 'field.survey'), 403, 'FORBIDDEN', 'Chỉ cán bộ chuyên môn được nộp khảo sát.');
  if (clientUuid) {
    const dup = await db.query('SELECT id, code FROM mobile.field_surveys WHERE client_uuid = $1', [clientUuid]);
    if (dup.rowCount) return { survey: await getSurvey(dup.rows[0].id), duplicate: true };
  }
  let asg = null;
  if (b.assignment_id) { asg = await getAssignment(b.assignment_id); need(asg && canOpen(auth, asg), 403, 'OUT_OF_SCOPE', 'Nhiệm vụ không thuộc phạm vi của bạn.'); }
  const g = geomOf(b.geometry);
  need(['dry', 'wet'].includes(b.season), 400, 'VALIDATION', 'Cần ghi mùa khảo sát (mùa khô/mùa mưa).');
  need(!b.forest_type || FOREST_TYPES[b.forest_type], 400, 'VALIDATION', 'Loại rừng không hợp lệ.');
  const chk = dipterocarpCheck(b);
  const u = actor(auth); const id = crypto.randomUUID(); const code = store.nextCode('KS');
  const c = await db.query('SELECT ST_Y(ST_PointOnSurface(ST_GeomFromGeoJSON($1))) lat, ST_X(ST_PointOnSurface(ST_GeomFromGeoJSON($1))) lon', [g.json]);
  const commune = repo.communeAt(c.rows[0].lon, c.rows[0].lat);
  need(!auth.scope || !commune || commune.code === auth.scope, 403, 'OUT_OF_SCOPE', 'Vị trí khảo sát ngoài địa bàn được giao.');
  const notes = [String(b.notes || '').slice(0, 3000), ...chk.notes].filter(Boolean).join('\n');
  await db.query(`INSERT INTO mobile.field_surveys (id, code, client_uuid, assignment_id, surveyor_id, surveyor, commune_code, geom, geom_type, area_ha, length_m,
      forest_type, is_dipterocarp, season, leaf_state, canopy_cover, change_cause, notes, observed_at, gps_accuracy, location_source, history)
    VALUES ($1,$2,$3,$4,$5,$6,$7, ST_SetSRID(ST_GeomFromGeoJSON($8),4326), $9,
      CASE WHEN $9 = 'polygon' THEN ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($8),4326)::geography) / 10000 END,
      CASE WHEN $9 = 'line' THEN ST_Length(ST_SetSRID(ST_GeomFromGeoJSON($8),4326)::geography) END,
      $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
  [id, code, clientUuid || null, asg ? asg.id : null, auth.sub, u.username, commune ? commune.code : null, g.json, g.type,
    b.forest_type || null, chk.khop, b.season, ['full', 'partial', 'leafless', 'unknown'].includes(b.leaf_state) ? b.leaf_state : null,
    num(b.canopy_cover), chk.cause, notes || null, b.observed_at || new Date().toISOString(), num(b.gps_accuracy),
    ['gps', 'manual', 'map'].includes(b.location_source) ? b.location_source : 'gps', JSON.stringify([{ at: new Date().toISOString(), by: u.username, action: 'submit' }])]);
  await claimAttachments(b.attachments, 'survey', id, auth);
  if (asg) await markSubmitted(asg, u.username);
  store.audit(u, 'field.survey', code, { assignment: asg && asg.code, dipterocarp: chk.khop });
  return { survey: await getSurvey(id), duplicate: false, warnings: chk.notes };
}
async function getSurvey(id) {
  const r = await db.query(`SELECT s.*, ST_AsGeoJSON(s.geom)::json geometry FROM mobile.field_surveys s WHERE s.id::text = $1 OR s.code = $1`, [String(id)]);
  if (!r.rows[0]) return null;
  const { geom, ...s } = r.rows[0]; // eslint-disable-line no-unused-vars
  const att = await db.query("SELECT object_key, mime FROM mobile.field_attachments WHERE owner_kind = 'survey' AND owner_id = $1", [s.id]);
  return { ...s, forest_type_label: FOREST_TYPES[s.forest_type] || null, attachments: att.rows.map((a) => ({ url: `/api/mobile/files/${a.object_key}`, mime: a.mime })) };
}
async function listSurveys(auth, { status, mine } = {}) {
  requireDb();
  const vals = []; const where = [];
  if (mine === 'true' || auth.role === 'specialist') { vals.push(auth.sub); where.push(`surveyor_id = $${vals.length}`); }
  if (status) { vals.push(status); where.push(`status = $${vals.length}`); }
  const r = await db.query(`SELECT id, code, geom_type, forest_type, is_dipterocarp, season, leaf_state, change_cause, status, commune_code, observed_at, surveyor, area_ha, length_m, version, updated_at,
      ST_AsGeoJSON(geom)::json geometry FROM mobile.field_surveys ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 300`, vals);
  return r.rows;
}

// optimistic update (offline edits): base_version must match, otherwise conflict is queued — never overwritten silently (TC09)
async function updateSurvey(auth, id, b, baseVersion) {
  requireDb();
  const s = await getSurvey(id);
  need(s, 404, 'NOT_FOUND', 'Không tìm thấy khảo sát.');
  need(s.surveyor_id === auth.sub, 403, 'FORBIDDEN', 'Chỉ người khảo sát được chỉnh sửa.');
  need(s.status !== 'approved', 409, 'BAD_STATE', 'Khảo sát đã duyệt, không sửa được.');
  if (Number(baseVersion) !== s.version) throw new FieldError(409, 'CONFLICT', 'Khảo sát đã thay đổi trên máy chủ.', { server: s });
  const fields = {};
  for (const k of ['forest_type', 'season', 'leaf_state', 'canopy_cover', 'change_cause', 'notes']) if (b[k] !== undefined) fields[k] = b[k];
  if (fields.forest_type && !FOREST_TYPES[fields.forest_type]) throw new FieldError(400, 'VALIDATION', 'Loại rừng không hợp lệ.');
  const chk = dipterocarpCheck({ ...s, ...fields });
  fields.change_cause = chk.cause; fields.is_dipterocarp = chk.khop;
  const sets = Object.keys(fields).map((k, i) => `${k} = $${i + 2}`);
  await db.query(`UPDATE mobile.field_surveys SET ${sets.join(', ')}, status = 'pending_review', version = version + 1, updated_at = now(),
    history = history || $${sets.length + 2}::jsonb WHERE id = $1`, [s.id, ...Object.values(fields), JSON.stringify([{ at: new Date().toISOString(), by: actor(auth).username, action: 'edit', before: Object.fromEntries(Object.keys(fields).map((k) => [k, s[k]])) }])]);
  return { survey: await getSurvey(s.id), warnings: chk.notes };
}

async function reviewSurvey(user, id, decision, note) {
  requireDb();
  need(['approved', 'rejected'].includes(decision), 400, 'VALIDATION', 'Quyết định không hợp lệ.');
  const s = await getSurvey(id);
  need(s, 404, 'NOT_FOUND', 'Không tìm thấy khảo sát.');
  need(s.surveyor_id !== user.id, 403, 'SELF_REVIEW', 'Không tự duyệt kết quả của chính mình.');
  await db.query(`UPDATE mobile.field_surveys SET status = $2, reviewer = $3, reviewed_at = now(), review_note = $4, version = version + 1, updated_at = now(),
    history = history || $5::jsonb WHERE id = $1`, [s.id, decision, user.username, note || null, JSON.stringify([{ at: new Date().toISOString(), by: user.username, action: decision, note }])]);
  if (s.assignment_id) await closeAssignment(s.assignment_id, decision, user.username);
  store.audit(user, 'field.survey.review', s.code, { decision });
  return getSurvey(s.id);
}

// ---------- verifications (immutable) ----------
async function markSubmitted(asg, by) {
  await db.query(`UPDATE mobile.field_assignments SET status = 'submitted', version = version + 1, updated_at = now(), history = history || $2::jsonb WHERE id = $1`,
    [asg.id, JSON.stringify([{ at: new Date().toISOString(), by, status: 'submitted' }])]);
}
async function closeAssignment(id, decision, by) {
  const status = decision === 'approved' ? 'approved' : 'returned';
  await db.query(`UPDATE mobile.field_assignments SET status = $2, version = version + 1, updated_at = now(), history = history || $3::jsonb WHERE id = $1`,
    [id, status, JSON.stringify([{ at: new Date().toISOString(), by, status }])]);
}

async function createVerification(auth, b, clientUuid) {
  requireDb();
  need(can({ role: auth.role }, 'field.verify'), 403, 'FORBIDDEN', 'Chỉ cán bộ chuyên môn được nộp kết quả xác minh.');
  if (clientUuid) {
    const dup = await db.query('SELECT id FROM mobile.incident_verifications WHERE client_uuid = $1', [clientUuid]);
    if (dup.rowCount) return { verification: await getVerification(dup.rows[0].id), duplicate: true };
  }
  const kind = b.alert_kind;
  need(VERDICTS[kind], 400, 'VALIDATION', 'Loại đối tượng xác minh không hợp lệ.');
  need(VERDICTS[kind][b.verdict], 400, 'VALIDATION', 'Kết luận xác minh không hợp lệ.');
  const loc = locate(kind, b.alert_id);
  need(loc, 404, 'NOT_FOUND', 'Không tìm thấy cảnh báo/phản ánh cần xác minh.');
  let asg = null;
  if (b.assignment_id) asg = await getAssignment(b.assignment_id);
  else {
    const r = await db.query("SELECT id FROM mobile.field_assignments WHERE kind = $1 AND ref_id = $2 AND status NOT IN ('approved','cancelled') LIMIT 1", [kind, b.alert_id]);
    if (r.rowCount) asg = await getAssignment(r.rows[0].id);
  }
  need(!asg || canOpen(auth, asg), 403, 'OUT_OF_SCOPE', 'Nhiệm vụ không thuộc địa bàn hoặc không được giao cho bạn.');
  need(asg || !auth.scope || !loc.commune || loc.commune === auth.scope, 403, 'OUT_OF_SCOPE', 'Đối tượng nằm ngoài địa bàn được giao.');
  need(kind !== 'candidate' || b.verdict !== 'loss_confirmed' || !(b.forest_type === 'rung-khop' && b.season === 'dry' && !b.loss_evidence), 400, 'DIPTEROCARP_DRY',
    'Rừng khộp mùa khô: không kết luận mất rừng nếu chưa có bằng chứng gốc chặt/chuyển đổi đất. Chọn “Rụng lá theo mùa” hoặc bổ sung bằng chứng.');
  const lat = num(b.lat); const lon = num(b.lon);
  const u = actor(auth); const id = crypto.randomUUID(); const code = store.nextCode('XM');
  const evidence = { description: String(b.description || '').slice(0, 3000), season: b.season || null, loss_evidence: b.loss_evidence || null, location_source: b.location_source || 'gps', attachments: [] };
  await db.query(`INSERT INTO mobile.incident_verifications (id, code, client_uuid, alert_kind, alert_id, assignment_id, verdict, severity, forest_type, burned_area_ha, recommendation, evidence, geom, gps_accuracy, verifier_id, verifier, verified_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::geometry,$14,$15,$16,$17)`,
  [id, code, clientUuid || null, kind, String(b.alert_id), asg ? asg.id : null, b.verdict, b.severity || null, b.forest_type || null, num(b.burned_area_ha), String(b.recommendation || '').slice(0, 2000) || null,
    JSON.stringify(evidence), pt(lon, lat), num(b.gps_accuracy), auth.sub, u.username, b.verified_at || new Date().toISOString()]);
  const att = await claimAttachments(b.attachments, 'verification', id, auth);
  // attachments are referenced from the attachment table (owner_id), the immutable row stays as written
  if (asg) await markSubmitted(asg, u.username);
  if (kind === 'hotspot') store.setDecision('hotspot', String(b.alert_id), { status: 'verifying', note: `Đã nộp kết quả xác minh ${code} – chờ duyệt` }, u);
  if (kind === 'candidate') store.setDecision('candidate', String(b.alert_id), { status: 'verifying', note: `Đã nộp kết quả xác minh ${code} – chờ duyệt` }, u);
  if (kind === 'report') {
    const r = store.find('reports', (x) => x.code === b.alert_id || x.id === b.alert_id);
    if (r && r.status === 'received') store.update('reports', r.id, { status: 'verifying', timeline: [...r.timeline, { at: store.now(), status: 'verifying', note: `Cán bộ xác minh hiện trường (${code})`, by: u.username }] });
  }
  store.audit(u, 'field.verify', code, { kind, alert: b.alert_id, verdict: b.verdict, attachments: att.length });
  return { verification: await getVerification(id), duplicate: false };
}

async function getVerification(id) {
  const r = await db.query(`SELECT v.*, ST_Y(v.geom) lat, ST_X(v.geom) lon, a.code assignment_code FROM mobile.incident_verifications v
    LEFT JOIN mobile.field_assignments a ON a.id = v.assignment_id WHERE v.id::text = $1 OR v.code = $1`, [String(id)]);
  if (!r.rows[0]) return null;
  const { geom, ...v } = r.rows[0]; // eslint-disable-line no-unused-vars
  const att = await db.query("SELECT object_key, mime FROM mobile.field_attachments WHERE owner_kind = 'verification' AND owner_id = $1", [v.id]);
  const rev = await db.query('SELECT decision, note, reviewer, created_at FROM mobile.verification_reviews WHERE verification_id = $1 ORDER BY created_at', [v.id]);
  return { ...v, verdict_label: (VERDICTS[v.alert_kind] || {})[v.verdict], attachments: att.rows.map((a) => ({ url: `/api/mobile/files/${a.object_key}`, mime: a.mime })), reviews: rev.rows };
}

async function listVerifications(auth, { review_status: rs } = {}) {
  requireDb();
  const vals = []; const where = [];
  if (auth.role === 'specialist' && !can({ role: auth.role }, 'field.review')) { vals.push(auth.sub); where.push(`verifier_id = $${vals.length}`); }
  if (rs) { vals.push(rs); where.push(`review_status = $${vals.length}`); }
  const r = await db.query(`SELECT v.id, v.code, v.alert_kind, v.alert_id, v.verdict, v.verifier, v.verified_at, v.review_status, v.severity, ST_Y(v.geom) lat, ST_X(v.geom) lon
    FROM mobile.incident_verifications v ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY v.created_at DESC LIMIT 300`, vals);
  return r.rows.map((v) => ({ ...v, verdict_label: (VERDICTS[v.alert_kind] || {})[v.verdict] }));
}

// 6.2: the competent person approves → alert status, logs and notification follow
async function reviewVerification(user, id, decision, note) {
  requireDb();
  need(['approved', 'rejected'].includes(decision), 400, 'VALIDATION', 'Quyết định không hợp lệ.');
  const v = await getVerification(id);
  need(v, 404, 'NOT_FOUND', 'Không tìm thấy kết quả xác minh.');
  need(v.review_status === 'pending', 409, 'BAD_STATE', 'Kết quả này đã được xử lý.');
  need(v.verifier_id !== user.id, 403, 'SELF_REVIEW', 'Không tự duyệt kết quả xác minh của chính mình.');
  await db.query('INSERT INTO mobile.verification_reviews (id, verification_id, decision, note, reviewer) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), v.id, decision, note || null, user.username]);
  await db.query('UPDATE mobile.incident_verifications SET review_status = $2 WHERE id = $1', [v.id, decision]);
  if (decision === 'approved') {
    const status = VERDICT_STATUS[v.alert_kind][v.verdict];
    const msg = `Duyệt kết quả xác minh ${v.code}: ${v.verdict_label}${note ? ` – ${note}` : ''}`;
    if (v.alert_kind === 'hotspot' || v.alert_kind === 'candidate') store.setDecision(v.alert_kind, v.alert_id, { status, note: msg }, user);
    if (v.alert_kind === 'report') {
      const r = store.find('reports', (x) => x.code === v.alert_id || x.id === v.alert_id);
      if (r) store.update('reports', r.id, { status, timeline: [...r.timeline, { at: store.now(), status, note: msg, public_note: status === 'rejected' ? 'Kết quả xác minh: không đủ căn cứ' : 'Đã xác minh tại hiện trường, đang xử lý', by: user.username }] });
    }
  } else if (v.alert_kind === 'hotspot' || v.alert_kind === 'candidate') {
    store.setDecision(v.alert_kind, v.alert_id, { status: v.alert_kind === 'hotspot' ? 'assigned' : 'verifying', note: `Trả lại kết quả ${v.code}: ${note || ''}` }, user);
  }
  if (v.assignment_id) await closeAssignment(v.assignment_id, decision, user.username);
  store.audit(user, 'field.verify.review', v.code, { decision, note });
  return getVerification(v.id);
}

// ---------- offline sync (6.4) ----------
async function syncBatch(auth, deviceId, items) {
  requireDb();
  need(Array.isArray(items) && items.length <= 100, 400, 'VALIDATION', 'Lô đồng bộ tối đa 100 bản ghi.');
  const out = [];
  for (const it of items) {
    const cu = String(it.client_uuid || '');
    if (!/^[0-9a-f-]{36}$/i.test(cu)) { out.push({ client_uuid: cu, result: 'rejected', message: 'client_uuid không hợp lệ' }); continue; }
    const prev = await db.query('SELECT * FROM mobile.mobile_sync_events WHERE client_uuid = $1 AND entity = $2', [cu, it.entity]);
    if (prev.rowCount && prev.rows[0].result !== 'conflict') { out.push({ client_uuid: cu, result: 'duplicate', server_id: prev.rows[0].server_id, message: 'Đã đồng bộ trước đó' }); continue; }
    let res;
    try {
      res = await applyItem(auth, it, cu);
    } catch (e) {
      if (!(e instanceof FieldError)) throw e;
      res = e.code === 'CONFLICT'
        ? { result: 'conflict', message: e.message, server: e.extra && e.extra.server, server_version: e.extra && e.extra.server && e.extra.server.version }
        : { result: 'rejected', message: e.message, code: e.code };
    }
    const row = [crypto.randomUUID(), cu, auth.sub, deviceId || null, it.entity, it.operation || 'create', it.base_version ?? null, res.server_version ?? null, res.result, res.server_id || null, res.message || null, JSON.stringify(it.payload || {})];
    await db.query(`INSERT INTO mobile.mobile_sync_events (id, client_uuid, user_id, device_id, entity, operation, base_version, server_version, result, server_id, message, payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (client_uuid, entity) DO UPDATE SET result = EXCLUDED.result, server_id = EXCLUDED.server_id, message = EXCLUDED.message, server_version = EXCLUDED.server_version, created_at = now()`, row);
    out.push({ client_uuid: cu, entity: it.entity, ...res });
  }
  if (deviceId) await db.query('UPDATE mobile.mobile_devices SET last_sync_at = now() WHERE id = $1', [deviceId]).catch(() => {});
  return out;
}

async function applyItem(auth, it, cu) {
  const p = it.payload || {};
  switch (`${it.entity}:${it.operation || 'create'}`) {
    case 'report:create': { const r = await createReport(auth, p, cu); return { result: r.duplicate ? 'duplicate' : 'applied', server_id: r.report.code }; }
    case 'survey:create': { const r = await createSurvey(auth, p, cu); return { result: r.duplicate ? 'duplicate' : 'applied', server_id: r.survey.code, warnings: r.warnings }; }
    case 'survey:update': { const r = await updateSurvey(auth, p.id, p, it.base_version); return { result: 'applied', server_id: r.survey.code, server_version: r.survey.version, warnings: r.warnings }; }
    case 'verification:create': { const r = await createVerification(auth, p, cu); return { result: r.duplicate ? 'duplicate' : 'applied', server_id: r.verification.code }; }
    case 'assignment:accept': case 'assignment:start': {
      const a = await changeAssignment(auth, p.id, it.operation, it.base_version); return { result: 'applied', server_id: a.code, server_version: a.version };
    }
    default: throw new FieldError(400, 'VALIDATION', 'Loại bản ghi đồng bộ không hỗ trợ.');
  }
}

async function conflicts(auth) {
  requireDb();
  const r = await db.query("SELECT * FROM mobile.mobile_sync_events WHERE user_id = $1 AND result = 'conflict' AND resolved_at IS NULL ORDER BY created_at DESC", [auth.sub]);
  return r.rows;
}
// the user decides: keep the server copy, or re-apply their change on top of the current server version
async function resolveConflict(auth, id, action) {
  requireDb();
  const c = (await db.query("SELECT * FROM mobile.mobile_sync_events WHERE id = $1 AND user_id = $2 AND result = 'conflict'", [id, auth.sub])).rows[0];
  need(c, 404, 'NOT_FOUND', 'Không tìm thấy xung đột.');
  need(['keep_server', 'apply_mine'].includes(action), 400, 'VALIDATION', 'Hành động không hợp lệ.');
  let res = { result: 'applied', message: 'Giữ bản trên máy chủ' };
  if (action === 'apply_mine') {
    const cur = c.entity === 'survey' ? await getSurvey(c.payload.id) : await getAssignment(c.payload.id);
    need(cur, 404, 'NOT_FOUND', 'Bản ghi trên máy chủ không còn.');
    res = await applyItem(auth, { entity: c.entity, operation: c.operation, base_version: cur.version, payload: c.payload }, c.client_uuid);
  }
  await db.query('UPDATE mobile.mobile_sync_events SET resolved_at = now(), result = $2, message = $3 WHERE id = $1', [id, 'applied', `${action}: ${res.message || ''}`]);
  store.audit(actor(auth), 'mobile.sync.resolve', c.client_uuid, { action });
  return res;
}

async function changes(auth, since) {
  const t = since && !Number.isNaN(Date.parse(since)) ? new Date(since) : new Date(0);
  const out = { server_time: new Date().toISOString(), reports: store.filter('reports', (r) => r.created_by === auth.sub && new Date(r.updated_at || r.created_at) > t).map(ownView) };
  if (db.enabled && auth.role === 'specialist') {
    const a = await db.query(`${ASG_SELECT} WHERE (a.assignee_id = $1 OR (a.assignee_id IS NULL AND ($2::text IS NULL OR a.scope_id = $2))) AND a.updated_at > $3 ORDER BY a.updated_at`, [auth.sub, auth.scope, t]);
    out.assignments = a.rows.map(asgView);
    const v = await db.query('SELECT id, code, alert_kind, alert_id, verdict, review_status FROM mobile.incident_verifications v WHERE verifier_id = $1 AND EXISTS (SELECT 1 FROM mobile.verification_reviews r WHERE r.verification_id = v.id AND r.created_at > $2)', [auth.sub, t]);
    out.verification_reviews = v.rows;
    const s = await db.query('SELECT id, code, status, version, review_note, updated_at FROM mobile.field_surveys WHERE surveyor_id = $1 AND updated_at > $2', [auth.sub, t]);
    out.surveys = s.rows;
  }
  return out;
}

// ---------- devices & notifications ----------
// Thiết bị + kênh push: Firebase Cloud Messaging (Android và iOS) – push_endpoint là FCM registration token.
async function registerDevice(auth, b) {
  const id = /^[0-9a-f-]{36}$/i.test(String(b.device_id || '')) ? b.device_id : null;
  need(id, 400, 'VALIDATION', 'device_id không hợp lệ.');
  if (!db.enabled) return { id };
  const communes = (Array.isArray(b.subscribed_communes) ? b.subscribed_communes : []).map(String).slice(0, 40);
  let provider = null; let endpoint = null; const keys = null; const env = null;
  if (b.push_provider === 'fcm') {
    need(/^[\w:.-]{100,4096}$/.test(String(b.push_endpoint || '')), 400, 'VALIDATION', 'FCM registration token không hợp lệ.');
    provider = 'fcm'; endpoint = String(b.push_endpoint);
  } else if (b.push_provider && b.push_provider !== 'none') {
    need(false, 400, 'VALIDATION', 'Kênh push không hỗ trợ (chỉ dùng fcm).');
  }
  const clearPush = b.push_provider === null || b.push_provider === 'none';
  // đăng ký ở nền (FCM làm mới token khi ứng dụng đóng, không có access token) giữ nguyên liên kết người dùng;
  // đăng xuất gỡ liên kết ở mobile-auth.logout
  await db.query(`INSERT INTO mobile.mobile_devices (id, user_id, platform, app_version, subscribed_communes, push_provider, push_endpoint, push_keys, push_env, last_seen_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
    ON CONFLICT (id) DO UPDATE SET user_id = CASE WHEN $11 THEN EXCLUDED.user_id ELSE mobile.mobile_devices.user_id END, platform = EXCLUDED.platform, app_version = EXCLUDED.app_version, subscribed_communes = EXCLUDED.subscribed_communes,
      push_provider = CASE WHEN $10 THEN NULL ELSE COALESCE(EXCLUDED.push_provider, mobile.mobile_devices.push_provider) END,
      push_endpoint = CASE WHEN $10 THEN NULL ELSE COALESCE(EXCLUDED.push_endpoint, mobile.mobile_devices.push_endpoint) END,
      push_keys = CASE WHEN $10 THEN NULL ELSE COALESCE(EXCLUDED.push_keys, mobile.mobile_devices.push_keys) END,
      push_env = COALESCE(EXCLUDED.push_env, mobile.mobile_devices.push_env),
      push_enabled = CASE WHEN EXCLUDED.push_endpoint IS NOT NULL THEN true ELSE mobile.mobile_devices.push_enabled END,
      last_seen_at = now(), updated_at = now()`,
  [id, auth ? auth.sub : null, String(b.platform || '').slice(0, 20), String(b.app_version || '').slice(0, 20), communes, provider, endpoint, keys ? JSON.stringify(keys) : null, env, clearPush, Boolean(auth)]);
  const d = (await db.query('SELECT push_provider, push_enabled FROM mobile.mobile_devices WHERE id = $1', [id])).rows[0];
  return { id, subscribed_communes: communes, push_provider: d.push_provider, push_enabled: d.push_enabled };
}

// Notifications are built only from official/verified items and the user's own work (mục 9):
// approved fire-danger warnings, approved fire verifications, own report updates, new tasks.
async function notifications(auth, communes) {
  const alerts = require('./alerts');
  const list = [];
  const inScope = (c) => !communes || !communes.length || communes.includes(c);
  for (const a of alerts.fireDangerAlerts(3)) if (a.official && inScope(a.communeCode)) list.push({ id: a.id, kind: 'fire_danger', title: a.title, body: a.detail, at: a.time, link: { screen: 'fire', commune: a.communeCode } });
  for (const h of repo.hotspots()) if (h.status === 'confirmed' && inScope(h.communeCode)) list.push({ id: `HS-${h.id}`, kind: 'fire_confirmed', title: `Đã xác minh cháy rừng tại ${h.commune || 'khu vực'}`, body: (h.decision && h.decision.note) || '', at: h.decision ? h.decision.updated_at : h.utc, link: { screen: 'hotspot', id: h.id } });
  if (auth) {
    for (const r of store.filter('reports', (x) => x.created_by === auth.sub)) {
      const last = r.timeline[r.timeline.length - 1];
      if (r.timeline.length > 1) list.push({ id: `PA-${r.code}-${r.timeline.length}`, kind: 'report', title: `Phản ánh ${r.code}: ${reports.STATUS[r.status].label}`, body: last.public_note || '', at: last.at, link: { screen: 'report', code: r.code } });
    }
    if (db.enabled && auth.role === 'specialist') {
      const a = await db.query("SELECT code, title, created_at, due_at FROM mobile.field_assignments WHERE assignee_id = $1 AND status IN ('assigned','returned')", [auth.sub]);
      for (const x of a.rows) list.push({ id: `NV-${x.code}`, kind: 'assignment', title: `Nhiệm vụ mới ${x.code}`, body: x.title, at: x.created_at, link: { screen: 'task', code: x.code } });
    }
  }
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  let read = new Set();
  if (auth && db.enabled && list.length) {
    const r = await db.query('SELECT alert_id FROM mobile.notification_receipts WHERE user_id = $1 AND read_at IS NOT NULL AND alert_id = ANY($2)', [auth.sub, list.map((x) => x.id)]);
    read = new Set(r.rows.map((x) => x.alert_id));
  }
  return list.slice(0, 100).map((n) => ({ ...n, read: read.has(n.id) }));
}
async function markRead(auth, ids) {
  if (!db.enabled) return;
  for (const id of (ids || []).slice(0, 200)) {
    await db.query(`INSERT INTO mobile.notification_receipts (id, alert_id, kind, title, user_id, read_at) VALUES ($1,$2,'read','',$3, now())
      ON CONFLICT (alert_id, user_id) DO UPDATE SET read_at = now()`, [crypto.randomUUID(), String(id), auth.sub]);
  }
}

// web admin overview
async function adminOverview() {
  requireDb();
  const [a, v, s, c] = await Promise.all([
    db.query(`${ASG_SELECT} ORDER BY (a.status IN ('approved','cancelled')), a.created_at DESC LIMIT 500`),
    db.query("SELECT v.*, ST_Y(v.geom) lat, ST_X(v.geom) lon FROM mobile.incident_verifications v ORDER BY (review_status <> 'pending'), created_at DESC LIMIT 500"),
    db.query("SELECT id, code, surveyor, surveyor_id, geom_type, forest_type, is_dipterocarp, season, leaf_state, change_cause, notes, status, commune_code, observed_at, area_ha, length_m, gps_accuracy, review_note FROM mobile.field_surveys ORDER BY (status <> 'pending_review'), created_at DESC LIMIT 500"),
    db.query("SELECT e.*, u.username FROM mobile.mobile_sync_events e LEFT JOIN identity.users u ON u.id = e.user_id WHERE result = 'conflict' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 200"),
  ]);
  return {
    assignments: a.rows.map(asgView),
    verifications: v.rows.map((x) => ({ ...x, verdict_label: (VERDICTS[x.alert_kind] || {})[x.verdict] })),
    surveys: s.rows.map((x) => ({ ...x, forest_type_label: FOREST_TYPES[x.forest_type] || x.forest_type })),
    conflicts: c.rows,
  };
}
async function cancelAssignment(user, id) {
  requireDb();
  const a = await getAssignment(id);
  need(a && !['approved', 'cancelled'].includes(a.status), 409, 'BAD_STATE', 'Nhiệm vụ không thể huỷ.');
  await db.query(`UPDATE mobile.field_assignments SET status = 'cancelled', version = version + 1, updated_at = now(), history = history || $2::jsonb WHERE id = $1`,
    [a.id, JSON.stringify([{ at: new Date().toISOString(), by: user.username, status: 'cancelled' }])]);
  store.audit(user, 'field.assign.cancel', a.code);
}

module.exports = {
  FieldError, FOREST_TYPES, VERDICTS, CHANGE_CAUSES, ASSIGNMENT_STATUS,
  presign, receiveUpload, attachmentFor, createReport, myReports, ownView,
  createAssignment, getAssignment, listAssignments, openAssignment, changeAssignment, cancelAssignment,
  createSurvey, getSurvey, listSurveys, updateSurvey, reviewSurvey,
  createVerification, getVerification, listVerifications, reviewVerification,
  syncBatch, conflicts, resolveConflict, changes, registerDevice, notifications, markRead, adminOverview, UPLOAD_DIR,
};
