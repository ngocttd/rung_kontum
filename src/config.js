const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');

// Session secret: env value, else a random one persisted under storage/ (never committed).
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const fs = require('fs');
  const file = path.join(ROOT, 'storage', '.session-secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* create below */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const secret = require('crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

module.exports = {
  ROOT,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',
  sessionSecret: sessionSecret(),
  // Mapbox public token is meant for the browser; restrict its URL scope in the Mapbox account.
  mapboxToken: process.env.MAPBOX_TOKEN || '',
  openWeatherKey: process.env.OPENWEATHER_KEY || '',
  // Draft articles compiled for the project are shown with a "chờ duyệt" badge unless disabled.
  showDraftContent: process.env.SHOW_DRAFT_CONTENT !== 'false',
  enableDataJobs: process.env.ENABLE_DATA_JOBS !== 'false', // automatic analysis runs (src/services/jobs.js), on by default
  python: process.env.PYTHON || 'python',
  paths: {
    data: path.join(ROOT, 'data'),
    web: path.join(ROOT, 'data', 'web'),
    processed: path.join(ROOT, 'data', 'processed'),
    collected: path.join(ROOT, 'data', 'collected'),
    content: path.join(ROOT, 'data', 'content'),
    boundaries: path.join(ROOT, 'data', 'boundaries'),
    storage: process.env.STORAGE_DIR || path.join(ROOT, 'storage'),
    uploads: path.join(process.env.STORAGE_DIR || path.join(ROOT, 'storage'), 'uploads'),
    scripts: path.join(ROOT, 'scripts'),
  },
  tz: 'Asia/Ho_Chi_Minh',
};
