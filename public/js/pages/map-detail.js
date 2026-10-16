/* Quản lý bản đồ – chi tiết: xem trước lớp, nắn chỉnh bằng điểm khống chế, theo dõi xử lý. */
(function () {
  const P = window.PAGE;

  // poll processing status (FR: frontend truy vấn trạng thái xử lý)
  if (P.busy) {
    const tick = async () => {
      const s = await fetch(`/quan-tri/ban-do/${P.id}/trang-thai`, { headers: { Accept: 'application/json' } }).then((r) => r.json()).catch(() => null);
      if (s && s.job && ['queued', 'running'].includes(s.job.status)) setTimeout(tick, 2500); else location.reload();
    };
    setTimeout(tick, 2000);
  }

  // ---------- georeferenced preview ----------
  if (P.overlay && document.getElementById('map')) {
    const lons = P.bounds.map((c) => c[0]); const lats = P.bounds.map((c) => c[1]);
    const v = KT.createMap('map', { basemap: 'satellite', bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], padding: 30 });
    if (v) {
      v.define('province', KT.layers.province());
      v.define('ds', {
        kind: 'overlay', layers: ['ds-img', 'ds-fp'],
        async build(map) {
          if (!map.getSource('ds-img')) map.addSource('ds-img', { type: 'image', url: P.overlay, coordinates: P.bounds });
          if (!map.getLayer('ds-img')) map.addLayer({ id: 'ds-img', type: 'raster', source: 'ds-img', paint: { 'raster-opacity': P.opacity, 'raster-fade-duration': 0 } });
          if (P.footprint && !map.getSource('ds-fp')) map.addSource('ds-fp', { type: 'geojson', data: P.footprint });
          if (P.footprint && !map.getLayer('ds-fp')) map.addLayer({ id: 'ds-fp', type: 'line', source: 'ds-fp', paint: { 'line-color': '#ffd21f', 'line-width': 2, 'line-dasharray': [3, 2] } });
        },
      });
      const op = document.getElementById('op');
      op.addEventListener('input', () => { document.getElementById('op-v').textContent = `${Math.round(op.value * 100)}%`; if (v.map.getLayer('ds-img')) v.map.setPaintProperty('ds-img', 'raster-opacity', Number(op.value)); });
      document.getElementById('show-fp').addEventListener('change', (e) => v.map.getLayer('ds-fp') && v.map.setLayoutProperty('ds-fp', 'visibility', e.target.checked ? 'visible' : 'none'));
    }
  }

  // ---------- GCP tool (PL.6) ----------
  const wrap = document.getElementById('gcp-wrap');
  if (!wrap) return;
  const img = document.getElementById('gcp-img');
  const rows = document.getElementById('gcp-rows');
  let gcps = (P.gcps || []).map((g) => ({ ...g }));
  let sel = gcps.length ? 0 : -1;
  let scale = 1;

  function layout() {
    // fit image width to container; markers positioned in displayed pixels
    scale = wrap.clientWidth / img.naturalWidth;
    img.style.width = `${img.naturalWidth * scale}px`;
    render();
  }
  function render() {
    wrap.querySelectorAll('.gcp-pt').forEach((x) => x.remove());
    gcps.forEach((g, i) => {
      const fx = g.fx ?? g.px / img.naturalWidth; const fy = g.fy ?? g.py / img.naturalHeight;
      const m = document.createElement('span'); m.className = `gcp-pt${i === sel ? ' sel' : ''}`; m.textContent = i + 1;
      m.style.left = `${fx * img.naturalWidth * scale}px`; m.style.top = `${fy * img.naturalHeight * scale}px`;
      wrap.appendChild(m);
    });
    rows.innerHTML = gcps.map((g, i) => `<tr class="${i === sel ? 'sel' : ''}" data-i="${i}"><td>${i + 1}</td><td>${Math.round(g.px)}</td><td>${Math.round(g.py)}</td>
      <td><input class="input" data-k="lon" value="${g.lon ?? ''}" inputmode="decimal" placeholder="107.800"></td><td><input class="input" data-k="lat" value="${g.lat ?? ''}" inputmode="decimal" placeholder="14.500"></td>
      <td class="num">${g.residual_m ?? '—'}</td><td><button type="button" class="btn btn-outline btn-sm" data-del="${i}">${KT.ic('trash-fill')}</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">Chưa có điểm khống chế – nhấp vào ảnh bản đồ để thêm.</td></tr>';
  }
  if (img.complete && img.naturalWidth) layout(); else img.addEventListener('load', layout);
  window.addEventListener('resize', layout);

  wrap.addEventListener('click', (e) => {
    const r = img.getBoundingClientRect();
    const x = (e.clientX - r.left) / scale; const y = (e.clientY - r.top) / scale;
    if (x < 0 || y < 0 || x > img.naturalWidth || y > img.naturalHeight) return;
    gcps.push({ px: x, py: y, fx: x / img.naturalWidth, fy: y / img.naturalHeight, lon: null, lat: null });
    sel = gcps.length - 1; render();
    const inp = rows.querySelector(`tr[data-i="${sel}"] input[data-k="lon"]`); if (inp) inp.focus();
  });
  rows.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { gcps.splice(Number(del.dataset.del), 1); sel = Math.min(sel, gcps.length - 1); render(); return; }
    const tr = e.target.closest('tr[data-i]'); if (tr) { sel = Number(tr.dataset.i); wrap.querySelectorAll('.gcp-pt').forEach((m, i) => m.classList.toggle('sel', i === sel)); rows.querySelectorAll('tr').forEach((x) => x.classList.toggle('sel', x === tr)); }
  });
  rows.addEventListener('input', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) gcps[Number(tr.dataset.i)][e.target.dataset.k] = e.target.value === '' ? null : Number(e.target.value.replace(',', '.')); });

  // pages
  document.querySelectorAll('#pages [data-page]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    if (gcps.length && !confirm('Đổi trang sẽ xoá các điểm khống chế đã đặt. Tiếp tục?')) return;
    document.querySelectorAll('#pages a').forEach((x) => x.classList.toggle('on', x === a));
    gcps = []; sel = -1; img.src = a.dataset.src; document.getElementById('page').value = a.dataset.page;
  }));

  // picking real-world coordinates on a basemap
  const pick = KT.createMap('pick-map', { basemap: 'satellite', padding: 10 });
  if (pick) {
    pick.define('province', KT.layers.province()).define('communes', KT.layers.communes(pick));
    const markers = [];
    const drawMarkers = () => { markers.splice(0).forEach((m) => m.remove()); gcps.forEach((g, i) => { if (Number.isFinite(g.lon) && Number.isFinite(g.lat)) { const el = document.createElement('span'); el.className = 'gcp-pt'; el.style.position = 'static'; el.style.margin = '0'; el.textContent = i + 1; markers.push(new mapboxgl.Marker({ element: el }).setLngLat([g.lon, g.lat]).addTo(pick.map)); } }); };
    pick.map.on('click', (e) => {
      if (sel < 0 || !gcps[sel]) return;
      gcps[sel].lon = Number(e.lngLat.lng.toFixed(6)); gcps[sel].lat = Number(e.lngLat.lat.toFixed(6));
      render(); drawMarkers();
    });
    rows.addEventListener('change', drawMarkers);
    drawMarkers();
  }

  document.getElementById('method').value = P.method;
  const form = document.getElementById('gcp-form');
  form.addEventListener('submit', (e) => {
    const ok = gcps.filter((g) => Number.isFinite(g.lon) && Number.isFinite(g.lat));
    const need = document.getElementById('method').value === 'poly2' ? 6 : 3;
    if (ok.length < need) { e.preventDefault(); alert(`Cần tối thiểu ${need} điểm có đủ kinh độ/vĩ độ (hiện có ${ok.length}).`); return; }
    document.getElementById('gcps-json').value = JSON.stringify(ok.map((g) => ({ px: g.px, py: g.py, fx: g.fx ?? g.px / img.naturalWidth, fy: g.fy ?? g.py / img.naturalHeight, lon: g.lon, lat: g.lat })));
  });
})();
