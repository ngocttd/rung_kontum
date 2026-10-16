// Unified alert feed built from three separate products, never merged into one "fire" count:
//  - fire_danger: automated Nesterov class forecast per commune (model output, not an official warning
//    until approved by an authorised user)
//  - hotspot: FIRMS thermal anomaly (observation, unverified until field verification)
//  - forest_change: Sentinel-2 change candidate (unverified)
const repo = require('../data/repo');
const store = require('../data/store');
const { ymd } = require('../lib/format');

const LEVEL_LABEL = { 1: 'Cấp I – Thấp', 2: 'Cấp II – Trung bình', 3: 'Cấp III – Cao', 4: 'Cấp IV – Nguy hiểm', 5: 'Cấp V – Cực kỳ nguy hiểm' };
const DANGER_STATUS = { auto: 'Tự động – chưa phê duyệt', approved: 'Đã phê duyệt công bố', dismissed: 'Không công bố' };

function fireDangerAlerts(minClass = 3) {
  const fd = repo.fireDanger();
  if (!fd) return [];
  const out = [];
  for (const c of fd.communes) {
    const days = [c.current, ...c.forecast].filter(Boolean);
    const peak = days.reduce((a, d) => (d.cls > (a ? a.cls : 0) ? d : a), null);
    if (!peak || peak.cls < minClass) continue;
    const id = `FD-${c.code}-${peak.date}`;
    const d = store.getDecision('fire_danger', id);
    const status = d ? d.status : 'auto';
    out.push({
      id, type: 'fire_danger', level: peak.cls, levelLabel: LEVEL_LABEL[peak.cls],
      title: `Dự báo nguy cơ cháy ${LEVEL_LABEL[peak.cls]} tại ${c.name}`,
      detail: `Ngày ${ymd(peak.date)} · chỉ số P = ${peak.p.toLocaleString('vi-VN')} · FWI ${peak.fwi}`,
      commune: c.name, communeCode: c.code, time: `${peak.date}T05:00:00Z`, date: peak.date,
      status, statusLabel: DANGER_STATUS[status], official: status === 'approved', link: `/canh-bao-chay?xa=${c.code}`,
    });
  }
  return out.sort((a, b) => b.level - a.level || a.date.localeCompare(b.date));
}

function hotspotAlerts() {
  return repo.hotspots().map((h) => ({
    id: h.id, type: 'hotspot', level: null, title: `Điểm nóng ${h.sensorLabel}${h.commune ? ` tại ${h.commune}` : ''}`,
    detail: `Độ tin cậy ${h.confidence}${h.frp ? ` · FRP ${h.frp} MW` : ''}${h.context ? ` · ${h.context.in_forest ? 'trong vùng rừng' : `lớp phủ: ${h.context.landcover || 'không rõ'}`}` : ''}`,
    commune: h.commune, communeCode: h.communeCode, time: h.utc, status: h.status, statusLabel: h.statusLabel,
    official: h.status === 'confirmed', link: `/canh-bao-chay?diem=${encodeURIComponent(h.id)}`, lon: h.lon, lat: h.lat,
  }));
}

function changeAlerts(limit = 50) {
  const fc = repo.changeCandidates();
  return fc.features
    .map((f) => f.properties)
    .sort((a, b) => b.area_ha - a.area_ha)
    .slice(0, limit)
    .map((p) => ({
      id: p.id, type: 'forest_change', level: null, title: `Biến động nghi vấn ${p.area_ha} ha${p.commune_name ? ` tại ${p.commune_name}` : ''}`,
      detail: `ΔNDVI ${p.mean_dndvi} · ${p.window}${p.seasonal_leaf_fall_possible ? ' · có thể do rụng lá mùa khô' : ''}`,
      commune: p.commune_name, communeCode: p.commune_code, status: p.status, statusLabel: p.statusLabel,
      official: p.status === 'confirmed', link: `/bien-dong-rung?diem=${p.id}`, lon: p.lon, lat: p.lat,
    }));
}

function feed({ limit = 8 } = {}) {
  const items = [...fireDangerAlerts(), ...hotspotAlerts(), ...changeAlerts(6)];
  return items.slice(0, limit);
}

module.exports = { fireDangerAlerts, hotspotAlerts, changeAlerts, feed, LEVEL_LABEL, DANGER_STATUS };
