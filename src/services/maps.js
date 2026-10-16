// Phân hệ nhập và quản lý bản đồ PDF/GeoTIFF (FR01–FR07 của báo cáo chuyên đề).
// Node API: kiểm tra quyền, lưu tệp, ghi PostGIS, đưa việc vào hàng đợi; Python worker (scripts/map_worker.py)
// đọc metadata, tạo ảnh xem trước, tạo overlay/COG, nắn chỉnh PDF bằng điểm khống chế.
// Status flow: uploaded → processing → needs_georef | ready → pending_review → published (→ revoked) ; rejected → chỉnh sửa lại.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const config = require('../config');
const db = require('../db/pool');

const MAP_DIR = path.join(config.paths.storage, 'maps');
fs.mkdirSync(MAP_DIR, { recursive: true });

const FORMATS = { geotiff: 'GeoTIFF (Raster)', pdf: 'PDF bản đồ', raster_image: 'Ảnh bản đồ (chưa định vị)', package: 'Gói bản đồ (khác)' };
const STATUS = {
  uploaded: ['Đã tải lên', 'b-gray'], processing: ['Đang xử lý', 'b-blue'], needs_georef: ['Cần nắn chỉnh', 'b-orange'], ready: ['Chờ gửi duyệt', 'b-yellow'],
  pending_review: ['Chờ duyệt', 'b-orange'], published: ['Đã xuất bản', 'b-green'], rejected: ['Trả về hiệu chỉnh', 'b-red'], revoked: ['Đã thu hồi', 'b-gray'], failed: ['Lỗi xử lý', 'b-red'],
};
const CATEGORIES = { 'tai-nguyen-rung': 'Tài nguyên rừng', 'bien-dong': 'Biến động rừng', 'quy-hoach': 'Quy hoạch rừng', 'khi-hau': 'Khí hậu – nhiệt độ', 'dia-hinh': 'Địa hình', 'hanh-chinh': 'Hành chính', khac: 'Khác' };
const LIMITS = { geotiff: 2048, pdf: 200, raster_image: 500, package: 2048 }; // MB

const enabled = () => db.enabled;

// ---------- storage keys ----------
function resolveKey(key) {
  if (key.startsWith('storage:')) return path.join(config.paths.storage, key.slice(8));
  if (key.startsWith('data:')) return path.join(config.paths.data, key.slice(5));
  throw new Error('storage_key không hợp lệ');
}
const dsDir = (id) => path.join(MAP_DIR, id);

function detectFormat(filename, head) {
  const ext = path.extname(filename).toLowerCase();
  const isPdf = head.slice(0, 5).toString() === '%PDF-';
  const isTiff = head.slice(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || head.slice(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
    || head.slice(0, 4).equals(Buffer.from([0x49, 0x49, 0x2b, 0x00])) || head.slice(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2b]));
  if (ext === '.pdf' && isPdf) return 'pdf';
  if (['.tif', '.tiff'].includes(ext) && isTiff) return 'geotiff';
  if (['.png', '.jpg', '.jpeg'].includes(ext)) return 'raster_image';
  if (['.mpk', '.zip'].includes(ext)) return 'package';
  return null;
}

// ---------- audit ----------
async function audit(datasetId, user, action, details) {
  await db.query('INSERT INTO maps.map_audit_logs (dataset_id, actor_id, action, details) VALUES ($1,$2,$3,$4)', [datasetId, user ? user.username : 'system', action, details ? JSON.stringify(details) : null]);
}

// ---------- queries ----------
async function list({ format, status, q, year, category } = {}) {
  const where = []; const v = [];
  const add = (sql, val) => { v.push(val); where.push(sql.replace('?', `$${v.length}`)); };
  if (format) add('d.format = ?', format);
  if (status) add('d.status = ?', status);
  if (category) add('d.category = ?', category);
  if (year) add('d.map_year = ?', Number(year));
  if (q) add('(d.title ILIKE ? OR d.description ILIKE $' + (v.length + 1) + ')', `%${q}%`);
  if (q) v.push(`%${q}%`);
  const r = await db.query(`SELECT d.*, (SELECT size_bytes FROM maps.map_files f WHERE f.dataset_id = d.id AND f.file_role = 'original' ORDER BY version_no DESC LIMIT 1) AS size_bytes,
      (SELECT status FROM maps.map_processing_jobs j WHERE j.dataset_id = d.id ORDER BY created_at DESC LIMIT 1) AS job_status
    FROM maps.map_datasets d ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.updated_at DESC`, v);
  return r.rows;
}

async function get(id) {
  const d = (await db.query('SELECT * FROM maps.map_datasets WHERE id = $1', [id])).rows[0];
  if (!d) return null;
  const [files, ref, jobs, versions, logs] = await Promise.all([
    db.query('SELECT * FROM maps.map_files WHERE dataset_id = $1 ORDER BY version_no DESC, file_role, page_no', [id]),
    db.query('SELECT srid, original_wkt, bbox_json, georef_method, gcps, residual_error, ST_AsGeoJSON(footprint)::json AS footprint FROM maps.map_spatial_refs WHERE dataset_id = $1', [id]),
    db.query('SELECT * FROM maps.map_processing_jobs WHERE dataset_id = $1 ORDER BY created_at DESC LIMIT 20', [id]),
    db.query('SELECT * FROM maps.map_versions WHERE dataset_id = $1 ORDER BY version_no DESC', [id]),
    db.query('SELECT * FROM maps.map_audit_logs WHERE dataset_id = $1 ORDER BY created_at DESC LIMIT 50', [id]),
  ]);
  return { ...d, files: files.rows, ref: ref.rows[0] || null, jobs: jobs.rows, versions: versions.rows, logs: logs.rows };
}

// ---------- create / update ----------
async function create(meta, file, user) {
  const head = Buffer.alloc(8); const fd = fs.openSync(file.path, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
  const format = detectFormat(file.originalname, head);
  if (!format) throw new Error('Định dạng không hỗ trợ hoặc nội dung tệp không khớp phần mở rộng (chỉ nhận .tif/.tiff, .pdf, .png/.jpg, .mpk/.zip)');
  if (meta.expect && meta.expect !== format && !(meta.expect === 'geotiff' && format === 'raster_image')) throw new Error(`Tệp là ${FORMATS[format]}, không khớp loại đã chọn (${FORMATS[meta.expect]})`);
  if (file.size > LIMITS[format] * 1024 * 1024) throw new Error(`Tệp vượt giới hạn ${LIMITS[format]} MB cho ${FORMATS[format]}`);
  const d = (await db.query(`INSERT INTO maps.map_datasets (title, description, category, source_org, acquisition_date, map_year, map_scale, license, format, access, status, created_by, updated_by, current_version)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'uploaded',$11,$11,1) RETURNING *`,
  [meta.title, meta.description || null, CATEGORIES[meta.category] ? meta.category : 'khac', meta.source_org || null, meta.acquisition_date || null, meta.map_year ? Number(meta.map_year) : null,
    meta.map_scale || null, meta.license || null, format, meta.access === 'internal' ? 'internal' : 'public', user.username])).rows[0];
  const dir = path.join(dsDir(d.id), 'v1'); fs.mkdirSync(dir, { recursive: true });
  const name = `original${path.extname(file.originalname).toLowerCase()}`;
  fs.renameSync(file.path, path.join(dir, name));
  await db.query(`INSERT INTO maps.map_files (dataset_id, file_role, version_no, storage_key, original_filename, mime_type, size_bytes) VALUES ($1,'original',1,$2,$3,$4,$5)`,
    [d.id, `storage:maps/${d.id}/v1/${name}`, file.originalname, file.mimetype, file.size]);
  await db.query('INSERT INTO maps.map_spatial_refs (dataset_id, srid) VALUES ($1, $2) ON CONFLICT (dataset_id) DO NOTHING', [d.id, meta.expected_srid ? Number(meta.expected_srid) : null]);
  await audit(d.id, user, 'upload', { file: file.originalname, size: file.size, format });
  await enqueue(d.id, 'inspect', {}, user);
  return d;
}

// Register a file that already exists under data/ (handover data) without copying it.
async function registerExisting(meta, relPath, user, opts = {}) {
  const abs = path.join(config.paths.data, relPath);
  const st = fs.statSync(abs);
  const exists = (await db.query(`SELECT d.id FROM maps.map_datasets d JOIN maps.map_files f ON f.dataset_id = d.id AND f.file_role = 'original' WHERE f.storage_key = $1`, [`data:${relPath}`])).rows[0];
  if (exists) return { id: exists.id, existed: true };
  const head = Buffer.alloc(8); const fd = fs.openSync(abs, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
  const format = meta.format || detectFormat(abs, head);
  const d = (await db.query(`INSERT INTO maps.map_datasets (title, description, category, source_org, map_year, map_scale, license, format, access, status, created_by, updated_by, current_version, display)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploaded',$10,$10,1,$11) RETURNING *`,
  [meta.title, meta.description || null, meta.category || 'khac', meta.source_org || null, meta.map_year || null, meta.map_scale || null, meta.license || null, format, meta.access || 'public', user.username, JSON.stringify(opts.display || {})])).rows[0];
  await db.query(`INSERT INTO maps.map_files (dataset_id, file_role, version_no, storage_key, original_filename, mime_type, size_bytes) VALUES ($1,'original',1,$2,$3,$4,$5)`,
    [d.id, `data:${relPath}`, path.basename(relPath), format === 'pdf' ? 'application/pdf' : format === 'package' ? 'application/octet-stream' : 'image/tiff', st.size]);
  await db.query('INSERT INTO maps.map_spatial_refs (dataset_id) VALUES ($1) ON CONFLICT DO NOTHING', [d.id]);
  await audit(d.id, user, 'register_handover', { path: relPath });
  if (format !== 'package') await enqueue(d.id, 'inspect', { autoPublish: opts.autoPublish || null }, user);
  else await db.query("UPDATE maps.map_datasets SET status = 'ready' WHERE id = $1", [d.id]);
  return { id: d.id, existed: false };
}

async function updateMeta(id, meta, user) {
  await db.query(`UPDATE maps.map_datasets SET title = $2, description = $3, category = $4, source_org = $5, map_year = $6, map_scale = $7, license = $8, access = $9, acquisition_date = $10, updated_by = $11, updated_at = now() WHERE id = $1`,
    [id, meta.title, meta.description || null, CATEGORIES[meta.category] ? meta.category : 'khac', meta.source_org || null, meta.map_year ? Number(meta.map_year) : null, meta.map_scale || null, meta.license || null,
      meta.access === 'internal' ? 'internal' : 'public', meta.acquisition_date || null, user.username]);
  await audit(id, user, 'update_metadata', { title: meta.title, access: meta.access });
}

async function replaceFile(id, file, user) {
  const d = await get(id);
  if (!d) throw new Error('Không tìm thấy bộ dữ liệu');
  const head = Buffer.alloc(8); const fd = fs.openSync(file.path, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
  const format = detectFormat(file.originalname, head);
  if (format !== d.format && !(d.format === 'geotiff' && format === 'raster_image')) throw new Error('Phiên bản mới phải cùng loại dữ liệu với bản hiện có');
  const v = d.current_version + 1; const dir = path.join(dsDir(id), `v${v}`); fs.mkdirSync(dir, { recursive: true });
  const name = `original${path.extname(file.originalname).toLowerCase()}`; fs.renameSync(file.path, path.join(dir, name));
  await db.query(`INSERT INTO maps.map_files (dataset_id, file_role, version_no, storage_key, original_filename, mime_type, size_bytes) VALUES ($1,'original',$2,$3,$4,$5,$6)`,
    [id, v, `storage:maps/${id}/v${v}/${name}`, file.originalname, file.mimetype, file.size]);
  // keep the published version live until the new one is approved (TC07)
  await db.query("UPDATE maps.map_datasets SET current_version = $2, status = CASE WHEN status = 'published' THEN status ELSE 'uploaded' END, updated_by = $3, updated_at = now() WHERE id = $1", [id, v, user.username]);
  await audit(id, user, 'new_version_upload', { version: v, file: file.originalname });
  await enqueue(id, 'inspect', { version: v }, user);
}

// ---------- jobs ----------
async function enqueue(id, type, payload, user) {
  const j = (await db.query(`INSERT INTO maps.map_processing_jobs (dataset_id, job_type, created_by, log) VALUES ($1,$2,$3,$4) RETURNING id`,
    [id, type, user ? user.username : 'system', JSON.stringify([{ at: new Date().toISOString(), msg: 'queued', payload }])])).rows[0];
  await db.query("UPDATE maps.map_datasets SET status = CASE WHEN status = 'published' THEN status ELSE 'processing' END, updated_at = now() WHERE id = $1", [id]);
  setImmediate(pump);
  return j.id;
}

function runWorker(args, script = 'map_worker.py') {
  return new Promise((resolve) => {
    const child = spawn(config.python, [path.join(config.paths.scripts, script), ...args], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = ''; let err = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { err += b; });
    const timer = setTimeout(() => child.kill(), 30 * 60e3);
    child.on('close', (code) => {
      clearTimeout(timer);
      try { resolve({ code, ...JSON.parse(out.trim().split(/\r?\n/).pop()) }); } catch { resolve({ code, ok: false, error_code: 'WorkerOutput', error: (err || out).slice(-800) }); }
    });
    child.on('error', (e) => resolve({ code: -1, ok: false, error_code: 'Spawn', error: e.message }));
  });
}

async function originalFile(id, version) {
  const r = await db.query("SELECT * FROM maps.map_files WHERE dataset_id = $1 AND file_role = 'original' AND ($2::int IS NULL OR version_no = $2) ORDER BY version_no DESC LIMIT 1", [id, version || null]);
  return r.rows[0];
}

async function addFile(id, role, version, absPath, extra = {}) {
  const rel = path.relative(config.paths.storage, absPath).split(path.sep).join('/');
  await db.query(`DELETE FROM maps.map_files WHERE dataset_id = $1 AND version_no = $2 AND file_role = $3 AND ($4::int IS NULL OR page_no = $4)`, [id, version, role, extra.page_no || null]);
  const st = fs.statSync(absPath);
  const r = await db.query(`INSERT INTO maps.map_files (dataset_id, file_role, version_no, storage_key, original_filename, mime_type, size_bytes, page_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [id, role, version, `storage:${rel}`, path.basename(absPath), extra.mime || 'application/octet-stream', st.size, extra.page_no || null]);
  return r.rows[0].id;
}

async function toWebp(png) {
  const webp = png.replace(/\.png$/, '.webp');
  await sharp(png, { limitInputPixels: false }).webp({ quality: 85, alphaQuality: 90 }).toFile(webp);
  fs.unlinkSync(png);
  return webp;
}

const fileUrl = (fileId) => `/ban-do-chuyen-de/tep/${fileId}`;

async function handleInspect(job, payload) {
  const d = (await db.query('SELECT * FROM maps.map_datasets WHERE id = $1', [job.dataset_id])).rows[0];
  const of = await originalFile(d.id, payload.version);
  const v = of.version_no; const dir = path.join(dsDir(d.id), `v${v}`, 'derived'); fs.mkdirSync(dir, { recursive: true });
  const r = await runWorker(['inspect', resolveKey(of.storage_key), dir]);
  if (!r.ok && r.error) throw Object.assign(new Error(r.error), { code: r.error_code });
  await db.query('UPDATE maps.map_files SET sha256 = $2 WHERE id = $1', [of.id, r.sha256]);
  let previewUrl = null;
  for (const p of r.previews || []) {
    const fid = await addFile(d.id, p.page ? 'page_preview' : 'preview', v, path.join(dir, p.file), { mime: 'image/jpeg', page_no: p.page || null });
    if (!previewUrl) previewUrl = fileUrl(fid);
  }
  const georef = Boolean(r.georeferenced);
  const format = d.format === 'geotiff' && !georef ? 'raster_image' : d.format; // TIFF ảnh không có CRS: xử lý như ảnh bản đồ
  await db.query(`UPDATE maps.map_datasets SET tech = $2, georeferenced = $3, preview_url = $4, format = $5, updated_at = now() WHERE id = $1`, [d.id, JSON.stringify(r), georef, previewUrl, format]);
  if (georef) {
    await db.query(`UPDATE maps.map_spatial_refs SET srid = $2, original_wkt = $3, bbox_json = $4, georef_method = 'embedded', footprint = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)), updated_at = now() WHERE dataset_id = $1`,
      [d.id, r.epsg || null, r.wkt || r.crs || null, JSON.stringify(r.bounds4326), JSON.stringify(r.footprint || bboxPolygon(r.bounds4326))]);
    const display = { mode: r.bands >= 3 && r.dtype === 'uint8' ? 'rgb' : 'single', palette: 'greens', opacity: 0.8, clip: true, ...(d.display || {}) };
    if (r.nodata !== null && r.nodata !== undefined && display.mode === 'rgb' && !display.nodata_rgb) display.nodata_rgb = [r.nodata, r.nodata, r.nodata];
    await enqueue(d.id, 'process', { display, autoPublish: payload.autoPublish, version: v }, { username: job.created_by });
    return { georeferenced: true };
  }
  const next = d.format === 'package' ? 'ready' : 'needs_georef';
  await db.query("UPDATE maps.map_datasets SET status = CASE WHEN status = 'published' THEN status ELSE $2 END WHERE id = $1", [d.id, next]);
  if (payload.autoPublish && payload.autoPublish.asDocument) await publish(d.id, { username: 'import' }, payload.autoPublish.note, true);
  return { georeferenced: false };
}

function bboxPolygon(b) { return { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] }; }

async function handleProcess(job, payload) {
  const d = (await db.query('SELECT * FROM maps.map_datasets WHERE id = $1', [job.dataset_id])).rows[0];
  const of = await originalFile(d.id, payload.version);
  const v = of.version_no; const dir = path.join(dsDir(d.id), `v${v}`, 'derived'); fs.mkdirSync(dir, { recursive: true });
  const cfg = payload.gcps ? { page: payload.page || 1, method: payload.method || 'affine', gcps: payload.gcps } : { ...(payload.display || d.display || {}), make_cog: of.size_bytes < 1.5e9 };
  const cfgFile = path.join(dir, `job-${job.id}.json`); fs.writeFileSync(cfgFile, JSON.stringify(cfg));
  const r = await runWorker(['process', resolveKey(of.storage_key), dir, cfgFile]);
  fs.unlinkSync(cfgFile);
  if (!r.ok) throw Object.assign(new Error(r.error || 'Xử lý thất bại'), { code: r.error_code });
  const overlay = await toWebp(path.join(dir, r.overlay));
  const oid = await addFile(d.id, 'overlay', v, overlay, { mime: 'image/webp' });
  if (r.cog) await addFile(d.id, 'cog', v, path.join(dir, r.cog), { mime: 'image/tiff' });
  if (r.georef_raster) await addFile(d.id, 'georef_raster', v, path.join(dir, r.georef_raster), { mime: 'image/tiff' });
  const display = r.mode === 'gcp' ? { ...(d.display || {}), opacity: (d.display && d.display.opacity) || 0.75 } : { ...(payload.display || {}), ...(r.display || {}) };
  delete display.tiles;
  // RGB GeoTIFF: XYZ tiles at full resolution so the layer stays sharp when zoomed in (served by /ban-do-chuyen-de/tiles)
  if (r.mode === 'rgb') {
    const tdir = path.join(dsDir(d.id), `v${v}`, 'tiles'); fs.rmSync(tdir, { recursive: true, force: true });
    const cfgT = payload.display || d.display || {};
    const args = [resolveKey(of.storage_key), tdir, '--zmin', '7', '--zmax', '0', '--mode', 'rgb', '--workers', '3'];
    if (cfgT.nodata_rgb) args.push('--nodata-rgb', cfgT.nodata_rgb.join(','));
    if (cfgT.clip !== false) args.push('--clip');
    const tj = await runWorker(args, 'make_tiles.py');
    if (tj.ok) display.tiles = { version: v, minzoom: tj.minzoom, maxzoom: tj.maxzoom, bounds: tj.bounds };
    else console.warn('[maps] tiles skipped', d.id, String(tj.error || '').slice(0, 200));
  }
  await db.query(`UPDATE maps.map_datasets SET overlay_url = $2, overlay_bounds = $3, display = $4, georeferenced = true,
      status = CASE WHEN status = 'published' THEN status ELSE 'ready' END, updated_at = now() WHERE id = $1`, [d.id, fileUrl(oid), JSON.stringify(r.overlay_bounds), JSON.stringify(display)]);
  if (r.mode === 'gcp') {
    await db.query(`UPDATE maps.map_spatial_refs SET srid = 4326, georef_method = $2, gcps = $3, residual_error = $4, bbox_json = $5, footprint = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326)), updated_at = now() WHERE dataset_id = $1`,
      [d.id, `gcp_${r.method}`, JSON.stringify(r.gcps), r.rmse_m, JSON.stringify(r.bounds4326), JSON.stringify(r.footprint)]);
  }
  if (payload.autoPublish && payload.autoPublish.layer) await publish(d.id, { username: 'import' }, payload.autoPublish.note, true);
  return { rmse_m: r.rmse_m, mode: r.mode, output_size: r.output_size, exact_fit: r.exact_fit };
}

let pumping = false;
async function pump() {
  if (pumping || !enabled()) return;
  pumping = true;
  try {
    for (;;) {
      const j = (await db.query(`UPDATE maps.map_processing_jobs SET status = 'running', started_at = now(), attempts = attempts + 1
        WHERE id = (SELECT id FROM maps.map_processing_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`)).rows[0];
      if (!j) break;
      const payload = (j.log[0] && j.log[0].payload) || {};
      try {
        const result = j.job_type === 'inspect' ? await handleInspect(j, payload) : await handleProcess(j, payload);
        await db.query(`UPDATE maps.map_processing_jobs SET status = 'succeeded', progress = 100, completed_at = now(), log = log || $2 WHERE id = $1`, [j.id, JSON.stringify([{ at: new Date().toISOString(), msg: 'done', result }])]);
        await audit(j.dataset_id, { username: 'worker' }, `job_${j.job_type}_ok`, result);
      } catch (e) {
        const retry = j.attempts < 3 && !['ValueError'].includes(e.code);
        await db.query(`UPDATE maps.map_processing_jobs SET status = $2, error_code = $3, error_message = $4, completed_at = now(), log = log || $5 WHERE id = $1`,
          [j.id, retry ? 'queued' : 'failed', e.code || 'Error', e.message.slice(0, 2000), JSON.stringify([{ at: new Date().toISOString(), msg: 'error', error: e.message.slice(0, 500) }])]);
        if (!retry) {
          await db.query("UPDATE maps.map_datasets SET status = CASE WHEN status = 'published' THEN status WHEN $2 = 'process' AND georeferenced = false THEN 'needs_georef' ELSE 'failed' END, updated_at = now() WHERE id = $1", [j.dataset_id, j.job_type]);
          await audit(j.dataset_id, { username: 'worker' }, `job_${j.job_type}_failed`, { error: e.message.slice(0, 500) });
        }
      }
    }
  } catch (e) { console.warn('[maps] hàng đợi lỗi:', e.message); } finally { pumping = false; }
}

// ---------- configure / georef / review ----------
async function configure(id, display, user) {
  await db.query('UPDATE maps.map_datasets SET display = $2, updated_by = $3, updated_at = now() WHERE id = $1', [id, JSON.stringify(display), user.username]);
  await audit(id, user, 'configure_display', display);
  return enqueue(id, 'process', { display }, user);
}

async function georeference(id, { page, method, gcps }, user) {
  if (!Array.isArray(gcps) || gcps.length < 3) throw new Error('Cần tối thiểu 3 điểm khống chế');
  for (const g of gcps) {
    if (![g.px, g.py, g.fx, g.fy, g.lon, g.lat].every(Number.isFinite) || g.fx < 0 || g.fx > 1 || g.fy < 0 || g.fy > 1) throw new Error('Toạ độ điểm khống chế không hợp lệ');
    if (g.lon < 102 || g.lon > 110 || g.lat < 8 || g.lat > 24) throw new Error('Toạ độ thực địa phải là kinh/vĩ độ WGS84 trong phạm vi Việt Nam');
  }
  await audit(id, user, 'georeference', { method, points: gcps.length, page });
  return enqueue(id, 'georef', { page, method, gcps }, user);
}

async function setStatus(id, status, user, note) {
  await db.query('UPDATE maps.map_datasets SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1', [id, status, user.username]);
  await audit(id, user, `status_${status}`, note ? { note } : null);
}

async function submit(id, user) {
  const d = (await db.query('SELECT status, georeferenced, format FROM maps.map_datasets WHERE id = $1', [id])).rows[0];
  if (!d || !['ready', 'needs_georef', 'rejected', 'revoked'].includes(d.status)) throw new Error('Chỉ gửi duyệt được bản đồ đã xử lý xong');
  await setStatus(id, 'pending_review', user);
}

// asDocument: PDF/ảnh chưa định vị được công bố như tài liệu (không chồng lên bản đồ – TC04)
async function publish(id, user, note, system = false) {
  const d = (await db.query('SELECT * FROM maps.map_datasets WHERE id = $1', [id])).rows[0];
  if (!d) throw new Error('Không tìm thấy');
  if (!system && d.status !== 'pending_review') throw new Error('Chỉ xuất bản bản đồ ở trạng thái chờ duyệt');
  if (d.format === 'geotiff' && !d.georeferenced) throw new Error('GeoTIFF chưa có hệ toạ độ không được xuất bản thành lớp bản đồ (TC02)');
  const ref = (await db.query('SELECT residual_error, georef_method FROM maps.map_spatial_refs WHERE dataset_id = $1', [id])).rows[0];
  const maxRmse = Number(process.env.MAP_MAX_RMSE_M || 50);
  if (d.georeferenced && ref && ref.georef_method && ref.georef_method.startsWith('gcp') && Number(ref.residual_error) > maxRmse) throw new Error(`Sai số nắn chỉnh RMSE ${ref.residual_error} m vượt ngưỡng ${maxRmse} m – trả về bước hiệu chỉnh`);
  const of = await originalFile(id, d.current_version);
  const vno = ((await db.query('SELECT COALESCE(MAX(version_no), 0) v FROM maps.map_versions WHERE dataset_id = $1', [id])).rows[0].v) + 1;
  await db.query(`INSERT INTO maps.map_versions (dataset_id, version_no, approved_by, approved_at, release_note, published_file_id, snapshot) VALUES ($1,$2,$3,now(),$4,$5,$6)`,
    [id, vno, user.username, note || null, of ? of.id : null, JSON.stringify({ overlay_url: d.overlay_url, overlay_bounds: d.overlay_bounds, display: d.display, georeferenced: d.georeferenced, file_version: d.current_version })]);
  await setStatus(id, 'published', user, note);
}

async function remove(id, user) {
  const d = (await db.query('SELECT status FROM maps.map_datasets WHERE id = $1', [id])).rows[0];
  if (!d) return;
  if (d.status === 'published') throw new Error('Thu hồi bản đồ trước khi xoá');
  await audit(id, user, 'delete', null);
  await db.query('DELETE FROM maps.map_datasets WHERE id = $1', [id]);
  fs.rmSync(dsDir(id), { recursive: true, force: true }); // only derived/uploaded copies; handover files under data/ are never touched
}

// ---------- public ----------
async function publishedLayers() {
  if (!enabled()) return [];
  const r = await db.query(`SELECT d.id, d.title, d.category, d.map_year, d.source_org, d.overlay_url, d.overlay_bounds, d.display, d.description, s.georef_method, s.residual_error
    FROM maps.map_datasets d LEFT JOIN maps.map_spatial_refs s ON s.dataset_id = d.id
    WHERE d.status = 'published' AND d.access = 'public' AND d.georeferenced AND d.overlay_url IS NOT NULL ORDER BY d.category, d.map_year`);
  return r.rows.map((x) => ({ ...x, categoryLabel: CATEGORIES[x.category] || x.category }));
}

async function publishedDocuments() {
  if (!enabled()) return [];
  const r = await db.query(`SELECT d.*, f.id AS file_id, f.size_bytes, f.original_filename, f.mime_type, f.sha256
    FROM maps.map_datasets d JOIN LATERAL (SELECT * FROM maps.map_files x WHERE x.dataset_id = d.id AND x.file_role = 'original' ORDER BY version_no DESC LIMIT 1) f ON true
    WHERE d.status = 'published' AND d.access = 'public' ORDER BY d.category, d.map_year DESC NULLS LAST, d.title`);
  return r.rows;
}

// XYZ tile of a processed RGB GeoTIFF; public only when published+public, staff can preview any (FR07)
const tileInfo = new Map();
async function tilePath(id, z, x, y, user) {
  let t = tileInfo.get(id);
  if (!t || t.at < Date.now() - 60e3) {
    const d = (await db.query('SELECT status, access, display FROM maps.map_datasets WHERE id = $1', [id])).rows[0];
    t = { at: Date.now(), d }; tileInfo.set(id, t);
  }
  const d = t.d;
  if (!d || !d.display || !d.display.tiles) return null;
  if (!user && !(d.status === 'published' && d.access === 'public')) return null;
  return path.join(dsDir(id), `v${d.display.tiles.version}`, 'tiles', String(z), String(x), `${y}.png`);
}

// file download/view with access control (FR07)
async function fileForRequest(fileId, user) {
  const r = await db.query(`SELECT f.*, d.status, d.access, d.title FROM maps.map_files f JOIN maps.map_datasets d ON d.id = f.dataset_id WHERE f.id = $1`, [fileId]);
  const f = r.rows[0];
  if (!f) return null;
  const staff = Boolean(user);
  if (!staff && (f.status !== 'published' || f.access !== 'public')) return null;
  return { ...f, abs: resolveKey(f.storage_key) };
}

function start() { if (enabled()) { pump(); setInterval(pump, 30e3).unref(); } }

module.exports = { FORMATS, STATUS, CATEGORIES, LIMITS, enabled, list, get, create, registerExisting, updateMeta, replaceFile, configure, georeference, submit, publish, setStatus, remove,
  publishedLayers, publishedDocuments, fileForRequest, tilePath, audit, start, pump, MAP_DIR };
