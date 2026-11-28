// Xuất báo cáo: hiện trạng rừng, nghi vấn mất rừng, phản ánh hiện trường, ghi nhận hiện trường (xác minh, khảo sát).
//  - Mỗi loại báo cáo khai báo danh sách TRƯỜNG dữ liệu (nhãn + từ đồng nghĩa) và hàm lấy dòng dữ liệu theo bộ lọc.
//  - Xuất mặc định: Excel do hệ thống dựng. Xuất theo MẪU: đơn vị tải tệp Excel mẫu lên, hệ thống nhận dạng dòng tiêu đề
//    và cột ↔ trường (theo tên cột), quản trị xem lại rồi lưu; khi có biểu mẫu mới chỉ cần tải mẫu mới lên, không sửa mã nguồn.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { paths } = require('../config');
const store = require('../data/store');
const repo = require('../data/repo');
const db = require('../db/pool');

const TPL_DIR = path.join(paths.uploads, 'templates');
fs.mkdirSync(TPL_DIR, { recursive: true });
class InputError extends Error {}
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9%]+/g, ' ').trim();
const dmy = (v) => { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d); };
const dmyhm = (v) => { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d); };
const inRange = (v, from, to) => { const d = String(v || '').slice(0, 10); return (!from || d >= from) && (!to || d <= to); };
const scopeOk = (f, code) => !f.communes || f.communes.includes(String(code));

const reportOrigin = (r) => require('./reports').origin(r);

const F = (key, label, type = 'text', syn = []) => ({ key, label, type, syn: [label, ...syn].map(norm) });
const DATASETS = {
  forest_status: {
    title: 'Báo cáo hiện trạng rừng theo xã', short: 'Hiện trạng rừng', icon: 'tree-fill',
    filters: ['nam', 'xa'],
    fields: [
      F('stt', 'STT', 'num', ['tt', 'so thu tu']), F('code', 'Mã xã', 'text', ['ma don vi', 'ma dvhc']), F('name', 'Tên xã/phường', 'text', ['don vi hanh chinh', 'xa phuong', 'ten xa', 'don vi', 'dia ban']),
      F('natural_area_ha', 'Diện tích tự nhiên (ha)', 'num', ['dien tich tu nhien', 'dttn']), F('forest_total_ha', 'Tổng diện tích có rừng, gồm rừng trồng chưa thành rừng (ha)', 'num', ['tong dien tich co rung', 'tong dien tich rung', 'dien tich co rung', 'tong cong']),
      F('established_forest_ha', 'Rừng đã thành rừng – tính tỷ lệ che phủ (ha)', 'num', ['dien tich rung de tinh ty le che phu', 'rung da thanh rung', 'dien tich rung du tieu chuan']),
      F('natural_forest_ha', 'Rừng tự nhiên (ha)', 'num', ['rung tu nhien']), F('plantation_ha', 'Rừng trồng (ha)', 'num', ['rung trong', 'tong rung trong']),
      F('established_plantation_ha', 'Rừng trồng đã thành rừng (ha)', 'num', ['rung trong da thanh rung', 'da thanh rung']), F('immature_plantation_ha', 'Rừng trồng chưa thành rừng (ha)', 'num', ['chua thanh rung', 'rung trong chua thanh rung', 'dien tich da trong chua thanh rung']),
      F('special_use_planning_ha', 'Quy hoạch rừng đặc dụng (ha)', 'num', ['dac dung', 'rung dac dung']), F('protection_planning_ha', 'Quy hoạch rừng phòng hộ (ha)', 'num', ['phong ho', 'rung phong ho']), F('production_planning_ha', 'Quy hoạch rừng sản xuất (ha)', 'num', ['san xuat', 'rung san xuat']),
      F('official_forest_cover_percent', 'Tỷ lệ che phủ rừng (%)', 'num', ['ty le che phu', 'do che phu', 'che phu %']),
      F('loss_recent_ha', 'Mất tán cây 5 năm gần nhất – Hansen (ha)', 'num', ['mat tan cay', 'mat rung 5 nam']), F('expected_loss_ha', 'Dự báo mất rừng kỳ vọng (ha)', 'num', ['du bao mat rung', 'nguy co mat rung']),
      F('suspect_zones', 'Số vùng nghi vấn biến động', 'num', ['so vung nghi van', 'nghi van']), F('suspect_ha', 'Diện tích nghi vấn biến động (ha)', 'num', ['dien tich nghi van']),
      F('note', 'Ghi chú', 'text', ['ghi chu']),
    ],
    async rows(f) {
      const cands = repo.changeCandidates({ staff: true }).features.map((x) => x.properties);
      return repo.communes(f.nam).filter((c) => c.official && scopeOk(f, c.code) && (!f.xa || String(c.code) === String(f.xa))).sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')).map((c, i) => {
        const o = c.official; const cs = cands.filter((x) => String(x.commune_code) === String(c.code));
        return { stt: i + 1, code: c.code, name: c.fullName, natural_area_ha: o.natural_area_ha, forest_total_ha: (o.established_forest_ha || 0) + (o.immature_plantation_ha || 0), established_forest_ha: o.established_forest_ha,
          natural_forest_ha: o.natural_forest_ha, plantation_ha: (o.established_plantation_ha || 0) + (o.immature_plantation_ha || 0), established_plantation_ha: o.established_plantation_ha, immature_plantation_ha: o.immature_plantation_ha,
          special_use_planning_ha: o.special_use_planning_ha, protection_planning_ha: o.protection_planning_ha, production_planning_ha: o.production_planning_ha, official_forest_cover_percent: o.official_forest_cover_percent,
          loss_recent_ha: c.loss ? Math.round(c.loss.last5 * 10) / 10 : null, expected_loss_ha: c.risk ? c.risk.expected_loss_ha : null, suspect_zones: cs.length, suspect_ha: Math.round(cs.reduce((a, x) => a + (x.area_ha || 0), 0) * 10) / 10, note: '' };
      });
    },
    meta(f) { const s = repo.forestSummary(f.nam) || {}; return { ky: `Năm ${s.year || ''}`, nam: s.year, can_cu: s.decision || '', ngay_so_lieu: dmy(s.as_of) }; },
    noSum: ['official_forest_cover_percent'],
  },
  change_suspects: {
    title: 'Báo cáo nghi vấn mất rừng', short: 'Nghi vấn mất rừng', icon: 'exclamation-triangle-fill',
    filters: ['tu', 'den', 'xa', 'trang_thai_bd', 'nguon_bd'],
    fields: [
      F('stt', 'STT', 'num', ['tt']), F('id', 'Mã vùng', 'text', ['ma', 'ma vung', 'so hieu']), F('source', 'Nguồn phát hiện', 'text', ['nguon', 'phuong phap']), F('window', 'Kỳ phát hiện', 'text', ['ky', 'thoi gian phat hien', 'thoi diem']),
      F('commune', 'Xã/phường', 'text', ['dia ban', 'xa', 'don vi hanh chinh']), F('area_ha', 'Diện tích (ha)', 'num', ['dien tich']), F('lon', 'Kinh độ', 'num', ['kinh do', 'x']), F('lat', 'Vĩ độ', 'num', ['vi do', 'y']),
      F('indicator', 'Chỉ số (ΔNDVI / năm mất tán cây)', 'text', ['chi so', 'ndvi', 'muc do']), F('status', 'Trạng thái xác minh', 'text', ['trang thai', 'ket qua xac minh', 'tinh trang']),
      F('assignee', 'Người/đơn vị xác minh', 'text', ['nguoi xac minh', 'don vi xac minh', 'can bo']), F('note', 'Ghi chú', 'text', ['ghi chu', 'ket luan', 'nguyen nhan']), F('evidence', 'Căn cứ phát hiện', 'text', ['can cu']),
    ],
    async rows(f) {
      const out = [];
      if (!f.nguon_bd || f.nguon_bd === 'auto') {
        for (const x of repo.changeCandidates({ staff: true }).features.map((y) => y.properties)) {
          const d = store.getDecision ? store.getDecision('candidate', x.id) : null;
          out.push({ id: x.id, source: x.kind === 'treeloss' ? 'Mất tán cây Hansen (30 m)' : 'Biến động Sentinel-2 (tự động/phân tích)', window: x.window, commune: x.commune_name, commune_code: x.commune_code, area_ha: x.area_ha, lon: x.lon, lat: x.lat,
            indicator: x.kind === 'treeloss' ? `Năm mất: ${x.loss_years}` : `ΔNDVI ${x.mean_dndvi}; ΔNBR ${x.mean_dnbr}`, status_key: x.status || 'unverified', status: x.statusLabel || 'Nghi vấn – chưa xác minh', assignee: (d && (d.assignee || (d.history && d.history.length && d.history[d.history.length - 1].by))) || '',
            note: `${(d && d.note) || ''}${x.seasonal_leaf_fall_possible ? ' (có thể rụng lá mùa khô)' : ''}`.trim(), evidence: x.evidence, date: (d && d.updated_at) || null });
        }
      }
      if (!f.nguon_bd || f.nguon_bd === 'zone') {
        const zones = require('./zones');
        for (const z of zones.list().filter((y) => ['forest_loss', 'logging', 'encroach'].includes(y.kind))) {
          out.push({ id: z.code, source: `Khoanh vùng trên web (${zones.KINDS[z.kind]})`, window: dmy(z.created_at), commune: z.commune_name, commune_code: z.commune_code, area_ha: z.area_ha, lon: z.lon, lat: z.lat, indicator: z.source_image || '',
            status_key: { new: 'unverified', assigned: 'verifying', verified: 'confirmed', rejected: 'rejected', closed: 'confirmed' }[z.status], status: zones.STATUS[z.status][1], assignee: z.assignment_code ? `Nhiệm vụ ${z.assignment_code}` : '', note: z.note || '', evidence: `Người khoanh: ${z.created_by}`, date: z.created_at });
        }
      }
      return out.filter((r) => scopeOk(f, r.commune_code) && (!f.xa || String(r.commune_code) === String(f.xa)) && (!f.trang_thai_bd || r.status_key === f.trang_thai_bd) && (!(f.tu || f.den) || !r.date || inRange(r.date, f.tu, f.den)))
        .sort((a, b) => (b.area_ha || 0) - (a.area_ha || 0)).map((r, i) => ({ stt: i + 1, ...r }));
    },
    meta(f) { return { ky: f.tu || f.den ? `${f.tu ? dmy(f.tu) : '…'} – ${f.den ? dmy(f.den) : '…'}` : 'Toàn bộ dữ liệu hiện có' }; },
    noSum: ['lon', 'lat'],
  },
  reports: {
    title: 'Tổng hợp phản ánh hiện trường', short: 'Phản ánh hiện trường', icon: 'megaphone-fill',
    filters: ['tu', 'den', 'xa', 'nguon_pa', 'trang_thai_pa', 'loai_pa'],
    fields: [
      F('stt', 'STT', 'num', ['tt']), F('code', 'Mã hồ sơ', 'text', ['ma', 'ma phan anh', 'so ho so']), F('created_at', 'Thời điểm gửi', 'date', ['ngay gui', 'thoi gian', 'ngay tiep nhan']), F('observed_at', 'Thời điểm xảy ra', 'date', ['thoi diem xay ra', 'ngay xay ra']),
      F('origin', 'Nguồn phản ánh', 'text', ['nguon', 'doi tuong phan anh', 'nguoi phan anh la']), F('channel', 'Kênh gửi', 'text', ['kenh']), F('type', 'Loại phản ánh', 'text', ['loai', 'noi dung phan anh', 'linh vuc']),
      F('description', 'Mô tả', 'text', ['mo ta', 'noi dung', 'tom tat']), F('commune', 'Xã/phường', 'text', ['dia ban', 'xa', 'dia diem']), F('location_text', 'Vị trí mô tả', 'text', ['vi tri', 'dia chi']), F('lon', 'Kinh độ', 'num', ['kinh do']), F('lat', 'Vĩ độ', 'num', ['vi do']),
      F('reporter', 'Người gửi', 'text', ['nguoi gui', 'ho ten', 'nguoi phan anh']), F('phone', 'Điện thoại', 'text', ['dien thoai', 'sdt', 'lien he']), F('status', 'Trạng thái xử lý', 'text', ['trang thai', 'tinh trang', 'ket qua']),
      F('assigned_to', 'Người xử lý', 'text', ['nguoi xu ly', 'can bo xu ly', 'don vi xu ly']), F('checked', 'Đã kiểm tra', 'text', ['da kiem tra', 'kiem tra']), F('response', 'Kết quả / phản hồi', 'text', ['phan hoi', 'ket qua xu ly', 'ghi chu']),
      F('photos', 'Số ảnh/video', 'num', ['so anh', 'tai lieu kem theo']), F('same_place', 'Số người cùng báo', 'num', ['cung bao']),
    ],
    async rows(f) {
      const reports = require('./reports');
      return store.all('reports').filter((r) => scopeOk(f, r.commune_code) && (!f.xa || String(r.commune_code) === String(f.xa)) && inRange(r.created_at, f.tu, f.den) && (!f.trang_thai_pa || r.status === f.trang_thai_pa) && (!f.loai_pa || r.type === f.loai_pa)
        && (!f.nguon_pa || reportOrigin(r).key === f.nguon_pa))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((r, i) => {
          const o = reportOrigin(r);
          return { stt: i + 1, code: r.code, created_at: dmyhm(r.created_at), observed_at: dmyhm(r.observed_at), origin: o.label, channel: o.channel, type: (reports.TYPES[r.type] || {}).label || r.type, description: r.description, commune: r.commune_name, location_text: r.location_text,
            lon: r.lon, lat: r.lat, reporter: (r.reporter && r.reporter.name) || o.user || '', phone: (r.reporter && r.reporter.phone) || '', status: (reports.STATUS[r.status] || {}).label || r.status, assigned_to: r.assigned_to || '', checked: r.reviewed_at ? `Có (${r.reviewed_by || ''})` : 'Chưa',
            response: r.response || '', photos: (r.photos || []).length + (r.videos || []).length, same_place: (reports.sameLocation(r) || {}).count || 0 };
        });
    },
    meta(f) { return { ky: f.tu || f.den ? `${f.tu ? dmy(f.tu) : '…'} – ${f.den ? dmy(f.den) : '…'}` : 'Toàn bộ dữ liệu hiện có' }; },
    noSum: ['lon', 'lat', 'same_place'],
  },
  field_records: {
    title: 'Tổng hợp ghi nhận hiện trường (xác minh, khảo sát)', short: 'Ghi nhận hiện trường', icon: 'geo-alt-fill',
    filters: ['tu', 'den', 'xa', 'loai_gn'],
    fields: [
      F('stt', 'STT', 'num', ['tt']), F('code', 'Mã ghi nhận', 'text', ['ma', 'so phieu']), F('kind', 'Loại ghi nhận', 'text', ['loai', 'hinh thuc']), F('object', 'Đối tượng', 'text', ['doi tuong', 'noi dung kiem tra']), F('task', 'Nhiệm vụ', 'text', ['nhiem vu', 'ma nhiem vu']),
      F('time', 'Thời điểm ghi nhận', 'date', ['thoi gian', 'ngay kiem tra', 'ngay khao sat']), F('officer', 'Cán bộ thực hiện', 'text', ['can bo', 'nguoi thuc hien', 'nguoi kiem tra']), F('commune', 'Xã/phường', 'text', ['dia ban', 'xa']),
      F('lon', 'Kinh độ', 'num', ['kinh do']), F('lat', 'Vĩ độ', 'num', ['vi do']), F('gps_accuracy', 'Sai số GPS (m)', 'num', ['sai so']), F('verdict', 'Kết luận', 'text', ['ket luan', 'ket qua', 'hien trang']),
      F('forest_type', 'Loại rừng', 'text', ['loai rung', 'trang thai rung']), F('area_ha', 'Diện tích (ha)', 'num', ['dien tich']), F('severity', 'Mức độ', 'text', ['muc do']), F('cause', 'Nguyên nhân / mùa – trạng thái lá', 'text', ['nguyen nhan']),
      F('notes', 'Mô tả, kiến nghị', 'text', ['mo ta', 'kien nghi', 'ghi chu', 'de xuat']), F('photos', 'Số ảnh bằng chứng', 'num', ['so anh', 'anh']), F('review', 'Trạng thái duyệt', 'text', ['duyet', 'trang thai']), F('reviewer', 'Người duyệt', 'text', ['nguoi duyet']),
    ],
    async rows(f) {
      if (!db.enabled) return [];
      const names = Object.fromEntries(repo.communes().map((c) => [String(c.code), c.fullName]));
      const VERDICT = { fire: 'Có cháy rừng', no_fire: 'Không có cháy', not_forest_fire: 'Không phải cháy rừng', deforestation: 'Xác nhận mất rừng', no_deforestation: 'Không phải mất rừng', seasonal: 'Rụng lá theo mùa', confirmed: 'Đúng phản ánh', unfounded: 'Không đúng phản ánh', inconclusive: 'Chưa đủ căn cứ' };
      const RV = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Trả lại', pending_review: 'Chờ duyệt' };
      const out = [];
      if (!f.loai_gn || f.loai_gn === 'verify') {
        const v = await db.query(`SELECT v.*, ST_X(v.geom) lon, ST_Y(v.geom) lat, a.code task, a.scope_id,
            (SELECT r.reviewer FROM mobile.verification_reviews r WHERE r.verification_id = v.id ORDER BY r.created_at DESC LIMIT 1) reviewer
          FROM mobile.incident_verifications v LEFT JOIN mobile.field_assignments a ON a.id = v.assignment_id ORDER BY v.verified_at DESC`).catch(() => ({ rows: [] }));
        for (const x of v.rows) {
          const cm = Number.isFinite(Number(x.lon)) ? repo.communeAt(Number(x.lon), Number(x.lat)) : null; const code = cm ? cm.code : x.scope_id; const ev = x.evidence || {};
          out.push({ code: x.code, kind: 'Xác minh', object: `${{ hotspot: 'Điểm nóng/điểm cháy', candidate: 'Biến động nghi vấn', report: 'Phản ánh' }[x.alert_kind] || x.alert_kind} ${x.alert_id}`, task: x.task || '', time: dmyhm(x.verified_at), date: x.verified_at, officer: x.verifier, commune: names[String(code)] || '', commune_code: code,
            lon: x.lon === null ? null : Number(Number(x.lon).toFixed(6)), lat: x.lat === null ? null : Number(Number(x.lat).toFixed(6)), gps_accuracy: x.gps_accuracy === null ? null : Number(x.gps_accuracy), verdict: VERDICT[x.verdict] || x.verdict, forest_type: x.forest_type || '', area_ha: x.burned_area_ha === null ? null : Number(x.burned_area_ha),
            severity: x.severity || '', cause: [ev.season === 'dry' ? 'mùa khô' : ev.season === 'wet' ? 'mùa mưa' : '', ev.cause || ''].filter(Boolean).join('; '), notes: [ev.description, x.recommendation].filter(Boolean).join(' | '), photos: (ev.photos || ev.attachments || []).length || null, review: RV[x.review_status] || x.review_status, reviewer: x.reviewer || '' });
        }
      }
      if (!f.loai_gn || f.loai_gn === 'survey') {
        const s = await db.query(`SELECT s.*, ST_X(ST_PointOnSurface(s.geom)) lon, ST_Y(ST_PointOnSurface(s.geom)) lat, a.code task FROM mobile.field_surveys s LEFT JOIN mobile.field_assignments a ON a.id = s.assignment_id ORDER BY s.observed_at DESC`).catch(() => ({ rows: [] }));
        for (const x of s.rows) {
          out.push({ code: x.code, kind: `Khảo sát (${{ point: 'điểm', line: 'đường', polygon: 'vùng' }[x.geom_type]})`, object: 'Hiện trạng rừng', task: x.task || '', time: dmyhm(x.observed_at), date: x.observed_at, officer: x.surveyor, commune: names[String(x.commune_code)] || '', commune_code: x.commune_code,
            lon: Number(Number(x.lon).toFixed(6)), lat: Number(Number(x.lat).toFixed(6)), gps_accuracy: x.gps_accuracy === null ? null : Number(x.gps_accuracy), verdict: x.canopy_cover === null ? '' : `Độ che phủ ${Number(x.canopy_cover)}%`, forest_type: `${x.forest_type || ''}${x.is_dipterocarp ? ' (rừng khộp)' : ''}`,
            area_ha: x.area_ha === null ? null : Number(x.area_ha), severity: '', cause: [x.season === 'dry' ? 'mùa khô' : x.season === 'wet' ? 'mùa mưa' : '', { full: 'đủ lá', partial: 'rụng lá một phần', leafless: 'rụng hết lá' }[x.leaf_state] || '', x.change_cause || ''].filter(Boolean).join('; '),
            notes: x.notes || '', photos: null, review: RV[x.status] || x.status, reviewer: x.reviewer || '' });
        }
      }
      return out.filter((r) => scopeOk(f, r.commune_code) && (!f.xa || String(r.commune_code) === String(f.xa)) && inRange(new Date(new Date(r.date).getTime() + 7 * 3600e3).toISOString(), f.tu, f.den))
        .sort((a, b) => new Date(b.date) - new Date(a.date)).map((r, i) => ({ stt: i + 1, ...r }));
    },
    meta(f) { return { ky: f.tu || f.den ? `${f.tu ? dmy(f.tu) : '…'} – ${f.den ? dmy(f.den) : '…'}` : 'Toàn bộ dữ liệu hiện có' }; },
    noSum: ['lon', 'lat', 'gps_accuracy'],
  },
};

function filterFrom(q = {}, user) {
  const d = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  const f = { nam: /^\d{4}$/.test(String(q.nam || '')) ? q.nam : undefined, xa: q.xa || null, tu: d(q.tu), den: d(q.den), trang_thai_bd: q.trang_thai_bd || null, nguon_bd: q.nguon_bd || null, nguon_pa: q.nguon_pa || null, trang_thai_pa: q.trang_thai_pa || null, loai_pa: q.loai_pa || null, loai_gn: q.loai_gn || null };
  const sc = require('../lib/scope').communesOf(user);
  if (sc) f.communes = sc;
  return f;
}
async function build(key, filter) {
  const ds = DATASETS[key];
  if (!ds) throw new InputError('Loại báo cáo không hợp lệ.');
  const rows = await ds.rows(filter);
  // làm tròn số thực (tránh 11017.550000000001): toạ độ 6 chữ số, còn lại 2 chữ số
  for (const r of rows) for (const fd of ds.fields) { const v = r[fd.key]; if (fd.type === 'num' && typeof v === 'number' && !Number.isInteger(v)) r[fd.key] = Number(v.toFixed(['lon', 'lat'].includes(fd.key) ? 6 : 2)); }
  const communeName = filter.xa ? (repo.communes().find((c) => String(c.code) === String(filter.xa)) || {}).fullName : null;
  const meta = { tieu_de: ds.title, ngay_xuat: dmy(new Date()), ngay: String(new Date(Date.now() + 7 * 3600e3).getUTCDate()).padStart(2, '0'), thang: String(new Date(Date.now() + 7 * 3600e3).getUTCMonth() + 1).padStart(2, '0'), nam_xuat: new Date(Date.now() + 7 * 3600e3).getUTCFullYear(),
    pham_vi: communeName || (filter.communes ? `${filter.communes.length} xã/phường phụ trách` : 'Vùng Kon Tum (cũ) – 40 xã, phường'), so_dong: rows.length, ...ds.meta(filter) };
  const totals = {};
  for (const fd of ds.fields) if (fd.type === 'num' && fd.key !== 'stt' && !(ds.noSum || []).includes(fd.key)) totals[fd.key] = Math.round(rows.reduce((a, r) => a + (Number(r[fd.key]) || 0), 0) * 100) / 100;
  return { key, ds, rows, meta, totals };
}

// ---------- xuất mặc định ----------
async function toXlsx(rep, cols) {
  const { ds, rows, meta, totals } = rep;
  const fields = cols && cols.length ? ds.fields.filter((f) => cols.includes(f.key)) : ds.fields;
  const wb = new ExcelJS.Workbook(); wb.creator = 'WebGIS Kon Tum';
  const ws = wb.addWorksheet('Bao cao', { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  const n = fields.length;
  ws.mergeCells(1, 1, 1, n); ws.getCell(1, 1).value = ds.title.toUpperCase(); ws.getCell(1, 1).font = { bold: true, size: 14 }; ws.getCell(1, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(2, 1, 2, n); ws.getCell(2, 1).value = `Phạm vi: ${meta.pham_vi} · Kỳ: ${meta.ky}${meta.can_cu ? ` · Căn cứ: ${meta.can_cu}` : ''}`; ws.getCell(2, 1).alignment = { horizontal: 'center' };
  ws.mergeCells(3, 1, 3, n); ws.getCell(3, 1).value = `Xuất từ Hệ thống giám sát tài nguyên rừng Kon Tum ngày ${meta.ngay_xuat} · ${rows.length} dòng`; ws.getCell(3, 1).alignment = { horizontal: 'center' }; ws.getCell(3, 1).font = { italic: true, color: { argb: 'FF666666' } };
  const hr = ws.getRow(5); hr.height = 34;
  fields.forEach((f, i) => { const c = hr.getCell(i + 1); c.value = f.label; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5C3A' } }; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    ws.getColumn(i + 1).width = f.type === 'num' ? 14 : Math.min(48, Math.max(12, ...rows.slice(0, 200).map((r) => String(r[f.key] ?? '').length * 0.9), f.label.length * 0.7)); });
  rows.forEach((r, k) => { const row = ws.getRow(6 + k); fields.forEach((f, i) => { const c = row.getCell(i + 1); c.value = r[f.key] ?? null; c.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'hair' }, right: { style: 'hair' } }; c.alignment = { vertical: 'top', wrapText: f.type !== 'num' };
    if (f.type === 'num' && typeof r[f.key] === 'number' && !['stt', 'lon', 'lat'].includes(f.key)) c.numFmt = '#,##0.##'; }); });
  if (rows.length && Object.keys(totals).length) { const row = ws.getRow(6 + rows.length); fields.forEach((f, i) => { const c = row.getCell(i + 1); c.value = i === 0 ? 'Tổng' : (totals[f.key] ?? null); c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF3EC' } }; if (typeof c.value === 'number') c.numFmt = '#,##0.##'; }); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- mẫu báo cáo: nhận dạng và điền ----------
const cellText = (c) => { const v = c.value; if (v === null || v === undefined) return ''; if (typeof v === 'object') { if (v.richText) return v.richText.map((t) => t.text).join(''); if (v.text) return String(v.text); if (v.result !== undefined) return String(v.result); if (v instanceof Date) return v.toISOString(); return ''; } return String(v); };
function matchField(ds, text, taken) {
  const t = norm(text); if (!t) return null;
  let best = null;
  for (const f of ds.fields) {
    if (taken.has(f.key)) continue;
    for (const s of f.syn) {
      if (!s) continue;
      let score = 0;
      if (t === s) score = 100; else if (t.includes(s)) score = 60 + Math.min(30, s.length); else if (s.includes(t) && t.length >= 4) score = 40 + t.length;
      if (score && (!best || score > best.score)) best = { key: f.key, score };
    }
  }
  return best && best.score >= 44 ? best : null;
}
async function recognize(buf, key) {
  const ds = DATASETS[key];
  if (!ds) throw new InputError('Loại báo cáo không hợp lệ.');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf); } catch { throw new InputError('Không đọc được tệp – mẫu phải là Excel .xlsx.'); }
  let best = null;
  wb.eachSheet((ws) => {
    const maxR = Math.min(ws.rowCount, 60); const maxC = Math.min(ws.columnCount || 40, 60);
    for (let r = 1; r <= maxR; r++) {
      const taken = new Set(); const cols = {}; let score = 0;
      for (let c = 1; c <= maxC; c++) {
        // tiêu đề nhiều tầng (ô gộp): ghép chữ của ô hiện tại với 2 dòng phía trên cùng cột
        const own = cellText(ws.getCell(r, c)); if (!own.trim()) continue;
        const up = [r - 1, r - 2].filter((x) => x >= 1).map((x) => cellText(ws.getCell(x, c))).filter((x) => x && x !== own);
        const m = matchField(ds, own, taken) || matchField(ds, `${up.reverse().join(' ')} ${own}`, taken);
        if (m) { cols[c] = m.key; taken.add(m.key); score += m.score; }
      }
      const cnt = Object.keys(cols).length;
      if (cnt >= 2 && (!best || score > best.score)) best = { sheet: ws.name, header_row: r, cols, score, count: cnt };
    }
  });
  if (!best) throw new InputError('Không nhận ra dòng tiêu đề cột nào trong mẫu. Kiểm tra tên cột (ví dụ “Tên xã”, “Diện tích”…) hoặc khai báo cột thủ công sau khi tải lên.');
  const ws = wb.getWorksheet(best.sheet);
  // dòng đánh số cột (1) (2) (3)… ngay dưới tiêu đề
  let start = best.header_row + 1;
  const vals = Object.keys(best.cols).map((c) => norm(cellText(ws.getCell(start, Number(c)))));
  if (vals.filter((v) => /^[a-z]?\d{1,2}$/.test(v.replace(/\s/g, ''))).length >= Math.max(2, vals.length - 1)) start += 1;
  // dòng tổng có sẵn trong mẫu
  let total = null;
  for (let r = start; r <= Math.min(ws.rowCount, start + 400); r++) { const t = norm(Array.from({ length: 4 }, (_, i) => cellText(ws.getCell(r, i + 1))).join(' ')); if (/^(tong|cong|tong cong|tong so)\b/.test(t)) { total = r; break; } }
  // ô giữ chỗ {{…}}
  const placeholders = [];
  ws.eachRow((row) => row.eachCell((c) => { const m = cellText(c).match(/\{\{\s*[\w]+\s*\}\}/g); if (m) placeholders.push(...m.map((x) => x.replace(/[{}\s]/g, ''))); }));
  const headers = {};
  for (let c = 1; c <= Math.min(ws.columnCount || 40, 60); c++) { const t = cellText(ws.getCell(best.header_row, c)).trim() || cellText(ws.getCell(best.header_row - 1 || 1, c)).trim(); if (t) headers[c] = t.replace(/\s+/g, ' ').slice(0, 80); }
  return { sheet: best.sheet, header_row: best.header_row, data_row: start, total_row: total, cols: best.cols, headers, placeholders: [...new Set(placeholders)], matched: best.count };
}
async function saveTemplate(user, { key, title, buffer, originalName }) {
  const map = await recognize(buffer, key);
  const stored = `${crypto.randomUUID()}.xlsx`;
  fs.writeFileSync(path.join(TPL_DIR, stored), buffer);
  const t = store.insert('report_templates', { report_key: key, title: String(title || originalName || 'Mẫu báo cáo').slice(0, 150), original_name: String(originalName || '').slice(0, 200), stored_name: stored, active: true, uploaded_by: user.username, mapping: map });
  store.audit(user, 'report_template.upload', t.title, { key, matched: map.matched });
  return t;
}
function updateMapping(user, id, body) {
  const t = store.get('report_templates', id);
  if (!t) throw new InputError('Không tìm thấy mẫu.');
  const ds = DATASETS[t.report_key]; const m = { ...t.mapping, cols: {} };
  for (const [k, v] of Object.entries(body)) { const c = (k.match(/^col_(\d+)$/) || [])[1]; if (c && v && ds.fields.some((f) => f.key === v)) m.cols[c] = v; }
  const num = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
  m.header_row = num(body.header_row, m.header_row); m.data_row = num(body.data_row, m.data_row); m.total_row = body.total_row === '' ? null : num(body.total_row, m.total_row);
  if (!Object.keys(m.cols).length) throw new InputError('Cần gán ít nhất một cột.');
  store.update('report_templates', id, { mapping: m, title: String(body.title || t.title).slice(0, 150), active: body.active !== '0' });
  store.audit(user, 'report_template.update', t.title);
}
function removeTemplate(user, id) { const t = store.get('report_templates', id); if (!t) return; fs.rmSync(path.join(TPL_DIR, t.stored_name), { force: true }); store.remove('report_templates', id); store.audit(user, 'report_template.delete', t.title); }
const templates = (key) => store.all('report_templates').filter((t) => !key || t.report_key === key).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
const templateFile = (t) => path.join(TPL_DIR, t.stored_name);

async function fillTemplate(t, rep) {
  const { rows, meta, totals } = rep; const m = t.mapping;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(templateFile(t));
  const ws = wb.getWorksheet(m.sheet) || wb.worksheets[0];
  // ô giữ chỗ {{ten}}
  const ph = { ...meta, tong_dong: rows.length };
  ws.eachRow((row) => row.eachCell((c) => { const s = cellText(c); if (s.includes('{{')) c.value = s.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => (ph[k] ?? totals[k] ?? '')); }));
  const cols = Object.entries(m.cols).map(([c, k]) => [Number(c), k]);
  const first = m.data_row; const totalRow = m.total_row && m.total_row >= first ? m.total_row : null;
  // số dòng dữ liệu mẫu sẵn có (giữa dòng dữ liệu đầu và dòng tổng) – thay bằng dữ liệu thật
  const existing = totalRow ? totalRow - first : 1;
  const styleRow = ws.getRow(first); const styles = {}; const maxC = Math.max(ws.columnCount, ...cols.map(([c]) => c));
  for (let c = 1; c <= maxC; c++) styles[c] = JSON.parse(JSON.stringify(styleRow.getCell(c).style || {}));
  const height = styleRow.height;
  const need = Math.max(rows.length, 1);
  if (need > existing) ws.spliceRows(first + existing, 0, ...Array.from({ length: need - existing }, () => []));
  else if (need < existing) ws.spliceRows(first + need, existing - need);
  rows.forEach((r, i) => {
    const row = ws.getRow(first + i); if (height) row.height = height;
    for (let c = 1; c <= maxC; c++) { const cell = row.getCell(c); cell.style = JSON.parse(JSON.stringify(styles[c])); cell.value = null; }
    cols.forEach(([c, k]) => { row.getCell(c).value = r[k] ?? null; });
    row.commit && row.commit();
  });
  if (!rows.length) cols.forEach(([c]) => { ws.getRow(first).getCell(c).value = null; });
  if (totalRow) { const tr = ws.getRow(first + need); cols.forEach(([c, k]) => { if (totals[k] !== undefined) tr.getCell(c).value = totals[k]; }); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { DATASETS, InputError, filterFrom, build, toXlsx, recognize, saveTemplate, updateMapping, removeTemplate, templates, templateFile, fillTemplate, reportOrigin, TPL_DIR };
