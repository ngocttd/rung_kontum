/* P03 – Tài nguyên rừng */
(function () {
  const P = window.PAGE;
  const ovById = Object.fromEntries(P.overlays.map((o) => [o.id, o]));
  KT.chart('ch-origin', {
    type: 'doughnut',
    data: {
      labels: ['Đặc dụng', 'Phòng hộ', 'Sản xuất'],
      datasets: [
        { data: [P.summary.special_use_ha, P.summary.protection_ha, P.summary.production_ha], backgroundColor: ['#006b38', '#75bb25', '#f8ce42'], borderColor: '#fff', borderWidth: 2 },
        { data: [P.summary.natural_forest_ha, P.summary.plantation_ha], backgroundColor: ['#176c35', '#b567d7'], borderColor: '#fff', borderWidth: 2 },
      ],
    },
    options: { cutout: '42%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.datasetIndex ? ['Rừng tự nhiên', 'Rừng trồng'][c.dataIndex] : ['Đặc dụng', 'Phòng hộ', 'Sản xuất'][c.dataIndex]}: ${KT.num(c.parsed)} ha` } } } },
  });

  // right chart: Hansen loss or NDVI series
  let lossChart = null;
  async function drawLoss(mode) {
    if (lossChart) lossChart.destroy();
    const note = document.getElementById('loss-note');
    if (mode === 'loss' && P.loss) {
      const ys = Object.keys(P.loss).filter((y) => y >= '2015');
      lossChart = KT.chart('ch-loss', { type: 'bar', data: { labels: ys, datasets: [{ label: 'Mất tán cây (ha)', data: ys.map((y) => P.loss[y]), backgroundColor: '#6fbf4a', borderRadius: 3 }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } } });
      note.textContent = 'Hansen/UMD GFC v1.12 – mất tán cây mọi nguyên nhân (gồm khai thác rừng trồng), ha/năm.';
    } else {
      const rows = await KT.getJSON('/api/public/ndvi');
      lossChart = KT.chart('ch-loss', { type: 'line', data: { labels: rows.map((r) => `${r.month.slice(5)}/${r.month.slice(2, 4)}`), datasets: [{ label: 'NDVI', data: rows.map((r) => r.ndvi), borderColor: '#0f7a52', tension: 0.3, pointRadius: 2 }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } } } } });
      note.textContent = 'NDVI trung bình tháng (Sentinel-2, 100 m) 01/2024–09/2026; giảm mùa khô là quy luật mùa vụ.';
    }
  }
  drawLoss('loss');
  document.getElementById('loss-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#loss-mode button').forEach((x) => x.classList.toggle('on', x === b)); drawLoss(b.dataset.m);
  });

  // satellite illustration tabs
  document.getElementById('sat-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || !ovById[b.dataset.img]) return;
    document.querySelectorAll('#sat-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.getElementById('sat-img').src = ovById[b.dataset.img].url;
    document.getElementById('sat-cap').textContent = ovById[b.dataset.img].title;
  });

  // tab charts
  const done = {};
  function drawPlan() {
    if (done.plan) return; done.plan = true;
    KT.chart('ch-plan', { type: 'bar', data: { labels: P.plan.map((x) => x.name), datasets: [
      { label: 'Đặc dụng', data: P.plan.map((x) => x.sp), backgroundColor: '#006b38' }, { label: 'Phòng hộ', data: P.plan.map((x) => x.pr), backgroundColor: '#75bb25' }, { label: 'Sản xuất', data: P.plan.map((x) => x.pd), backgroundColor: '#f8ce42' }] },
      options: { scales: { x: { stacked: true, ticks: { autoSkip: false, maxRotation: 70, font: { size: 10 } } }, y: { stacked: true } } } });
    const colors = { 10: '#006400', 20: '#ffbb22', 30: '#ffff4c', 40: '#f096ff', 50: '#fa0000', 60: '#b4b4b4', 80: '#0064c8', 90: '#0096a0' };
    const ks = Object.keys(P.wc.aoi_worldcover_ha).sort((a, b) => P.wc.aoi_worldcover_ha[b] - P.wc.aoi_worldcover_ha[a]);
    KT.donut('ch-wc', ks.map((k) => P.wc.classes[k]), ks.map((k) => P.wc.aoi_worldcover_ha[k]), ks.map((k) => colors[k]));
  }
  function drawCat(key) {
    if (done[key]) return; done[key] = true;
    const c = document.querySelector(`[data-cat-chart="${key}"]`); const rows = P.cats[key];
    KT.chart(c, { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ label: 'ha', data: rows.map((r) => r.v), backgroundColor: c.dataset.color, borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { y: { ticks: { font: { size: 10.5 } } } } } });
  }
  let lcChart = null;
  function drawLandcover(code) {
    if (!P.lc) return;
    const src = code ? P.lc.by_commune[code] : P.lc.aoi;
    const ks = Object.keys(P.lc.classes);
    const yr = (y) => src[y] || src[String(y)] || {};
    if (lcChart) lcChart.destroy();
    lcChart = KT.chart('ch-lc', { type: 'bar', data: { labels: P.lc.years.map(String), datasets: ks.map((k) => ({ label: P.lc.classes[k].label, data: P.lc.years.map((y) => yr(y)[k] || 0), backgroundColor: P.lc.classes[k].color })) },
      options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => KT.num(v) } } }, plugins: { legend: { position: 'bottom' } } } });
    document.querySelector('#lc-table tbody').innerHTML = ks.map((k) => {
      const a = yr(P.lc.years[0])[k] || 0; const b = yr(P.lc.years[P.lc.years.length - 1])[k] || 0;
      return `<tr><td><span class="dot" style="background:${P.lc.classes[k].color}"></span> ${KT.esc(P.lc.classes[k].label)}</td>${P.lc.years.map((y) => `<td class="num">${KT.num(yr(y)[k] || 0)}</td>`).join('')}<td class="num" style="color:${b - a < 0 ? 'var(--red)' : 'var(--forest)'}">${b - a > 0 ? '+' : ''}${KT.num(b - a)}</td></tr>`;
    }).join('');
  }
  const lcSel = document.getElementById('lc-commune');
  if (lcSel) lcSel.addEventListener('change', () => drawLandcover(lcSel.value));
  const CAT_KEY = { 'dac-dung': ['special_use_planning_ha', 'special'], 'phong-ho': ['protection_planning_ha', 'protection'], 'san-xuat': ['production_planning_ha', 'production'] };
  let v = null;
  const tabs = document.querySelector('[data-tabs="forest"]');
  const onTab = (t) => {
    if (t === 'phan-loai') drawPlan();
    if (t === 'lop-phu' && !done.lc) { done.lc = true; drawLandcover(''); }
    if (CAT_KEY[t]) { drawCat(CAT_KEY[t][0]); setChoro(CAT_KEY[t][1]); }
  };
  tabs.addEventListener('tabchange', (e) => { onTab(e.detail); history.replaceState(null, '', `?tab=${e.detail}`); });

  // sortable tables
  document.querySelectorAll('[data-sortable] thead th').forEach((th, i) => th.addEventListener('click', () => {
    const tb = th.closest('table').tBodies[0]; const asc = th.dataset.asc !== '1'; th.dataset.asc = asc ? '1' : '0';
    const val = (tr) => { const t = tr.children[i].textContent.trim(); const n = Number(t.replace(/\./g, '').replace(',', '.').replace('%', '')); return Number.isNaN(n) ? t : n; };
    [...tb.rows].sort((a, b) => { const x = val(a); const y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1); }).forEach((r) => tb.appendChild(r));
  }));

  // ---------- map ----------
  v = KT.createMap('map', { basemap: 'satellite', choropleth: 'cover', padding: 30 });
  const legend = document.getElementById('legend');
  function renderLegend() {
    if (!v) return;
    legend.innerHTML = (v.choropleth ? KT.legendHtml(v.choropleth) : '') + P.overlays.filter((o) => v.defs[`ov-${o.id}`] && v.defs[`ov-${o.id}`].visible).map((o) => `<div style="margin-top:8px">${KT.overlayLegendHtml(o)}</div>`).join('');
    legend.hidden = !legend.innerHTML;
  }
  function setChoro(mode) {
    document.querySelectorAll('input[name=ftype]').forEach((c) => { c.checked = c.value === mode; });
    if (v) { v.setChoropleth(mode || 'cover'); renderLegend(); }
  }
  onTab(new URLSearchParams(location.search).get('tab'));
  if (!v) return;
  P.overlays.forEach((o) => v.define(`ov-${o.id}`, KT.layers.overlay(o)));
  v.define('communes', KT.layers.communes(v)).define('province', KT.layers.province());
  renderLegend();

  // filters: one forest type at a time colours the communes
  document.querySelectorAll('input[name=ftype]').forEach((c) => c.addEventListener('change', () => setChoro(c.checked ? c.value : null)));
  document.querySelectorAll('[data-ov]').forEach((c) => c.addEventListener('change', () => { v.setVisible(`ov-${c.dataset.ov}`, c.checked); renderLegend(); }));
  document.querySelectorAll('[data-vec]').forEach((c) => c.addEventListener('change', () => v.setVisible(c.dataset.vec, c.checked)));
  document.querySelectorAll('input[name=bm]').forEach((r) => r.addEventListener('change', () => {
    const s2 = r.value === 's2';
    v.setBasemap(s2 ? 'satellite' : r.value);
    const id = ovById['s2-latest'] ? 's2-latest' : 's2-2025-dry-true';
    v.setVisible(`ov-${id}`, s2);
    const cb = document.querySelector(`[data-ov="${id}"]`); if (cb) cb.checked = s2;
    renderLegend();
  }));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'home') v.fitAOI();
    if (b.dataset.act === 'zoom-in') v.map.zoomIn();
    if (b.dataset.act === 'zoom-out') v.map.zoomOut();
    if (b.dataset.act === 'locate' && navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => v.map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 12 }));
  });

  let sel = null;
  function focus(code) {
    if (sel && v.map.getSource('communes')) v.map.setFeatureState({ source: 'communes', id: sel }, { sel: false });
    sel = code || null;
    document.querySelectorAll('tr[data-code]').forEach((tr) => { tr.classList.toggle('sel', tr.dataset.code === code); const t = tr.closest('table'); if (tr.dataset.code === code && t && t.showItem) t.showItem(tr); });
    if (!code) { v.fitAOI(); return; }
    v.map.setFeatureState({ source: 'communes', id: code }, { sel: true });
    const f = v.map.querySourceFeatures('communes', { filter: ['==', ['get', 'code'], code] })[0];
    if (f) { const bb = new mapboxgl.LngLatBounds(); (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).forEach((p) => p[0].forEach((pt) => bb.extend(pt))); v.map.fitBounds(bb, { padding: 50 }); }
  }
  const select = document.getElementById('commune-select');
  document.getElementById('apply').addEventListener('click', () => focus(select.value));
  select.addEventListener('change', () => focus(select.value));
  KT.onCommuneSearch = (code) => { select.value = code; focus(code); };
  document.querySelectorAll('tr[data-code]').forEach((tr) => tr.addEventListener('click', () => { select.value = tr.dataset.code; focus(tr.dataset.code); window.scrollTo({ top: 200, behavior: 'smooth' }); }));
  document.getElementById('reset').addEventListener('click', () => {
    select.value = ''; focus('');
    document.querySelectorAll('[data-ov]').forEach((c) => { c.checked = false; v.setVisible(`ov-${c.dataset.ov}`, false); });
    setChoro(null);
  });
  v.map.on('click', 'communes-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(KT.communeHtml(p)).addTo(v.map);
    select.value = p.code; focus(p.code);
  });
  v.map.on('mouseenter', 'communes-fill', () => { v.map.getCanvas().style.cursor = 'pointer'; });
  v.map.on('mouseleave', 'communes-fill', () => { v.map.getCanvas().style.cursor = ''; });
})();
