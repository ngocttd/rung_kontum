/* P10 – Thống kê, báo cáo */
(function () {
  const P = window.PAGE;
  const S = P.summary;
  const ys = Object.keys(P.loss).filter((y) => y >= '2015');
  const lossChart = KT.chart('ch-loss', { type: 'line', data: { labels: ys, datasets: [{ label: 'Mất tán cây (ha)', data: ys.map((y) => P.loss[y]), borderColor: '#e11d48', backgroundColor: 'rgba(225,29,72,.12)', fill: true, tension: 0.3 }] },
    options: { plugins: { legend: { display: false } } } });
  const struct = KT.donut('ch-struct', ['Đặc dụng', 'Phòng hộ', 'Sản xuất'], [S.special_use_ha, S.protection_ha, S.production_ha], ['#006b38', '#75bb25', '#f8ce42']);
  KT.hotspotChart('ch-hot', P.hot, { ticks: 12 });
  if (P.dangerMonthly) {
    const c = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    Object.entries(P.dangerMonthly).filter(([m]) => m.startsWith('2025')).forEach(([, v]) => Object.entries(v).forEach(([k, n]) => { c[k] += n; }));
    const tot = Object.values(c).reduce((a, b) => a + b, 0);
    KT.donut('ch-cls', [1, 2, 3, 4, 5].map((k) => KT.LEVEL[k]), [1, 2, 3, 4, 5].map((k) => c[k]), [1, 2, 3, 4, 5].map((k) => KT.RISK[k]), ['Ngày-xã', KT.num(tot)]);
  }
  const top = P.communes.filter((c) => c.risk).sort((a, b) => b.risk.expected_loss_ha - a.risk.expected_loss_ha).slice(0, 10);
  KT.chart('ch-risk', { type: 'bar', data: { labels: top.map((c) => c.name.replace(/^(Xã|Phường) /, '')), datasets: [{ label: 'DT kỳ vọng mất (ha)', data: top.map((c) => c.risk.expected_loss_ha), backgroundColor: '#d94801', borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } } });

  // scope filter updates KPI cards and structure donut
  const set = (k, t) => { const el = document.querySelector(`[data-k="${k}"]`); if (el) el.textContent = t; };
  let v = null;
  document.getElementById('scope').addEventListener('change', (e) => {
    const c = P.communes.find((x) => x.code === e.target.value);
    document.querySelectorAll('tr[data-code]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.code === e.target.value));
    if (!c || !c.o) {
      set('forest', `${KT.num(S.established_forest_ha)} ha`); set('cover', `${KT.num(S.cover_percent_computed, 1)}%`); set('cover-note', 'tính từ tổng 40 xã');
      set('natural', `${KT.num(S.natural_forest_ha)} ha`); set('plant', `${KT.num(S.plantation_ha)} ha`); set('imm', `+ ${KT.num(S.immature_plantation_ha)} ha chưa thành rừng`);
      set('hot', KT.num(P.hs.y2025)); set('hot-note', `2024: ${KT.num(P.hs.y2024)} (MODIS 1 km)`); set('loss', `${KT.num(P.loss5)} ha`);
      struct.data.datasets[0].data = [S.special_use_ha, S.protection_ha, S.production_ha];
      set('sp', KT.num(S.special_use_ha)); set('pr', KT.num(S.protection_ha)); set('pd', KT.num(S.production_ha));
      lossChart.data.datasets[0].data = ys.map((y) => P.loss[y]); lossChart.update();
    } else {
      const o = c.o;
      set('forest', `${KT.num(o.established_forest_ha)} ha`); set('cover', `${KT.num(o.official_forest_cover_percent, 2)}%`); set('cover-note', 'số công bố của xã');
      set('natural', `${KT.num(o.natural_forest_ha)} ha`); set('plant', `${KT.num(o.established_plantation_ha)} ha`); set('imm', `+ ${KT.num(o.immature_plantation_ha)} ha chưa thành rừng`);
      set('hot', KT.num(c.hot)); set('hot-note', 'tổng 2024–2026 trong xã'); set('loss', `${KT.num(c.loss5)} ha`);
      struct.data.datasets[0].data = [o.special_use_planning_ha, o.protection_planning_ha, o.production_planning_ha];
      set('sp', KT.num(o.special_use_planning_ha)); set('pr', KT.num(o.protection_planning_ha)); set('pd', KT.num(o.production_planning_ha));
      KT.fetchCached('/api/public/forest/communes').then((list) => {
        const x = list.find((y) => y.code === c.code);
        if (x && x.loss) { lossChart.data.datasets[0].data = ys.map((y) => x.loss.annual[y]); lossChart.update(); }
      });
    }
    struct.update();
    if (v && c) {
      const f = v.map.querySourceFeatures('communes', { filter: ['==', ['get', 'code'], c.code] })[0];
      if (f) { const b = new mapboxgl.LngLatBounds(); (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).forEach((p) => p[0].forEach((pt) => b.extend(pt))); v.map.fitBounds(b, { padding: 40 }); }
    } else if (v) v.fitAOI();
  });

  v = KT.createMap('map', { basemap: 'satellite', choropleth: P.choro });
  if (!v) return;
  const legend = document.getElementById('legend');
  legend.innerHTML = KT.legendHtml(P.choro);
  v.define('communes', KT.layers.communes(v)).define('province', KT.layers.province());
  document.getElementById('choro').addEventListener('change', (e) => { v.setChoropleth(e.target.value); legend.innerHTML = KT.legendHtml(e.target.value); });
  v.map.on('click', 'communes-fill', (e) => new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(KT.communeHtml(e.features[0].properties)).addTo(v.map));
})();
