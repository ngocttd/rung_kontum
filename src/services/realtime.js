// Socket.IO cho MobileGIS (namespace /mobile, đường dẫn /socket.io):
//  - xác thực bằng chính token truy cập của API (auth: { token, device_id, communes }); khách vẫn kết nối để nhận cảnh báo công khai;
//  - "notification": thông báo mới (phát từ pg_notify 'mobile_notification' nên mọi tiến trình máy chủ đều giao được),
//    ứng dụng xác nhận (ack) → ghi nhận đã giao, huỷ bản push nền tảng đang chờ;
//  - "changed": dữ liệu nghiệp vụ thay đổi (phản ánh, quyết định xác minh, nhiệm vụ…) → ứng dụng làm mới ngay (đồng bộ web ↔ mobile).
const { Server } = require('socket.io');
const db = require('../db/pool');
const store = require('../data/store');
const auth = require('./mobile-auth');
const notifier = require('./notifier');

let io = null;
const TABLES = {
  'ops.reports': 'reports', 'ops.decisions': 'alerts', 'ops.articles': 'news', 'ops.documents': 'documents', 'spatial.map_layers': 'layers',
  'mobile.field_assignments': 'assignments', 'mobile.field_surveys': 'surveys', 'mobile.incident_verifications': 'verifications', 'mobile.verification_reviews': 'verifications',
};
// những thay đổi chỉ cán bộ cần biết
const STAFF_ONLY = new Set(['assignments', 'surveys', 'verifications']);

function attach(httpServer) {
  io = new Server(httpServer, { path: '/socket.io', serveClient: false, cors: process.env.MOBILE_CORS_ORIGIN ? { origin: process.env.MOBILE_CORS_ORIGIN } : undefined, pingInterval: 25000, pingTimeout: 20000 });
  const nsp = io.of('/mobile');

  nsp.use(async (socket, next) => {
    try {
      const a = socket.handshake.auth || {};
      let user = null;
      if (a.token) {
        const p = auth.verifyAccess(a.token);
        if (!p || !(await auth.sidActive(p.sid))) return next(Object.assign(new Error('TOKEN_EXPIRED'), { data: { code: 'TOKEN_EXPIRED' } }));
        const u = store.get('users', p.sub);
        if (!u || !u.active) return next(new Error('INACTIVE'));
        user = { user_id: u.id, role: u.role, scope: u.scope || null, username: u.username };
      }
      const communes = Array.isArray(a.communes) ? a.communes.map(String).slice(0, 40) : [];
      const deviceId = /^[0-9a-f-]{36}$/i.test(String(a.device_id || '')) ? a.device_id : null;
      socket.data = { ...(user || { user_id: null, role: null, scope: null }), communes, deviceId };
      return next();
    } catch (e) { return next(e); }
  });

  nsp.on('connection', (socket) => {
    const d = socket.data;
    if (d.user_id) socket.join(`user:${d.user_id}`);
    socket.join(d.role && d.role !== 'citizen' ? 'staff' : 'public');
    if (d.deviceId && db.enabled) db.query('UPDATE mobile.mobile_devices SET last_seen_at = now() WHERE id = $1', [d.deviceId]).catch(() => {});
    // đổi danh sách xã theo dõi mà không cần kết nối lại
    socket.on('subscribe', (communes) => { if (Array.isArray(communes)) socket.data.communes = communes.map(String).slice(0, 40); });
    socket.emit('hello', { server_time: new Date().toISOString(), user: d.username || null });
  });

  if (db.enabled) {
    db.listen('mobile_notification', (id) => deliver(id).catch((e) => console.warn('[realtime]', e.message)));
    let timer = null; const changed = new Set();
    db.listen('store_changed', (payload) => {
      const c = TABLES[String(payload).split(':')[0]];
      if (!c) return;
      changed.add(c); clearTimeout(timer);
      timer = setTimeout(() => { for (const x of changed) (STAFF_ONLY.has(x) ? nsp.to('staff') : nsp).emit('changed', { collection: x, at: new Date().toISOString() }); changed.clear(); }, 400);
    });
  }
  return io;
}

// gửi một thông báo tới các kết nối phù hợp trong tiến trình này, chờ xác nhận
async function deliver(id) {
  if (!io) return;
  const r = await db.query('SELECT * FROM mobile.notifications WHERE id = $1', [id]);
  const n = r.rows[0];
  if (!n) return;
  const payload = { id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.data, priority: n.priority, at: n.created_at };
  const sockets = await io.of('/mobile').fetchSockets();
  const acked = [];
  await Promise.all(sockets.filter((s) => notifier.matches(n, s.data)).map(async (s) => {
    try {
      await s.timeout(notifier.GRACE_MS - 500).emitWithAck('notification', payload);
      if (s.data.deviceId) acked.push(s.data.deviceId);
    } catch { /* không xác nhận → để kênh push nền tảng gửi */ }
  }));
  await notifier.deliveredBySocket(n.id, [...new Set(acked)]);
}

const stats = async () => (io ? { connections: (await io.of('/mobile').fetchSockets()).length } : { connections: 0 });

module.exports = { attach, deliver, stats };
