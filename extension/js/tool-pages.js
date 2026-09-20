// Organize pages (reorder / rotate / delete) and Split / extract pages
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, Pdf, Thumbs, resultCard, App, cleanName, fmtSize, stem, parseRanges, UserError } = PP;

  const PDF_ACCEPT = 'application/pdf,.pdf';

  async function loadTarget(file) {
    const { bytes } = await Pdf.readFile(file);
    const doc = await Pdf.open(bytes, { name: file.name, ask: false });
    return { name: file.name, bytes, doc, n: doc.numPages };
  }

  const pdfBlob = async (doc) => new Blob([await doc.save()], { type: 'application/pdf' });

  function iconBtn(label, ico, fn, { disabled = false, warn = false } = {}) {
    return h('button', { type: 'button', 'aria-label': label, title: label, disabled, class: warn ? 'warn' : '', onclick: fn }, icon(ico, 20));
  }

  function emptyCard(title, text, onPick) {
    return h('div', { class: 'card intro' },
      h('h2', {}, title),
      h('p', { class: 'muted' }, text),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: onPick }, icon('file', 20), 'Choose PDF')));
  }

  const fileLine = (t, onOther) => h('div', { class: 'card file-line' },
    icon('file', 26),
    h('div', { class: 'grow' }, h('strong', {}, t.name), h('span', { class: 'muted' }, `${t.n} page${t.n === 1 ? '' : 's'} · ${fmtSize(t.bytes.length)}`)),
    h('button', { class: 'btn small ghost', type: 'button', onclick: onOther }, 'Change'));

  // ═════════════════════════════════════════
  //  Organize
  // ═════════════════════════════════════════
  (() => {
    const ui = {};
    let t = null;      // loaded target
    let pages = [];    // [{ n, rot, del, thumb }] in current order

    function disposeThumbs() { pages.forEach((p) => p.thumb.destroy()); pages = []; }

    function reset() {
      disposeThumbs();
      if (t) { Pdf.close(t.doc); t = null; }
      ui.result.replaceChildren();
      ui.empty.hidden = false;
      ui.work.hidden = true;
    }

    async function load(file) {
      const target = await Busy.run('Opening PDF…', () => loadTarget(file));
      if (!target) return;
      reset();
      t = target;
      pages = Array.from({ length: t.n }, (_, i) => ({ n: i + 1, rot: 0, del: false, thumb: Thumbs.make(t.doc, i + 1) }));
      ui.empty.hidden = true;
      ui.work.hidden = false;
      ui.file.replaceChildren(fileLine(t, pick));
      render();
    }

    const pick = async () => { const [f] = await Files.pick({ accept: PDF_ACCEPT }); if (f) load(f); };

    function changed() { ui.result.replaceChildren(); render(); }

    function render() {
      const kept = pages.filter((p) => !p.del).length;
      ui.count.textContent = `${kept} of ${pages.length} pages kept`;
      ui.save.disabled = kept === 0;
      ui.grid.replaceChildren(...pages.map((p, i) => h('li', { class: `tile${p.del ? ' removed' : ''}` },
        p.thumb.el,
        h('span', { class: 'num' }, i + 1),
        p.del ? h('span', { class: 'badge' }, 'Deleted') : null,
        h('div', { class: 'meta' }, p.n !== i + 1 ? `was page ${p.n}` : ' '),
        h('div', { class: 'tools' },
          iconBtn('Move earlier', 'left', () => { [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; changed(); }, { disabled: i === 0 }),
          iconBtn('Rotate', 'rotate', () => { p.rot = (p.rot + 90) % 360; p.thumb.setRotation(p.rot); changed(); }),
          iconBtn('Move later', 'right', () => { [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]]; changed(); }, { disabled: i === pages.length - 1 }),
          iconBtn(p.del ? 'Restore' : 'Delete', p.del ? 'plus' : 'trash', () => { p.del = !p.del; changed(); }, { warn: !p.del })))));
    }

    async function save() {
      const keep = pages.filter((p) => !p.del);
      if (!keep.length) { toast('Keep at least one page.'); return; }
      ui.result.replaceChildren();
      const blob = await Busy.run('Saving PDF…', async (p) => {
        await p.tick('Reading pages…');
        const src = await Pdf.load(t.bytes, t.name);
        const out = await PDFLib.PDFDocument.create();
        out.setProducer('Pocket PDF');
        out.setCreator('Pocket PDF');
        const extra = new Map(keep.map((k) => [k.n - 1, k.rot]));
        await p.tick('Building new PDF…');
        await Pdf.copyInto(out, src, keep.map((k) => k.n - 1), (idx) => extra.get(idx) || 0);
        return pdfBlob(out);
      });
      if (!blob) return;
      ui.result.replaceChildren(resultCard([{ name: `${stem(t.name)}-edited.pdf`, blob }], { title: 'Saved', note: `${keep.length} pages` }));
      ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    App.register({
      id: 'organize',
      title: 'Organize pages',
      build(root) {
        ui.empty = emptyCard('Reorder, rotate or delete pages', 'Choose a PDF, then fix its pages one by one.', pick);
        ui.file = h('div');
        ui.count = h('strong');
        ui.grid = h('ol', { class: 'grid' });
        ui.result = h('div');
        ui.save = h('button', { class: 'btn primary big', type: 'button', onclick: save }, 'Save new PDF');
        ui.work = h('div', { hidden: true },
          ui.file,
          h('div', { class: 'bar' }, ui.count, h('span', { class: 'spacer' }),
            h('button', { class: 'btn small', type: 'button', onclick: () => { pages.forEach((p) => { p.rot = (p.rot + 90) % 360; p.thumb.setRotation(p.rot); }); changed(); } }, icon('rotate', 18), 'Rotate all'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { pages.reverse(); changed(); } }, 'Reverse')),
          ui.grid, ui.save, ui.result);
        root.append(ui.empty, ui.work);
      },
      enter(args) { if (args && args.file) load(args.file); },
      leave: reset,
    });
  })();

  // ═════════════════════════════════════════
  //  Split / extract
  // ═════════════════════════════════════════
  (() => {
    const ui = {};
    let t = null;
    let tiles = []; // [{ n, thumb, selected }]
    let mode = 'pick';

    function reset() {
      tiles.forEach((x) => x.thumb.destroy());
      tiles = [];
      if (t) { Pdf.close(t.doc); t = null; }
      ui.result.replaceChildren();
      ui.empty.hidden = false;
      ui.work.hidden = true;
    }

    async function load(file) {
      const target = await Busy.run('Opening PDF…', () => loadTarget(file));
      if (!target) return;
      reset();
      t = target;
      tiles = Array.from({ length: t.n }, (_, i) => ({ n: i + 1, thumb: Thumbs.make(t.doc, i + 1), selected: false }));
      ui.empty.hidden = true;
      ui.work.hidden = false;
      ui.file.replaceChildren(fileLine(t, pick));
      ui.ranges.placeholder = t.n > 1 ? `1-${Math.ceil(t.n / 2)}, ${Math.ceil(t.n / 2) + 1}-${t.n}` : '1';
      setMode('pick');
    }

    const pick = async () => { const [f] = await Files.pick({ accept: PDF_ACCEPT }); if (f) load(f); };

    function setMode(m) {
      mode = m;
      ui.result.replaceChildren();
      for (const [k, b] of Object.entries(ui.segs)) b.setAttribute('aria-pressed', String(k === m));
      ui.panePick.hidden = m !== 'pick';
      ui.paneRanges.hidden = m !== 'ranges';
      ui.paneEvery.hidden = m !== 'every';
      renderTiles();
    }

    function renderTiles() {
      const sel = tiles.filter((x) => x.selected).length;
      ui.selCount.textContent = `${sel} selected`;
      ui.extract.disabled = sel === 0;
      ui.extract.textContent = sel ? `Extract ${sel} page${sel === 1 ? '' : 's'}` : 'Select pages to extract';
      if (mode !== 'pick') return;
      ui.grid.replaceChildren(...tiles.map((x) => h('li', {
        class: `tile selectable${x.selected ? ' selected' : ''}`, role: 'button', tabIndex: 0, 'aria-pressed': String(x.selected), 'aria-label': `Page ${x.n}`,
        onclick: () => { x.selected = !x.selected; ui.result.replaceChildren(); renderTiles(); },
      }, x.thumb.el, h('span', { class: 'num' }, x.n), h('span', { class: 'tick' }, icon('check', 16)))));
    }

    function selectWhere(fn) { tiles.forEach((x) => { x.selected = fn(x.n); }); ui.result.replaceChildren(); renderTiles(); }

    async function makePart(src, indexes) {
      const out = await PDFLib.PDFDocument.create();
      out.setProducer('Pocket PDF');
      out.setCreator('Pocket PDF');
      await Pdf.copyInto(out, src, indexes);
      return pdfBlob(out);
    }

    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i); // 1-based inclusive -> 0-based indexes

    // parts: [{ name, indexes }]
    async function run(parts, title) {
      ui.result.replaceChildren();
      const items = await Busy.run('Splitting…', async (p) => {
        const src = await Pdf.load(t.bytes, t.name);
        const out = [];
        for (let i = 0; i < parts.length; i++) {
          await p.tick(parts.length > 1 ? `Part ${i + 1} of ${parts.length}` : 'Building PDF…', i, parts.length);
          out.push({ name: parts[i].name, blob: await makePart(src, parts[i].indexes) });
        }
        return out;
      });
      if (!items) return;
      ui.result.replaceChildren(resultCard(items, { title, folder: items.length > 1 ? `${stem(t.name)}-split` : '', zipName: `${stem(t.name)}-split.zip` }));
      ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const pad = (n, max) => String(n).padStart(String(max).length, '0');

    function extractSelected() {
      const idx = tiles.filter((x) => x.selected).map((x) => x.n - 1);
      run([{ name: `${stem(t.name)}-extract.pdf`, indexes: idx }], 'Pages extracted');
    }

    function splitRanges() {
      let rs;
      try { rs = parseRanges(ui.ranges.value, t.n); } catch (e) { PP.reportError(e); return; }
      run(rs.map(([a, b]) => ({ name: `${stem(t.name)}-${a === b ? `page-${pad(a, t.n)}` : `pages-${pad(a, t.n)}-${pad(b, t.n)}`}.pdf`, indexes: range(a, b) })),
        rs.length > 1 ? `Split into ${rs.length} PDFs` : 'Pages extracted');
    }

    function splitEvery() {
      const step = Math.floor(Number(ui.every.value));
      if (!(step >= 1)) { toast('Type a number, like 1 or 5.'); return; }
      const parts = [];
      for (let a = 1; a <= t.n; a += step) {
        const b = Math.min(t.n, a + step - 1);
        parts.push({ name: `${stem(t.name)}-part-${pad(parts.length + 1, Math.ceil(t.n / step))}.pdf`, indexes: range(a, b) });
      }
      if (parts.length < 2) { toast(`That would make just one PDF. This one has ${t.n} page${t.n === 1 ? '' : 's'}.`); return; }
      run(parts, `Split into ${parts.length} PDFs`);
    }

    App.register({
      id: 'split',
      title: 'Split & extract',
      build(root) {
        ui.empty = emptyCard('Split a PDF or pull out pages', 'Choose a PDF, then pick pages or split it into several files.', pick);
        ui.file = h('div');
        ui.segs = {
          pick: h('button', { type: 'button', onclick: () => setMode('pick') }, 'Pick pages'),
          ranges: h('button', { type: 'button', onclick: () => setMode('ranges') }, 'By ranges'),
          every: h('button', { type: 'button', onclick: () => setMode('every') }, 'Every N pages'),
        };
        ui.selCount = h('strong');
        ui.grid = h('ol', { class: 'grid' });
        ui.extract = h('button', { class: 'btn primary big', type: 'button', onclick: extractSelected }, '');
        ui.panePick = h('div', {},
          h('div', { class: 'bar' }, ui.selCount, h('span', { class: 'spacer' }),
            h('button', { class: 'btn small', type: 'button', onclick: () => selectWhere(() => true) }, 'All'),
            h('button', { class: 'btn small', type: 'button', onclick: () => selectWhere((n) => n % 2 === 1) }, 'Odd'),
            h('button', { class: 'btn small', type: 'button', onclick: () => selectWhere((n) => n % 2 === 0) }, 'Even'),
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => selectWhere(() => false) }, 'None')),
          ui.grid, ui.extract);
        ui.ranges = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, inputMode: 'text' });
        ui.paneRanges = h('div', { class: 'card' },
          h('label', { class: 'field' }, 'Page ranges (each becomes its own PDF)', ui.ranges),
          h('p', { class: 'muted' }, 'Example: 1-3, 4-6, 7-  (a dash at the end means "to the last page")'),
          h('button', { class: 'btn primary big', type: 'button', onclick: splitRanges }, 'Split'));
        ui.every = h('input', { type: 'number', min: 1, value: 1, inputMode: 'numeric' });
        ui.paneEvery = h('div', { class: 'card' },
          h('label', { class: 'field' }, 'Pages per file', ui.every),
          h('p', { class: 'muted' }, '1 = every page becomes its own PDF.'),
          h('button', { class: 'btn primary big', type: 'button', onclick: splitEvery }, 'Split'));
        ui.result = h('div');
        ui.work = h('div', { hidden: true }, ui.file, h('div', { class: 'seg' }, Object.values(ui.segs)), ui.panePick, ui.paneRanges, ui.paneEvery, ui.result);
        root.append(ui.empty, ui.work);
      },
      enter(args) { if (args && args.file) load(args.file); },
      leave: reset,
    });
  })();
})();
