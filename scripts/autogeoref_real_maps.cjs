// Tự định vị các ảnh bản đồ toàn tỉnh trong data/Data_thuc_te (TIFF xuất từ bố cục, không có toạ độ) để hiển thị
// thành lớp trên Bản đồ WebGIS. PDF không xử lý (chỉ là tài liệu). Các ảnh cùng mẫu bố cục (cùng thư mục, cùng kích
// thước) dùng chung khung bản đồ: ảnh nào tự khớp kém hơn rõ rệt sẽ dùng kết quả của ảnh khớp tốt nhất trong nhóm.
// Usage: node scripts/autogeoref_real_maps.cjs [--force]   (--force: chạy lại cả bản đã tự định vị)
const path = require('path');
const maps = require('../src/services/maps');
const db = require('../src/db/pool');

const USER = { username: 'import' };
const force = process.argv.includes('--force');

(async () => {
  if (!maps.enabled()) throw new Error('Cần cấu hình PostgreSQL/PostGIS');
  const rows = (await db.query(`SELECT d.id, d.title, d.tech, f.storage_key, s.georef_method FROM maps.map_datasets d
    JOIN maps.map_files f ON f.dataset_id = d.id AND f.file_role = 'original' AND f.version_no = d.current_version
    LEFT JOIN maps.map_spatial_refs s ON s.dataset_id = d.id
    WHERE d.format = 'raster_image' AND f.storage_key LIKE 'data:Data_thuc_te/%' ORDER BY f.storage_key`)).rows
    .filter((r) => force || r.georef_method !== 'auto_shape');
  console.log(`${rows.length} ảnh bản đồ cần tự định vị`);
  const res = [];
  for (const r of rows) {
    const a = await maps.runWorker(['autogeoref', maps.resolveKey(r.storage_key), '1']);
    const tech = r.tech || {};
    res.push({ ...r, a, key: `${path.dirname(r.storage_key)}|${tech.width}x${tech.height}` });
    console.log(`  ${a.ok ? `IoU ${a.iou} · sai số ${a.boundary_error_m} m` : `lỗi: ${a.error}`}  ${r.title}`);
  }
  // nhóm cùng mẫu bố cục → chọn ảnh khớp tốt nhất làm mẫu
  const groups = {};
  for (const x of res) (groups[x.key] = groups[x.key] || []).push(x);
  for (const g of Object.values(groups)) {
    const ok = g.filter((x) => x.a.ok).sort((p, q) => q.a.iou - p.a.iou || p.a.boundary_error_m - q.a.boundary_error_m);
    const best = ok[0];
    for (const x of g) {
      let use = x.a;
      if (best && best !== x && g.length > 1 && (!x.a.ok || x.a.boundary_error_m > Math.max(300, 2 * best.a.boundary_error_m))) {
        use = { ...best.a, template_from: best.title };
        console.log(`  dùng mẫu bố cục của “${best.title}” cho “${x.title}” (tự khớp: ${x.a.ok ? `${x.a.boundary_error_m} m` : 'lỗi'})`);
      }
      const out = await maps.autoGeoref(x.id, USER, { override: use, autoPublish: { layer: true, note: 'Tự định vị theo hình tỉnh (bộ dữ liệu thực tế dự án) – đạt ngưỡng sai số' } });
      x.result = out;
    }
  }
  for (;;) {
    await maps.pump();
    const q = (await db.query("SELECT count(*)::int n FROM maps.map_processing_jobs WHERE status IN ('queued','running')")).rows[0].n;
    if (!q) break;
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 3000));
  }
  const s = (await db.query(`SELECT d.status, d.georeferenced, s.georef_method, count(*)::int n FROM maps.map_datasets d LEFT JOIN maps.map_spatial_refs s ON s.dataset_id = d.id
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)).rows;
  console.log('\nKết quả:', JSON.stringify(s));
  console.log(`Lớp trên Bản đồ WebGIS: ${(await maps.publishedLayers()).length}`);
  await db.getPool().end();
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
