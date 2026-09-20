// PDF viewer: lazy page rendering, pinch / button zoom, page jump
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, Pdf, App, fmtSize } = PP;

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 5;
  const MAX_CANVAS_WIDTH = 2800; // device pixels

  const ui = {};
  let doc = null;
  let src = null;       // { blob, name }
  let pages = [];       // [{ n, el, canvas, aspect, visible, queued }]
  let zoom = 1;
  let chain = Promise.resolve();
  let io = null;
  let gen = 0;          // bumps whenever a different document is opened

  // ── night mode: inverts each page's colours (white↔black, every colour to its opposite) so a bright PDF
  // doesn't light up a dark room. Pure CSS, so it costs nothing and needs no re-render. Remembered like auto-crop.
  let night = false;
  try { night = localStorage.getItem('pdfnight') === 'on'; } catch (_) { /* storage may be blocked */ }

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2.5);
  const pageCssWidth = () => Math.max(120, (ui.scroll.clientWidth - 16) * zoom);

  function sizePage(pg) {
    const w = pageCssWidth();
    pg.el.style.width = `${w}px`;
    pg.el.style.height = `${w * pg.aspect}px`;
  }

  function requestDraw(pg) {
    if (pg.queued || !pg.visible) return;
    pg.queued = true;
    const myGen = gen;
    chain = chain.then(async () => {
      pg.queued = false;
      if (myGen !== gen || !pg.visible) return;
      try {
        const target = Math.min(pageCssWidth() * dpr(), MAX_CANVAS_WIDTH);
        await Pdf.render(doc, pg.n, { targetWidth: target, maxPixels: 9e6, canvas: pg.canvas });
        pg.drawnAt = zoom;
      } catch (_) { /* document closed mid-render */ }
    });
  }

  function release(pg) {
    pg.canvas.width = pg.canvas.height = 0; // frees the pixel memory of pages far off screen
    pg.drawnAt = null;
  }

  function layoutAll() {
    pages.forEach(sizePage);
    pages.forEach((pg) => { if (pg.visible) requestDraw(pg); });
  }

  function currentPage() {
    const mid = ui.scroll.scrollTop + ui.scroll.clientHeight / 2;
    let best = 1;
    for (const pg of pages) { if (pg.el.offsetTop <= mid) best = pg.n; else break; }
    return best;
  }

  function updateIndicator() { ui.pg.textContent = `${currentPage()} / ${pages.length}`; }

  function setZoom(next, focus) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (Math.abs(z - zoom) < 0.001) return;
    const s = ui.scroll;
    // Keep the point under `focus` (scroller-relative px) where it is.
    const fx = focus ? focus.x : s.clientWidth / 2;
    const fy = focus ? focus.y : s.clientHeight / 2;
    const cx = s.scrollLeft + fx;
    const cy = s.scrollTop + fy;
    const ratio = z / zoom;
    zoom = z;
    layoutAll();
    s.scrollLeft = cx * ratio - fx;
    s.scrollTop = cy * ratio - fy;
    ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    updateIndicator();
  }

  // ── pinch to zoom ──
  let pinch = null;
  const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  function wirePinch() {
    const s = ui.scroll;
    s.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      const r = s.getBoundingClientRect();
      const [a, b] = e.touches;
      const fx = (a.clientX + b.clientX) / 2 - r.left;
      const fy = (a.clientY + b.clientY) / 2 - r.top;
      pinch = { d0: dist(a, b), scale: 1, fx, fy };
      ui.pages.style.transformOrigin = `${s.scrollLeft + fx}px ${s.scrollTop + fy}px`;
    }, { passive: true });
    s.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const next = dist(e.touches[0], e.touches[1]) / pinch.d0;
      pinch.scale = Math.min(MAX_ZOOM / zoom, Math.max(MIN_ZOOM / zoom, next));
      ui.pages.style.transform = `scale(${pinch.scale})`;
    }, { passive: false });
    const end = () => {
      if (!pinch) return;
      const { scale, fx, fy } = pinch;
      pinch = null;
      ui.pages.style.transform = '';
      setZoom(zoom * scale, { x: fx, y: fy });
    };
    s.addEventListener('touchend', (e) => { if (e.touches.length < 2) end(); });
    s.addEventListener('touchcancel', end);
  }

  function closeDoc() {
    gen++;
    if (io) { io.disconnect(); io = null; }
    if (doc) { Pdf.close(doc); doc = null; }
    pages.forEach(release);
    pages = [];
    ui.pages.replaceChildren();
    src = null;
  }

  async function open(blob, name) {
    closeDoc();
    const bytes = await Busy.run('Opening…', async () => new Uint8Array(await blob.arrayBuffer()));
    if (!bytes) { App.back(); return; }
    let d;
    try {
      d = await Busy.run('Opening…', () => Pdf.open(bytes, { name, ask: true })) ;
    } catch (_) { d = undefined; }
    if (!d) { if (App.current === 'viewer') App.back(); return; }

    doc = d;
    src = { blob, name };
    zoom = 1;
    ui.zoomLabel.textContent = '100%';
    ui.empty.hidden = true;
    ui.viewer.hidden = false;
    PP.$('#title').textContent = name;

    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const defaultAspect = vp.height / vp.width;

    const myGen = gen;
    io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const pg = e.target.__pg;
        pg.visible = e.isIntersecting;
        if (pg.visible) requestDraw(pg); else if (pg.drawnAt != null) release(pg);
      }
    }, { root: ui.scroll, rootMargin: '150% 0px' });

    pages = Array.from({ length: doc.numPages }, (_, i) => {
      const canvas = h('canvas', { width: 0, height: 0 }); // 0x0 until drawn, so unseen pages cost no memory
      const el = h('div', { class: 'vpage', 'data-page': i + 1 }, canvas);
      const pg = { n: i + 1, el, canvas, aspect: defaultAspect, visible: false, queued: false, drawnAt: null };
      el.__pg = pg;
      return pg;
    });
    pages.forEach(sizePage);
    ui.pages.replaceChildren(...pages.map((pg) => pg.el));
    pages.forEach((pg) => io.observe(pg.el));
    ui.scroll.scrollTop = 0;
    updateIndicator();

    // Learn each page's real shape in the background (only matters for PDFs with mixed page sizes).
    (async () => {
      for (const pg of pages) {
        if (myGen !== gen) return;
        try {
          const pgObj = await doc.getPage(pg.n);
          const v = pgObj.getViewport({ scale: 1 });
          const aspect = v.height / v.width;
          if (Math.abs(aspect - pg.aspect) > 0.001) { pg.aspect = aspect; sizePage(pg); }
        } catch (_) { return; }
      }
    })();
  }

  function setNight(on) {
    night = on;
    ui.pages.classList.toggle('night', night);
    ui.nightBtn.setAttribute('aria-pressed', String(night));
    try { localStorage.setItem('pdfnight', night ? 'on' : 'off'); } catch (_) { /* ignore */ }
  }

  const pick = async () => { const [f] = await Files.pick({ accept: 'application/pdf,.pdf' }); if (f) open(f, f.name); };

  function jump() {
    if (!pages.length) return;
    const answer = window.prompt(`Go to page (1–${pages.length})`, String(currentPage()));
    const n = Math.round(Number(answer));
    if (answer && n >= 1 && n <= pages.length) pages[n - 1].el.scrollIntoView({ block: 'start' });
  }

  App.register({
    id: 'viewer',
    title: 'PDF viewer',

    build(root) {
      root.classList.add('viewer-screen');
      ui.empty = h('div', { class: 'card intro' },
        h('h2', {}, 'Open a PDF'),
        h('p', { class: 'muted' }, 'Read any PDF right here. It never leaves your phone.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: pick }, icon('file', 20), 'Choose PDF')));

      ui.pg = h('button', { class: 'btn small ghost pg', type: 'button', 'aria-label': 'Jump to page', onclick: jump }, '');
      ui.zoomLabel = h('span', { class: 'zl' }, '100%');
      ui.nightBtn = h('button', {
        class: 'btn small ghost', type: 'button', 'aria-label': 'Night mode', title: 'Night mode',
        'aria-pressed': String(night), onclick: () => setNight(!night),
      }, icon('moon', 18));
      ui.scroll = h('div', { class: 'vscroll' });
      ui.pages = h('div', { class: `vpages${night ? ' night' : ''}` });
      ui.scroll.append(ui.pages);
      ui.scroll.addEventListener('scroll', () => requestAnimationFrame(updateIndicator), { passive: true });
      ui.scroll.addEventListener('dblclick', () => setZoom(zoom > 1.2 ? 1 : 2));
      wirePinch();
      addEventListener('resize', () => { if (doc) layoutAll(); });

      ui.viewer = h('div', { class: 'vwrap', hidden: true },
        h('div', { class: 'vbar' },
          ui.pg,
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom / 1.25) }, icon('minus', 18)),
          ui.zoomLabel,
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom * 1.25) }, icon('plus', 18)),
          h('span', { class: 'spacer' }),
          ui.nightBtn,
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Save a copy', onclick: () => src && Files.saveWithToast(src.blob, src.name) }, icon('save', 20)),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Share', onclick: () => src && Files.share([src])}, icon('share', 20))),
        ui.scroll);

      root.append(ui.empty, ui.viewer);
    },

    async enter(args) {
      if (args && args.blob) await open(args.blob, args.name || 'document.pdf');
      else if (args && args.file) await open(args.file, args.file.name);
    },

    leave() {
      closeDoc();
      ui.viewer.hidden = true;
      ui.empty.hidden = false;
    },
  });
})();
