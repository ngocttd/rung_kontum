/* P02 – Bản đồ WebGIS */
(function () {
  const P = window.PAGE;
  const params = new URLSearchParams(location.search);
  const status = document.getElementById('map-status');
  const legend = document.getElementById('legend');
  const ovById = Object.fromEntries(P.overlays.map((o) => [o.id, o]));
  let dangerData = null; let dangerDay = 'current'; let forestBy = {}; let v = null;

  // ---------- bottom charts ----------
  KT.getJSON('/api/public/forest/summary').then((s) => {
    KT.donut('ch-plan', ['Rừng đặc dụng', 'Rừng phòng hộ', 'Rừng sản xuất'], [s.special_use_ha, s.protection_ha, s.production_ha], ['#006b38', '#75bb25', '#f8ce42'], ['Tổng', `${KT.num(s.planning_ha)} ha`]);
  });
  let hsChart = null; let hsFeatures = [];
  function drawHotspot7(code) {
    const today = new Date(Date.now() + 7 * 3600e3);
    const days = [...Array(7).keys()].map((i) => new Date(today.getTime() - (6 - i) * 864e5).toISOString().slice(0, 10));
    const count = (d) => hsFeatures.filter((f) => (!code || f.properties.communeCode === code) && new Date(new Date(f.properties.utc).getTime() + 7 * 3600e3).toISOString().slice(0, 10) === d).length;
    if (hsChart) hsChart.destroy();
    hsChart = KT.chart('ch-hot', { type: 'bar', data: { labels: days.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`), datasets: [{ label: 'Số điểm nóng', data: days.map(count), backgroundColor: '#ef3b24', borderRadius: 2, maxBarThickness: 26 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, suggestedMax: 4, ticks: { precision: 0 } } } } });
  }
  KT.fetchCached('/api/public/fire/hotspots').then((fc) => { hsFeatures = fc.features; drawHotspot7(''); showFirstHotspot(); });
  KT.fetchCached('/api/public/boundaries/communes').then((fc) => {
    const sel = document.getElementById('hs-commune');
    fc.features.map((f) => f.properties).sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')).forEach((p) => { sel.insertAdjacentHTML('beforeend', `<option value="${p.code}">${KT.esc(p.fullName)}</option>`); });
    forestBy = Object.fromEntries(fc.features.map((f) => [f.properties.code, f.properties.forest_ha || 0]));
    renderDanger();
  });
  document.getElementById('hs-commune').addEventListener('change', (e) => drawHotspot7(e.target.value));

  // ---------- fire danger card (forest area by class) ----------
  const NAMES = { 5: 'Rất cao', 4: 'Cao', 3: 'Trung bình', 2: 'Thấp', 1: 'Rất thấp' };
  const dChart = KT.donut('ch-danger', [1, 2, 3, 4, 5].map((k) => KT.LEVEL[k]), [0, 0, 0, 0, 0], [1, 2, 3, 4, 5].map((k) => KT.RISK[k]), ['Tổng diện tích', '…']);
  function dayClasses() {
    if (!dangerData) return {};
    return Object.fromEntries(dangerData.communes.map((c) => { const d = dangerDay === 'current' ? c.current : c.forecast[Number(dangerDay)]; return [c.code, d ? d.cls : null]; }));
  }
  function renderDanger() {
    if (!dangerData) return;
    const cls = dayClasses();
    const area = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    Object.entries(cls).forEach(([code, c]) => { if (c) area[c] += forestBy[code] || 0; });
    const tot = Object.values(area).reduce((a, b) => a + b, 0);
    dChart.data.datasets[0].data = [1, 2, 3, 4, 5].map((k) => area[k]);
    dChart.$center = ['Tổng diện tích', `${KT.num(tot)} ha`];
    dChart.update();
    document.getElementById('danger-list').innerHTML = [5, 4, 3, 2, 1].map((k) => `<li><span class="dot" style="background:${KT.RISK[k]}"></span><strong>${NAMES[k]}</strong><span class="v">Diện tích: ${KT.num(area[k])} ha</span><span class="v" style="min-width:42px">${tot ? KT.num((area[k] / tot) * 100, 1) : '0,0'}%</span></li>`).join('');
    if (v && v.choropleth === 'danger' && v.map.getLayer('communes-fill')) {
      const expr = ['match', ['get', 'code']];
      Object.entries(cls).forEach(([code, c]) => { expr.push(code, c ? KT.RISK[c] : '#cccccc'); });
      expr.push('#cccccc');
      v.map.setPaintProperty('communes-fill', 'fill-color', expr);
    }
  }
  KT.getJSON('/api/public/fire/danger').then((d) => { dangerData = d; renderDanger(); });
  document.getElementById('danger-day').addEventListener('change', (e) => { dangerDay = e.target.value; renderDanger(); });

  // ---------- layer panel tabs, gear/info buttons ----------
  const tree = document.getElementById('layer-tree');
  document.querySelector('[data-lt-tabs]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lt]'); if (!b) return;
    document.querySelectorAll('[data-lt]').forEach((x) => x.classList.toggle('on', x === b));
    tree.querySelectorAll('[data-lt-group]').forEach((g) => { g.hidden = !g.dataset.ltGroup.split(' ').includes(b.dataset.lt); });
  });
  tree.querySelectorAll('[data-lt-group]').forEach((g) => { g.hidden = !g.dataset.ltGroup.split(' ').includes('theme'); });
  tree.addEventListener('click', (e) => {
    const g = e.target.closest('[data-gear]');
    if (g) { const it = g.closest('.lt-item'); if (it.querySelector('input[type=range]')) it.classList.toggle('show-op'); else status.textContent = 'Lớp vector: độ mờ cố định'; }
    const m = e.target.closest('[data-more]');
    if (m) status.textContent = m.title;
  });

  v = KT.createMap('map', { basemap: 'satellite', exportable: true, choropleth: 'danger', padding: 46 });
  document.getElementById('choro-danger').checked = true;
  if (!v) return;
  const { map } = v;

  // ---------- layers ----------
  P.overlays.forEach((o) => v.define(`ov-${o.id}`, KT.layers.overlay(o)));
  v.define('communes', KT.layers.communes(v)).define('province', KT.layers.province()).define('candidates', KT.layers.candidates())
    .define('reports', { ...KT.layers.reports(), visible: false }).define('samples', KT.layers.samples()).define('weather', KT.layers.weather()).define('hotspots', KT.layers.hotspots());
  P.custom.forEach((l) => v.define(`custom-${l.id}`, KT.layers.custom(l)));
  v.onChoropleth = () => { renderDanger(); updateLegend(); };
  v.onBuilt = () => { if (v.choropleth === 'danger') renderDanger(); };

  function updateLegend() {
    const parts = [];
    if (v.choropleth) parts.push(`<div>${KT.legendHtml(v.choropleth)}</div>`);
    P.overlays.forEach((o) => { if (v.defs[`ov-${o.id}`] && v.defs[`ov-${o.id}`].visible) parts.push(`<div style="margin-top:8px">${KT.overlayLegendHtml(o)}<div class="src">${KT.esc(o.source)}</div></div>`); });
    if (v.defs.hotspots && v.defs.hotspots.visible) parts.push(`<div style="margin-top:8px">${KT.hotspotLegendHtml()}</div>`);
    if (v.defs.candidates.visible) parts.push('<div style="margin-top:8px"><h4>Biến động nghi vấn</h4><div class="row"><span class="sw" style="background:#ff3d7f"></span>Chưa xác minh</div><div class="row"><span class="sw" style="background:#b81725"></span>Xác nhận mất rừng</div><div class="row"><span class="sw" style="background:#7b8791"></span>Không phải mất rừng</div></div>');
    legend.innerHTML = parts.join('');
    legend.hidden = !parts.length;
  }

  tree.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.overlay) v.setVisible(`ov-${t.dataset.overlay}`, t.checked);
    if (t.dataset.vector) v.setVisible(t.dataset.vector, t.checked);
    if (t.dataset.custom) v.setVisible(`custom-${t.dataset.custom}`, t.checked);
    if (t.dataset.choro) {
      tree.querySelectorAll('[data-choro]').forEach((c) => { if (c !== t) c.checked = false; });
      v.setChoropleth(t.checked ? t.dataset.choro : null);
    }
    updateLegend();
  });
  tree.addEventListener('input', (e) => { if (e.target.dataset.opacity) v.setOpacity(`ov-${e.target.dataset.opacity}`, Number(e.target.value)); });
  document.getElementById('layer-filter').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    tree.querySelectorAll('.lt-item').forEach((it) => { it.hidden = q && !it.textContent.toLowerCase().includes(q); });
    tree.querySelectorAll('details').forEach((d) => { if (q) { d.open = true; d.hidden = false; } });
  });
  document.querySelectorAll('[data-show-overlay]').forEach((b) => b.addEventListener('click', () => {
    const cb = document.getElementById(`ly-${b.dataset.showOverlay}`);
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[data-lt="base"]').click(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // ---------- selection & info panel ----------
  const tabs = document.querySelector('[data-tabs="info"]');
  const showTab = (name) => tabs.querySelector(`[data-tab="${name}"]`).click();
  function hotspotPanel(p) {
    const ctx = typeof p.context === 'string' ? JSON.parse(p.context) : p.context;
    const ll = `${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)}`;
    document.getElementById('info-hotspot').innerHTML = `<div style="display:grid;grid-template-columns:112px minmax(0,1fr);gap:10px">
      <div style="position:relative"><img src="/assets/items/wildfire-small.webp" alt="Ảnh minh họa" style="width:112px;height:96px;object-fit:cover;border-radius:8px;display:block"><span class="credit" style="top:auto;bottom:6px;right:6px">Ảnh minh họa</span></div>
      <table class="kv kv-tight" style="font-size:12.6px"><tr><td>Mã điểm nóng</td><td style="word-break:break-all">${KT.esc(String(p.id).slice(0, 26))}</td></tr><tr><td>Thời gian</td><td>${KT.dt(p.utc)}</td></tr>
      <tr><td>Nguồn</td><td>${KT.esc(p.sensorLabel)}${String(p.sensor) === 'MANUAL' ? '' : ' (NASA FIRMS)'}</td></tr>${String(p.sensor) === 'MANUAL' ? '' : `<tr><td>Nhiệt độ sáng</td><td>${KT.num(p.brightness, 1)} K</td></tr>`}
      <tr><td>Độ tin cậy</td><td>${KT.esc(p.confidence)}</td></tr><tr><td>Vị trí</td><td>${ll}</td></tr><tr><td>Địa bàn</td><td>${KT.esc(p.commune || 'Ngoài ranh xã')}</td></tr></table></div>
      <p class="src" style="margin:8px 0">${ctx ? `Lớp phủ: <b>${KT.esc(ctx.landcover || '—')}</b>${ctx.in_forest ? ' · trong vùng rừng' : ''} · ` : ''}${String(p.sensor) === 'MANUAL' ? 'Nhập thủ công' : `FRP ${p.frp ?? '—'} MW`} · <b>${KT.esc(p.statusLabel)}</b>${['confirmed', 'handling', 'closed', 'rejected'].includes(p.status) ? '' : ' (chưa xác minh hiện trường)'}</p>
      <div class="hs-actions">
        <button class="btn btn-outline btn-sm" data-hs-act="sat">${KT.ic('image-fill')} Xem ảnh vệ tinh</button>
        <button class="btn btn-outline btn-sm" data-hs-act="zoom">${KT.ic('shield-fill-check')} Xem khu vực xung quanh</button>
        <a class="btn btn-outline btn-sm" href="/phan-anh?lat=${p.lat}&lon=${p.lon}#gui">${KT.ic('megaphone-fill')} Tạo phản ánh</a></div>`;
    const box = document.getElementById('info-hotspot');
    box.querySelector('[data-hs-act="sat"]').onclick = () => { const cb = document.getElementById('ly-s2-latest') || document.getElementById('ly-s2-2025-dry-true'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); map.flyTo({ center: [Number(p.lon), Number(p.lat)], zoom: 11.5 }); };
    box.querySelector('[data-hs-act="zoom"]').onclick = () => map.flyTo({ center: [Number(p.lon), Number(p.lat)], zoom: 13.5 });
  }
  function showFirstHotspot() { if (hsFeatures.length) hotspotPanel(hsFeatures[0].properties); }

  let selected = null;
  function selectCommune(code) {
    if (selected && map.getSource('communes')) map.setFeatureState({ source: 'communes', id: selected }, { sel: false });
    selected = code;
    if (code && map.getSource('communes')) map.setFeatureState({ source: 'communes', id: code }, { sel: true });
    KT.fetchCached('/api/public/forest/communes').then((list) => {
      const c = list.find((x) => x.code === code);
      if (!c) return;
      const o = c.official || {}; const lc = c.landcover || {}; const rk = c.risk || {};
      document.getElementById('info-forest').innerHTML = `<h3 style="font-size:15px;margin-bottom:6px">${KT.esc(c.name)}</h3><table class="kv">
        <tr><td>Diện tích có rừng</td><td>${KT.num(o.established_forest_ha)} ha</td></tr><tr><td>Rừng tự nhiên</td><td>${KT.num(o.natural_forest_ha)} ha</td></tr>
        <tr><td>Rừng trồng đã thành rừng</td><td>${KT.num(o.established_plantation_ha)} ha</td></tr><tr><td>Rừng trồng chưa thành rừng</td><td>${KT.num(o.immature_plantation_ha)} ha</td></tr>
        <tr><td>QH đặc dụng / phòng hộ / sản xuất</td><td>${KT.num(o.special_use_planning_ha)} / ${KT.num(o.protection_planning_ha)} / ${KT.num(o.production_planning_ha)} ha</td></tr>
        <tr><td>Che phủ công bố</td><td>${KT.num(o.official_forest_cover_percent, 2)}%</td></tr>
        <tr><td>Cây gỗ WorldCover 2021</td><td>${KT.num((lc.tree_cover_share || 0) * 100, 1)}% (phần trong ranh cũ)</td></tr>
        <tr><td>Mất tán cây 2020–2024</td><td>${c.loss ? `${KT.num(c.loss.last5)} ha` : '—'}</td></tr>
        <tr><td>Dự báo mất rừng 2025–26</td><td>${rk.expected_loss_ha !== undefined ? `${KT.num(rk.expected_loss_ha)} ha kỳ vọng · ${KT.num(rk.high_risk_ha)} ha nguy cơ cao` : '—'}</td></tr></table>
        <p class="src">QĐ 1047/QĐ-UBND (31/12/2025, toàn xã) · Hansen GFC · mô hình dự báo của hệ thống</p>`;
      document.getElementById('info-admin').innerHTML = `<h3 style="font-size:15px;margin-bottom:6px">${KT.esc(c.name)}</h3><table class="kv">
        <tr><td>Mã đơn vị</td><td>${c.code}</td></tr><tr><td>Diện tích tự nhiên</td><td>${KT.num(o.natural_area_ha)} ha</td></tr>
        <tr><td>Độ cao trung bình</td><td>${KT.num(lc.elevation_mean_m)} m (${KT.num(lc.elevation_min_m)}–${KT.num(lc.elevation_max_m)} m)</td></tr>
        <tr><td>Phiên bản ranh giới</td><td>vietnamese-provinces-database v5.2.0</td></tr></table>
        <p class="src">Ranh xã hiện hành sau sắp xếp 2025; bản hiển thị đã cắt theo ranh Kon Tum cũ.</p>`;
    });
  }
  map.on('click', (e) => {
    if (v.measuring || coordMode) return;
    const feats = map.queryRenderedFeatures(e.point, { layers: ['hotspots', 'samples', 'cand-fill', 'cand-pt', 'reports', 'communes-fill'].filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none') });
    const f = feats[0];
    if (!f) return;
    if (f.layer.id === 'hotspots') { hotspotPanel(f.properties); showTab('hotspot'); }
    else if (f.layer.id === 'samples') new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(KT.sampleHtml(f.properties)).addTo(map);
    else if (f.layer.id.startsWith('cand')) new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(KT.candidateHtml(f.properties)).addTo(map);
    else if (f.layer.id === 'reports') new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(`<div class="pop"><h4>${KT.esc(f.properties.code)} · ${KT.esc(f.properties.typeLabel)}</h4><p>${KT.esc(f.properties.statusLabel)}</p><a href="/phan-anh?ma=${f.properties.code}">Xem hồ sơ</a></div>`).addTo(map);
    const c = feats.find((x) => x.layer.id === 'communes-fill');
    if (c) {
      selectCommune(c.properties.code);
      if (f.layer.id === 'communes-fill') { showTab('forest'); new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(KT.communeHtml(c.properties)).addTo(map); }
    }
  });
  ['hotspots', 'cand-fill', 'reports', 'communes-fill'].forEach((l) => {
    map.on('mouseenter', l, () => { if (!v.measuring) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { if (!v.measuring) map.getCanvas().style.cursor = ''; });
  });
  KT.onCommuneSearch = (code) => { selectCommune(code); showTab('forest'); };

  // ---------- tools ----------
  let stopMeasure = null; let coordMode = false;
  const toolbar = document.querySelector('.toolbar');
  toolbar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !b.dataset.tool) return;
    toolbar.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
    if (stopMeasure) { stopMeasure(); stopMeasure = null; v.measuring = false; }
    coordMode = b.dataset.tool === 'coord';
    if (b.dataset.tool === 'length' || b.dataset.tool === 'area') {
      v.measuring = true;
      status.textContent = 'Nhấp các điểm trên bản đồ để đo';
      stopMeasure = KT.measure(v, b.dataset.tool, (val, n) => {
        status.textContent = b.dataset.tool === 'area' ? `Diện tích: ${KT.num(val / 1e4, 2)} ha (${KT.num(val / 1e6, 3)} km²) · ${n} điểm` : `Khoảng cách: ${val > 1000 ? `${KT.num(val / 1000, 2)} km` : `${KT.num(val)} m`} · ${n} điểm`;
      });
    } else status.textContent = coordMode ? 'Di chuyển chuột để xem tọa độ; nhấp để sao chép' : 'Nhấp vào bản đồ để xem thông tin';
  });
  map.on('mousemove', (e) => { if (coordMode) status.textContent = `Vĩ độ ${e.lngLat.lat.toFixed(5)}, Kinh độ ${e.lngLat.lng.toFixed(5)} (WGS84)`; });
  map.on('click', (e) => { if (coordMode) { const t = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`; if (navigator.clipboard) navigator.clipboard.writeText(t); status.textContent = `Đã sao chép: ${t}`; } });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'zoom-in') map.zoomIn();
    if (act === 'zoom-out') map.zoomOut();
    if (act === 'home') v.fitAOI();
    if (act === 'fullscreen') { const el = map.getContainer().parentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); setTimeout(() => map.resize(), 300); }
    if (act === 'locate' && navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => {
      const ll = [p.coords.longitude, p.coords.latitude];
      new mapboxgl.Marker({ color: '#168bf0' }).setLngLat(ll).addTo(map); map.flyTo({ center: ll, zoom: 12 });
    }, () => { status.textContent = 'Không lấy được vị trí'; });
    if (act === 'export') { const a = document.createElement('a'); a.download = `ban-do-kon-tum-${new Date().toISOString().slice(0, 10)}.png`; a.href = map.getCanvas().toDataURL('image/png'); a.click(); }
    if (act === 'share') {
      const c = map.getCenter(); const url = `${location.origin}/ban-do#${c.lng.toFixed(4)},${c.lat.toFixed(4)},${map.getZoom().toFixed(1)}`;
      (navigator.share ? navigator.share({ title: 'Bản đồ rừng Kon Tum', url }) : navigator.clipboard.writeText(url)).then(() => { status.textContent = 'Đã sao chép liên kết bản đồ'; }).catch(() => {});
    }
    if (act === 'print') window.print();
    if (act === '3d') b.classList.toggle('on', v.toggle3D());
  });
  const setBase = (name) => {
    document.querySelectorAll('[data-base]').forEach((x) => x.classList.toggle('on', x.dataset.base === name));
    document.querySelectorAll('input[name=bm-left]').forEach((r) => { r.checked = r.value === name; });
    v.setBasemap(name);
  };
  document.querySelectorAll('[data-base]').forEach((b) => b.addEventListener('click', () => setBase(b.dataset.base)));
  document.querySelectorAll('input[name=bm-left]').forEach((r) => r.addEventListener('change', () => setBase(r.value)));

  // active layer summary + per-group counters
  const BOUNDARY = new Set(['province', 'communes']);
  function refreshActive() {
    const on = [...tree.querySelectorAll('input[type=checkbox]:checked')];
    const extra = on.filter((c) => !BOUNDARY.has(c.dataset.vector));
    const box = document.getElementById('lt-active');
    box.innerHTML = `${KT.ic('layers-fill')} Đang bật <b>${on.length}</b> lớp${extra.length ? ' <button type="button" id="lt-off">Tắt lớp chuyên đề</button>' : ''}`;
    const off = document.getElementById('lt-off');
    if (off) off.onclick = () => { extra.forEach((c) => { c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); };
    tree.querySelectorAll('details.lt-group').forEach((d) => {
      const n = d.querySelectorAll('input[type=checkbox]:checked').length;
      let c = d.querySelector('summary .cnt'); if (!c) { c = document.createElement('span'); c.className = 'cnt'; d.querySelector('summary').appendChild(c); }
      c.textContent = n ? `${n} bật` : '';
    });
  }
  tree.addEventListener('change', refreshActive);
  refreshActive();

  // ---------- initial state from URL ----------
  if (location.hash.length > 1) { const [x, y, z] = location.hash.slice(1).split(',').map(Number); if (z) { v.skipFit = true; map.jumpTo({ center: [x, y], zoom: z }); } }
  const lop = params.get('lop');
  if (lop && ovById[lop]) { const cb = document.getElementById(`ly-${lop}`); if (cb) { cb.checked = true; v.setVisible(`ov-${lop}`, true); const g = cb.closest('[data-lt-group]'); if (g && !g.dataset.ltGroup.includes('theme')) document.querySelector('[data-lt="base"]').click(); updateLegend(); } }
  const xa = params.get('xa');
  if (xa) {
    v.skipFit = true;
    map.once('idle', () => {
      const feat = map.querySourceFeatures('communes', { filter: ['==', ['get', 'code'], xa] })[0];
      selectCommune(xa); showTab('forest');
      if (feat) { const bb = new mapboxgl.LngLatBounds(); (feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates).forEach((pp) => pp[0].forEach((pt) => bb.extend(pt))); map.fitBounds(bb, { padding: 60 }); }
    });
  }
})();
