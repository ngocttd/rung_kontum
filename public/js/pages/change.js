/* Biến động và dự báo mất rừng */
(function () {
  const P = window.PAGE;
  const FEAT = {
    cropland_share_1km: 'Tỷ lệ đất canh tác xung quanh', recent_loss_density_1km: 'Mật độ mất rừng 3 năm gần (1 km)', dist_recent_loss_km: 'Khoảng cách tới vùng mất gần đây',
    elevation_m: 'Độ cao', recent_loss_density_5km: 'Mật độ mất rừng 3 năm gần (5 km)', dist_nonforest_km: 'Khoảng cách tới đất không rừng', forest_fraction: 'Tỷ lệ rừng trong ô',
    dist_builtup_km: 'Khoảng cách tới khu xây dựng', slope_deg: 'Độ dốc', loss_last3y: 'Mất rừng trong ô 3 năm gần', loss_older: 'Mất rừng trong ô trước đó',
  };
  const imp = Object.entries(P.importance);
  KT.chart('ch-imp', { type: 'bar', data: { labels: imp.map(([k]) => FEAT[k] || k), datasets: [{ label: 'Mức đóng góp', data: imp.map(([, v]) => v), backgroundColor: '#0f7a52', borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { y: { ticks: { font: { size: 10.5 } } }, x: { ticks: { callback: (x) => `${Math.round(x * 100)}%` } } } } });

  let histChart = null;
  function drawHist(series) {
    const ys = Object.keys(series);
    if (histChart) histChart.destroy();
    histChart = KT.chart('ch-hist', { type: 'bar', data: { labels: ys, datasets: [{ label: 'Mất tán cây (ha)', data: ys.map((y) => series[y]), backgroundColor: '#e11d48', borderRadius: 2 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } } });
  }
  drawHist(P.history);
  document.getElementById('hist-commune').addEventListener('change', async (e) => {
    if (!e.target.value) return drawHist(P.history);
    const list = await KT.fetchCached('/api/public/forest/communes');
    const c = list.find((x) => x.code === e.target.value);
    return drawHist(c && c.loss ? c.loss.annual : {});
  });

  // sortable
  document.querySelectorAll('[data-sortable] thead th').forEach((th, i) => th.addEventListener('click', () => {
    const tb = th.closest('table').tBodies[0]; const asc = th.dataset.asc !== '1'; th.dataset.asc = asc ? '1' : '0';
    const val = (tr) => { const t = tr.children[i].textContent.trim(); const n = Number(t.replace(/\./g, '').replace(',', '.').replace('%', '')); return Number.isNaN(n) ? t : n; };
    [...tb.rows].sort((a, b) => { const x = val(a); const y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1); }).forEach((r) => tb.appendChild(r));
  }));

  // candidate list
  const listEl = document.getElementById('cand-list');
  const fWin = document.getElementById('f-window'); const fSt = document.getElementById('f-status');
  function filtered() { return P.candidates.filter((c) => (!fWin.value || c.window === fWin.value) && (!fSt.value || c.status === fSt.value)); }
  function renderList() {
    const rows = filtered();
    document.getElementById('cand-count').textContent = `${rows.length} vùng`;
    listEl.innerHTML = rows.map((c) => `<div class="alert-item" data-id="${c.id}" style="cursor:pointer">
      <img class="ai-ic" src="/assets/symbols/change-suspected.svg" alt="">
      <div class="ai-b"><span class="ai-t">${KT.esc(c.commune_name || 'Ngoài ranh xã')} · ${KT.num(c.area_ha)} ha</span>
      <span class="ai-d">ΔNDVI ${c.mean_dndvi} · ${KT.esc(c.window.split(' ')[0])}</span>
      <div class="meta"><span class="badge ${P.statusBadge[c.status]}">${KT.esc(c.statusLabel)}</span>${c.seasonal_leaf_fall_possible ? '<span class="badge b-yellow">mùa khô</span>' : ''}</div></div></div>`).join('')
      || '<div class="empty-state">Không có vùng phù hợp bộ lọc.</div>';
  }
  fWin.addEventListener('change', renderList); fSt.addEventListener('change', renderList);
  listEl.dataset.pageSize = '12';
  renderList();
  KT.paginate(listEl);

  function showDetail(c) {
    document.querySelectorAll('#cand-list .alert-item').forEach((x) => { x.style.background = x.dataset.id === c.id ? 'var(--forest-3)' : ''; if (x.dataset.id === c.id && listEl.showItem) { listEl.showItem(x); x.scrollIntoView({ block: 'nearest' }); } });
    document.getElementById('detail-body').innerHTML = `<h3 style="font-size:15px;margin-bottom:8px">${KT.esc(c.id)}</h3>
      <table class="kv"><tr><td>Địa bàn</td><td>${KT.esc(c.commune_name || '—')}</td></tr><tr><td>Diện tích nghi vấn</td><td>${KT.num(c.area_ha)} ha</td></tr>
      <tr><td>Vị trí tâm</td><td>${c.lat}, ${c.lon}</td></tr><tr><td>Kỳ so sánh</td><td>${KT.esc(c.window)}</td></tr>
      <tr><td>Thay đổi NDVI</td><td>${c.mean_dndvi}</td></tr><tr><td>Thay đổi NBR</td><td>${c.mean_dnbr}</td></tr>
      <tr><td>Trạng thái</td><td><span class="badge ${P.statusBadge[c.status]}">${KT.esc(c.statusLabel)}</span></td></tr></table>
      <p class="src">${KT.esc(c.evidence)}</p>
      ${c.seasonal_leaf_fall_possible ? '<div class="note">Kỳ mùa khô: cần loại trừ rụng lá theo mùa (rừng khộp) trước khi kết luận.</div>' : ''}
      <div style="display:flex;gap:8px;margin-top:10px"><a class="btn btn-outline btn-sm" href="/ban-do#${c.lon},${c.lat},13">Mở trên bản đồ WebGIS</a><a class="btn btn-outline btn-sm" href="/phan-anh?lat=${c.lat}&lon=${c.lon}#gui">Gửi thông tin hiện trường</a></div>`;
  }

  // map
  const v = KT.createMap('map', { basemap: 'satellite' });
  if (!v) return;
  const { map } = v;
  const legend = document.getElementById('legend');
  P.overlays.forEach((o) => v.define(`ov-${o.id}`, { ...KT.layers.overlay(o), visible: o.id === 'forest-loss-risk' }));
  v.define('communes', KT.layers.communes(v)).define('province', KT.layers.province()).define('candidates', { ...KT.layers.candidates(), visible: true });
  const MODES = { risk: ['forest-loss-risk'], loss: ['hansen-loss'], cand: [], img: ['s2-2025-wet-true'], lc: ['lc-forest-change-1991-2023'] };
  function setMode(m) {
    document.querySelectorAll('#mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    P.overlays.forEach((o) => v.setVisible(`ov-${o.id}`, MODES[m].includes(o.id)));
    const ovs = P.overlays.filter((o) => MODES[m].includes(o.id));
    legend.innerHTML = ovs.map((o) => KT.overlayLegendHtml(o)).join('') + '<div style="margin-top:8px"><h4>Biến động nghi vấn 2026</h4><div class="row"><span class="sw" style="background:#ff3d7f"></span>Chưa xác minh</div><div class="row"><span class="sw" style="background:#b81725"></span>Xác nhận mất rừng</div></div>';
  }
  setMode('risk');
  document.getElementById('mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  document.querySelector('[data-act=home]').addEventListener('click', () => v.fitAOI());

  function fly(c) { map.flyTo({ center: [c.lon, c.lat], zoom: 13.2 }); showDetail(c); }
  listEl.addEventListener('click', (e) => { const it = e.target.closest('[data-id]'); if (it) fly(P.candidates.find((c) => c.id === it.dataset.id)); });
  map.on('click', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['cand-fill', 'cand-pt'].filter((l) => map.getLayer(l)) })[0];
    if (f) { const c = P.candidates.find((x) => x.id === f.properties.id); if (c) showDetail(c); return; }
    const cm = map.queryRenderedFeatures(e.point, { layers: ['communes-fill'] })[0];
    if (cm) new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(KT.communeHtml(cm.properties)).addTo(map);
  });
  ['cand-fill', 'cand-pt'].forEach((l) => { map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; }); });
  if (P.selected) v.skipFit = true;
  if (P.selected) { const c = P.candidates.find((x) => x.id === P.selected); if (c) map.once('load', () => fly(c)); }
})();
