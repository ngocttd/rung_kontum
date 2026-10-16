const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const compression = require('compression');
const config = require('./src/config');
const fmt = require('./src/lib/format');
const security = require('./src/middleware/security');
const content = require('./src/services/content');
const weather = require('./src/services/weather');
const jobs = require('./src/services/jobs');
const firms = require('./src/services/firms');
const maps = require('./src/services/maps');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(compression());
app.use(security.headers);
// Only public/ is static: data/, .env and .secrets/ are never exposed.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.env === 'production' ? '7d' : 0 }));
// MobileGIS web build (bản xem thử của ứng dụng Flutter: cd mobile && flutter build web --base-href /mobile-app/)
const mobileWeb = path.join(__dirname, 'mobile', 'build', 'web');
if (require('fs').existsSync(mobileWeb)) app.use('/mobile-app', express.static(mobileWeb, { maxAge: 0 }));
// XYZ tiles outside the data are not written (scripts/make_tiles.py): answer 204 so the map draws nothing
app.get(/^\/tiles\/[\w-]+\/\d+\/\d+\/\d+\.png$/, (req, res) => res.set('Cache-Control', 'public, max-age=86400').status(204).end());
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));
// Sessions live outside synced folders (OneDrive locks files during rename).
const sessionDir = process.env.SESSION_DIR || path.join(require('os').tmpdir(), 'webgis-kontum-sessions');
fs.mkdirSync(sessionDir, { recursive: true });
app.use(session({
  store: new FileStore({ path: sessionDir, retries: 2, logFn: () => {} }),
  secret: config.sessionSecret, resave: false, saveUninitialized: false, name: 'kt.sid',
  // COOKIE_SECURE=false chỉ khi tạm chạy HTTP (chưa có tên miền/HTTPS) – nếu không trình duyệt không gửi cookie đăng nhập
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : config.env === 'production', maxAge: 8 * 3600e3 },
}));

app.use((req, res, next) => {
  res.locals.fmt = fmt;
  res.locals.ic = (name, cls = '') => `<i class="ic ${cls}" style="--i:url(/assets/icons/${name}.svg)" aria-hidden="true"></i>`;
  res.locals.cicon = (name, alt = '') => `<img src="/assets/icons/colored/${name}.svg" alt="${alt}" loading="lazy">`;
  res.locals.paginate = require('./src/lib/paginate').paginate;
  res.locals.pageUrl = (n, key = 'trang') => { const u = new URL(req.originalUrl, 'http://x'); u.searchParams.set(key, n); return u.pathname + u.search; };
  res.locals.user = req.session.user || null;
  res.locals.can = (perm) => security.can(req.session.user, perm);
  res.locals.mapboxToken = config.mapboxToken;
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

// MobileGIS API (bearer tokens, no cookies). CORS only for an explicitly configured origin (e.g. Flutter web in dev).
app.use('/api/mobile', (req, res, next) => {
  const o = process.env.MOBILE_CORS_ORIGIN;
  if (o && req.get('origin') === o) {
    res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    if (req.method === 'OPTIONS') return res.status(204).end();
  }
  return next();
}, require('./src/routes/mobile'));
app.use('/api', require('./src/routes/api'));
app.use(security.csrf);
app.use('/quan-tri', require('./src/routes/admin'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => res.status(404).render('public/error', { title: 'Không tìm thấy trang', code: 404, message: 'Trang bạn tìm không tồn tại hoặc đã được di chuyển.', nav: '' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Lỗi máy chủ' });
  return res.status(500).render('public/error', { title: 'Lỗi hệ thống', code: 500, message: 'Đã xảy ra lỗi khi xử lý yêu cầu.', nav: '' });
});

const store = require('./src/data/store');

// Loads the data store (PostGIS or JSON fallback) before anything reads it.
app.ready = store.init().then((st) => {
  console.log(`Kho dữ liệu: ${st.backend === 'pg' ? 'PostgreSQL/PostGIS' : 'JSON (storage/)'}`);
  content.seed();
});

if (require.main === module) {
  app.ready.then(() => {
    weather.start();
    firms.start();
    maps.start();
    jobs.startScheduler();
    require('./src/services/notifier').start();
    // HOST=127.0.0.1 khi chạy sau reverse proxy (Caddy) trên VPS – không mở cổng 3000 ra ngoài
    const server = app.listen(config.port, config.host, () => console.log(`WebGIS rừng Kon Tum: http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`));
    const io = require('./src/services/realtime').attach(server); // Socket.IO /mobile cho MobileGIS
    // đóng Socket.IO trước (kết nối websocket giữ server.close() chờ) rồi ghi nốt hàng đợi DB
    const stop = () => { io.close(); server.close(); server.closeAllConnections(); store.drain().then(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  });
}

module.exports = app;
