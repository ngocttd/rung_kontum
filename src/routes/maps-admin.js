// Quản trị → Bản đồ và lớp dữ liệu → Quản lý bản đồ (PL.1–PL.8)
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const maps = require('../services/maps');
const store = require('../data/store');
const { requirePerm, checkCsrf, can } = require('../middleware/security');

const r = express.Router();
const TMP = path.join(maps.MAP_DIR, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const upload = multer({ dest: TMP, limits: { fileSize: 2048 * 1024 * 1024, files: 1 } });
const flash = (req, type, text) => { req.session.flash = { type, text }; };
const me = (req) => req.session.user;
const wantsJson = (req) => req.get('x-requested-with') === 'fetch' || req.accepts(['html', 'json']) === 'json';

r.use((req, res, next) => {
  if (!maps.enabled()) return res.status(503).render('admin/forbidden', { title: 'Cần cơ sở dữ liệu', perm: 'Phân hệ bản đồ yêu cầu PostgreSQL/PostGIS (DB_*)' });
  res.locals.section = 'maps'; res.locals.M = maps;
  return next();
});

r.get('/', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const list = await maps.list({ format: req.query.loai, status: req.query.trang_thai, q: req.query.q, year: req.query.nam, category: req.query.nhom });
    const all = await maps.list({});
    if (req.query.xuat === 'csv') {
      const head = ['id', 'title', 'format', 'category', 'map_year', 'status', 'access', 'georeferenced', 'source_org', 'created_by', 'created_at', 'size_bytes'];
      const csv = [head.join(','), ...list.map((d) => head.map((h) => `"${String(d[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
      return res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="danh-sach-ban-do.csv"').send(`﻿${csv}`);
    }
    const counts = { all: all.length }; all.forEach((d) => { counts[d.format] = (counts[d.format] || 0) + 1; });
    return res.render('admin/maps', { title: 'Quản lý bản đồ', list, counts, filter: req.query, years: [...new Set(all.map((d) => d.map_year).filter(Boolean))].sort() });
  } catch (e) { return next(e); }
});

r.get('/moi', requirePerm('maps.manage'), (req, res) => res.render('admin/map-new', { title: 'Thêm bản đồ', type: req.query.loai || 'geotiff' }));

r.post('/moi', requirePerm('maps.manage'), upload.single('file'), checkCsrf, async (req, res) => {
  try {
    if (!req.file) throw new Error('Chưa chọn tệp');
    if (!String(req.body.title || '').trim()) throw new Error('Cần nhập tên bản đồ');
    const d = await maps.create({ ...req.body, title: String(req.body.title).trim().slice(0, 250) }, req.file, me(req));
    store.audit(me(req), 'map.upload', d.title);
    const url = `/quan-tri/ban-do/${d.id}`;
    return wantsJson(req) ? res.json({ ok: true, id: d.id, url }) : res.redirect(url);
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (wantsJson(req)) return res.status(400).json({ ok: false, error: e.message });
    flash(req, 'error', e.message); return res.redirect('/quan-tri/ban-do/moi');
  }
});

r.get('/:id', requirePerm('dashboard.view'), async (req, res, next) => {
  try {
    const d = await maps.get(req.params.id);
    if (!d) return next();
    return res.render('admin/map-detail', { title: d.title, d, step: req.query.buoc });
  } catch (e) { return next(e); }
});

r.get('/:id/trang-thai', requirePerm('dashboard.view'), async (req, res) => {
  const d = await maps.get(req.params.id);
  if (!d) return res.status(404).json({});
  const j = d.jobs[0] || null;
  return res.json({ status: d.status, statusLabel: maps.STATUS[d.status][0], georeferenced: d.georeferenced, overlay_url: d.overlay_url, job: j && { type: j.job_type, status: j.status, error: j.error_message, attempts: j.attempts } });
});

const act = (perm, fn, okText) => [requirePerm(perm), async (req, res) => {
  try { await fn(req); store.audit(me(req), `map.${req.path.split('/').pop()}`, req.params.id); flash(req, 'ok', okText); }
  catch (e) { flash(req, 'error', e.message); }
  return res.redirect(`/quan-tri/ban-do/${req.params.id}`);
}];

r.post('/:id/thong-tin', ...act('maps.manage', (req) => maps.updateMeta(req.params.id, req.body, me(req)), 'Đã lưu thông tin bản đồ.'));
r.post('/:id/cau-hinh', ...act('maps.manage', (req) => maps.configure(req.params.id, {
  mode: req.body.mode === 'single' ? 'single' : 'rgb', band: Number(req.body.band) || 1, palette: req.body.palette || 'greens',
  min: req.body.min !== '' && req.body.min !== undefined ? Number(req.body.min) : undefined, max: req.body.max !== '' && req.body.max !== undefined ? Number(req.body.max) : undefined,
  opacity: Math.min(1, Math.max(0, Number(req.body.opacity) || 0.8)), clip: req.body.clip === 'on',
  nodata_rgb: req.body.nodata_rgb ? String(req.body.nodata_rgb).split(',').map(Number).slice(0, 3) : undefined,
}, me(req)), 'Đã lưu cấu hình, đang xử lý tạo lớp hiển thị.'));
r.post('/:id/nan-chinh', ...act('maps.manage', (req) => maps.georeference(req.params.id, { page: Number(req.body.page) || 1, method: req.body.method === 'poly2' ? 'poly2' : 'affine', gcps: JSON.parse(req.body.gcps || '[]') }, me(req)), 'Đang tính biến đổi và tạo raster định vị.'));
r.post('/:id/gui-duyet', ...act('maps.manage', (req) => maps.submit(req.params.id, me(req)), 'Đã gửi duyệt.'));
r.post('/:id/xuat-ban', ...act('maps.publish', (req) => maps.publish(req.params.id, me(req), String(req.body.note || '').slice(0, 1000)), 'Đã xuất bản bản đồ.'));
r.post('/:id/tra-ve', ...act('maps.publish', (req) => maps.setStatus(req.params.id, 'rejected', me(req), String(req.body.note || '').slice(0, 1000)), 'Đã trả về để hiệu chỉnh.'));
r.post('/:id/thu-hoi', ...act('maps.publish', (req) => maps.setStatus(req.params.id, 'revoked', me(req), String(req.body.note || '').slice(0, 1000)), 'Đã thu hồi bản đồ.'));
r.post('/:id/xoa', requirePerm('maps.publish'), async (req, res) => {
  try { await maps.remove(req.params.id, me(req)); store.audit(me(req), 'map.delete', req.params.id); flash(req, 'ok', 'Đã xoá bộ dữ liệu.'); return res.redirect('/quan-tri/ban-do'); }
  catch (e) { flash(req, 'error', e.message); return res.redirect(`/quan-tri/ban-do/${req.params.id}`); }
});
r.post('/:id/phien-ban', requirePerm('maps.manage'), upload.single('file'), checkCsrf, async (req, res) => {
  try { if (!req.file) throw new Error('Chưa chọn tệp'); await maps.replaceFile(req.params.id, req.file, me(req)); flash(req, 'ok', 'Đã tải phiên bản mới; bản đang xuất bản được giữ đến khi bản mới được duyệt.'); }
  catch (e) { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); flash(req, 'error', e.message); }
  return res.redirect(`/quan-tri/ban-do/${req.params.id}`);
});

module.exports = r;
module.exports.can = can;
