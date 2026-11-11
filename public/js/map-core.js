/* Shared Mapbox GL map: basemaps, data layers that survive style switches, popups, measuring, export. */
(function () {
  const KT = (window.KT = window.KT || {});
  const D = window.KT_D || {}; // năm/nguồn dữ liệu hiện hành (server: src/lib/dataContext.js)
  KT.D = D;
  const BASEMAPS = {
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
    streets: 'mapbox://styles/mapbox/streets-v12',
    terrain: 'mapbox://styles/mapbox/outdoors-v12',
    light: 'mapbox://styles/mapbox/light-v11',
  };
  const BOUNDS = [[107.33, 13.91], [108.56, 15.43]];
  const MARKERS = ['hotspot-unverified', 'fire-investigating', 'fire-confirmed', 'fire-rejected', 'fire-resolved', 'forest-violation', 'land-encroachment',
    'timber-transport', 'wildlife', 'report-other', 'report-photo', 'gps', 'survey'];
  const cache = {};
  KT.fetchCached = (url) => (cache[url] = cache[url] || KT.getJSON(url));
  KT.fetchFresh = async (url) => {
    const r = await fetch(url, { cache: 'no-cache', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const j = await r.json(); cache[url] = Promise.resolve(j); return j;
  };

  // Đồng bộ trực tiếp: máy chủ phát "changed" (Socket.IO /mobile, chung với MobileGIS) khi trạng thái xác minh,
  // điểm cháy nhập tay hay điểm nóng FIRMS mới thay đổi → bản đồ làm mới. Dự phòng: kiểm tra lại 2 phút/lần và khi quay lại tab.
  const liveSubs = [];
  let liveSock = null;
  KT.onLive = (collections, fn) => {
    liveSubs.push({ collections: new Set(collections), fn });
    if (!liveSock && window.io) {
      try {
        liveSock = window.io('/mobile', { path: '/socket.io', transports: ['websocket', 'polling'] });
        liveSock.on('changed', (c) => liveSubs.forEach((s) => { if (s.collections.has(c.collection)) s.fn(c); }));
        liveSock.on('connect', () => { if (liveSock.wasConnected) liveSubs.forEach((s) => s.fn({ collection: 'reconnect' })); liveSock.wasConnected = true; });
      } catch (e) { /* không có socket → chỉ dùng kiểm tra định kỳ */ }
    }
  };
  const fallbackSubs = [];
  KT.onRefresh = (fn) => {
    fallbackSubs.push(fn);
    if (fallbackSubs.length === 1) {
      setInterval(() => { if (!document.hidden) fallbackSubs.forEach((f) => f()); }, 120e3);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) fallbackSubs.forEach((f) => f()); });
    }
  };

  const HOTSPOT_ICON = ['match', ['get', 'status'], 'confirmed', 'fire-confirmed', 'handling', 'fire-confirmed', 'verifying', 'fire-investigating', 'assigned', 'fire-investigating',
    'rejected', 'fire-rejected', 'closed', 'fire-resolved', 'hotspot-unverified'];

  const CHORO = {
    cover: { prop: 'cover', title: `Tỷ lệ che phủ rừng công bố ${D.forestYear || ''} (%)`, stops: [[0, '#f7fcb9'], [20, '#d9f0a3'], [40, '#addd8e'], [60, '#41ab5d'], [80, '#006837']], unit: '%' },
    forest: { prop: 'forest_ha', title: `Diện tích có rừng ${D.forestYear || ''} (ha)`, stops: [[0, '#f7fcb9'], [5000, '#c2e699'], [10000, '#78c679'], [20000, '#31a354'], [35000, '#006837']], unit: ' ha' },
    danger: { prop: 'danger_cls', title: 'Cấp nguy cơ cháy hôm nay (chỉ số P)', classes: true },
    danger7: { prop: 'danger_max7', title: 'Cấp nguy cơ cháy cao nhất 7 ngày tới', classes: true },
    risk: { prop: 'risk_mean', title: `Xác suất mất rừng TB ${D.forecastLabel}`, stops: [[0, '#fff5eb'], [0.01, '#fdd0a2'], [0.03, '#fd8d3c'], [0.06, '#d94801'], [0.1, '#7f2704']], unit: '', pct: true },
    special: { prop: 'special_ha', title: 'Quy hoạch rừng đặc dụng (ha)', stops: [[0, '#f2f7ee'], [1, '#c7e6b7'], [3000, '#5fae5f'], [9000, '#1d7a3a'], [18000, '#004d26']], unit: ' ha' },
    protection: { prop: 'protection_ha', title: 'Quy hoạch rừng phòng hộ (ha)', stops: [[0, '#f7fbea'], [1, '#e1f2b0'], [3000, '#a8d655'], [9000, '#6aa51f'], [27000, '#3b6b06']], unit: ' ha' },
    production: { prop: 'production_ha', title: 'Quy hoạch rừng sản xuất (ha)', stops: [[0, '#fffbe8'], [1, '#fdeca6'], [5000, '#f8ce42'], [12000, '#d99a0b'], [25000, '#8a5a00']], unit: ' ha' },
    natural: { prop: 'natural_forest_ha', title: `Rừng tự nhiên ${D.forestYear || ''} (ha)`, stops: [[0, '#f1f8ef'], [3000, '#a9d8a0'], [10000, '#4ea85a'], [20000, '#176c35'], [40000, '#0a3d1d']], unit: ' ha' },
    plantation: { prop: 'plantation_ha', title: `Rừng trồng đã thành rừng ${D.forestYear || ''} (ha)`, stops: [[0, '#f8f0fb'], [300, '#e3c4f0'], [1500, '#c48ee0'], [3500, '#a254cc'], [6000, '#6a2591']], unit: ' ha' },
    loss: { prop: 'loss_5y', title: 'Mất tán cây 2020–2024 (ha)', stops: [[0, '#fff7f3'], [100, '#fcc5c0'], [400, '#f768a1'], [900, '#ae017e'], [1800, '#49006a']], unit: ' ha' },
  };
  KT.CHORO = CHORO;

  function choroColor(mode) {
    const c = CHORO[mode];
    if (c.classes) return ['match', ['coalesce', ['get', c.prop], 0], 1, KT.RISK[1], 2, KT.RISK[2], 3, KT.RISK[3], 4, KT.RISK[4], 5, KT.RISK[5], '#cccccc'];
    const expr = ['interpolate', ['linear'], ['coalesce', ['get', c.prop], 0]];
    c.stops.forEach(([v, col]) => expr.push(v, col));
    return expr;
  }

  KT.createMap = function createMap(container, opts = {}) {
    const el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!window.mapboxgl || !window.MAPBOX_TOKEN) {
      el.innerHTML = '<div class="map-fallback">Bản đồ cần Mapbox GL và token công khai (MAPBOX_TOKEN). Vui lòng kiểm tra cấu hình hoặc kết nối mạng.</div>';
      return null;
    }
    if (!mapboxgl.supported || (mapboxgl.supported && !mapboxgl.supported())) {
      el.innerHTML = '<div class="map-fallback">Trình duyệt không hỗ trợ WebGL nên không hiển thị được bản đồ.</div>';
      return null;
    }
    mapboxgl.accessToken = window.MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: el, style: BASEMAPS[opts.basemap || 'satellite'], bounds: opts.bounds || BOUNDS, fitBoundsOptions: { padding: opts.padding ?? 20 },
      attributionControl: true, preserveDrawingBuffer: Boolean(opts.exportable), interactive: opts.interactive !== false, locale: {}, language: 'vi',
      projection: 'mercator', cooperativeGestures: Boolean(opts.cooperative),
    });
    if (opts.interactive !== false) map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    const view = { map, defs: {}, order: [], basemap: opts.basemap || 'satellite', choropleth: opts.choropleth || null, terrain: false };
    KT.activeMap = map;

    function applyState(id) {
      const d = view.defs[id];
      (d.layers || []).forEach((lid) => {
        if (!map.getLayer(lid)) return;
        map.setLayoutProperty(lid, 'visibility', d.visible ? 'visible' : 'none');
        if (d.opacity !== undefined) {
          const type = map.getLayer(lid).type;
          const prop = { raster: 'raster-opacity', fill: 'fill-opacity', line: 'line-opacity', circle: 'circle-opacity', symbol: 'icon-opacity' }[type];
          if (prop) map.setPaintProperty(lid, prop, d.opacity * (d.baseOpacity && d.baseOpacity[lid] !== undefined ? d.baseOpacity[lid] : 1));
        }
      });
    }

    function loadMarkers() {
      return Promise.all(MARKERS.map((name) => new Promise((resolve) => {
        if (map.hasImage(name)) return resolve();
        map.loadImage(`/assets/markers/${name}.png`, (err, img) => { if (!err && !map.hasImage(name)) map.addImage(name, img, { pixelRatio: 3.4 }); resolve(); });
      })));
    }

    async function buildAll() {
      await loadMarkers();
      if (!map.hasImage('wind-arrow')) await new Promise((res) => map.loadImage('/assets/symbols/wind-direction.png', (e, img) => { if (!e && !map.hasImage('wind-arrow')) map.addImage('wind-arrow', img, { pixelRatio: 4 }); res(); }));
      for (const id of view.order) {
        const d = view.defs[id];
        try { await d.build(map, d); applyState(id); } catch (e) { console.warn('layer', id, e); }
      }
      if (view.terrain) setTerrain(true);
      if (map.getLayer('communes-line')) Object.values(view.defs).forEach((d) => { if (d.kind === 'overlay' && d.visible) d.layers.forEach((l) => map.getLayer(l) && map.moveLayer(l, 'communes-line')); });
      if (view.onBuilt) view.onBuilt();
    }

    map.on('style.load', () => { view.ready = true; buildAll(); });
    // Containers may change size while fonts/layout settle: refit once loaded unless a page set its own view.
    map.once('load', () => { map.resize(); if (!view.skipFit && !opts.bounds) map.fitBounds(BOUNDS, { padding: opts.padding ?? 20, duration: 0 }); });
    // Keep the whole AOI in view when the container is resized by layout, until the user moves the map.
    ['dragstart', 'wheel', 'touchstart'].forEach((ev) => map.on(ev, () => { view.userMoved = true; }));
    if (window.ResizeObserver) {
      let t = null;
      new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { map.resize(); if (!view.userMoved && !view.skipFit && !opts.bounds) map.fitBounds(BOUNDS, { padding: opts.padding ?? 20, duration: 0 }); }, 120); }).observe(el);
    }

    view.define = (id, def) => { view.defs[id] = { visible: true, ...def }; view.order.push(id); if (view.ready) def.build(map, view.defs[id]).then(() => applyState(id)); return view; };
    view.setVisible = (id, v) => {
      const d = view.defs[id]; if (!d) return;
      d.visible = v;
      if (v && view.ready && d.kind === 'overlay' && !map.getLayer(d.layers[0])) {
        d.build(map, d).then(() => { applyState(id); if (map.getLayer('communes-line')) d.layers.forEach((l) => map.getLayer(l) && map.moveLayer(l, 'communes-line')); }).catch((e) => console.warn('layer', id, e));
        return;
      }
      applyState(id);
      // an image overlay switched on is drawn above the commune choropleth, below boundary lines
      if (v && d.kind === 'overlay' && map.getLayer('communes-line')) d.layers.forEach((l) => map.getLayer(l) && map.moveLayer(l, 'communes-line'));
    };
    view.setOpacity = (id, v) => { if (!view.defs[id]) return; view.defs[id].opacity = v; applyState(id); };
    view.setBasemap = (name) => { if (!BASEMAPS[name] || name === view.basemap) return; view.basemap = name; map.setStyle(BASEMAPS[name]); };
    function setTerrain(on) {
      if (on) {
        if (!map.getSource('mapbox-dem')) map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
        if (!map.getLayer('sky')) map.addLayer({ id: 'sky', type: 'sky', paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun-intensity': 12 } });
      } else { map.setTerrain(null); }
    }
    view.toggle3D = () => { view.terrain = !view.terrain; setTerrain(view.terrain); map.easeTo({ pitch: view.terrain ? 60 : 0, bearing: view.terrain ? -15 : 0, duration: 900 }); return view.terrain; };
    view.setChoropleth = (mode) => {
      view.choropleth = mode;
      if (map.getLayer('communes-fill')) {
        map.setPaintProperty('communes-fill', 'fill-color', mode ? choroColor(mode) : '#ffffff');
        map.setPaintProperty('communes-fill', 'fill-opacity', mode ? 0.62 : 0.01);
      }
      if (view.onChoropleth) view.onChoropleth(mode);
    };
    view.fitAOI = () => map.fitBounds(BOUNDS, { padding: 20 });
    return view;
  };

  // ---------- standard layer definitions ----------
  KT.layers = {
    overlay(o) {
      return {
        kind: 'overlay', opacity: o.opacity ?? 1, visible: false, layers: [`ov-${o.id}`], meta: o,
        async build(map, d) {
          // chỉ nạp ảnh khi lớp được bật (trang có hàng chục lớp ảnh: nạp cùng lúc vừa chậm vừa dễ lỗi đứt tải)
          if (d && !d.visible) return;
          // tiled classified layers keep full resolution (15 m) when zoomed in; others are one image
          const t = o.tiles;
          if (!map.getSource(`ov-${o.id}`)) map.addSource(`ov-${o.id}`, t ? { type: 'raster', tiles: [t.url], tileSize: 256, minzoom: t.minzoom, maxzoom: t.maxzoom, bounds: t.bounds } : { type: 'image', url: o.url, coordinates: o.coordinates });
          const crisp = t || /worldcover|risk|lc-|hansen/.test(o.id);
          if (!map.getLayer(`ov-${o.id}`)) map.addLayer({ id: `ov-${o.id}`, type: 'raster', source: `ov-${o.id}`, paint: { 'raster-fade-duration': 0, 'raster-resampling': crisp ? 'nearest' : 'linear' } }, firstSymbolId(map));
        },
      };
    },
    province() {
      return {
        kind: 'vector', layers: ['province-halo', 'province-line'],
        async build(map) {
          const data = await KT.fetchCached('/api/public/boundaries/province');
          if (!map.getSource('province')) map.addSource('province', { type: 'geojson', data });
          if (!map.getLayer('province-halo')) map.addLayer({ id: 'province-halo', type: 'line', source: 'province', paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.55 } });
          if (!map.getLayer('province-line')) map.addLayer({ id: 'province-line', type: 'line', source: 'province', paint: { 'line-color': '#9b4dff', 'line-width': 2.6 } });
        },
      };
    },
    communes(view) {
      return {
        kind: 'vector', layers: ['communes-fill', 'communes-line', 'communes-hl', 'communes-label'], baseOpacity: { 'communes-fill': 0.62 },
        async build(map) {
          const data = await KT.fetchCached('/api/public/boundaries/communes');
          if (!map.getSource('communes')) map.addSource('communes', { type: 'geojson', data, promoteId: 'code' });
          const mode = view.choropleth;
          if (!map.getLayer('communes-fill')) map.addLayer({ id: 'communes-fill', type: 'fill', source: 'communes', paint: { 'fill-color': mode ? choroColor(mode) : '#ffffff', 'fill-opacity': mode ? 0.62 : 0.01 } }, firstSymbolId(map));
          if (!map.getLayer('communes-line')) map.addLayer({ id: 'communes-line', type: 'line', source: 'communes', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1.6], 'line-opacity': 0.85, 'line-dasharray': [2, 1] } });
          if (!map.getLayer('communes-hl')) map.addLayer({ id: 'communes-hl', type: 'line', source: 'communes', paint: { 'line-color': '#ffd21f', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3.2, 0] } });
          if (!map.getLayer('communes-label')) map.addLayer({ id: 'communes-label', type: 'symbol', source: 'communes', minzoom: 8.6, layout: { 'text-field': ['get', 'name'], 'text-size': 11.5, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.65)', 'text-halo-width': 1.3 } });
        },
      };
    },
    hotspots() {
      return {
        kind: 'vector', layers: ['hotspots-glow', 'hotspots'], opacity: 1,
        async build(map) {
          const data = await KT.fetchCached('/api/public/fire/hotspots');
          if (!map.getSource('hotspots')) map.addSource('hotspots', { type: 'geojson', data });
          if (!map.getLayer('hotspots-glow')) map.addLayer({ id: 'hotspots-glow', type: 'circle', source: 'hotspots', paint: { 'circle-radius': 16, 'circle-color': '#ff5a1f', 'circle-opacity': 0.25, 'circle-blur': 0.6 } });
          if (!map.hotspotsLive) {
            map.hotspotsLive = true;
            let busy = false;
            const reload = async () => {
              if (busy) return; busy = true;
              try {
                const fresh = await KT.fetchFresh('/api/public/fire/hotspots');
                const src = map.getSource('hotspots');
                if (src) src.setData(fresh);
                document.dispatchEvent(new CustomEvent('kt:hotspots', { detail: fresh }));
              } catch (e) { /* giữ dữ liệu cũ */ } finally { busy = false; }
            };
            KT.onLive(['alerts', 'reconnect'], reload);
            KT.onRefresh(reload);
          }
          if (!map.getLayer('hotspots')) map.addLayer({ id: 'hotspots', type: 'symbol', source: 'hotspots', layout: { 'icon-image': HOTSPOT_ICON, 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-size': 1 } });
        },
      };
    },
    candidates() {
      return {
        kind: 'vector', layers: ['cand-fill', 'cand-line', 'cand-pt'], visible: false,
        async build(map) {
          const data = await KT.fetchCached('/api/public/forest/candidates');
          if (!map.getSource('candidates')) map.addSource('candidates', { type: 'geojson', data });
          const color = ['match', ['get', 'status'], 'confirmed', '#b81725', 'rejected', '#7b8791', 'seasonal', '#bd9851', 'verifying', '#eaa12a', '#ff3d7f'];
          if (!map.getLayer('cand-fill')) map.addLayer({ id: 'cand-fill', type: 'fill', source: 'candidates', paint: { 'fill-color': color, 'fill-opacity': 0.45 } });
          if (!map.getLayer('cand-line')) map.addLayer({ id: 'cand-line', type: 'line', source: 'candidates', paint: { 'line-color': color, 'line-width': 1.6 } });
          if (!map.getLayer('cand-pt')) map.addLayer({ id: 'cand-pt', type: 'circle', source: 'candidates', maxzoom: 10.5, filter: ['>=', ['get', 'area_ha'], 5], paint: { 'circle-radius': ['interpolate', ['linear'], ['get', 'area_ha'], 5, 3, 60, 9], 'circle-color': color, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
        },
      };
    },
    weather() {
      return {
        kind: 'vector', layers: ['wx-arrow', 'wx-temp'], visible: false,
        async build(map) {
          const data = await KT.fetchCached('/api/public/weather');
          if (!map.getSource('weather')) map.addSource('weather', { type: 'geojson', data });
          if (!map.getLayer('wx-arrow')) map.addLayer({ id: 'wx-arrow', type: 'symbol', source: 'weather', layout: { 'icon-image': 'wind-arrow', 'icon-rotate': ['+', ['coalesce', ['get', 'wind_deg'], 0], 180], 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map', 'icon-offset': [0, -22] } });
          if (!map.getLayer('wx-temp')) map.addLayer({ id: 'wx-temp', type: 'symbol', source: 'weather', layout: { 'text-field': ['concat', ['to-string', ['round', ['get', 'temp']]], '°'], 'text-size': 12, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#0d5fae', 'text-halo-width': 2.2 } });
        },
      };
    },
    // mũi tên gió theo xã (Open-Meteo hôm nay) hoặc lưới ERA5-Land; nhãn tốc độ m/s
    wind(source) {
      const id = `wind-${source}`;
      return {
        kind: 'vector', layers: [`${id}-arrow`, `${id}-label`], visible: false,
        async build(map) {
          const data = await KT.fetchCached(`/api/public/weather/wind?nguon=${source}`).catch(() => ({ type: 'FeatureCollection', features: [] }));
          if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
          if (!map.getLayer(`${id}-arrow`)) map.addLayer({ id: `${id}-arrow`, type: 'symbol', source: id, layout: { 'icon-image': 'wind-arrow', 'icon-size': ['interpolate', ['linear'], ['get', 'speed_ms'], 0, 0.7, 8, 1.3], 'icon-rotate': ['+', ['get', 'dir_from'], 180], 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map' } });
          if (!map.getLayer(`${id}-label`)) map.addLayer({ id: `${id}-label`, type: 'symbol', source: id, minzoom: 8.5, layout: { 'text-field': ['concat', ['to-string', ['get', 'speed_ms']], ' m/s'], 'text-size': 10.5, 'text-offset': [0, 1.6], 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-allow-overlap': false }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#174a7c', 'text-halo-width': 1.6 } });
        },
      };
    },
    samples() {
      return {
        kind: 'vector', layers: ['samples'], visible: false,
        async build(map) {
          const data = await KT.fetchCached('/api/public/field-samples');
          if (!map.getSource('samples')) map.addSource('samples', { type: 'geojson', data });
          if (!map.getLayer('samples')) map.addLayer({ id: 'samples', type: 'circle', source: 'samples', paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 13, 7],
            'circle-color': ['case', ['get', 'is_forest'], '#1b9e4b', ['==', ['get', 'lpr_code'], 'Mat nuoc'], '#1677d2', ['==', ['get', 'lpr_code'], 'Dat trong'], '#d8a23a', '#9a6bd1'],
            'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } });
        },
      };
    },
    reports() {
      return {
        kind: 'vector', layers: ['reports'], visible: true,
        async build(map) {
          const res = await KT.fetchCached('/api/public/reports');
          const data = { type: 'FeatureCollection', features: res.items.filter((r) => r.lat !== null).map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { ...r, photos: undefined, timeline: undefined } })) };
          if (!map.getSource('reports')) map.addSource('reports', { type: 'geojson', data });
          if (!map.getLayer('reports')) map.addLayer({ id: 'reports', type: 'symbol', source: 'reports', layout: { 'icon-image': ['get', 'marker'], 'icon-anchor': 'bottom', 'icon-allow-overlap': true } });
        },
      };
    },
    custom(l) {
      return {
        kind: 'vector', layers: [`cl-${l.id}-f`, `cl-${l.id}-l`, `cl-${l.id}-p`], visible: false,
        async build(map) {
          const data = await KT.fetchCached(l.url);
          const color = (l.style && l.style.color) || '#00bcd4';
          if (!map.getSource(`cl-${l.id}`)) map.addSource(`cl-${l.id}`, { type: 'geojson', data });
          if (!map.getLayer(`cl-${l.id}-f`)) map.addLayer({ id: `cl-${l.id}-f`, type: 'fill', source: `cl-${l.id}`, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color, 'fill-opacity': 0.3 } });
          if (!map.getLayer(`cl-${l.id}-l`)) map.addLayer({ id: `cl-${l.id}-l`, type: 'line', source: `cl-${l.id}`, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': color, 'line-width': 1.8 } });
          if (!map.getLayer(`cl-${l.id}-p`)) map.addLayer({ id: `cl-${l.id}-p`, type: 'circle', source: `cl-${l.id}`, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': color, 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
        },
      };
    },
  };

  function firstSymbolId(map) {
    const layers = map.getStyle().layers || [];
    const l = layers.find((x) => x.type === 'symbol' && x.id !== 'communes-label');
    return l ? l.id : undefined;
  }

  // ---------- popups ----------
  KT.HOTSPOT_LEGEND = [['hotspot-unverified', 'Điểm nóng chưa xác minh'], ['fire-investigating', 'Đang xác minh'], ['fire-confirmed', 'Xác nhận cháy / đang xử lý'], ['fire-rejected', 'Không phải cháy rừng'], ['fire-resolved', 'Đã kết thúc']];
  KT.hotspotLegendHtml = () => `<h4>Điểm nóng / điểm cháy</h4>${KT.HOTSPOT_LEGEND.map(([k, l]) => `<div class="row"><img src="/assets/markers/${k}.png" width="16" alt=""> ${l}</div>`).join('')}`;
  KT.hotspotHtml = (p) => {
    const ctx = typeof p.context === 'string' ? JSON.parse(p.context) : p.context;
    const man = typeof p.manual === 'string' ? JSON.parse(p.manual) : p.manual;
    return `<div class="pop"><h4>${KT.ic('fire')} ${man ? `Điểm cháy báo tin ${KT.esc(man.code)}` : 'Điểm nóng vệ tinh'}</h4><table>
    <tr><td>Thời gian</td><td>${KT.dt(p.utc)} (giờ VN)</td></tr><tr><td>${man ? 'Nguồn' : 'Cảm biến'}</td><td>${KT.esc(p.sensorLabel)}</td></tr>
    ${man ? `<tr><td>Diện tích ước tính</td><td>${man.area_ha !== null && man.area_ha !== undefined ? `${KT.num(man.area_ha, 1)} ha` : '—'}</td></tr>` : `<tr><td>Độ tin cậy</td><td>${KT.esc(p.confidence)}</td></tr><tr><td>FRP</td><td>${p.frp ?? '—'} MW</td></tr>`}
    <tr><td>Vị trí</td><td>${Number(p.lat).toFixed(4)}, ${Number(p.lon).toFixed(4)}</td></tr><tr><td>Địa bàn</td><td>${KT.esc(p.commune || 'Ngoài ranh xã')}</td></tr>
    ${ctx ? `<tr><td>Lớp phủ</td><td>${KT.esc(ctx.landcover || '—')}${ctx.in_forest ? ' · trong rừng' : ''}</td></tr>` : ''}
    <tr><td>Trạng thái</td><td><b>${KT.esc(p.statusLabel)}</b></td></tr></table>
    <p class="src" style="margin:6px 0 0">${['confirmed', 'handling', 'closed'].includes(p.status) ? 'Đã xác minh hiện trường.' : p.status === 'rejected' ? 'Đã kiểm tra: không phải cháy rừng.' : man ? 'Tin báo nhập thủ công, chưa xác minh hiện trường.' : 'Phát hiện nhiệt chưa xác minh hiện trường.'}</p></div>`;
  };
  KT.communeHtml = (p) => `<div class="pop"><h4>${KT.esc(p.fullName)}</h4><table>
    <tr><td>Có rừng ${D.forestYear || ''}</td><td>${KT.num(p.forest_ha)} ha</td></tr><tr><td>Che phủ công bố</td><td>${KT.num(p.cover, 2)}%</td></tr>
    <tr><td>Rừng tự nhiên</td><td>${KT.num(p.natural_forest_ha)} ha</td></tr><tr><td>Mất tán cây 2020–24</td><td>${KT.num(p.loss_5y)} ha</td></tr>
    <tr><td>Điểm nóng 7 ngày</td><td>${p.hotspots_7d ?? 0} <span class="src">(lịch sử 2024–26: ${p.hotspots_hist ?? 0})</span></td></tr>
    <tr><td>Nguy cơ cháy hôm nay</td><td>${p.danger_cls ? `<span class="lv lv-${p.danger_cls}">${p.danger_cls}</span> P=${KT.num(p.danger_p)}` : '—'}</td></tr>
    <tr><td>Cao nhất 7 ngày</td><td>${p.danger_max7 ? `<span class="lv lv-${p.danger_max7}">${p.danger_max7}</span>` : '—'}</td></tr>
    <tr><td>Dự báo mất rừng</td><td>${p.risk_expected_ha !== null && p.risk_expected_ha !== undefined ? `${KT.num(p.risk_expected_ha)} ha (${D.forecastShort})` : '—'}</td></tr></table></div>`;
  KT.sampleHtml = (p) => `<div class="pop"><h4>${KT.ic('clipboard-check-fill')} Mẫu thực địa 2025</h4><table>
    <tr><td>Đối tượng</td><td><b>${KT.esc(p.ten_vi || p.ten)}</b></td></tr><tr><td>Nhãn lớp phủ</td><td>${KT.esc(p.lpr)}</td></tr>
    <tr><td>Lớp phủ 2023 tại điểm</td><td>${KT.esc(p.lc2023 || '—')}</td></tr><tr><td>Toạ độ UTM 48N</td><td>${p.x_utm}, ${p.y_utm}</td></tr></table>
    <p class="src" style="margin:6px 0 0">Mau_KON_TUM_2025 – dữ liệu thực tế dự án</p></div>`;
  KT.candidateHtml = (p) => `<div class="pop"><h4>${KT.ic('exclamation-triangle-fill')} Biến động nghi vấn ${KT.esc(p.id)}</h4><table>
    <tr><td>Diện tích</td><td>${KT.num(p.area_ha)} ha</td></tr><tr><td>ΔNDVI / ΔNBR</td><td>${p.mean_dndvi} / ${p.mean_dnbr}</td></tr>
    <tr><td>Kỳ so sánh</td><td>${KT.esc(p.window)}</td></tr><tr><td>Địa bàn</td><td>${KT.esc(p.commune_name || '—')}</td></tr>
    <tr><td>Trạng thái</td><td><b>${KT.esc(p.statusLabel)}</b></td></tr></table>
    ${String(p.seasonal_leaf_fall_possible) === 'true' ? '<p class="src">Cửa sổ mùa khô: có thể do rụng lá theo mùa.</p>' : ''}</div>`;

  // ---------- measuring ----------
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  KT.lengthM = (pts) => pts.slice(1).reduce((s, p, i) => {
    const a = pts[i]; const dLat = rad(p[1] - a[1]); const dLon = rad(p[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(p[1])) * Math.sin(dLon / 2) ** 2;
    return s + 2 * R * Math.asin(Math.sqrt(h));
  }, 0);
  KT.areaM2 = (pts) => {
    if (pts.length < 3) return 0;
    let s = 0; const ring = [...pts, pts[0]];
    for (let i = 0; i < ring.length - 1; i++) s += rad(ring[i + 1][0] - ring[i][0]) * (2 + Math.sin(rad(ring[i][1])) + Math.sin(rad(ring[i + 1][1])));
    return Math.abs((s * R * R) / 2);
  };
  KT.measure = function (view, mode, onUpdate) {
    const { map } = view; const pts = [];
    const src = 'measure';
    const draw = () => {
      const coords = mode === 'area' && pts.length > 2 ? [...pts, pts[0]] : pts;
      const data = { type: 'FeatureCollection', features: [
        ...(pts.length > 1 ? [{ type: 'Feature', geometry: mode === 'area' && pts.length > 2 ? { type: 'Polygon', coordinates: [coords] } : { type: 'LineString', coordinates: coords } }] : []),
        ...pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p } })),
      ] };
      if (!map.getSource(src)) {
        map.addSource(src, { type: 'geojson', data });
        map.addLayer({ id: 'measure-fill', type: 'fill', source: src, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ffd21f', 'fill-opacity': 0.25 } });
        map.addLayer({ id: 'measure-line', type: 'line', source: src, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#ffd21f', 'line-width': 2.5, 'line-dasharray': [2, 1] } });
        map.addLayer({ id: 'measure-pt', type: 'circle', source: src, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-color': '#e0a800', 'circle-stroke-width': 2 } });
      } else map.getSource(src).setData(data);
      onUpdate(mode === 'area' ? KT.areaM2(pts) : KT.lengthM(pts), pts.length);
    };
    const click = (e) => { pts.push([e.lngLat.lng, e.lngLat.lat]); draw(); };
    map.on('click', click);
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      map.off('click', click); map.getCanvas().style.cursor = '';
      ['measure-fill', 'measure-line', 'measure-pt'].forEach((l) => map.getLayer(l) && map.removeLayer(l));
      if (map.getSource(src)) map.removeSource(src);
    };
  };

  // ---------- lớp vẽ tạm (kết quả công cụ) ----------
  KT.scratch = function (map, id, data) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'geojson', data });
      map.addLayer({ id: `${id}-road`, type: 'line', source: id, filter: ['==', ['get', 'kind'], 'road'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#1565d8', 'line-width': 5, 'line-opacity': 0.9 } });
      map.addLayer({ id: `${id}-walk`, type: 'line', source: id, filter: ['in', ['get', 'kind'], ['literal', ['walk', 'near']]], paint: { 'line-color': ['match', ['get', 'kind'], 'near', '#ffd21f', '#ff6f00'], 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: `${id}-pt`, type: 'circle', source: id, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'kind'], 'start', '#0c7a51', 'end', '#c0261f', 'settlement', '#ffd21f', 'facility', '#7e57c2', 'road', '#1565d8', '#ffffff'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: `${id}-label`, type: 'symbol', source: id, filter: ['has', 'label'], layout: { 'text-field': ['get', 'label'], 'text-size': 11.5, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,.7)', 'text-halo-width': 1.4 } });
    } else map.getSource(id).setData(data);
    return () => { [`${id}-road`, `${id}-walk`, `${id}-pt`, `${id}-label`].forEach((l) => map.getLayer(l) && map.removeLayer(l)); if (map.getSource(id)) map.removeSource(id); };
  };
  const fmtM = (m) => (m >= 1000 ? `${KT.num(m / 1000, 1)} km` : `${KT.num(m)} m`);
  KT.fmtDist = fmtM;
  const pt = (c, kind, label) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { kind, ...(label ? { label } : {}) } });
  KT.nearHtml = (r) => `<div class="pop"><h4>${KT.ic('geo-alt-fill')} Khoảng cách từ điểm chọn</h4><table>
    ${r.settlements.slice(0, 3).map((s, i) => `<tr><td>${i ? '' : 'Khu dân cư gần nhất'}</td><td><b>${KT.esc(s.name)}</b> (${KT.esc(s.kind)}) · ${fmtM(s.distance_m)}</td></tr>`).join('')}
    ${r.road ? `<tr><td>Đường gần nhất</td><td>${KT.esc(r.road.name || r.road.highway)} · ${fmtM(r.road.distance_m)}</td></tr>` : ''}
    ${r.facilities.slice(0, 2).map((f) => `<tr><td>${KT.esc(f.kind)}</td><td>${KT.esc(f.name)} · ${fmtM(f.distance_m)}</td></tr>`).join('')}</table>
    <p class="src">${KT.esc(r.source)}</p></div>`;
  // vẽ kết quả khoảng cách tới dân cư quanh một điểm
  KT.showNearest = async function (map, lng, lat) {
    const r = await KT.getJSON(`/api/public/tools/nearest?lon=${lng}&lat=${lat}`);
    const o = [lng, lat]; const feats = [pt(o, 'start')];
    r.settlements.slice(0, 3).forEach((s) => { feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [o, [s.lon, s.lat]] }, properties: { kind: 'near' } }, pt([s.lon, s.lat], 'settlement', `${s.name} · ${fmtM(s.distance_m)}`)); });
    if (r.road) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [o, [r.road.lon, r.road.lat]] }, properties: { kind: 'walk' } }, pt([r.road.lon, r.road.lat], 'road', `Đường · ${fmtM(r.road.distance_m)}`));
    KT.scratch(map, 'tool', { type: 'FeatureCollection', features: feats });
    return r;
  };
  KT.showRoute = async function (map, from, to) {
    const r = await KT.getJSON(`/api/public/tools/route?from=${from[0]},${from[1]}&to=${to[0]},${to[1]}`);
    if (r.error) throw new Error(r.error);
    KT.scratch(map, 'tool', { type: 'FeatureCollection', features: [...r.features, pt(from, 'start', 'Điểm đi'), pt(to, 'end', 'Điểm đến')] });
    const bb = new mapboxgl.LngLatBounds(); r.features.forEach((f) => f.geometry.coordinates.forEach((c) => bb.extend(c))); bb.extend(from); bb.extend(to);
    map.fitBounds(bb, { padding: 70, maxZoom: 15 });
    return r;
  };
  KT.routeText = (s) => `Đường đi ${fmtM(s.distance_m)} · khoảng ${s.duration_min >= 60 ? `${Math.floor(s.duration_min / 60)} giờ ${s.duration_min % 60} phút` : `${s.duration_min} phút`}${s.walk_end_m > 50 ? ` (gồm ${fmtM(s.walk_end_m)} đi bộ từ đường tới đích)` : ''}`;

  KT.legendHtml = (mode) => {
    const c = CHORO[mode];
    if (!c) return '';
    if (c.classes) return `<h4>${c.title}</h4>${[1, 2, 3, 4, 5].map((k) => `<div class="row"><span class="sw" style="background:${KT.RISK[k]}"></span>${KT.LEVEL[k]}</div>`).join('')}`;
    const grad = `linear-gradient(90deg, ${c.stops.map((s) => s[1]).join(',')})`;
    const f = (v) => (c.pct ? `${KT.num(v * 100, 0)}%` : KT.num(v));
    return `<h4>${c.title}</h4><div class="ramp" style="background:${grad}"></div><div class="ramp-l"><span>${f(c.stops[0][0])}</span><span>${f(c.stops[c.stops.length - 1][0])}+</span></div>`;
  };
  KT.overlayLegendHtml = (o) => {
    if (!o.legend) return `<h4>${KT.esc(o.title)}</h4>`;
    if (o.legend[0].label) return `<h4>${KT.esc(o.title)}</h4>${o.legend.map((l) => `<div class="row"><span class="sw" style="background:${l.color}"></span>${KT.esc(l.label)}</div>`).join('')}`;
    if (o.id === 'forest-loss-risk') return `<h4>${KT.esc(o.title)}</h4>${o.legend.map((l) => `<div class="row"><span class="sw" style="background:${l.color}"></span>Cấp ${l.value} – ${KT.RISK_LABEL[l.value]}</div>`).join('')}`;
    return `<h4>${KT.esc(o.title)}</h4><div class="ramp" style="background:linear-gradient(90deg,${o.legend.map((l) => l.color).join(',')})"></div><div class="ramp-l"><span>${o.legend[0].value}</span><span>${o.legend[o.legend.length - 1].value}</span></div>`;
  };
})();
