// Điểm cháy nhập thủ công – bổ sung cho nguồn tự động (NASA FIRMS).
// Mỗi điểm đi chung luồng với điểm nóng vệ tinh: hiện trong repo.hotspots() với sensor 'MANUAL',
// xác minh bằng ops.decisions (kind 'hotspot', ref 'man-<code>'), thông báo MobileGIS khi "Xác nhận cháy".
const store = require('../data/store');
const repo = require('../data/repo');

const SOURCES = {
  'kiem-lam': 'Kiểm lâm / cán bộ chuyên môn phát hiện',
  'chong-chay': 'Tổ chống cháy, chính quyền xã báo',
  'nguoi-dan': 'Người dân báo tin (điện thoại, trực tiếp)',
  'phan-anh': 'Phản ánh hiện trường (web/MobileGIS)',
  khac: 'Nguồn khác',
};
// trạng thái được chọn khi nhập: chưa xác minh (vào hàng đợi xác minh) hoặc đã xác minh tại hiện trường
const INITIAL = ['new', 'assigned', 'verifying', 'confirmed', 'handling'];

class InputError extends Error {}
const refOf = (code) => `man-${code}`;

// datetime-local (giờ Việt Nam, không múi giờ) hoặc ISO → ISO UTC
function parseTime(v) {
  if (!v) return new Date().toISOString();
  const s = String(v).trim();
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.length === 16 ? `${s}:00` : s}+07:00`);
  if (Number.isNaN(d.getTime())) throw new InputError('Thời điểm phát hiện không hợp lệ.');
  if (d.getTime() > Date.now() + 10 * 60e3) throw new InputError('Thời điểm phát hiện không được ở tương lai.');
  if (d.getTime() < Date.now() - 365 * 864e5) throw new InputError('Chỉ nhập điểm cháy trong vòng 12 tháng.');
  return d.toISOString();
}

// user: { username, role }; canVerify: người nhập có quyền xác minh (alerts.verify)
function create(user, input, { canVerify = false } = {}) {
  const lat = Number(String(input.lat ?? '').replace(',', '.'));
  const lon = Number(String(input.lon ?? '').replace(',', '.'));
  if (!(lat > 13 && lat < 16.5 && lon > 106.5 && lon < 109.5)) throw new InputError('Toạ độ nằm ngoài khu vực Kon Tum (vĩ độ 13–16,5; kinh độ 106,5–109,5).');
  const source = SOURCES[input.source_kind] ? input.source_kind : 'khac';
  const area = input.area_ha === '' || input.area_ha === undefined || input.area_ha === null ? null : Number(String(input.area_ha).replace(',', '.'));
  if (area !== null && !(area >= 0 && area < 100000)) throw new InputError('Diện tích ước tính không hợp lệ.');
  const description = String(input.description || '').trim().slice(0, 2000);
  if (description.length < 5) throw new InputError('Vui lòng mô tả ngắn gọn tình hình (ít nhất 5 ký tự).');
  let status = INITIAL.includes(input.status) ? input.status : 'new';
  if (!canVerify && status !== 'new') status = 'new'; // chỉ cán bộ có quyền xác minh mới nhập "đã xác minh"

  const c = repo.communeAt(lon, lat);
  const code = store.nextCode('CH');
  const row = store.insert('fire_points', {
    code, observed_at: parseTime(input.observed_at), source_kind: source, description, area_ha: area,
    lat, lon, commune_code: c ? c.code : null, commune_name: c ? c.fullName : null,
    report_code: input.report_code || null, created_by: user ? user.username : 'system',
  });
  const note = String(input.note || '').trim().slice(0, 1000) || (status === 'confirmed' ? 'Xác nhận cháy khi nhập thủ công' : 'Nhập thủ công, chờ xác minh');
  store.setDecision('hotspot', refOf(code), { status, note, assignee: input.assignee || null }, user);
  store.audit(user, 'firepoint.create', code, { source, status, report: row.report_code });
  return { row, ref: refOf(code), status };
}

// tạo điểm cháy từ một phản ánh "Cháy rừng" (giữ liên kết hai chiều)
function fromReport(user, report, { confirm = false, note } = {}) {
  if (!report || report.type !== 'chay-rung') throw new InputError('Chỉ tạo điểm cháy từ phản ánh loại "Cháy rừng".');
  if (report.lat === null || report.lon === null || report.lat === undefined) throw new InputError('Phản ánh chưa có toạ độ.');
  if (report.fire_point) throw new InputError(`Phản ánh đã gắn với điểm cháy ${report.fire_point}.`);
  const out = create(user, {
    lat: report.lat, lon: report.lon, observed_at: report.observed_at || report.created_at, source_kind: 'phan-anh',
    description: `${report.code}: ${report.description}`.slice(0, 2000), report_code: report.code,
    status: confirm ? 'confirmed' : 'new', note,
  }, { canVerify: confirm });
  store.update('reports', report.id, {
    fire_point: out.row.code,
    timeline: [...report.timeline, { at: store.now(), status: report.status, note: `Tạo điểm cháy ${out.row.code}${confirm ? ' (đã xác nhận cháy)' : ' (chờ xác minh)'}`, by: user ? user.username : 'system' }],
  });
  return out;
}

module.exports = { SOURCES, INITIAL, InputError, create, fromReport, refOf };
