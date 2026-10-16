const TZ = 'Asia/Ho_Chi_Minh';

function num(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(v, digits = 1) {
  if (v === null || v === undefined) return '—';
  return `${num(v, digits)}%`;
}

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function date(v) {
  const d = toDate(v);
  if (!d) return typeof v === 'string' ? v : '—';
  return d.toLocaleDateString('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dateTime(v) {
  const d = toDate(v);
  if (!d) return '—';
  return `${d.toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })} ${date(d)}`;
}

// "YYYY-MM-DD" (local calendar date) → "16/10/2026" without timezone shifts.
function ymd(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : s;
}

function ago(v) {
  const d = toDate(v);
  if (!d) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

function ageHours(v) {
  const d = toDate(v);
  return d ? (Date.now() - d.getTime()) / 3600000 : Infinity;
}

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
function weekday(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function bytes(n) {
  if (!n && n !== 0) return '—';
  if (n > 1e6) return `${num(n / 1e6, 1)} MB`;
  return `${num(n / 1e3, 0)} KB`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { num, pct, date, dateTime, ymd, ago, ageHours, weekday, bytes, esc, TZ };
