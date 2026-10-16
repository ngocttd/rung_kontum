// Tạo lại lớp hiển thị (overlay + tile XYZ) cho các bản đồ GeoTIFF RGB đã xử lý.
// Usage: node scripts/retile_maps.cjs
const maps = require('../src/services/maps');
const db = require('../src/db/pool');

(async () => {
  if (!maps.enabled()) throw new Error('Cần cấu hình PostgreSQL/PostGIS');
  const rows = (await db.query("SELECT id, title, display FROM maps.map_datasets WHERE georeferenced AND display->>'mode' = 'rgb'")).rows;
  for (const d of rows) {
    const { tiles, ...display } = d.display || {};
    await maps.configure(d.id, display, { username: 'system' });
    console.log('+', d.title);
  }
  for (;;) {
    await maps.pump();
    const q = (await db.query("SELECT count(*)::int n FROM maps.map_processing_jobs WHERE status IN ('queued','running')")).rows[0].n;
    if (!q) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const r = (await db.query("SELECT title, status, display->'tiles' t FROM maps.map_datasets WHERE id = ANY($1)", [rows.map((x) => x.id)])).rows;
  r.forEach((x) => console.log(x.status, JSON.stringify(x.t), x.title));
  await db.getPool().end();
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
