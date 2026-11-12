/* P03 – Tài nguyên rừng */
(function () {
  const P = window.PAGE;
  const ovById = Object.fromEntries(P.overlays.map((o) => [o.id, o]));
  KT.chart('ch-origin', {
    type: 'doughnut',
    data: {
      labels: ['QH đặc dụng', 'QH phòng hộ', 'QH sản xuất'],
      datasets: [
        { data: [P.summary.special_use_ha, P.summary.protection_ha, P.summary.production_ha], backgroundColor: ['#006b38', '#75bb25', '#f8ce42'], borderColor: '#fff', borderWidth: 2 },
        { data: [P.summary.natural_forest_ha, P.summary.plantation_ha], backgroundColor: ['#176c35', '#b567d7'], borderColor: '#fff', borderWidth: 2 },
      ],
    },
    options: { cutout: '42%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.datasetIndex ? ['Rừng tự nhiên', 'Rừng trồng'][c.dataIndex] : ['Quy hoạch đặc dụng', 'Quy hoạch phòng hộ', 'Quy hoạch sản xuất'][c.dataIndex]}: ${KT.num(c.parsed)} ha` } } } },
  });

  // right chart: Hansen loss or NDVI series
  let lossChart = null;
  async function drawLoss(mode) {
    if (lossChart) lossChart.destroy();
    const note = document.getElementById('loss-note');
    if (mode === 'loss' && P.loss) {
      // 10 năm gần nhất của Hansen + các năm sau đó từ phân tích biến động Sentinel-2 của hệ thống (khác phương pháp, chưa xác minh)
      const D = KT.D || {}; const last = Number(D.hansenLast) || Math.max(...Object.keys(P.loss).map(Number));
      const ys = Object.keys(P.loss).map(Number).filter((y) => y > last - 10).sort((a, b) => a - b);
      const sy = Object.keys(D.s2Change || {}).map(Number).filter((y) => y > last).sort((a, b) => a - b);
      const labels = [...ys, ...sy].map(String);
      lossChart = KT.chart('ch-loss', { type: 'bar', data: { labels, datasets: [
        { label: 'Mất tán cây – Hansen GFC (ha)', data: labels.map((y) => P.loss[y] ?? null), backgroundColor: '#6fbf4a', borderRadius: 3, stack: 's' },
        { label: 'Biến động nghi vấn Sentinel-2 (ha, chưa xác minh)', data: labels.map((y) => (D.s2Change || {})[y] ?? null), backgroundColor: '#ff3d7f', borderRadius: 3, stack: 's' },
      ] }, options: { plugins: { legend: { display: sy.length > 0, position: 'bottom', labels: { boxWidth: 10, font: { size: 10.5 } } } }, scales: { x: { grid: { display: false } } } } });
      document.getElementById('loss-title').textContent = `Biến động tán rừng ${labels[0]}–${labels[labels.length - 1]}`;
      note.textContent = `Xanh: Hansen/UMD GFC (đến ${last}) – mất tán cây mọi nguyên nhân, gồm khai thác rừng trồng.${sy.length ? ` Hồng: ${sy.join(', ')} – tổng diện tích vùng biến động nghi vấn từ ảnh Sentinel-2 (phương pháp khác, chưa xác minh hiện trường).` : ''}`;
    } else {
      const rows = await KT.getJSON('/api/public/ndvi');
      lossChart = KT.chart('ch-loss', { type: 'line', data: { labels: rows.map((r) => `${r.month.slice(5)}/${r.month.slice(2, 4)}`), datasets: [{ label: 'NDVI', data: rows.map((r) => r.ndvi), borderColor: '#0f7a52', tension: 0.3, pointRadius: 2 }] },
        options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } } } } });
      const f0 = rows[0]; const f1 = rows[rows.length - 1];
      document.getElementById('loss-title').textContent = 'NDVI trung bình tháng';
      note.textContent = `NDVI trung bình tháng (Sentinel-2, 100 m) ${f0 ? f0.month.slice(5) + '/' + f0.month.slice(0, 4) : ''}–${f1 ? f1.month.slice(5) + '/' + f1.month.slice(0, 4) : ''}; giảm mùa khô là quy luật mùa vụ.`;
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
      { label: 'QH đặc dụng', data: P.plan.map((x) => x.sp), backgroundColor: '#006b38' }, { label: 'QH phòng hộ', data: P.plan.map((x) => x.pr), backgroundColor: '#75bb25' }, { label: 'QH sản xuất', data: P.plan.map((x) => x.pd), backgroundColor: '#f8ce42' }] },
      options: { scales: { x: { stacked: true, ticks: { autoSkip: false, maxRotation: 70, font: { size: 10 } } }, y: { stacked: true } } } });
  }
  function drawCat(key) {
    if (done[key]) return; done[key] = true;
    const c = document.querySelector(`[data-cat-chart="${key}"]`); const rows = P.cats[key];
    KT.chart(c, { type: 'bar', data: { labels: rows.map((r) => r.name), datasets: [{ label: 'ha', data: rows.map((r) => r.v), backgroundColor: c.dataset.color, borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { y: { ticks: { font: { size: 10.5 } } } } } });
  }
  // ---------- Lớp phủ qua các năm (Google Dynamic World, chuẩn hoá) ----------
  const L = P.lcs;
  let lcChart = null;
  const lcKeys = L ? Object.keys(L.classes) : [];
  function drawLandcover(code) {
    if (!L) return;
    const src = (code ? L.by_commune[code] : L.aoi) || {};
    const yr = (k) => src[k] || {};
    if (lcChart) lcChart.destroy();
    lcChart = KT.chart('ch-lc', { type: 'bar', data: { labels: L.series.map((s) => s.year + (s.partial ? '*' : '')), datasets: lcKeys.map((k) => ({ label: L.classes[k].label, data: L.series.map((s) => yr(s.key)[k] || 0), backgroundColor: L.classes[k].color })) },
      options: { scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (x) => KT.num(x) } } }, plugins: { legend: { position: 'bottom' } } } });
    document.querySelector('#lc-table tbody').innerHTML = lcKeys.filter((k) => L.series.some((s) => yr(s.key)[k])).map((k) => `<tr><td><span class="dot" style="background:${L.classes[k].color}"></span> ${KT.esc(L.classes[k].label)}</td>${L.series.map((s) => `<td class="num">${KT.num(yr(s.key)[k] || 0)}</td>`).join('')}</tr>`).join('');
  }
  function drawPair() {
    if (!L) return;
    let a = document.getElementById('lc-a').value; let b = document.getElementById('lc-b').value;
    if (a === b) { document.getElementById('lc-change').innerHTML = '<p class="src">Chọn hai năm khác nhau.</p>'; document.getElementById('lc-matrix').innerHTML = ''; document.querySelector('#lc-communes tbody').innerHTML = ''; return; }
    if (Number(a) > Number(b)) [a, b] = [b, a];
    const pr = L.pairs[`${a}|${b}`]; if (!pr) return;
    const ya = L.series.find((s) => s.key === a); const yb = L.series.find((s) => s.key === b);
    const lab = `${ya.year} → ${yb.year}${yb.partial ? ' (tạm tính)' : ''}`;
    document.getElementById('lc-pair-label').textContent = `(${lab})`;
    const net = pr.gain_ha - pr.loss_ha;
    const stat = (t, val, col) => `<div style="border:1px solid var(--line,#e5e7eb);border-radius:8px;padding:10px 12px"><div style="font-size:12.5px;color:var(--muted,#6b7280)">${t}</div><div style="font-size:20px;font-weight:700;color:${col || 'inherit'}">${val > 0 && t === 'Thay đổi ròng' ? '+' : ''}${KT.num(val)} <small style="font-size:12px;font-weight:400">ha</small></div></div>`;
    document.getElementById('lc-change').innerHTML = `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">${stat('Cây gỗ giữ nguyên', pr.stable_ha)}${stat('Mất cây gỗ', pr.loss_ha, 'var(--red)')}${stat('Tăng cây gỗ', pr.gain_ha, 'var(--forest)')}${stat('Thay đổi ròng', net, net < 0 ? 'var(--red)' : 'var(--forest)')}</div>
      <p class="src" style="margin:8px 0 0">So sánh trên ${KT.num(pr.compared_ha)} ha có dữ liệu cả hai năm. Biến động một năm có thể gồm sai số giải đoán (mây, mùa vụ); nên xem xu hướng nhiều năm.</p>`;
    const used = lcKeys.map((k, i) => i).filter((i) => pr.matrix[i].some((x) => x) || pr.matrix.some((r) => r[i]));
    const SHORT = { 1: 'Nước', 2: 'Cây gỗ', 3: 'Cỏ', 4: 'Ngập nước', 5: 'Nông nghiệp', 6: 'Cây bụi', 7: 'Xây dựng', 8: 'Đất trống' };
    const lbl = (i) => KT.esc(SHORT[lcKeys[i]] || L.classes[lcKeys[i]].label);
    document.getElementById('lc-matrix').innerHTML = `<table class="tbl compact"><thead><tr><th>${ya.year} ↓ / ${yb.year} →</th>${used.map((j) => `<th class="num">${lbl(j)}</th>`).join('')}</tr></thead><tbody>${used.map((i) => `<tr><td><span class="dot" style="background:${L.classes[lcKeys[i]].color}"></span> ${lbl(i)}</td>${used.map((j) => `<td class="num" style="${i === j ? 'font-weight:600;background:var(--bg-soft,#f3f4f6)' : ''}">${pr.matrix[i][j] ? KT.num(pr.matrix[i][j]) : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const rows = Object.entries(pr.by_commune).map(([c, r]) => ({ c, ...r, net: r.gain_ha - r.loss_ha })).sort((x, z) => z.loss_ha - x.loss_ha);
    const tb = document.querySelector('#lc-communes tbody');
    tb.innerHTML = rows.map((r) => `<tr data-code="${r.c}"><td>${KT.esc(P.names[r.c] || r.c)}</td><td class="num">${KT.num(r.a_ha)}</td><td class="num">${KT.num(r.b_ha)}</td><td class="num" style="color:var(--red)">${KT.num(r.loss_ha)}</td><td class="num" style="color:var(--forest)">${KT.num(r.gain_ha)}</td><td class="num" style="color:${r.net < 0 ? 'var(--red)' : 'var(--forest)'}">${r.net > 0 ? '+' : ''}${KT.num(r.net)}</td></tr>`).join('');
  }
  const lcSel = document.getElementById('lc-commune');
  if (lcSel) lcSel.addEventListener('change', () => drawLandcover(lcSel.value));
  ['lc-a', 'lc-b'].forEach((id) => { const e = document.getElementById(id); if (e) e.addEventListener('change', drawPair); });
  const CAT_KEY = { 'dac-dung': ['special_use_planning_ha', 'special'], 'phong-ho': ['protection_planning_ha', 'protection'], 'san-xuat': ['production_planning_ha', 'production'] };
  let v = null;
  const tabs = document.querySelector('[data-tabs="forest"]');
  const onTab = (t) => {
    if (t === 'phan-loai') drawPlan();
    if (t === 'lop-phu' && !done.lc) { done.lc = true; drawLandcover(''); drawPair(); }
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
    const id = ovById['s2-latest'] ? 's2-latest' : Object.keys(ovById).find((k) => /^s2-.*-true$/.test(k));
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
  document.getElementById('apply').addEventListener('click', () => { setYear(yearSel.value); focus(select.value); });
  select.addEventListener('change', () => focus(select.value));
  KT.onCommuneSearch = (code) => { select.value = code; focus(code); };
  document.querySelectorAll('tr[data-code]').forEach((tr) => tr.addEventListener('click', () => { select.value = tr.dataset.code; focus(tr.dataset.code); window.scrollTo({ top: 200, behavior: 'smooth' }); }));
  document.getElementById('reset').addEventListener('click', () => {
    select.value = ''; focus('');
    document.querySelectorAll('[data-ov]').forEach((c) => { c.checked = false; v.setVisible(`ov-${c.dataset.ov}`, false); });
    setChoro(null);
    yearSel.value = 'official'; setYear('official');
  });
  // năm bản đồ: 'official' = số liệu hiện trạng chính thức (năm theo quyết định công bố) tô theo xã; còn lại = bản đồ lớp phủ của dự án
  const yearSel = document.getElementById('map-year');
  const yearNote = document.getElementById('year-note');
  let year = 'official';
  // giá trị ô chọn = mã lớp (lc-2023, m-<id>…); năm lấy từ data-year
  function setYear(val) {
    const opt = [...yearSel.options].find((o) => o.value === String(val || 'official')) || yearSel.options[0];
    // năm số liệu chính thức khác năm đang xem → tải lại trang theo năm đó
    if (opt.value.startsWith('official-')) { const u = new URL(location.href); u.searchParams.set('nam', opt.dataset.statYear); location.href = u; return; }
    year = opt.value === 'official' ? 'official' : String(opt.dataset.year);
    const official = year === 'official';
    [...yearSel.options].forEach((o) => { if (o.value !== 'official') v.setVisible(`ov-${o.value}`, o === opt); });
    document.querySelectorAll('input[name=ftype]').forEach((c) => { c.disabled = !official; if (!official) c.checked = false; c.closest('label').style.opacity = official ? '' : '.45'; });
    if (official) setChoro(document.querySelector('input[name=ftype]:checked') ? document.querySelector('input[name=ftype]:checked').value : null);
    else { v.setChoropleth(null); renderLegend(); }
    yearNote.hidden = official;
    const project = opt.dataset.kind === 'project';
    document.getElementById('map-title').textContent = official ? `Bản đồ hiện trạng tài nguyên rừng năm ${KT.D.forestYear}` : project ? `Bản đồ lớp phủ năm ${year} của dự án (tham khảo)` : `Lớp phủ năm ${year} – Dynamic World`;
    if (!official) yearNote.textContent = project ? `Bản đồ do dự án cung cấp năm ${year} – chỉ để đối chiếu, không dùng cho thống kê.` : `Lớp phủ chuẩn hoá Google Dynamic World năm ${year}${(L && (L.series.find((x) => x.year === Number(year)) || {}).partial) ? ' (tạm tính đến nay)' : ''}; bấm vào xã để xem diện tích các lớp. Lọc theo loại rừng chỉ áp dụng cho số liệu hiện trạng ${KT.D.forestYear}.`;
    renderLegend();
  }
  yearSel.addEventListener('change', () => setYear(yearSel.value));
  document.querySelectorAll('[data-show-year-ov]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.showYearOv; if (!ovById[id]) return;
    [...yearSel.options].forEach((o) => { if (o.value !== 'official') v.setVisible(`ov-${o.value}`, false); });
    v.setChoropleth(null); v.setVisible(`ov-${id}`, true); renderLegend();
    document.getElementById('map-title').textContent = ovById[id].title; window.scrollTo({ top: 200, behavior: 'smooth' });
  }));
  document.querySelectorAll('[data-show-year]').forEach((b) => b.addEventListener('click', () => { yearSel.value = b.dataset.showYear; setYear(b.dataset.showYear); window.scrollTo({ top: 200, behavior: 'smooth' }); }));
  function lcRows(code) {
    const opt = yearSel.selectedOptions[0];
    if (year === 'official' || !L || !opt || opt.dataset.kind !== 'dw' || !L.by_commune[code]) return '';
    const b = L.by_commune[code][String(year)] || {};
    const tot = Object.values(b).reduce((x, z) => x + z, 0);
    return `<div class="pop" style="border-top:1px solid #e5e7eb;margin-top:6px;padding-top:6px"><h4>Lớp phủ năm ${year} (Dynamic World)</h4><table>${lcKeys.filter((k) => b[k]).map((k) => `<tr><td><span class="dot" style="background:${L.classes[k].color}"></span> ${KT.esc(L.classes[k].label)}</td><td>${KT.num(b[k])} ha${tot ? ` (${KT.num(b[k] / tot * 100, 1)}%)` : ''}</td></tr>`).join('')}</table></div>`;
  }

  v.map.on('click', 'communes-fill', (e) => {
    const p = e.features[0].properties;
    new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(KT.communeHtml(p) + lcRows(p.code)).addTo(v.map);
    select.value = p.code; focus(p.code);
  });
  v.map.on('mouseenter', 'communes-fill', () => { v.map.getCanvas().style.cursor = 'pointer'; });
  v.map.on('mouseleave', 'communes-fill', () => { v.map.getCanvas().style.cursor = ''; });
})();
