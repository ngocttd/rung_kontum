// Thông tin năm/nguồn của dữ liệu đang dùng, tính từ chính dữ liệu (không viết cố định trong giao diện):
// năm hiện trạng rừng và quyết định công bố, năm cuối của chuỗi Hansen, giai đoạn dự báo mất rừng, tháng ảnh Sentinel-2 mới nhất,
// diện tích biến động nghi vấn Sentinel-2 theo năm. Khi có quyết định/ảnh/dữ liệu mới, mọi nhãn tự đổi theo.
const repo = require('../data/repo');

const dmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function dataContext() {
  const s = repo.forestSummary() || {};
  const fc = repo.forestChange() || null;
  const asOf = s.as_of || null; // ngày số liệu hiện trạng (vd 2025-12-31)
  const forestYear = asOf ? Number(asOf.slice(0, 4)) : null;
  const dec = String(s.decision || '');
  const decNo = (dec.match(/^\s*([\w./-]*QĐ-[\w]+)/) || [])[1] || dec.split(' ')[0] || '';
  const decDate = (dec.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || '';
  const decShort = decNo ? `QĐ ${decNo.split('/')[0]}` : '';
  const hist = fc && fc.history ? fc.history.aoi_annual_loss_ha || {} : {};
  const hy = Object.keys(hist).map(Number).filter(Boolean).sort((a, b) => a - b);
  const hansenLast = hy.length ? hy[hy.length - 1] : null;
  const hz = fc && fc.forecast && fc.forecast.horizon ? String(fc.forecast.horizon).match(/(\d{4})-\d{2}-\d{2}\.\.(\d{4})/) : null;
  const fcFrom = hz ? Number(hz[1]) : null; const fcTo = hz ? Number(hz[2]) : null;
  const ov = Object.fromEntries(repo.overlays().map((o) => [o.id, o]));
  const s2 = ov['s2-latest'];
  // biến động nghi vấn Sentinel-2 theo năm (theo năm bắt đầu của kỳ so sánh) – sau năm cuối của Hansen
  const s2Change = {};
  for (const w of (fc && fc.candidates && fc.candidates.windows) || []) {
    const y = Number(String(w.window).slice(0, 4));
    if (y) s2Change[y] = (s2Change[y] || 0) + (w.area_ha || 0);
  }
  return {
    forestYear, forestAsOf: dmy(asOf), decision: decNo, decisionShort: decShort, decisionDate: decDate,
    forestLabel: forestYear ? `${forestYear}${decShort ? ` (${decShort})` : ''}` : 'hiện hành',
    hansenFirst: hy[0] || null, hansenLast, lossRecentFrom: hansenLast ? hansenLast - 4 : null,
    forecastLabel: fcFrom && fcTo ? (fcFrom === fcTo ? String(fcFrom) : `${fcFrom}–${fcTo}`) : '', forecastShort: fcFrom && fcTo ? `${fcFrom}–${String(fcTo).slice(2)}` : '',
    s2Month: s2 && s2.month ? `${s2.month.slice(5)}/${s2.month.slice(0, 4)}` : '', s2Change,
    nowYear: new Date(Date.now() + 7 * 3600e3).getUTCFullYear(),
  };
}

module.exports = { dataContext };
