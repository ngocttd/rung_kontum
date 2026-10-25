const crypto = require('crypto');

const ROLES = {
  admin: 'Quản trị hệ thống',
  leader: 'Lãnh đạo UBND',
  specialist: 'Cán bộ Sở NN&MT / Kiểm lâm',
  citizen: 'Người dân (tài khoản MobileGIS)',
};
// roles that may use the web admin; citizens only use the mobile app / public site
const STAFF_ROLES = ['admin', 'leader', 'specialist'];

// Platform admins do not approve professional decisions (alerts, verification) — see đặc tả mục 2.
const PERMISSIONS = {
  'dashboard.view': ['admin', 'leader', 'specialist'],
  'data.manage': ['admin', 'specialist'],
  'alerts.verify': ['specialist'],
  'alerts.approve': ['specialist', 'leader'],
  // nhập tay điểm cháy (tin báo); chỉ người có alerts.verify mới nhập ở trạng thái "Xác nhận cháy"
  'alerts.manual': ['admin', 'leader', 'specialist'],
  'reports.view': ['admin', 'leader', 'specialist'],
  // cập nhật trạng thái, phân công, phản hồi và đánh dấu "đã kiểm tra" hồ sơ phản ánh
  'reports.manage': ['admin', 'leader', 'specialist'],
  'news.manage': ['admin', 'specialist'],
  'news.publish': ['admin', 'specialist'],
  'docs.manage': ['admin', 'specialist'],
  'maps.manage': ['admin', 'specialist'],
  'maps.publish': ['admin'],
  'jobs.run': ['admin', 'specialist'],
  'users.manage': ['admin'],
  'audit.view': ['admin', 'leader'],
  // MobileGIS (đặc tả MobileGIS mục 3)
  'reports.own': ['citizen', 'specialist', 'leader', 'admin'],
  'tasks.assign': ['specialist', 'leader'],
  'field.survey': ['specialist'],
  'field.verify': ['specialist'],
  'field.review': ['specialist', 'leader'],
  'mobile.sync': ['citizen', 'specialist'],
};

function can(user, perm) { return Boolean(user && PERMISSIONS[perm] && PERMISSIONS[perm].includes(user.role)); }

function requireLogin(req, res, next) {
  if (req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Cần đăng nhập' });
  return res.redirect(`/quan-tri/dang-nhap?next=${encodeURIComponent(req.originalUrl)}`);
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (can(req.session.user, perm)) return next();
    if (req.accepts('html')) return res.status(403).render('admin/forbidden', { title: 'Không có quyền', perm });
    return res.status(403).json({ error: 'Không có quyền' });
  };
}

function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  // multipart bodies are parsed later by multer; those routes call checkCsrf after upload
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('multipart/form-data')) {
    const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (token !== req.session.csrf) return res.status(403).send('Phiên làm việc đã hết hạn, vui lòng tải lại trang.');
  }
  return next();
}

function checkCsrf(req, res, next) {
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!req.session.csrf || token !== req.session.csrf) return res.status(403).send('Phiên làm việc đã hết hạn, vui lòng tải lại trang.');
  return next();
}

// Simple fixed-window limiter per IP and key (in memory; sufficient for a single-node deployment).
const hits = new Map();
function rateLimit(key, max, windowMs) {
  return (req, res, next) => {
    const k = `${key}:${req.ip}`;
    const now = Date.now();
    const h = hits.get(k);
    if (!h || now - h.start > windowMs) { hits.set(k, { start: now, n: 1 }); return next(); }
    h.n += 1;
    if (h.n > max) return res.status(429).send('Bạn thao tác quá nhanh, vui lòng thử lại sau.');
    return next();
  };
}

function headers(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  next();
}

module.exports = { ROLES, STAFF_ROLES, PERMISSIONS, can, requireLogin, requirePerm, csrf, checkCsrf, rateLimit, headers };
