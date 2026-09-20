// PDF → Images, and Extract images from a PDF
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, Pdf, resultCard, App, fmtSize, stem, parseRanges } = PP;

  const PDF_ACCEPT = 'application/pdf,.pdf';
  const pad = (n, max) => String(n).padStart(String(max).length, '0');
  const toBlob = (canvas, type, q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Export failed'))), type, q));

  async function smallThumb(canvas, size = 96) {
    const s = Math.min(1, size / Math.max(canvas.width, canvas.height));
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(canvas.width * s));
    t.height = Math.max(1, Math.round(canvas.height * s));
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
    const url = URL.createObjectURL(await toBlob(t, 'image/jpeg', 0.7));
    t.width = t.height = 0;
    return url;
  }

  const fileLine = (f, size, pages, onOther) => h('div', { class: 'card file-line' }, icon('file', 26),
    h('div', { class: 'grow' }, h('strong', {}, f), h('span', { class: 'muted' }, `${pages} page${pages === 1 ? '' : 's'} · ${fmtSize(size)}`)),
    h('button', { class: 'btn small ghost', type: 'button', onclick: onOther }, 'Change'));

  function emptyCard(title, text, onPick) {
    return h('div', { class: 'card intro' },
      h('h2', {}, title),
      h('p', { class: 'muted' }, text),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: onPick }, icon('file', 20), 'Choose PDF')));
  }

  // ═════════════════════════════════════════
  //  PDF → Images
  // ═════════════════════════════════════════
  (() => {
    const ui = {};
    let t = null; // { name, bytes, doc, n }
    let urls = [];

    function reset() {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls = [];
      if (t) { Pdf.close(t.doc); t = null; }
      ui.result.replaceChildren();
      ui.empty.hidden = false;
      ui.work.hidden = true;
    }

    async function load(f) {
      const target = await Busy.run('Opening PDF…', async () => {
        const { bytes } = await Pdf.readFile(f);
        const doc = await Pdf.open(bytes, { name: f.name });
        return { name: f.name, bytes, doc, n: doc.numPages };
      });
      if (!target) return;
      reset();
      t = target;
      ui.empty.hidden = true;
      ui.work.hidden = false;
      ui.file.replaceChildren(fileLine(t.name, t.bytes.length, t.n, pick));
      ui.pages.value = '';
      ui.pages.placeholder = `All ${t.n} pages, or e.g. 1-3, 5`;
    }

    const pick = async () => { const [f] = await Files.pick({ accept: PDF_ACCEPT }); if (f) load(f); };

    async function convert() {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls = [];
      ui.result.replaceChildren();
      let list;
      try {
        list = ui.pages.value.trim() ? parseRanges(ui.pages.value, t.n).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)) : Array.from({ length: t.n }, (_, i) => i + 1);
      } catch (e) { PP.reportError(e); return; }
      list = [...new Set(list)];

      const png = ui.format.value === 'png';
      const dpi = Number(ui.dpi.value);
      const items = await Busy.run('Converting…', async (p) => {
        const out = [];
        for (let i = 0; i < list.length; i++) {
          await p.tick(`Page ${list[i]} (${i + 1} of ${list.length})`, i, list.length);
          const canvas = await Pdf.render(t.doc, list[i], { scale: dpi / 72, maxPixels: 16e6 });
          const blob = await toBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.9);
          const thumb = await smallThumb(canvas);
          urls.push(thumb);
          canvas.width = canvas.height = 0;
          out.push({ name: `${stem(t.name)}-page-${pad(list[i], t.n)}.${png ? 'png' : 'jpg'}`, blob, thumb });
        }
        return out;
      });
      if (!items) return;
      ui.result.replaceChildren(resultCard(items, { title: `${items.length} image${items.length === 1 ? '' : 's'} ready`, folder: items.length > 1 ? `${stem(t.name)}-images` : '', zipName: `${stem(t.name)}-images.zip` }));
      ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    App.register({
      id: 'toimg',
      title: 'PDF to images',
      build(root) {
        ui.empty = emptyCard('Turn PDF pages into pictures', 'Choose a PDF and save its pages as JPG or PNG.', pick);
        ui.file = h('div');
        ui.format = h('select', {}, h('option', { value: 'jpg' }, 'JPG (smaller)'), h('option', { value: 'png' }, 'PNG (sharpest)'));
        ui.dpi = h('select', {}, h('option', { value: '100' }, 'Low · 100 dpi'), h('option', { value: '150', selected: true }, 'Standard · 150 dpi'), h('option', { value: '220' }, 'High · 220 dpi'));
        ui.pages = h('input', { type: 'text', autocomplete: 'off', spellcheck: false });
        ui.result = h('div');
        ui.work = h('div', { hidden: true },
          ui.file,
          h('div', { class: 'card settings' },
            h('label', {}, 'Format', ui.format),
            h('label', {}, 'Resolution', ui.dpi),
            h('label', { class: 'wide' }, 'Pages', ui.pages)),
          h('button', { class: 'btn primary big', type: 'button', onclick: convert }, 'Convert'),
          ui.result);
        root.append(ui.empty, ui.work);
      },
      enter(args) { if (args && args.file) load(args.file); },
      leave: reset,
    });
  })();

  // ═════════════════════════════════════════
  //  Extract images
  // ═════════════════════════════════════════
  (() => {
    const ui = {};
    let t = null;
    let found = []; // [{ id, name, blob, w, h, page, thumb, selected }]
    let nextId = 1;

    function reset() {
      found.forEach((f) => URL.revokeObjectURL(f.thumb));
      found = [];
      if (t) { Pdf.close(t.doc); t = null; }
      ui.result.replaceChildren();
      ui.empty.hidden = false;
      ui.work.hidden = true;
      ui.found.hidden = true;
    }

    // pdf.js hands back either a decoded bitmap or raw pixels (grayscale bits / RGB / RGBA).
    function toCanvas(img, ImageKind) {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      let alpha = false;
      if (img.bitmap) {
        ctx.drawImage(img.bitmap, 0, 0);
      } else {
        const { width: w, height: hgt, data, kind } = img;
        const rgba = new Uint8ClampedArray(w * hgt * 4);
        if (kind === ImageKind.RGBA_32BPP) {
          rgba.set(data.subarray(0, rgba.length));
          for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { alpha = true; break; }
        } else if (kind === ImageKind.RGB_24BPP) {
          for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) { rgba[j] = data[i]; rgba[j + 1] = data[i + 1]; rgba[j + 2] = data[i + 2]; rgba[j + 3] = 255; }
        } else { // 1 bit per pixel, rows padded to whole bytes
          const rowBytes = (w + 7) >> 3;
          for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
            const v = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
            const j = (y * w + x) * 4;
            rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
            rgba[j + 3] = 255;
          }
        }
        ctx.putImageData(new ImageData(rgba, w, hgt), 0, 0);
      }
      return { canvas, alpha };
    }

    async function getObject(page, id) {
      const store = id.startsWith('g_') ? page.commonObjs : page.objs;
      return new Promise((resolve) => store.get(id, resolve));
    }

    async function scan() {
      found.forEach((f) => URL.revokeObjectURL(f.thumb));
      found = [];
      ui.result.replaceChildren();
      const lib = await Pdf.js();
      const minSize = Number(ui.min.value);
      const fmt = ui.format.value;

      await Busy.run('Looking for pictures…', async (p) => {
        const seen = new Set();
        for (let n = 1; n <= t.n; n++) {
          await p.tick(`Page ${n} of ${t.n} · ${found.length} found`, n - 1, t.n);
          const page = await t.doc.getPage(n);
          const ops = await page.getOperatorList();
          for (let i = 0; i < ops.fnArray.length; i++) {
            const fn = ops.fnArray[i];
            let img;
            if (fn === lib.OPS.paintImageXObject) {
              const id = ops.argsArray[i][0];
              if (seen.has(id)) continue;
              seen.add(id);
              img = await getObject(page, id);
            } else if (fn === lib.OPS.paintInlineImageXObject) {
              img = ops.argsArray[i][0];
            } else continue;
            if (!img || !img.width || img.width < minSize || img.height < minSize) continue;

            const { canvas, alpha } = toCanvas(img, lib.ImageKind);
            const png = fmt === 'png' || (fmt === 'auto' && alpha);
            const blob = await toBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.92);
            const thumb = await smallThumb(canvas, 140);
            const w = canvas.width;
            const hgt = canvas.height;
            canvas.width = canvas.height = 0;
            found.push({ id: nextId++, name: `${stem(t.name)}-p${pad(n, t.n)}-img${found.length + 1}.${png ? 'png' : 'jpg'}`, blob, w, h: hgt, page: n, thumb, selected: true });
          }
          page.cleanup();
        }
      });
      ui.found.hidden = false;
      render();
      if (!found.length) toast('No pictures found. This PDF may be text only, or lower "Smallest picture" to include small ones.', { ms: 8000 });
    }

    function render() {
      const sel = found.filter((f) => f.selected);
      ui.count.textContent = found.length ? `${sel.length} of ${found.length} selected` : 'Nothing found';
      ui.get.disabled = sel.length === 0;
      ui.get.textContent = sel.length ? `Get ${sel.length} image${sel.length === 1 ? '' : 's'}` : 'Select images';
      ui.grid.replaceChildren(...found.map((f) => h('li', {
        class: `tile selectable${f.selected ? ' selected' : ''}`, role: 'button', tabIndex: 0, 'aria-pressed': String(f.selected), 'aria-label': f.name,
        onclick: () => { f.selected = !f.selected; ui.result.replaceChildren(); render(); },
      }, h('span', { class: 'frame' }, h('img', { src: f.thumb, alt: '' })),
      h('span', { class: 'num' }, `p${f.page}`), h('span', { class: 'tick' }, icon('check', 16)),
      h('div', { class: 'meta' }, `${f.w}×${f.h} · ${fmtSize(f.blob.size)}`))));
    }

    function setAll(v) { found.forEach((f) => { f.selected = v; }); ui.result.replaceChildren(); render(); }

    function get() {
      const items = found.filter((f) => f.selected).map((f) => ({ name: f.name, blob: f.blob, thumb: f.thumb }));
      ui.result.replaceChildren(resultCard(items, { title: `${items.length} image${items.length === 1 ? '' : 's'} ready`, folder: items.length > 1 ? `${stem(t.name)}-pictures` : '', zipName: `${stem(t.name)}-pictures.zip` }));
      ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function load(f) {
      const target = await Busy.run('Opening PDF…', async () => {
        const { bytes } = await Pdf.readFile(f);
        const doc = await Pdf.open(bytes, { name: f.name });
        return { name: f.name, bytes, doc, n: doc.numPages };
      });
      if (!target) return;
      reset();
      t = target;
      ui.empty.hidden = true;
      ui.work.hidden = false;
      ui.file.replaceChildren(fileLine(t.name, t.bytes.length, t.n, pick));
    }

    const pick = async () => { const [f] = await Files.pick({ accept: PDF_ACCEPT }); if (f) load(f); };

    App.register({
      id: 'extract',
      title: 'Extract pictures',
      build(root) {
        ui.empty = emptyCard('Pull the pictures out of a PDF', 'Finds every photo inside the PDF and saves them at their original quality.', pick);
        ui.file = h('div');
        ui.min = h('select', {}, h('option', { value: '32' }, 'Tiny (32 px)'), h('option', { value: '100', selected: true }, 'Normal (100 px)'), h('option', { value: '300' }, 'Large only (300 px)'));
        ui.format = h('select', {}, h('option', { value: 'auto' }, 'Automatic'), h('option', { value: 'jpg' }, 'JPG'), h('option', { value: 'png' }, 'PNG'));
        ui.count = h('strong');
        ui.grid = h('ol', { class: 'grid' });
        ui.get = h('button', { class: 'btn primary big', type: 'button', onclick: get }, '');
        ui.result = h('div');
        ui.found = h('div', { hidden: true },
          h('div', { class: 'bar' }, ui.count, h('span', { class: 'spacer' }),
            h('button', { class: 'btn small', type: 'button', onclick: () => setAll(true) }, 'All'),
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => setAll(false) }, 'None')),
          ui.grid, ui.get);
        ui.work = h('div', { hidden: true },
          ui.file,
          h('div', { class: 'card settings' },
            h('label', {}, 'Smallest picture', ui.min),
            h('label', {}, 'Format', ui.format)),
          h('button', { class: 'btn primary big', type: 'button', onclick: scan }, 'Find pictures'),
          ui.found, ui.result);
        root.append(ui.empty, ui.work);
      },
      enter(args) { if (args && args.file) load(args.file); },
      leave: reset,
    });
  })();
})();
