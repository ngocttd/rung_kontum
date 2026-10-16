// Citizen field reports (P06 / A08). Personal contact data is never sent to public pages;
// public listing only includes reports staff marked as public, with coordinates rounded.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { paths } = require('../config');
const store = require('../data/store');
const repo = require('../data/repo');

const TYPES = {
  'chay-rung': { label: 'Cháy rừng', marker: 'fire-investigating' },
  'pha-rung': { label: 'Phá rừng, khai thác trái phép', marker: 'forest-violation' },
  'lan-chiem': { label: 'Xâm lấn đất rừng', marker: 'land-encroachment' },
  'van-chuyen': { label: 'Vận chuyển lâm sản trái phép', marker: 'timber-transport' },
  'dong-vat': { label: 'Động vật hoang dã', marker: 'wildlife' },
  khac: { label: 'Khác', marker: 'report-other' },
};
const STATUS = {
  received: { label: 'Đã tiếp nhận', tone: 'info' },
  verifying: { label: 'Đang xác minh', tone: 'warn' },
  processing: { label: 'Đang xử lý', tone: 'danger' },
  resolved: { label: 'Đã xử lý', tone: 'ok' },
  rejected: { label: 'Không đủ căn cứ', tone: 'muted' },
  closed: { label: 'Đã đóng', tone: 'muted' },
};

const PHOTO_DIR = path.join(paths.uploads, 'reports');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

// Re-encode uploads: strips EXIF (including hidden GPS), bounds size, rejects non-images.
async function savePhotos(files) {
  const out = [];
  for (const f of files || []) {
    const name = `${crypto.randomUUID()}.webp`;
    await sharp(f.buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(PHOTO_DIR, name));
    out.push(name);
  }
  return out;
}

async function create(input, files) {
  const lat = Number(input.lat); const lon = Number(input.lon);
  const commune = Number.isFinite(lat) && Number.isFinite(lon) ? repo.communeAt(lon, lat) : null;
  const photos = await savePhotos(files);
  const code = store.nextCode('PA');
  const row = store.insert('reports', {
    code, type: TYPES[input.type] ? input.type : 'khac', description: String(input.description || '').slice(0, 3000),
    lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, location_text: String(input.location_text || '').slice(0, 300),
    commune_code: commune ? commune.code : null, commune_name: commune ? commune.fullName : null,
    observed_at: input.observed_at || null,
    reporter: { name: String(input.name || '').slice(0, 120), phone: String(input.phone || '').slice(0, 30), email: String(input.email || '').slice(0, 120) },
    photos, status: 'received', public: false, public_photos: false, assigned_to: null, response: null,
    timeline: [{ at: store.now(), status: 'received', note: 'Hệ thống tiếp nhận phản ánh', by: 'system' }],
  });
  return row;
}

function decorate(r) {
  return { ...r, typeLabel: TYPES[r.type].label, marker: TYPES[r.type].marker, statusLabel: STATUS[r.status].label, statusTone: STATUS[r.status].tone };
}

// Public view: no reporter data, coordinates rounded to ~1 km, internal notes removed.
function publicView(r) {
  const d = decorate(r);
  return {
    code: d.code, type: d.type, typeLabel: d.typeLabel, marker: d.marker, status: d.status, statusLabel: d.statusLabel, statusTone: d.statusTone,
    description: d.description, commune_name: d.commune_name, created_at: d.created_at, observed_at: d.observed_at,
    lat: d.lat !== null ? Math.round(d.lat * 100) / 100 : null, lon: d.lon !== null ? Math.round(d.lon * 100) / 100 : null,
    photos: d.public_photos ? d.photos.map((p) => `/phan-anh/anh/${p}`) : [], response: d.response,
    timeline: d.timeline.map((t) => ({ at: t.at, status: t.status, label: STATUS[t.status] ? STATUS[t.status].label : t.status, note: t.public_note || null })),
  };
}

function listPublic(filter = {}) {
  return store.filter('reports', (r) => r.public && (!filter.type || r.type === filter.type) && (!filter.status || r.status === filter.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(publicView);
}

function byCode(code) { return store.find('reports', (r) => r.code === String(code || '').trim().toUpperCase()); }

function counts() {
  const all = store.all('reports');
  const byType = Object.fromEntries(Object.keys(TYPES).map((k) => [k, all.filter((r) => r.public && r.type === k).length]));
  return { total: all.length, public: all.filter((r) => r.public).length, open: all.filter((r) => ['received', 'verifying', 'processing'].includes(r.status)).length, byType };
}

module.exports = { TYPES, STATUS, create, decorate, publicView, listPublic, byCode, counts, PHOTO_DIR };
