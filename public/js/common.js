/* Shared client helpers: navigation, global search, number formatting, Chart.js defaults. */
(function () {
  const KT = (window.KT = window.KT || {});

  KT.num = (v, d = 0) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—'
    : Number(v).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }));
  KT.ymd = (s) => { if (!s) return '—'; const [y, m, d] = String(s).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  KT.dt = (iso) => { const d = new Date(iso); return Number.isNaN(d) ? '—' : d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }); };
  KT.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  KT.ic = (name) => `<i class="ic" style="--i:url(/assets/icons/${name}.svg)"></i>`;
  KT.RISK = { 1: '#007b4b', 2: '#81cb1a', 3: '#ffd21f', 4: '#ff8a00', 5: '#f02d2d' };
  KT.LEVEL = { 1: 'Cấp I – Thấp', 2: 'Cấp II – Trung bình', 3: 'Cấp III – Cao', 4: 'Cấp IV – Nguy hiểm', 5: 'Cấp V – Cực kỳ nguy hiểm' };
  KT.RISK_LABEL = { 1: 'Rất thấp', 2: 'Thấp', 3: 'Trung bình', 4: 'Cao', 5: 'Rất cao' };
  KT.getJSON = async (url) => { const r = await fetch(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };

  // Navigation toggle (mobile)
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle-nav]');
    if (t) document.getElementById('main-nav').classList.toggle('open');
  });

  // EN: machine translation of the current public URL
  document.querySelectorAll('[data-translate]').forEach((a) => { a.href += encodeURIComponent(location.href); a.target = '_blank'; });

  // Global search (communes, news, documents, layers)
  function bindSearch(box) {
    const input = box.querySelector('input');
    const out = box.querySelector('.search-results');
    let timer = null; let last = '';
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const q = input.value.trim();
        if (q === last) return; last = q;
        if (q.length < 2) { out.classList.remove('open'); return; }
        const rows = await KT.getJSON(`/api/public/search?q=${encodeURIComponent(q)}`).catch(() => []);
        out.innerHTML = rows.length ? rows.map((r) => `<a href="${r.url}" data-center="${r.center ? r.center.join(',') : ''}">${KT.esc(r.title)}<small>${KT.esc(r.type)}</small></a>`).join('')
          : '<div class="empty">Không tìm thấy kết quả phù hợp</div>';
        out.classList.add('open');
      }, 220);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const a = out.querySelector('a'); if (a) { e.preventDefault(); a.click(); } } });
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) out.classList.remove('open'); });
    out.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && box.dataset.search === 'map' && a.dataset.center && KT.activeMap) {
        e.preventDefault();
        const [x, y] = a.dataset.center.split(',').map(Number);
        KT.activeMap.flyTo({ center: [x, y], zoom: 11 });
        out.classList.remove('open');
        if (KT.onCommuneSearch) KT.onCommuneSearch(a.getAttribute('href').split('xa=')[1]);
      }
    });
  }
  document.querySelectorAll('[data-search]').forEach(bindSearch);

  // Client-side tabs: <div data-tabs> buttons[data-tab] + panels[data-panel]
  document.querySelectorAll('[data-tabs]').forEach((root) => {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b || !root.contains(b)) return;
      const group = root.dataset.tabs;
      root.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle(x.dataset.cls || 'on', x === b));
      document.querySelectorAll(`[data-panel-group="${group}"]`).forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
      root.dispatchEvent(new CustomEvent('tabchange', { detail: b.dataset.tab }));
    });
  });

  // Client-side pagination: <table data-page-size="10"> (paginates tbody rows) or any container with
  // data-page-size (paginates its element children). Re-paginates after sorting/filtering (childList changes);
  // rows hidden by a filter should carry data-filtered="1".
  KT.paginate = function paginate(el) {
    const size = Number(el.dataset.pageSize) || 10;
    const body = el.tagName === 'TABLE' ? el.tBodies[0] : el;
    if (!body) return;
    let page = 1;
    const nav = document.createElement('nav'); nav.className = 'pager'; nav.setAttribute('aria-label', 'Phân trang');
    const anchor = el.tagName === 'TABLE' && el.parentElement.classList.contains('table-wrap') ? el.parentElement : el;
    anchor.after(nav);
    function render() {
      const rows = [...body.children].filter((r) => r.dataset.filtered !== '1');
      const pages = Math.max(1, Math.ceil(rows.length / size));
      page = Math.min(page, pages);
      [...body.children].forEach((r) => { r.hidden = true; });
      rows.forEach((r, i) => { r.hidden = i < (page - 1) * size || i >= page * size; });
      if (rows.length <= size) { nav.innerHTML = rows.length ? `<span class="pager-info">${rows.length} mục</span>` : ''; return; }
      const nums = []; for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
      nav.innerHTML = `<span class="pager-info">Hiển thị ${(page - 1) * size + 1}–${Math.min(page * size, rows.length)} / ${rows.length}</span>`
        + `<button type="button" class="pg ${page === 1 ? 'off' : ''}" data-p="${page - 1}" aria-label="Trang trước">${KT.ic('chevron-left')}</button>`
        + nums.map((n, i) => `${i && n - nums[i - 1] > 1 ? '<span class="pg gap">…</span>' : ''}<button type="button" class="pg ${n === page ? 'on' : ''}" data-p="${n}">${n}</button>`).join('')
        + `<button type="button" class="pg ${page === pages ? 'off' : ''}" data-p="${page + 1}" aria-label="Trang sau">${KT.ic('chevron-right')}</button>`;
    }
    nav.addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; page = Number(b.dataset.p); render(); });
    new MutationObserver(() => { page = 1; render(); }).observe(body, { childList: true });
    el.repaginate = (toPage) => { if (toPage) page = toPage; render(); };
    // jump to the page that contains a given element (e.g. a row selected on the map)
    el.showItem = (item) => { const rows = [...body.children].filter((r) => r.dataset.filtered !== '1'); const i = rows.indexOf(item); if (i >= 0) { page = Math.floor(i / size) + 1; render(); } };
    render();
  };
  document.querySelectorAll('[data-page-size]').forEach((el) => KT.paginate(el));

  // Chart.js defaults & helpers (loaded only on pages that include Chart.js)
  KT.chartDefaults = () => {
    if (!window.Chart || KT._chartInit) return;
    KT._chartInit = true;
    Chart.defaults.font.family = 'Roboto, Segoe UI, sans-serif';
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = '#5f7180';
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.tooltip.callbacks.label = (ctx) => {
      const v = ctx.parsed && typeof ctx.parsed === 'object' ? (ctx.parsed.y ?? ctx.parsed.x) : ctx.parsed;
      return ` ${ctx.dataset.label || ctx.label}: ${KT.num(v, Math.abs(v) < 10 && v % 1 ? 2 : 0)}`;
    };
  };
  KT.chart = (el, cfg) => { KT.chartDefaults(); const c = typeof el === 'string' ? document.getElementById(el) : el; return c ? new Chart(c, cfg) : null; };
  // Monthly hotspot chart: MODIS history (GEE) and the NRT 7-day snapshot as separate stacked series.
  KT.hotspotChart = (el, h, opts = {}) => {
    if (!h) return null;
    const ms = h.months || Object.keys(h.monthly).sort();
    const lab = ms.map((m) => `${m.slice(5)}/${m.slice(2, 4)}`);
    const ds = [
      { type: 'bar', label: 'Lịch sử MODIS 1 km (GEE)', data: ms.map((m) => h.monthly[m] || 0), backgroundColor: '#ef4b2f', stack: 's', yAxisID: 'y' },
      { type: 'bar', label: 'FIRMS NRT 7 ngày gần nhất', data: ms.map((m) => (h.nrtMonthly || {})[m] || 0), backgroundColor: '#7e1d6b', stack: 's', yAxisID: 'y', minBarLength: 3 },
      ...(opts.extra ? opts.extra(ms) : []),
    ];
    return KT.chart(el, { data: { labels: lab, datasets: ds },
      options: { plugins: { legend: { display: opts.legend !== false, position: 'bottom' } }, scales: { x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: opts.ticks || 9 } }, y: { stacked: true, beginAtZero: true }, ...(opts.scales || {}) } } });
  };
  KT.donut = (el, labels, values, colors, centerText) => KT.chart(el, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
    options: { cutout: '64%', plugins: { legend: { display: false } } },
    plugins: centerText ? [{
      id: 'center', afterDraw(c) {
        const { ctx, chartArea: a } = c; const x = (a.left + a.right) / 2; const y = (a.top + a.bottom) / 2; const t = c.$center || centerText;
        const big = a.right - a.left < 120 ? 12 : 15;
        ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#5f7180'; ctx.font = '500 10.5px Roboto'; ctx.fillText(t[0], x, y - 8);
        ctx.fillStyle = '#092d49'; ctx.font = `800 ${big}px Roboto`; ctx.fillText(t[1], x, y + 10); ctx.restore();
      },
    }] : [],
  });
})();
