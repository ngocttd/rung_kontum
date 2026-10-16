// Đăng ký bản đồ thực tế (data/Data_thuc_te) vào phân hệ quản lý bản đồ.
// GeoTIFF có toạ độ → xử lý tạo lớp hiển thị + COG và xuất bản thành lớp WebGIS.
// PDF / ảnh bản đồ biên tập chưa định vị → xuất bản như tài liệu (không chồng lên bản đồ) – có thể nắn chỉnh sau.
// Gói .mpk → lưu nội bộ để tải về. Tệp gốc không bị sao chép hay chỉnh sửa.
// Usage: node scripts/seed_real_maps.cjs
const maps = require('../src/services/maps');
const db = require('../src/db/pool');

const BD = 'Data_thuc_te/BD_Longlat_ver2/BD_Longlat_ver2';
const ORG = 'Dữ liệu thực tế dự án (Data_thuc_te)';
const USER = { username: 'import' };
const NOTE = 'Nhập tự động từ bộ dữ liệu thực tế do dự án bàn giao (data/Data_thuc_te); cần cán bộ chuyên môn rà soát nội dung.';
const items = [];

for (const [y, nd] of [[1991, 255], [2014, 255], [2023, 15]]) {
  items.push({ path: `${BD}/Lop_phu_${y}.tif`, meta: { title: `Bản đồ lớp phủ tỉnh Kon Tum năm ${y} (GeoTIFF 15 m)`, description: 'Lớp phủ 7 lớp (rừng, cây bụi, đất nông nghiệp, dân cư, mặt nước, thực vật ngập nước, đất trống) giải đoán từ ảnh vệ tinh; UTM 48N, 15 m.', category: 'tai-nguyen-rung', map_year: y, source_org: ORG, map_scale: '1:25.000' },
    opts: { display: { mode: 'rgb', nodata_rgb: [nd, nd, nd], clip: true, opacity: 0.8 }, autoPublish: { layer: true, note: NOTE } } });
  items.push({ path: `${BD}/Bando_Bientap/BD_Lop phu_${y}.tif`, meta: { title: `Bản đồ lớp phủ tỉnh Kon Tum từ ảnh vệ tinh năm ${y} (bản biên tập)`, category: 'tai-nguyen-rung', map_year: y, source_org: ORG, map_scale: '1:25.000', description: 'Bản đồ đã biên tập (khung, lưới kinh vĩ độ, chú giải); ảnh chưa gắn toạ độ.' },
    opts: { autoPublish: { asDocument: true, note: NOTE } } });
}
for (const p of ['1991_2014', '2014_2023', '1991_2023']) {
  const [a, b] = p.split('_');
  items.push({ path: `${BD}/BD_Bien dong_Lop phu_${p}_ver2.tif`, meta: { title: `Bản đồ biến động lớp phủ tỉnh Kon Tum giai đoạn ${a}–${b}`, category: 'bien-dong', map_year: Number(b), source_org: ORG, map_scale: '1:25.000', description: 'Bản đồ biên tập thể hiện các kiểu chuyển đổi lớp phủ (ví dụ rừng → đất nông nghiệp); ảnh chưa gắn toạ độ.' }, opts: { autoPublish: { asDocument: true, note: NOTE } } });
  items.push({ path: `${BD}/BD_DB_NHIET_${p}_ver2.tif`, meta: { title: `Bản đồ biến động nhiệt độ bề mặt tỉnh Kon Tum giai đoạn ${a}–${b}`, category: 'khi-hau', map_year: Number(b), source_org: ORG, map_scale: '1:25.000', description: 'Bản đồ biên tập; ảnh chưa gắn toạ độ.' }, opts: { autoPublish: { asDocument: true, note: NOTE } } });
}
for (const y of [1991, 2000, 2010, 2014, 2015, 2020, 2021, 2022, 2023]) {
  items.push({ path: `${BD}/Nhiet_do_${y}_ver2.tif`, meta: { title: `Bản đồ nhiệt độ bề mặt tỉnh Kon Tum năm ${y}`, category: 'khi-hau', map_year: y, source_org: ORG, map_scale: '1:25.000', description: 'Bản đồ biên tập nhiệt độ bề mặt từ ảnh vệ tinh; ảnh chưa gắn toạ độ.' }, opts: { autoPublish: { asDocument: true, note: NOTE } } });
}
for (const y of [1991, 2000, 2010, 2014, 2016, 2018, 2021, 2022, 2023]) {
  items.push({ path: `Data_thuc_te/LPR_KONTUM/LPR_KONTUM/LP_${y}.tif`, meta: { title: `Bản đồ lớp phủ rừng (LPR) tỉnh Kon Tum năm ${y} – ảnh`, category: 'tai-nguyen-rung', map_year: y, source_org: ORG, description: 'Ảnh bản đồ xuất từ phần mềm GIS (không có toạ độ nhúng).' }, opts: { autoPublish: { asDocument: true, note: NOTE } } });
}
for (const y of [1991, 2000, 2010, 2014, 2016, 2018, 2020, 2021, 2022, 2023]) {
  items.push({ path: `Data_thuc_te/LPR_KONTUM_PDF/LPR_KONTUM_PDF/${y}.pdf`, meta: { title: `Bản đồ lớp phủ rừng (LPR) tỉnh Kon Tum năm ${y} – PDF`, category: 'tai-nguyen-rung', map_year: y, source_org: ORG, description: 'Bản đồ PDF khổ A4; chưa có tham chiếu địa lý.' }, opts: { autoPublish: { asDocument: true, note: NOTE } } });
}
for (const [f, t] of [['Nen_KomTum_LOPPHU_Longlat.mpk', 'lớp phủ'], ['Nen_KomTum_Bien_dong_LOPPHU_Longlat.mpk', 'biến động lớp phủ'], ['Nen_KomTum_NHIETDO_LongLat.mpk', 'nhiệt độ'], ['Nen_KomTum_BD_NHIETDO_LongLat.mpk', 'biến động nhiệt độ']]) {
  items.push({ path: `${BD}/Bando_mpk/${f}`, meta: { title: `Gói bản đồ ArcGIS – ${t} (MPK)`, category: 'khac', source_org: ORG, access: 'internal', format: 'package', description: 'Gói bản đồ ArcGIS (.mpk) gồm dữ liệu và trình bày; mở bằng ArcGIS Desktop/Pro.' }, opts: {} });
}

(async () => {
  if (!maps.enabled()) throw new Error('Cần cấu hình PostgreSQL/PostGIS');
  let created = 0;
  for (const it of items) {
    const r = await maps.registerExisting(it.meta, it.path, USER, it.opts);
    if (!r.existed) created += 1;
    process.stdout.write(`${r.existed ? '=' : '+'} ${it.meta.title}\n`);
  }
  console.log(`Đăng ký ${created} bộ dữ liệu mới / ${items.length}. Đang xử lý hàng đợi…`);
  for (;;) {
    await maps.pump();
    const q = (await db.query("SELECT count(*)::int n FROM maps.map_processing_jobs WHERE status IN ('queued','running')")).rows[0].n;
    if (!q) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const s = (await db.query('SELECT status, count(*)::int n FROM maps.map_datasets GROUP BY status')).rows;
  console.log('Trạng thái:', JSON.stringify(s));
  await db.getPool().end();
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
