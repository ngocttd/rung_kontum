// Thông báo MobileGIS (không Firebase):
//  1. Nguồn sự thật: bảng mobile.notifications (PostgreSQL). Thông báo được sinh từ sự kiện nghiệp vụ đã chốt –
//     cảnh báo cháy đã phê duyệt, cháy đã xác minh, hồ sơ phản ánh đổi trạng thái, nhiệm vụ mới/trả lại, kết quả duyệt
//     xác minh. KHÔNG sinh từ điểm nóng chưa xác minh (đặc tả mục 9). source_ref UNIQUE chống trùng giữa nhiều tiến trình.
//  2. Giao tức thời qua Socket.IO (src/services/realtime.js) khi ứng dụng đang mở.
//  3. Push nền tảng khi ứng dụng ở nền/đã đóng: APNs (iOS), Web Push/UnifiedPush (Android, trình duyệt).
//     Bản ghi push chờ GRACE_MS; nếu Socket.IO đã giao được thì bỏ qua (không báo trùng).
const crypto = require('crypto');
const db = require('../db/pool');
const store = require('../data/store');
const repo = require('../data/repo');
const reports = require('./reports');
const apns = require('./push/apns');
const webpush = require('./push/webpush');

const GRACE_MS = 4000;
const MAX_ATTEMPTS = 6;
const RECENT_MS = 3 * 864e5; // chỉ phát sự kiện trong 3 ngày gần nhất (tránh dồn thông báo cũ khi mới triển khai)

// ---------- đối tượng nhận ----------
// d = { user_id, role, scope, communes[] } của thiết bị/kết nối
function matches(n, d) {
  if (n.target_user) return Boolean(d.user_id) && d.user_id === n.target_user;
  if (n.target_roles && n.target_roles.length) {
    if (!d.role || !n.target_roles.includes(d.role)) return false;
    return !n.target_communes || !n.target_communes.length || !d.scope || n.target_communes.includes(d.scope);
  }
  if (n.is_public) {
    const subs = d.communes || [];
    return !subs.length || !n.target_communes || !n.target_communes.length || subs.some((c) => n.target_communes.includes(c));
  }
  return false;
}
// cùng quy tắc bằng SQL cho thiết bị có kênh push (tham số $1 = notification row)
const DEVICE_MATCH_SQL = `
  SELECT d.id, d.push_provider FROM mobile.mobile_devices d LEFT JOIN identity.users u ON u.id = d.user_id
  WHERE d.push_enabled AND d.push_provider IS NOT NULL AND d.push_endpoint IS NOT NULL AND (
    ($1::uuid IS NOT NULL AND d.user_id = $1::uuid)
    OR ($1::uuid IS NULL AND $2::text[] IS NOT NULL AND u.role = ANY($2) AND ($3::text[] IS NULL OR u.scope IS NULL OR u.scope = ANY($3)))
    OR ($1::uuid IS NULL AND $2::text[] IS NULL AND $4 AND (cardinality(d.subscribed_communes) = 0 OR $3::text[] IS NULL OR d.subscribed_communes && $3::text[]))
  )`;

// ---------- tạo thông báo ----------
async function create(n) {
  if (!db.enabled) return null;
  const id = crypto.randomUUID();
  // một giao dịch: pg_notify (trigger) chỉ phát khi COMMIT, lúc đó các bản giao push đã có sẵn
  // → Socket.IO giao xong có thể huỷ đúng bản push đang chờ (không báo trùng)
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`INSERT INTO mobile.notifications (id, source_ref, kind, title, body, data, target_user, target_roles, target_communes, is_public, priority, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (source_ref) DO NOTHING RETURNING *`,
    [id, n.source_ref, n.kind, n.title.slice(0, 200), (n.body || '').slice(0, 1000), JSON.stringify(n.data || {}), n.target_user || null, n.target_roles || null, n.target_communes || null, Boolean(n.is_public), n.priority || 'normal', n.expires_at || null]);
    const row = r.rows[0];
    if (!row) { await client.query('ROLLBACK'); return null; } // đã có (tiến trình khác tạo trước)
    const devs = await client.query(DEVICE_MATCH_SQL, [row.target_user, row.target_roles, row.target_communes, row.is_public]);
    for (const d of devs.rows) {
      await client.query(`INSERT INTO mobile.notification_deliveries (id, notification_id, device_id, channel, next_attempt_at)
        VALUES ($1,$2,$3,$4, now() + ($5 || ' milliseconds')::interval) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), row.id, d.id, d.push_provider, String(GRACE_MS)]);
    }
    await client.query('COMMIT');
    return row;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

// ---------- quét sự kiện nghiệp vụ ----------
const recent = (t) => t && Date.now() - new Date(t).getTime() < RECENT_MS;
let scanning = false;
async function scan() {
  if (!db.enabled || scanning) return 0;
  scanning = true;
  let created = 0;
  const add = async (n) => { if (await create(n)) created += 1; };
  try {
    // a) cảnh báo nguy cơ cháy đã phê duyệt (công khai theo xã)
    const alerts = require('./alerts');
    for (const a of alerts.fireDangerAlerts(3)) {
      if (!a.official) continue;
      const d = store.getDecision('fire_danger', a.id);
      if (!d || !recent(d.updated_at || d.created_at)) continue;
      await add({
        source_ref: `fd:${a.id}`, kind: 'fire_danger', title: `Cảnh báo cháy rừng ${a.levelLabel} – ${a.commune}`, body: `${a.detail}${d.note ? `. ${d.note}` : ''}`,
        data: { screen: 'fire', commune: a.communeCode, date: a.date }, target_communes: [a.communeCode], is_public: true, priority: a.level >= 4 ? 'high' : 'normal',
        expires_at: new Date(new Date(`${a.date}T23:59:59+07:00`).getTime()).toISOString(),
      });
    }
    // b) cháy rừng đã xác minh (công khai theo xã)
    for (const h of repo.hotspots()) {
      if (h.status !== 'confirmed' || !h.decision || !recent(h.decision.updated_at)) continue;
      await add({
        source_ref: `hs:${h.id}:confirmed`, kind: 'fire_confirmed', title: `Đã xác minh cháy rừng tại ${h.commune || 'khu vực'}`, body: (h.decision.note || '').slice(0, 300),
        data: { screen: 'hotspot', id: h.id, commune: h.communeCode, lat: h.lat, lon: h.lon }, target_communes: h.communeCode ? [h.communeCode] : null, is_public: true, priority: 'high',
      });
    }
    // c) hồ sơ phản ánh của người dân đổi trạng thái / có phản hồi
    for (const r of store.filter('reports', (x) => x.created_by && x.timeline && x.timeline.length > 1)) {
      const last = r.timeline[r.timeline.length - 1];
      if (!recent(last.at)) continue;
      const label = reports.STATUS[last.status] ? reports.STATUS[last.status].label : last.status;
      await add({
        source_ref: `pa:${r.code}:${r.timeline.length}`, kind: 'report', title: `Phản ánh ${r.code}: ${label}`, body: last.public_note || r.response || 'Hồ sơ của bạn đã được cập nhật.',
        data: { screen: 'report', code: r.code }, target_user: r.created_by,
      });
    }
    // d) nhiệm vụ mới / bị trả lại → người được giao, hoặc cán bộ phụ trách xã nếu chưa giao
    const asg = await db.query(`SELECT id, code, title, status, assignee_id, scope_id, jsonb_array_length(history) h, updated_at FROM mobile.field_assignments
      WHERE status IN ('assigned','returned') AND updated_at > now() - interval '3 days'`);
    for (const a of asg.rows) {
      await add({
        source_ref: `nv:${a.id}:${a.status}:${a.h}`, kind: 'assignment', title: a.status === 'returned' ? `Nhiệm vụ ${a.code} bị trả lại` : `Nhiệm vụ mới ${a.code}`, body: a.title,
        data: { screen: 'task', id: a.id, code: a.code }, target_user: a.assignee_id || null, target_roles: a.assignee_id ? null : ['specialist'], target_communes: a.assignee_id || !a.scope_id ? null : [a.scope_id], priority: 'high',
      });
    }
    // e) kết quả duyệt xác minh → cán bộ đã xác minh
    const rev = await db.query(`SELECT r.id, r.decision, r.note, v.code, v.verifier_id, v.assignment_id FROM mobile.verification_reviews r JOIN mobile.incident_verifications v ON v.id = r.verification_id
      WHERE r.created_at > now() - interval '3 days' AND v.verifier_id IS NOT NULL`);
    for (const x of rev.rows) {
      await add({
        source_ref: `xm:${x.id}`, kind: 'verification', title: `Kết quả xác minh ${x.code} ${x.decision === 'approved' ? 'đã được duyệt' : 'bị trả lại'}`, body: x.note || '',
        data: { screen: 'task', id: x.assignment_id }, target_user: x.verifier_id,
      });
    }
  } catch (e) {
    console.warn('[notifier] quét lỗi:', e.message);
  } finally { scanning = false; }
  return created;
}

// ---------- gửi push nền tảng (hàng đợi, backoff, nhiều tiến trình an toàn) ----------
let dispatching = false;
async function dispatch() {
  if (!db.enabled || dispatching) return 0;
  dispatching = true;
  let n = 0;
  try {
    const claimed = await db.query(`UPDATE mobile.notification_deliveries x SET attempts = attempts + 1,
        next_attempt_at = now() + (least(3600, 30 * power(2, attempts)) || ' seconds')::interval
      WHERE x.id IN (SELECT id FROM mobile.notification_deliveries WHERE status = 'pending' AND channel <> 'socket' AND next_attempt_at <= now()
        ORDER BY next_attempt_at LIMIT 50 FOR UPDATE SKIP LOCKED)
      RETURNING x.id, x.notification_id, x.device_id, x.channel, x.attempts`);
    for (const c of claimed.rows) {
      const q = await db.query(`SELECT n.*, d.push_endpoint, d.push_keys, d.push_env, d.push_enabled FROM mobile.notifications n, mobile.mobile_devices d WHERE n.id = $1 AND d.id = $2`, [c.notification_id, c.device_id]);
      const row = q.rows[0];
      if (!row || !row.push_enabled) { await setStatus(c.id, 'gone', 'Thiết bị đã tắt push'); continue; }
      if (row.expires_at && new Date(row.expires_at) < new Date()) { await setStatus(c.id, 'skipped', 'Thông báo đã hết hạn'); continue; }
      const res = c.channel === 'apns'
        ? await apns.send(row.push_endpoint, row, { env: row.push_env })
        : await webpush.send({ endpoint: row.push_endpoint, keys: row.push_keys || {} }, row);
      if (res.ok) { await setStatus(c.id, 'sent'); n += 1; } else if (res.gone) {
        await setStatus(c.id, 'gone', res.reason);
        await db.query('UPDATE mobile.mobile_devices SET push_enabled = false, push_failed_at = now() WHERE id = $1', [c.device_id]);
      } else if (c.attempts >= MAX_ATTEMPTS || /chưa được cấu hình/.test(res.reason || '')) {
        await setStatus(c.id, 'failed', res.reason);
      } else {
        await db.query('UPDATE mobile.notification_deliveries SET last_error = $2 WHERE id = $1', [c.id, String(res.reason || res.status || '').slice(0, 500)]);
      }
    }
  } catch (e) {
    console.warn('[notifier] gửi push lỗi:', e.message);
  } finally { dispatching = false; }
  return n;
}
async function setStatus(id, status, err) {
  await db.query(`UPDATE mobile.notification_deliveries SET status = $2, last_error = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END WHERE id = $1`, [id, status, err ? String(err).slice(0, 500) : null]);
}

// Socket.IO đã giao tới thiết bị → ghi nhận và bỏ bản push đang chờ (không báo trùng)
async function deliveredBySocket(notificationId, deviceIds) {
  if (!db.enabled || !deviceIds.length) return;
  await db.query(`UPDATE mobile.notification_deliveries SET status = 'skipped', last_error = 'Đã giao qua Socket.IO' WHERE notification_id = $1 AND device_id = ANY($2) AND status = 'pending'`, [notificationId, deviceIds]);
  for (const d of deviceIds) {
    await db.query(`INSERT INTO mobile.notification_deliveries (id, notification_id, device_id, channel, status, attempts, sent_at)
      SELECT $1, $2, $3, 'socket', 'sent', 1, now() WHERE EXISTS (SELECT 1 FROM mobile.mobile_devices WHERE id = $3) ON CONFLICT DO NOTHING`, [crypto.randomUUID(), notificationId, d]).catch(() => {});
  }
}

// ---------- danh sách thông báo cho ứng dụng ----------
async function feed(auth, communes, { limit = 100 } = {}) {
  if (!db.enabled) return [];
  const u = auth ? store.get('users', auth.sub) : null;
  const d = { user_id: auth ? auth.sub : null, role: auth ? auth.role : null, scope: u ? u.scope || null : null, communes: communes || [] };
  const r = await db.query(`SELECT * FROM mobile.notifications WHERE created_at > now() - interval '30 days' AND (expires_at IS NULL OR expires_at > now() - interval '1 day')
    AND (target_user = $1::uuid OR target_user IS NULL) ORDER BY created_at DESC LIMIT 500`, [d.user_id]);
  const list = r.rows.filter((n) => matches(n, d)).slice(0, limit);
  let read = new Set();
  if (auth && list.length) {
    const rr = await db.query('SELECT alert_id FROM mobile.notification_receipts WHERE user_id = $1 AND read_at IS NOT NULL AND alert_id = ANY($2)', [auth.sub, list.map((x) => x.id)]);
    read = new Set(rr.rows.map((x) => x.alert_id));
  }
  return list.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, at: n.created_at, link: n.data, priority: n.priority, read: read.has(n.id) }));
}

async function stats() {
  if (!db.enabled) return null;
  const [n, d, dev] = await Promise.all([
    db.query("SELECT count(*)::int total, count(*) FILTER (WHERE created_at > now() - interval '1 day')::int today FROM mobile.notifications"),
    db.query("SELECT channel, status, count(*)::int n FROM mobile.notification_deliveries WHERE created_at > now() - interval '7 days' GROUP BY 1, 2 ORDER BY 1, 2"),
    db.query("SELECT coalesce(push_provider, 'chỉ Socket.IO') provider, count(*) FILTER (WHERE push_enabled)::int enabled, count(*)::int total FROM mobile.mobile_devices GROUP BY 1"),
  ]);
  return { notifications: n.rows[0], deliveries: d.rows, devices: dev.rows, apns: apns.configured(), webpush_public_key: webpush.publicKey() };
}

// ---------- vòng chạy ----------
let timers = [];
function start() {
  if (!db.enabled) return;
  webpush.publicKey(); // sinh khoá VAPID nếu chưa có
  let pending = null;
  const kick = () => { clearTimeout(pending); pending = setTimeout(() => scan().catch(() => {}), 800); };
  db.listen('store_changed', kick); // web/mobile/tiến trình khác thay đổi dữ liệu → quét ngay
  timers = [setInterval(() => scan().catch(() => {}), 30e3), setInterval(() => dispatch().catch(() => {}), 3e3)];
  timers.forEach((t) => t.unref());
  setTimeout(() => scan().catch(() => {}), 3000).unref();
}


module.exports = { create, scan, dispatch, deliveredBySocket, feed, matches, stats, start, GRACE_MS };
