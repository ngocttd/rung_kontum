// Lớp vector bổ sung (spatial.map_layers): chuyển đổi định dạng, kiểm tra hình học và vòng đời
// tải lên → vùng chờ (staging) → công bố. Dùng chung cho trang quản trị và API quản lý lớp (/api/v1/layers).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { paths, python } = require('../config');
const store = require('../data/store');

function validateGeoJSON(gj) {
  const errors = [];
  if (!gj || !['FeatureCollection', 'Feature'].includes(gj.type)) return { errors: ['Không phải GeoJSON FeatureCollection/Feature'] };
  const feats = gj.type === 'Feature' ? [gj] : gj.features || [];
  if (!feats.length) errors.push('Không có đối tượng');
  if (gj.crs && !/4326|CRS84/i.test(JSON.stringify(gj.crs))) errors.push('Hệ tọa độ phải là EPSG:4326 (WGS84)');
  const types = new Set(); let outside = 0; let bad = 0;
  const visit = (c, depth) => { if (typeof c[0] === 'number') { const [x, y] = c; if (!(x >= 102 && x <= 110 && y >= 8 && y <= 24)) outside += 1; return; } c.forEach((cc) => visit(cc, depth + 1)); };
  feats.forEach((f) => {
    if (!f.geometry || !f.geometry.coordinates) { bad += 1; return; }
    types.add(f.geometry.type);
    try { visit(f.geometry.coordinates, 0); } catch { bad += 1; }
  });
  if (bad) errors.push(`${bad} đối tượng thiếu/hỏng hình học`);
  if (outside) errors.push(`${outside} tọa độ nằm ngoài phạm vi Việt Nam – kiểm tra hệ tọa độ (cần lon/lat WGS84)`);
  return { errors, count: feats.length, types: [...types], fc: gj.type === 'Feature' ? { type: 'FeatureCollection', features: [gj] } : gj };
}

// Nhập lớp từ GeoJSON, Shapefile (.zip), Excel (.xlsx) hoặc CSV có cột toạ độ – chuyển về GeoJSON WGS84 bằng scripts/convert_layer.py
const LAYER_EXT = /\.(geojson|json|zip|xlsx|csv)$/i;
function convertLayer(buf, name, crs) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kt-layer-'));
  try {
    const inp = path.join(tmp, `in${path.extname(name).toLowerCase()}`); const out = path.join(tmp, 'out.geojson');
    fs.writeFileSync(inp, buf);
    const r = require('child_process').spawnSync(python, [path.join(paths.scripts, 'convert_layer.py'), inp, out, crs || 'auto'], { encoding: 'utf8', timeout: 120000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
    let info = null; try { info = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch { info = null; }
    if (!info) throw new Error(`Không đọc được tệp (${String(r.stderr || '').split('\n').filter(Boolean).pop() || 'lỗi chuyển đổi'})`);
    if (!info.ok) throw new Error(info.error);
    return { gj: JSON.parse(fs.readFileSync(out, 'utf8')), info };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function create(user, { title, source, description, color, gj, info, originalName }) {
  const v = validateGeoJSON(gj);
  if (info && info.warnings && info.warnings.length) v.warnings = info.warnings;
  const row = store.insert('layers', {
    title: String(title || originalName || 'Lớp không tên').slice(0, 160), source: String(source || '').slice(0, 200), description: String(description || '').slice(0, 1000),
    style: { color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#00bcd4' }, original_name: originalName || null,
    status: v.errors.length ? 'invalid' : 'staging',
    validation: { errors: v.errors, count: v.count, types: v.types, warnings: v.warnings || [], source_format: info ? info.format : '.geojson', source_crs: info ? info.source_crs : 'EPSG:4326' },
    geojson: v.errors.length ? null : v.fc, uploaded_by: user.username,
  });
  store.audit(user, 'layer.upload', row.title, row.validation);
  return { row, v };
}
function update(user, id, b) {
  const l = store.get('layers', id); if (!l) return null;
  const patch = {};
  if (b.title !== undefined) patch.title = String(b.title || l.title).slice(0, 160);
  if (b.source !== undefined) patch.source = String(b.source || '').slice(0, 200);
  if (b.description !== undefined) patch.description = String(b.description || '').slice(0, 1000);
  if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color)) patch.style = { ...(l.style || {}), color: b.color };
  const row = store.update('layers', id, patch);
  store.audit(user, 'layer.edit', row.title);
  return row;
}
function setStatus(user, id, status) {
  const l = store.get('layers', id); if (!l) return null;
  if (!['published', 'staging'].includes(status) || l.status === 'invalid') throw Object.assign(new Error('Trạng thái không hợp lệ hoặc lớp chưa qua kiểm tra'), { status: 400 });
  const row = store.update('layers', id, { status, reviewed_by: user.username });
  store.audit(user, `layer.${status}`, l.title);
  return row;
}
function remove(user, id) { const l = store.get('layers', id); if (!l) return false; store.remove('layers', id); store.audit(user, 'layer.delete', l.title); return true; }
const summary = (l) => ({ id: l.id, title: l.title, source: l.source, description: l.description, status: l.status, style: l.style, validation: l.validation, uploaded_by: l.uploaded_by, reviewed_by: l.reviewed_by || null, created_at: l.created_at, updated_at: l.updated_at });

module.exports = { validateGeoJSON, convertLayer, LAYER_EXT, create, update, setStatus, remove, summary };
