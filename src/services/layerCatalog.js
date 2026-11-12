// Danh mục lớp bản đồ dùng chung cho Bản đồ WebGIS, trang Tài nguyên rừng, MobileGIS và trang quản trị lớp.
// Mặc định (nhóm, thứ tự, bật sẵn, ẩn bản trùng) định nghĩa ở đây; quản trị chỉnh đè từng lớp ở bảng spatial.layer_settings.
// Các lớp ảnh sinh tự động (thời tiết, NDMI, LST, kỳ phân tích biến động, phân loại ảnh), bản đồ chuyên đề đã xuất bản và lớp
// vector bổ sung được thêm vào danh mục tự động khi xuất hiện – không cần sửa mã.
const store = require('../data/store');
const repo = require('../data/repo');

const DEFAULT_GROUPS = [
  { key: 'admin', title: 'Ranh giới hành chính', section: 'HÀNH CHÍNH', cls: 'sec-admin', icon: 'geo-fill', tab: 'theme' },
  { key: 'forest', title: 'Hiện trạng rừng', section: 'TÀI NGUYÊN RỪNG', cls: 'sec-forest', icon: 'tree-fill', tab: 'theme' },
  { key: 'landcover', title: 'Lớp phủ theo năm (Dynamic World, chuẩn hoá)', section: 'TÀI NGUYÊN RỪNG', cls: 'sec-forest', icon: 'tree-fill', tab: 'theme' },
  { key: 'map-lpr', title: 'Bản đồ lớp phủ của dự án (tham khảo)', section: 'TÀI NGUYÊN RỪNG', cls: 'sec-forest', icon: 'tree-fill', tab: 'theme' },
  { key: 'change', title: 'Biến động và dự báo mất rừng', section: 'BIẾN ĐỘNG RỪNG', cls: 'sec-forest', icon: 'graph-up-arrow', tab: 'theme' },
  { key: 'map-change', title: 'Bản đồ biến động lớp phủ của dự án (tham khảo)', section: 'BIẾN ĐỘNG RỪNG', cls: 'sec-forest', icon: 'graph-up-arrow', tab: 'theme' },
  { key: 'fire', title: 'Điểm nóng và nguy cơ cháy', section: 'CẢNH BÁO CHÁY RỪNG', cls: 'sec-fire', icon: 'fire', tab: 'theme' },
  { key: 'fire-env', title: 'Yếu tố môi trường gây cháy', section: 'CẢNH BÁO CHÁY RỪNG', cls: 'sec-fire', icon: 'fire', tab: 'theme' },
  { key: 'map-lst', title: 'Nhiệt độ bề mặt các năm (bản đồ dự án)', section: 'CẢNH BÁO CHÁY RỪNG', cls: 'sec-fire', icon: 'fire', tab: 'theme' },
  { key: 'weather', title: 'Thời tiết hôm nay', section: 'MÔI TRƯỜNG & HIỆN TRƯỜNG', cls: 'sec-env', icon: 'cloud-sun-fill', tab: 'theme' },
  { key: 'field', title: 'Phản ánh hiện trường', section: 'MÔI TRƯỜNG & HIỆN TRƯỜNG', cls: 'sec-env', icon: 'cloud-sun-fill', tab: 'theme' },
  { key: 'map-other', title: 'Bản đồ chuyên đề khác', section: 'BẢN ĐỒ CHUYÊN ĐỀ', cls: 'sec-map', icon: 'map-fill', tab: 'theme' },
  { key: 'custom', title: 'Lớp vector bổ sung', section: 'BẢN ĐỒ CHUYÊN ĐỀ', cls: 'sec-map', icon: 'map-fill', tab: 'theme' },
  { key: 'imagery', title: 'Ảnh vệ tinh Sentinel-2', section: 'ẢNH VỆ TINH', cls: 'sec-base', icon: 'image-fill', tab: 'base' },
  { key: 'class', title: 'Phân loại ảnh (tự động)', section: 'ẢNH VỆ TINH', cls: 'sec-base', icon: 'image-fill', tab: 'base' },
  { key: 'terrain', title: 'Địa hình, chỉ số thực vật, lớp phủ tham khảo', section: 'ĐỊA HÌNH & CHỈ SỐ', cls: 'sec-base', icon: 'graph-up-arrow', tab: 'base' },
  { key: 'reanalysis', title: 'Thời tiết ngày gần nhất (ERA5-Land)', section: 'ĐỊA HÌNH & CHỈ SỐ', cls: 'sec-base', icon: 'graph-up-arrow', tab: 'base' },
];
DEFAULT_GROUPS.forEach((g, i) => { g.sort = (i + 1) * 10; g.builtin = true; });
const CLS = { 'theme': 'sec-map', 'base': 'sec-base' };
// Danh mục nhóm lớp: nhóm mặc định + chỉnh sửa/nhóm mới của quản trị (bảng spatial.layer_groups)
function groups({ all = false } = {}) {
  const rows = Object.fromEntries(store.all('layer_groups').map((r) => [r.key, r]));
  const out = DEFAULT_GROUPS.map((g) => {
    const r = rows[g.key];
    return r ? { ...g, title: r.title || g.title, section: r.section || g.section, tab: r.tab || g.tab, sort: Number.isFinite(r.sort) ? r.sort : g.sort, hidden: Boolean(r.hidden), customized: true } : { ...g, hidden: false };
  });
  for (const r of Object.values(rows)) {
    if (DEFAULT_GROUPS.some((g) => g.key === r.key) || r.deleted) continue;
    const sec = DEFAULT_GROUPS.find((g) => g.section === r.section);
    out.push({ key: r.key, title: r.title || r.key, section: r.section || 'BẢN ĐỒ CHUYÊN ĐỀ', tab: r.tab || 'theme', cls: sec ? sec.cls : CLS[r.tab || 'theme'], icon: sec ? sec.icon : 'map-fill',
      sort: Number.isFinite(r.sort) ? r.sort : 999, hidden: Boolean(r.hidden), builtin: false, customized: true });
  }
  out.sort((a, b) => (a.tab === b.tab ? 0 : a.tab === 'theme' ? -1 : 1) || a.sort - b.sort);
  return all ? out : out;
}
function groupMap() { return Object.fromEntries(groups().map((g) => [g.key, g])); }
const GROUPS = DEFAULT_GROUPS; // tương thích
const GROUP = new Proxy({}, { get: (_, k) => groupMap()[k], has: (_, k) => k in groupMap() });
// nhãn có năm lấy từ dữ liệu hiện hành
function labels() {
  const D = require('../lib/dataContext').dataContext();
  return { forest: `Hiện trạng rừng ${D.forestLabel}`, cover: `Che phủ rừng ${D.forestYear || ''} (theo xã)`, area: `Diện tích rừng ${D.forestYear || ''} (theo xã)`,
    risk: `Dự báo nguy cơ mất rừng ${D.forecastShort}`, riskInfo: `Xác suất mất rừng trung bình ${D.forecastLabel} (mô hình hiệu chỉnh)`, decision: D.decision,
    loss: `Mất tán cây ${D.hansenFirst || ''}–${D.hansenLast || ''} (Hansen)`, loss5: `Mất tán cây ${D.lossRecentFrom || ''}–${D.hansenLast || ''} (theo xã)` };
}

// lớp cố định: [id, kind, group, title, icon, info, opts]
// kind: vector | choro | overlay (ảnh trong overlays.json); icon: 'sym:x' | 'mk:x' | 'ic2:x'
const STATIC = [
  ['province', 'vector', 'admin', 'Ranh giới Kon Tum (cũ)', 'sym:boundary-historical', 'Government of Viet Nam / HDX qua geoBoundaries, năm 2020', { on: true }],
  ['communes', 'vector', 'admin', 'Ranh giới xã/phường', 'sym:boundary-commune', 'vietnamese-provinces-database v5.2.0, cắt theo ranh Kon Tum cũ', { on: true, forest: true }],
  ['cover', 'choro', 'forest', '@cover', 'sym:forest-protection', 'Tỷ lệ che phủ công bố theo xã (@decision)', {}],
  ['forest', 'choro', 'forest', '@area', 'sym:forest-special-use', 'Diện tích đã thành rừng theo xã (@decision)', {}],
  ['lc-2023', 'overlay', 'map-lpr', 'Lớp phủ năm 2023', 'sym:forest-evergreen', null, {}],
  ['lc-2014', 'overlay', 'map-lpr', 'Lớp phủ năm 2014', 'sym:forest-mixed', null, {}],
  ['lc-1991', 'overlay', 'map-lpr', 'Lớp phủ năm 1991', 'sym:forest-conifer', null, {}],
  ['samples', 'vector', 'map-lpr', 'Mẫu thực địa 2025', 'mk:survey', 'Mau_KON_TUM_2025 – 389 điểm, dữ liệu thực tế dự án', {}],
  ['change-latest', 'overlay', 'change', null, 'sym:change-suspected', null, {}],
  ['candidates', 'vector', 'change', 'Vùng biến động nghi vấn (Sentinel-2)', 'sym:change-suspected', 'Sentinel-2 chuỗi tháng 100 m – phân tích tự động theo kỳ, chưa xác minh hiện trường', {}],
  ['lc-forest-change-1991-2023', 'overlay', 'map-change', 'Mất / tăng rừng 1991–2023', 'sym:change-suspected', null, {}],
  ['hansen-loss', 'overlay', 'change', '@loss', 'sym:change-suspected', null, {}],
  ['forest-loss-risk', 'overlay', 'change', '@risk', 'sym:risk-4', null, {}],
  ['risk', 'choro', 'change', 'Xác suất mất rừng (theo xã)', 'sym:risk-3', '@riskInfo', {}],
  ['loss', 'choro', 'change', '@loss5', 'sym:risk-5', 'Hansen GFC – tổng diện tích mất tán cây 5 năm gần nhất theo xã', {}],
  ['hotspots', 'vector', 'fire', 'Điểm nóng / điểm cháy 7 ngày (FIRMS + nhập tay)', 'mk:hotspot-unverified', 'NASA FIRMS NRT (MODIS, VIIRS) và điểm cháy cán bộ nhập; chỉ hiện điểm trong 7 ngày gần nhất – xem lịch sử ở trang Cảnh báo cháy', { on: true }],
  ['danger', 'choro', 'fire', 'Cấp nguy cơ cháy theo ngày', 'sym:risk-5', 'Cấp dự báo cháy theo chỉ số P Nesterov – theo ngày chọn ở khung bên phải', { on: true }],
  ['danger7', 'choro', 'fire', 'Cấp cao nhất 7 ngày tới', 'sym:risk-4', 'Cấp cao nhất trong 7 ngày tới', {}],
  ['wind-du-bao', 'vector', 'fire-env', 'Hướng gió 13 giờ hôm nay (theo xã)', 'ic2:wind', 'Open-Meteo – dự báo tại 40 điểm đại diện xã; mũi tên chỉ hướng gió thổi tới', {}],
  ['weather', 'vector', 'weather', 'Nhiệt độ và hướng gió hiện tại', 'ic2:wind', 'OpenWeather – thời tiết hiện tại tại điểm đại diện xã', {}],
  ['reports', 'vector', 'field', 'Phản ánh hiện trường (công khai)', 'mk:report-photo', 'Phản ánh đã được cán bộ cho phép công khai', {}],
  ['s2-latest', 'overlay', 'imagery', null, 'ic2:satellite', null, { forest: true }],
  ['s2-2025-dry-true', 'overlay', 'imagery', 'Màu tự nhiên – mùa khô 2025', 'ic2:satellite', null, {}],
  ['s2-2025-wet-true', 'overlay', 'imagery', 'Màu tự nhiên – mùa mưa 2025', 'ic2:satellite', null, {}],
  ['s2-2025-dry-false', 'overlay', 'imagery', 'Giả màu – mùa khô 2025', 'ic2:satellite', null, {}],
  ['s2-2025-wet-false', 'overlay', 'imagery', 'Giả màu – mùa mưa 2025', 'ic2:satellite', null, {}],
  ['ndvi-latest', 'overlay', 'terrain', null, 'ic2:plantation', null, { forest: true }],
  ['dem-2024', 'overlay', 'terrain', 'Địa hình (DEM 30 m)', 'ic2:map', null, { forest: true }],
  ['ndvi-2025-dry', 'overlay', 'terrain', 'NDVI mùa khô 2025', 'ic2:plantation', null, {}],
  ['ndvi-2025-wet', 'overlay', 'terrain', 'NDVI mùa mưa 2025', 'ic2:plantation', null, {}],
  ['ndvi-2024-dry', 'overlay', 'terrain', 'NDVI mùa khô 2024', 'ic2:plantation', null, {}],
  ['ndvi-2024-wet', 'overlay', 'terrain', 'NDVI mùa mưa 2024', 'ic2:plantation', null, {}],
  ['worldcover-2021', 'overlay', 'terrain', 'Lớp phủ đất 2021 (ESA WorldCover, tham khảo)', 'ic2:forest', null, {}],
  ['wind-era5', 'vector', 'reanalysis', 'Hướng gió theo lưới ERA5-Land', 'ic2:wind', 'ERA5-Land – gió 10 m lúc 12 giờ ngày gần nhất có tái phân tích, lưới ~11 km', {}],
];

// nhóm cho lớp ảnh sinh tự động (theo id / group trong overlays.json)
function autoGroup(o) {
  if (o.group === 'change-run') return 'change';
  if (o.group === 'landcover' || /^dw-\d{4}$/.test(o.id)) return 'landcover';
  if (o.group === 'class') return 'class';
  if (o.group === 'fire-env') return 'fire-env';
  if (o.group === 'weather') return o.id.startsWith('wx-era') ? 'reanalysis' : 'weather';
  if (o.id.startsWith('s2-')) return 'imagery';
  return 'terrain';
}
const wxIcon = (id) => `ic2:${id.endsWith('rain') ? 'rain' : id.endsWith('wind') ? 'wind' : 'temperature'}`;

// bản đồ chuyên đề đã xuất bản → nhóm; bản trùng dữ liệu với lớp hệ thống thì ẩn mặc định (quản trị bật lại được)
function mapGroup(m) {
  const t = m.title || '';
  if (m.category === 'khi-hau' || /nhiệt độ bề mặt/i.test(t)) return 'map-lst';
  if (m.category === 'bien-dong' || /biến động/i.test(t)) return 'map-change';
  if (/LPR/i.test(t)) return 'map-lpr';
  if (m.category === 'tai-nguyen-rung') return 'map-lpr';
  return 'map-other';
}
function mapDuplicate(m) {
  const t = m.title || '';
  const y = m.map_year;
  if (/GeoTIFF 15 m/i.test(t) && [1991, 2014, 2023].includes(Number(y))) return `Trùng lớp “Lớp phủ năm ${y}” (cùng tệp GeoTIFF, lớp hệ thống hiển thị ô ảnh 15 m sắc nét hơn)`;
  if (/bản biên tập/i.test(t) && [1991, 2014, 2023].includes(Number(y))) return `Bản trình bày (bố cục in) của “Lớp phủ năm ${y}” – dữ liệu trùng lớp hệ thống`;
  return null;
}
const shortMapTitle = (m) => String(m.title || '').replace(/^Bản đồ\s+/i, '').replace(/\s*tỉnh Kon Tum\s*/i, ' ').replace(/\s+–\s+ảnh$/, '').replace(/\s{2,}/g, ' ').trim()
  .replace(/^./, (c) => c.toUpperCase());

function settings() { return Object.fromEntries(store.all('layer_settings').map((s) => [s.id, s])); }

// Danh mục đầy đủ (kể cả lớp ẩn) – dùng cho quản trị; public() lọc lớp ẩn
async function full({ mapLayers } = {}) {
  const ov = Object.fromEntries(repo.overlays().map((o) => [o.id, o]));
  const maps = mapLayers || await require('./maps').publishedLayers().catch(() => []);
  const items = [];
  let order = 0;
  const L = labels();
  const lab = (t) => (typeof t === 'string' && t.startsWith('@') ? L[t.slice(1)] : t);
  for (const [id, kind, group, title0, icon, info0, opts] of STATIC) {
    const title = lab(title0); const info = info0 ? String(lab(info0)).replace('@decision', L.decision) : info0;
    if (kind === 'overlay' && !ov[id]) continue;
    const o = ov[id];
    let t = title;
    if (id === 'change-latest') t = o && o.window ? `Biến động NDVI ${String(o.window).split(' ')[0].replace(/^(\d{4})-(\d{2})\.\.(\d{2})$/, '$2–$3/$1')}` : 'Biến động NDVI mới nhất';
    if (id === 's2-latest') t = o && o.month ? `Ảnh Sentinel-2 mới nhất ${o.month.slice(5)}/${o.month.slice(0, 4)}` : 'Ảnh Sentinel-2 mới nhất';
    if (id === 'ndvi-latest') t = o && o.month ? `NDVI tháng mới nhất ${o.month.slice(5)}/${o.month.slice(0, 4)}` : 'NDVI tháng mới nhất';
    items.push({ id, kind, group, title: t || (o && o.title) || id, icon, info: info || (o ? `${o.title} – ${o.source}. ${o.meaning || ''}${o.resolution ? ` (${o.resolution})` : ''}` : ''),
      default_on: Boolean(opts.on), on_forest: Boolean(opts.forest), hidden: false, sort: (order += 10), source: 'system', deletable: false });
  }
  const known = new Set(items.map((i) => i.id));
  for (const o of Object.values(ov)) {
    if (known.has(o.id)) continue;
    const g = autoGroup(o);
    items.push({ id: o.id, kind: 'overlay', group: g, title: o.title, year: o.year || null, icon: g === 'landcover' ? 'sym:forest-evergreen' : g === 'weather' || g === 'reanalysis' ? wxIcon(o.id) : g === 'fire-env' ? `ic2:${o.id.startsWith('lst') ? 'temperature' : 'water'}` : g === 'class' ? 'ic2:forest' : g === 'change' ? 'sym:change-suspected' : 'ic2:map',
      info: `${o.title} – ${o.source}. ${o.meaning || ''}${o.resolution ? ` (${o.resolution})` : ''}`, default_on: false, on_forest: false, hidden: false, sort: g === 'landcover' && o.year ? 5000 - o.year : (order += 10), source: 'auto', deletable: false });
  }
  for (const m of maps.slice().sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.map_year || 0) - (b.map_year || 0) || a.title.localeCompare(b.title, 'vi'))) {
    const dup = mapDuplicate(m);
    items.push({ id: `m-${m.id}`, kind: 'map', group: mapGroup(m), title: shortMapTitle(m), full_title: m.title, icon: 'ic2:layers', map_id: m.id, year: m.map_year,
      info: `${m.source_org || 'Bản đồ chuyên đề'}${m.map_year ? ` · ${m.map_year}` : ''}${m.georef_method === 'auto_shape' ? ` · tự định vị theo hình tỉnh, sai số ~${Math.round(m.residual_error)} m` : m.georef_method && m.georef_method.startsWith('gcp') ? ` · nắn chỉnh, RMSE ${m.residual_error} m` : ''}${m.description ? `. ${m.description}` : ''}`,
      default_on: false, on_forest: false, hidden: Boolean(dup), duplicate: dup, sort: (order += 10), source: 'map', deletable: false, opacity: (m.display && m.display.opacity) || 0.8 });
  }
  for (const l of repo.customLayers(false)) {
    items.push({ id: `c-${l.id}`, kind: 'custom', group: 'custom', title: l.title, icon: null, color: (l.style && l.style.color) || '#00bcd4', layer_id: l.id,
      info: `${l.source || ''} ${l.description || ''}`.trim(), default_on: false, on_forest: false, hidden: false, sort: (order += 10), source: 'custom', deletable: true });
  }
  // cấu hình quản trị đè mặc định
  const st = settings();
  const gm = groupMap();
  for (const it of items) {
    const s = st[it.id];
    it.defaults = { title: it.title, group: it.group, sort: it.sort, hidden: it.hidden, default_on: it.default_on, on_forest: it.on_forest };
    if (!s) continue;
    if (s.title) it.title = s.title;
    if (s.grp && gm[s.grp]) it.group = s.grp;
    if (Number.isFinite(s.sort)) it.sort = s.sort;
    if (s.hidden !== null && s.hidden !== undefined) it.hidden = s.hidden;
    if (s.default_on !== null && s.default_on !== undefined) it.default_on = s.default_on;
    if (s.on_forest !== null && s.on_forest !== undefined) it.on_forest = s.on_forest;
    if (s.deleted) { it.deleted = true; it.hidden = true; }
    it.customized = { by: s.updated_by, at: s.updated_at };
  }
  // nhóm bị ẩn → lớp trong nhóm không hiện; nhóm bị xoá → lớp về nhóm mặc định
  for (const it of items) { if (!gm[it.group]) it.group = it.defaults.group; if (gm[it.group] && gm[it.group].hidden) { it.hidden = true; it.group_hidden = true; } }
  const gOrder = groups().map((g) => g.key);
  items.sort((a, b) => gOrder.indexOf(a.group) - gOrder.indexOf(b.group) || a.sort - b.sort);
  return items;
}

// cây nhóm cho trang bản đồ: [{ ...group, items[] }] – chỉ lớp không ẩn
async function tree(opts) {
  const items = (await full(opts)).filter((i) => !i.hidden);
  const L = labels();
  return groups().filter((g) => !g.hidden).map((g) => ({ ...g, title: g.key === 'forest' && !g.customized ? L.forest : g.title, items: items.filter((i) => i.group === g.key) })).filter((g) => g.items.length);
}

function save(user, id, b) {
  const old = store.get('layer_settings', id);
  const bool = (v) => (v === undefined ? undefined : v === true || v === '1' || v === 'on' || v === 'true');
  const rec = {
    hidden: bool(b.hidden) ?? false, default_on: bool(b.default_on) ?? false, on_forest: bool(b.on_forest) ?? false,
    title: String(b.title || '').trim().slice(0, 160) || null, grp: groupMap()[b.grp] ? b.grp : null, sort: Number.isFinite(Number(b.sort)) && b.sort !== '' ? Math.round(Number(b.sort)) : null,
    updated_by: user.username,
  };
  const row = old ? store.update('layer_settings', id, rec) : store.insert('layer_settings', { id, ...rec });
  store.audit(user, 'layer.settings', id, rec);
  return row;
}
function reset(user, id) { if (store.get('layer_settings', id)) { store.remove('layer_settings', id); store.audit(user, 'layer.settings.reset', id); } }
function setHidden(user, id, hidden) {
  const old = store.get('layer_settings', id);
  const row = old ? store.update('layer_settings', id, { hidden, updated_by: user.username }) : store.insert('layer_settings', { id, hidden, updated_by: user.username });
  store.audit(user, hidden ? 'layer.hide' : 'layer.show', id);
  return row;
}

// Xoá lớp: vector bổ sung và bản đồ chuyên đề xoá hẳn dữ liệu; lớp hệ thống/tự sinh (do lịch chạy tạo lại) chỉ gỡ khỏi danh mục,
// dữ liệu giữ nguyên và khôi phục được ở mục “Lớp đã xoá”.
async function remove(user, id) {
  const it = (await full()).find((i) => i.id === id);
  if (!it) throw Object.assign(new Error('Không tìm thấy lớp'), { status: 404 });
  if (it.kind === 'custom') { require('./layers').remove(user, it.layer_id); reset(user, id); return { removed: 'data' }; }
  if (it.kind === 'map') { await require('./maps').remove(it.map_id, user); reset(user, id); store.audit(user, 'map.delete', it.map_id); return { removed: 'data' }; }
  const old = store.get('layer_settings', id);
  const data = { deleted: true, hidden: true, updated_by: user.username };
  if (old) store.update('layer_settings', id, data); else store.insert('layer_settings', { id, ...data });
  store.audit(user, 'layer.remove_from_catalog', id);
  return { removed: 'catalog' };
}
function restore(user, id) {
  const old = store.get('layer_settings', id); if (!old) return;
  store.update('layer_settings', id, { deleted: false, hidden: false, updated_by: user.username });
  store.audit(user, 'layer.restore', id);
}

// ---------- chia sẻ: mô tả truy cập dữ liệu của từng lớp (dùng cho API /api/v1/catalog) ----------
function share(it, base, extra = {}) {
  const link = (u) => (u ? `${base}${u}` : null);
  const out = { id: it.id, title: it.title, kind: it.kind, group: it.group, group_title: (groupMap()[it.group] || {}).title, source: it.source, description: it.info || null };
  if (it.kind === 'overlay' || it.kind === 'map') {
    const o = extra.overlay || {};
    out.type = 'raster';
    out.image = { url: link(o.url), format: 'image/webp', crs: 'EPSG:3857 (ảnh), toạ độ góc WGS84', coordinates: o.coordinates || null };
    if (o.tiles) out.tiles = { url: link(o.tiles.url), scheme: 'xyz', minzoom: o.tiles.minzoom, maxzoom: o.tiles.maxzoom, bounds: o.tiles.bounds };
    if (o.legend) out.legend = o.legend;
    if (o.resolution) out.resolution = o.resolution;
    if (extra.download) out.download = link(extra.download);
  } else if (it.kind === 'vector' || it.kind === 'custom') {
    out.type = 'vector';
    out.geojson = link(extra.geojson);
  } else if (it.kind === 'choro') {
    out.type = 'vector';
    out.geojson = link('/api/public/boundaries/communes');
    out.attribute = { cover: 'cover', forest: 'forest_ha', risk: 'risk_mean', loss: 'loss_last5', danger: 'danger_cls', danger7: 'danger_max7' }[it.id] || it.id;
    out.note = 'Lớp tô màu theo xã: lấy GeoJSON ranh giới xã, thuộc tính ghi ở trường "attribute"';
  }
  out.metadata = link(`/api/v1/catalog/${encodeURIComponent(it.id)}`);
  return out;
}

// ---------- quản lý nhóm ----------
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
function saveGroup(user, key, b) {
  const k = key || `g-${slug(b.title) || Date.now()}`;
  if (!key && groupMap()[k]) throw Object.assign(new Error('Đã có nhóm trùng tên'), { status: 400 });
  const rec = { key: k, title: String(b.title || '').trim().slice(0, 120) || null, section: String(b.section || '').trim().toUpperCase().slice(0, 60) || null,
    tab: ['theme', 'base'].includes(b.tab) ? b.tab : null, sort: b.sort !== undefined && b.sort !== '' && Number.isFinite(Number(b.sort)) ? Math.round(Number(b.sort)) : null,
    hidden: b.hidden === true || b.hidden === '1' || b.hidden === 'on', deleted: false, updated_by: user.username };
  if (!key && !rec.title) throw Object.assign(new Error('Nhập tên nhóm'), { status: 400 });
  const old = store.get('layer_groups', k);
  const row = old ? store.update('layer_groups', k, rec) : store.insert('layer_groups', { id: k, ...rec });
  store.audit(user, key ? 'layer.group.edit' : 'layer.group.create', k, rec);
  return row;
}
async function removeGroup(user, key) {
  const g = groupMap()[key];
  if (!g) throw Object.assign(new Error('Không có nhóm này'), { status: 404 });
  if (g.builtin) throw Object.assign(new Error('Nhóm mặc định không xoá được – có thể ẩn hoặc đổi tên'), { status: 400 });
  // lớp đang gán vào nhóm này trở về nhóm mặc định của lớp
  for (const s of store.all('layer_settings').filter((x) => x.grp === key)) store.update('layer_settings', s.id, { grp: null, updated_by: user.username });
  store.remove('layer_groups', key);
  store.audit(user, 'layer.group.delete', key);
}
function resetGroup(user, key) { if (store.get('layer_groups', key) && groupMap()[key] && groupMap()[key].builtin) { store.remove('layer_groups', key); store.audit(user, 'layer.group.reset', key); } }

module.exports = { GROUPS, GROUP, groups, groupMap, full, tree, save, reset, setHidden, remove, restore, share, saveGroup, removeGroup, resetGroup };
