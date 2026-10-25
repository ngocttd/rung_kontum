// Xoá dữ liệu kiểm thử MobileGIS (người dùng t_m_*, bản ghi có chữ “kiểm thử”). Dùng tài khoản quản trị DB (DB_USER)
// vì bảng xác minh là lịch sử bất biến: role ứng dụng không được xoá. Usage: node scripts/purge_mobile_test.cjs
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

async function purge() {
  const c = new Client({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'rung_kontum' });
  await c.connect();
  try {
    const ids = (await c.query("SELECT id FROM identity.users WHERE username LIKE 't\_m\_%' OR username = '0912345678'")).rows.map((x) => x.id);
    await c.query('BEGIN');
    await c.query('ALTER TABLE mobile.incident_verifications DISABLE TRIGGER verification_immutable');
    await c.query("DELETE FROM mobile.verification_reviews WHERE verification_id IN (SELECT id FROM mobile.incident_verifications WHERE verifier_id = ANY($1) OR evidence->>'description' LIKE '%kiểm thử%')", [ids]);
    await c.query("DELETE FROM mobile.incident_verifications WHERE verifier_id = ANY($1) OR evidence->>'description' LIKE '%kiểm thử%'", [ids]);
    await c.query('ALTER TABLE mobile.incident_verifications ENABLE TRIGGER verification_immutable');
    await c.query("DELETE FROM mobile.field_surveys WHERE surveyor_id = ANY($1) OR notes LIKE '%kiểm thử%'", [ids]);
    await c.query("DELETE FROM mobile.field_assignments WHERE instructions LIKE '%kiểm thử%' OR assignee_id = ANY($1) OR (kind = 'report' AND ref_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ops.reports r WHERE r.code = ref_id))", [ids]);
    await c.query('DELETE FROM mobile.mobile_sync_events WHERE user_id = ANY($1)', [ids]);
    // điểm cháy tạo từ phản ánh kiểm thử (cán bộ báo cháy bằng GPS) và quyết định/thông báo đi kèm
    if ((await c.query("SELECT to_regclass('fire.manual_points') AS t")).rows[0].t) {
      const fp = (await c.query("DELETE FROM fire.manual_points WHERE description LIKE '%kiểm thử%' OR report_code IN (SELECT code FROM ops.reports WHERE description LIKE '%kiểm thử%') RETURNING code")).rows.map((x) => `man-${x.code}`);
      if (fp.length) {
        await c.query("DELETE FROM ops.decisions WHERE kind = 'hotspot' AND ref_id = ANY($1)", [fp]);
        await c.query("DELETE FROM mobile.notifications WHERE source_ref = ANY($1)", [fp.map((x) => `hs:${x}:confirmed`)]);
      }
    }
    const r = await c.query("DELETE FROM ops.reports WHERE description LIKE '%kiểm thử%' OR description LIKE 'Thử dùng lại%'");
    await c.query('DELETE FROM mobile.refresh_tokens WHERE user_id = ANY($1)', [ids]);
    await c.query('DELETE FROM identity.users WHERE id = ANY($1)', [ids]);
    await c.query('COMMIT');
    return { users: ids.length, reports: r.rowCount };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { await c.end(); }
}
module.exports = purge;
if (require.main === module) purge().then((x) => console.log('Đã xoá dữ liệu kiểm thử', x)).catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
