/* P04 – Cảnh báo cháy rừng */
(function () {
  const P = window.PAGE;
  const daySel = document.getElementById('day');
  const LVS = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };
  let day = 0;
  let v = null;
  const enabledCls = new Set([1, 2, 3, 4, 5]);
  const dayOf = (c, i) => c.days[i] || null;

  // ---------- donut + list (forest area by class for the chosen day) ----------
  const donut = KT.donut('ch-donut', [1, 2, 3, 4, 5].map((k) => KT.LEVEL[k]), [0, 0, 0, 0, 0], [1, 2, 3, 4, 5].map((k) => KT.RISK[k]));
  function renderDonut() {
    const area = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }; const n = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    P.communes.forEach((c) => { const d = dayOf(c, day); if (d) { area[d.cls] += P.forest[c.code] || 0; n[d.cls] += 1; } });
    const total = Object.values(area).reduce((a, b) => a + b, 0);
    donut.data.datasets[0].data = [1, 2, 3, 4, 5].map((k) => area[k]); donut.update();
    document.getElementById('danger-list').innerHTML = [5, 4, 3, 2, 1].map((k) => `<li><span class="dot" style="background:${KT.RISK[k]}"></span><strong>${KT.LEVEL[k].split(' – ')[1]}</strong><span class="v">${n[k]} xã · ${KT.num(area[k])} ha · ${total ? KT.num((area[k] / total) * 100, 1) : 0}%</span></li>`).join('');
    const d0 = P.communes[0] && dayOf(P.communes[0], day);
    const label = d0 ? `${day === 0 ? 'Hôm nay' : 'Dự báo'} ${KT.ymd(d0.date)}` : '';
    document.getElementById('donut-day').textContent = label;
    document.getElementById('day-label').textContent = label;
  }
  renderDonut();

  // ---------- charts ----------
  const nDays = P.communes[0] ? P.communes[0].days.length : 0;
  const idx = [...Array(nDays).keys()];
  if (nDays) {
    const labels = idx.map((i) => KT.ymd(P.communes[0].days[i].date).slice(0, 5));
    // past 7 days: observed hotspots per day; P index from the chain (observed + forecast)
    const today = new Date(Date.now() + 7 * 3600e3);
    const past = [...Array(7).keys()].map((i) => new Date(today.getTime() - (7 - i) * 864e5).toISOString().slice(0, 10));
    const fdays = P.communes[0].days.map((d) => d.date);
    const all = [...past, ...fdays];
    const hsByDay = (d) => P.hotspots.filter((h) => new Date(new Date(h.utc).getTime() + 7 * 3600e3).toISOString().slice(0, 10) === d).length;
    const pAt = (d, f) => { const vals = P.communes.map((c) => { const x = (c.recent || []).concat(c.days).find((y) => y.date === d); return x ? x.p : null; }).filter((x) => x !== null); return vals.length ? f(vals) : null; };
    KT.chart('ch-trend', {
      data: { labels: all.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`), datasets: [
        { type: 'bar', label: 'Số điểm nóng (quan sát)', data: all.map((d) => (past.includes(d) ? hsByDay(d) : null)), backgroundColor: '#ef3b24', yAxisID: 'y2', maxBarThickness: 18 },
        { type: 'line', label: 'P trung bình', data: all.map((d) => pAt(d, (v) => v.reduce((a, b) => a + b, 0) / v.length)), borderColor: '#f58b1f', tension: 0.3, pointRadius: 2, segment: { borderDash: (c) => (c.p0DataIndex >= past.length ? [5, 4] : undefined) } },
        { type: 'line', label: 'P cao nhất', data: all.map((d) => pAt(d, (v) => Math.max(...v))), borderColor: '#b81725', tension: 0.3, pointRadius: 2, segment: { borderDash: (c) => (c.p0DataIndex >= past.length ? [5, 4] : undefined) } },
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Chỉ số P' } }, y2: { position: 'right', beginAtZero: true, suggestedMax: 5, grid: { display: false }, ticks: { precision: 0 }, title: { display: true, text: 'Điểm nóng' } }, x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } } } },
    });
    const top = P.communes.map((c) => ({ c, peak: c.days.reduce((a, d) => (d.p > a.p ? d : a), c.days[0]) })).sort((a, b) => b.peak.p - a.peak.p).slice(0, 10);
    KT.chart('ch-top', { type: 'bar', data: { labels: top.map((t) => t.c.name), datasets: [{ label: 'P cao nhất 7 ngày', data: top.map((t) => t.peak.p), backgroundColor: top.map((t) => KT.RISK[t.peak.cls]), borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
  }
  if (P.history) {
    KT.hotspotChart('ch-month', P.history);
    let histDone = false;
    const drawHist = () => {
      if (histDone) return; histDone = true;
      KT.hotspotChart('ch-hist', P.history, { ticks: 12,
        extra: (ms) => [{ type: 'line', label: 'Diện tích cháy MCD64A1 (ha)', data: ms.map((m) => (P.burnedMonthly ? P.burnedMonthly[m] ?? null : null)), borderColor: '#f58b1f', yAxisID: 'y2', tension: 0.3 }],
        scales: { y2: { position: 'right', beginAtZero: true, grid: { display: false } } } });
      const bc = Object.entries(P.history.byCommune).sort((a, b) => b[1] - a[1]).slice(0, 12);
      KT.chart('ch-hist-commune', { type: 'bar', data: { labels: bc.map(([c]) => P.names[c] || c), datasets: [{ label: 'Điểm nóng 2024–2026', data: bc.map(([, n]) => n), backgroundColor: '#f58b1f', borderRadius: 3 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
    };
    document.querySelector('[data-tabs="fire"]').addEventListener('tabchange', (e) => { if (e.detail === 'lich-su') drawHist(); history.replaceState(null, '', `?tab=${e.detail}`); });
    if (new URLSearchParams(location.search).get('tab') === 'lich-su') drawHist();
  }
  if (P.validation && P.validation.hotspot_rate_by_nesterov_class) {
    const r = P.validation.hotspot_rate_by_nesterov_class;
    let validDone = false;
    const drawValid = () => {
      if (validDone) return; validDone = true;
      KT.chart('ch-valid', { type: 'bar', data: { labels: [1, 2, 3, 4, 5].map((k) => `Cấp ${LVS[k]}`), datasets: [{ label: 'Tỷ lệ ngày có điểm nóng (%)', data: [1, 2, 3, 4, 5].map((k) => (r[k] ? r[k].rate * 100 : 0)), backgroundColor: [1, 2, 3, 4, 5].map((k) => KT.RISK[k]), borderRadius: 3 }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (x) => `${x}%` } } } } });
    };
    document.querySelector('[data-tabs="fire"]').addEventListener('tabchange', (e) => { if (e.detail === 'du-bao') drawValid(); });
    if (new URLSearchParams(location.search).get('tab') === 'du-bao') drawValid();
  }

  // ---------- hotspot pager ----------
  let hsIndex = 0;
  const hsBody = document.getElementById('hs-body');
  function showHotspot(i, fly) {
    if (!P.hotspots.length) return;
    hsIndex = (i + P.hotspots.length) % P.hotspots.length;
    const h = P.hotspots[hsIndex];
    document.getElementById('hs-idx').textContent = `${hsIndex + 1} / ${P.hotspots.length}`;
    const ctx = h.context;
    hsBody.innerHTML = `<div style="display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px">
      <div style="position:relative"><img src="/assets/items/smoke-report-small.webp" alt="Ảnh minh họa" style="width:150px;height:140px;object-fit:cover;border-radius:8px;display:block"><span class="credit" style="top:auto;bottom:6px;right:6px">Ảnh minh họa</span></div>
      <table class="kv compact-kv"><tr><td>Mã điểm nóng</td><td>${KT.esc(h.id.split('-').slice(0, 5).join('-'))}</td></tr><tr><td>Thời gian</td><td>${KT.dt(h.utc)}</td></tr>
      <tr><td>Nguồn vệ tinh</td><td>${KT.esc(h.sensorLabel)}</td></tr><tr><td>Độ tin cậy · FRP</td><td>${KT.esc(h.confidence)} · ${h.frp ?? '—'} MW</td></tr>
      <tr><td>Vị trí</td><td>${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}</td></tr><tr><td>Địa bàn</td><td>${KT.esc(h.commune || 'Ngoài ranh xã')}</td></tr>
      <tr><td>Lớp phủ</td><td>${ctx ? `${KT.esc(ctx.landcover || '—')}${ctx.in_forest ? ' (trong rừng)' : ''}` : '—'} · <b style="color:#c0261f">${KT.esc(h.statusLabel)}</b></td></tr></table></div>
      <div class="hs-actions" style="margin-top:10px"><button class="btn btn-outline btn-sm" data-fly>${KT.ic('geo-alt-fill')} Xem vị trí trên bản đồ</button><a class="btn btn-outline btn-sm" href="/ban-do?lop=s2-latest#${h.lon},${h.lat},13">${KT.ic('image-fill')} Xem ảnh vệ tinh</a><a class="btn btn-outline btn-sm" href="/phan-anh?lat=${h.lat}&lon=${h.lon}#gui">${KT.ic('clock-history')} Báo hiện trường</a></div>`;
    hsBody.querySelector('[data-fly]').onclick = () => v && v.map.flyTo({ center: [h.lon, h.lat], zoom: 12.5 });
    if (fly && v) v.map.flyTo({ center: [h.lon, h.lat], zoom: 12 });
  }
  if (P.hotspots.length) {
    document.getElementById('hs-prev').onclick = () => showHotspot(hsIndex - 1, true);
    document.getElementById('hs-next').onclick = () => showHotspot(hsIndex + 1, true);
    const start = P.selectedHotspot ? Math.max(0, P.hotspots.findIndex((h) => h.id === P.selectedHotspot)) : 0;
    showHotspot(start, false);
  }
  document.querySelectorAll('tr[data-hs]').forEach((tr) => tr.addEventListener('click', () => {
    showHotspot(P.hotspots.findIndex((h) => h.id === tr.dataset.hs), true); window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // ---------- map ----------
  v = KT.createMap('map', { basemap: 'satellite', choropleth: 'danger' });
  daySel.addEventListener('change', () => { day = Number(daySel.value); renderDonut(); paint(); });
  if (!v) return;
  const { map } = v;
  P.overlays.forEach((o) => v.define(`ov-${o.id}`, KT.layers.overlay(o)));
  v.define('communes', KT.layers.communes(v)).define('province', KT.layers.province()).define('weather', KT.layers.weather()).define('hotspots', KT.layers.hotspots());
  function paint() {
    if (!map.getLayer('communes-fill')) return;
    const expr = ['match', ['get', 'code']]; let any = false;
    P.communes.forEach((c) => { const d = dayOf(c, day); if (d) { any = true; expr.push(c.code, enabledCls.has(d.cls) ? KT.RISK[d.cls] : 'rgba(0,0,0,0)'); } });
    expr.push('rgba(0,0,0,0)');
    if (any) map.setPaintProperty('communes-fill', 'fill-color', expr);
    map.setPaintProperty('communes-fill', 'fill-opacity', 0.6);
  }
  v.onBuilt = paint;
  function sensorFilter() {
    const on = [...document.querySelectorAll('[data-sensor]')].filter((c) => c.checked).map((c) => c.dataset.sensor);
    ['hotspots', 'hotspots-glow'].forEach((l) => map.getLayer(l) && map.setFilter(l, ['in', ['get', 'sensor'], ['literal', on]]));
  }
  document.querySelectorAll('[data-sensor]').forEach((c) => c.addEventListener('change', sensorFilter));
  document.querySelectorAll('[data-cls]').forEach((c) => c.addEventListener('change', () => { enabledCls[c.checked ? 'add' : 'delete'](Number(c.dataset.cls)); paint(); }));
  document.querySelectorAll('[data-vec]').forEach((c) => c.addEventListener('change', () => v.setVisible(c.dataset.vec, c.checked)));
  document.querySelectorAll('[data-ov]').forEach((c) => c.addEventListener('change', () => v.setVisible(`ov-${c.dataset.ov}`, c.checked)));
  document.querySelectorAll('input[name=bm]').forEach((r) => r.addEventListener('change', () => v.setBasemap(r.value)));
  document.querySelector('[data-act=home]').addEventListener('click', () => v.fitAOI());

  map.on('click', (e) => {
    const hs = map.queryRenderedFeatures(e.point, { layers: ['hotspots'].filter((l) => map.getLayer(l)) })[0];
    if (hs) { showHotspot(P.hotspots.findIndex((h) => h.id === hs.properties.id), false); new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(KT.hotspotHtml(hs.properties)).addTo(map); return; }
    const cm = map.queryRenderedFeatures(e.point, { layers: ['communes-fill'] })[0];
    if (!cm) return;
    const c = P.communes.find((x) => x.code === cm.properties.code); const d = c && dayOf(c, day);
    if (!d) return;
    new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(`<div class="pop"><h4>${KT.esc(P.names[c.code])}</h4><table>
      <tr><td>Ngày</td><td>${KT.ymd(d.date)}${d.source === 'open_meteo_forecast' ? ' (dự báo)' : ''}</td></tr>
      <tr><td>Cấp dự báo</td><td><span class="lv lv-${d.cls}">${LVS[d.cls]}</span> ${KT.LEVEL[d.cls].split(' – ')[1]}</td></tr>
      <tr><td>Chỉ số P</td><td>${KT.num(d.p)}</td></tr><tr><td>FWI / FFMC</td><td>${d.fwi} / ${d.ffmc}</td></tr>
      <tr><td>Nhiệt độ, độ ẩm 12h</td><td>${d.T}°C, ${d.H}%</td></tr><tr><td>Gió</td><td>${d.W} km/h</td></tr><tr><td>Mưa 24 giờ</td><td>${d.rain} mm</td></tr>
      <tr><td>Rừng trong xã</td><td>${KT.num(P.forest[c.code])} ha</td></tr></table></div>`).addTo(map);
  });
  ['hotspots', 'communes-fill'].forEach((l) => { map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; }); });
  if (P.selectedCommune) map.once('idle', () => {
    const f = map.querySourceFeatures('communes', { filter: ['==', ['get', 'code'], P.selectedCommune] })[0];
    if (f) { const b = new mapboxgl.LngLatBounds(); (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).forEach((p) => p[0].forEach((pt) => b.extend(pt))); map.fitBounds(b, { padding: 60 }); map.setFeatureState({ source: 'communes', id: P.selectedCommune }, { sel: true }); }
    document.querySelectorAll(`tr[data-code="${P.selectedCommune}"]`).forEach((tr) => tr.classList.add('sel'));
  });
  if (P.selectedHotspot || P.selectedCommune) v.skipFit = true;
  if (P.selectedHotspot) { const h = P.hotspots.find((x) => x.id === P.selectedHotspot); if (h) map.once('load', () => map.flyTo({ center: [h.lon, h.lat], zoom: 12 })); }
})();
