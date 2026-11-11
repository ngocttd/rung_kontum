/* So sánh ảnh vệ tinh: hai bản đồ chồng nhau, bản bên phải cắt theo thanh trượt, di chuyển đồng bộ */
(function () {
  const P = window.PAGE;
  const ovById = Object.fromEntries(P.overlays.map((o) => [o.id, o]));
  const shell = document.getElementById('cmp-shell');
  const handle = document.getElementById('cmp-handle');
  const top = document.getElementById('map-right');
  const L = KT.createMap('map-left', { basemap: 'satellite', padding: 20 });
  const Rv = KT.createMap('map-right', { basemap: 'satellite', padding: 20 });
  if (!L || !Rv) return;
  Rv.skipFit = true; // bản phải luôn theo khung nhìn bản trái (không tự căn)
  [L, Rv].forEach((v) => v.define('communes', { ...KT.layers.communes(v) }).define('province', KT.layers.province()));

  // đồng bộ khung nhìn
  let syncing = false;
  const sync = (a, b) => a.map.on('move', () => { if (syncing) return; syncing = true; b.map.jumpTo({ center: a.map.getCenter(), zoom: a.map.getZoom(), bearing: a.map.getBearing(), pitch: a.map.getPitch() }); syncing = false; });
  sync(L, Rv); sync(Rv, L);
  L.map.once('idle', () => Rv.map.jumpTo({ center: L.map.getCenter(), zoom: L.map.getZoom() }));

  // thanh trượt
  let frac = 0.5;
  const place = () => { const w = shell.clientWidth; top.style.clipPath = `inset(0 0 0 ${Math.round(w * frac)}px)`; handle.style.left = `${frac * 100}%`; };
  const drag = (x) => { const r = shell.getBoundingClientRect(); frac = Math.min(0.98, Math.max(0.02, (x - r.left) / r.width)); place(); };
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => { dragging = true; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => { if (dragging) drag(e.clientX); });
  handle.addEventListener('pointerup', () => { dragging = false; });
  handle.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { frac = Math.max(0.02, frac - 0.05); place(); } if (e.key === 'ArrowRight') { frac = Math.min(0.98, frac + 0.05); place(); } });
  window.addEventListener('resize', place); place();

  // nguồn ảnh theo lựa chọn
  function spec(v) {
    if (v.startsWith('m:')) { const [, m, mode] = v.split(':'); return { id: `m-${m}-${mode}`, url: `/anh-ve-tinh/thang/${m}-${mode}.webp`, coordinates: P.bounds }; }
    const o = ovById[v.slice(2)]; return o ? { id: o.id, url: o.url, coordinates: o.coordinates, tiles: o.tiles } : null;
  }
  const label = (sel) => sel.options[sel.selectedIndex].text;
  function show(view, side) {
    const sel = document.getElementById(`cmp-${side}`); const s = spec(sel.value); if (!s) return;
    const map = view.map;
    const apply = () => {
      ['cmp-img'].forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); if (map.getSource(id)) map.removeSource(id); });
      map.addSource('cmp-img', s.tiles ? { type: 'raster', tiles: [s.tiles.url], tileSize: 256, minzoom: s.tiles.minzoom, maxzoom: s.tiles.maxzoom, bounds: s.tiles.bounds } : { type: 'image', url: s.url, coordinates: s.coordinates });
      map.addLayer({ id: 'cmp-img', type: 'raster', source: 'cmp-img', paint: { 'raster-fade-duration': 0 } }, map.getLayer('communes-line') ? 'communes-line' : undefined);
    };
    document.getElementById(`tag-${side}`).textContent = `${label(sel)}${s.url.includes('/thang/') ? ' · đang dựng ảnh…' : ''}`;
    if (s.url.includes('/thang/')) fetch(s.url, { method: 'HEAD' }).finally(() => { document.getElementById(`tag-${side}`).textContent = label(sel); });
    if (map.isStyleLoaded()) apply(); else map.once('idle', apply); // apply() tự gỡ lớp cũ nên gọi lặp không sao
    if (side === 'right') { const a = document.getElementById('cmp-dl'); a.href = s.url; a.setAttribute('download', `${s.id}.webp`); }
  }
  const refresh = () => { show(L, 'left'); show(Rv, 'right'); };
  ['left', 'right'].forEach((side) => document.getElementById(`cmp-${side}`).addEventListener('change', () => show(side === 'left' ? L : Rv, side)));
  document.getElementById('cmp-swap').addEventListener('click', () => { const a = document.getElementById('cmp-left'); const b = document.getElementById('cmp-right'); const t = a.value; a.value = b.value; b.value = t; refresh(); });
  // đổi nền bản đồ làm mất lớp → vẽ lại khi style tải xong
  [L, Rv].forEach((v, i) => v.map.on('style.load', () => setTimeout(() => show(v, i ? 'right' : 'left'), 50)));
  refresh();
})();
