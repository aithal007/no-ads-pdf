// Images → PDF
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, resultCard, App, cleanName, UserError, $ } = PP;
  const { buildPdf, layoutPage } = window.PdfKit;

  const THUMB_PX = 440; // tiles are ~200 CSS px wide, which is 500+ device pixels on a phone
  const VIEW_PX = 1600; // the full-screen photo view
  const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
  const QUALITY = {
    high: { maxDim: 3000, q: 0.9 },
    medium: { maxDim: 2000, q: 0.8 },
    small: { maxDim: 1400, q: 0.65 },
  };

  let items = [];
  let nextId = 1;
  let ui = {};

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url); // bitmap is already decoded in memory
    }
  }

  const canvasToBlob = (canvas, type, q) =>
    new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), type, q));

  // Draws the image rotated by `rot` degrees on a white canvas, longest side capped at maxDim.
  function drawImage(img, rot, maxDim) {
    const srcW = img.naturalWidth || img.width;   // <img> or canvas (a cropped page)
    const srcH = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const w = Math.max(1, Math.round(srcW * scale));
    const hgt = Math.max(1, Math.round(srcH * scale));
    const turned = rot % 180 !== 0;
    const canvas = document.createElement('canvas');
    canvas.width = turned ? hgt : w;
    canvas.height = turned ? w : hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // transparent PNGs would turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -hgt / 2, w, hgt);
    return canvas;
  }

  // The photo, cut down to the page and straightened when a crop (quad) is set.
  const pageSource = (img, quad, maxDim) => (quad ? DocScan.crop(img, quad, maxDim) : img);

  async function renderJpeg(file, rot, { maxDim, q }, quad) {
    const img = await loadImage(file);
    const canvas = drawImage(pageSource(img, quad, maxDim), rot, maxDim);
    const { width: pxW, height: pxH } = canvas;
    const blob = await canvasToBlob(canvas, 'image/jpeg', q);
    canvas.width = canvas.height = 0; // release pixel memory early
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), pxW, pxH };
  }

  // Big picture for the full-screen view: the page as it will appear in the PDF, or the whole photo (`whole`).
  // Cached on the item; dropBig() forgets it when the crop or rotation changes.
  async function bigOf(item, whole) {
    const key = whole && item.quad ? 'bigWhole' : 'big';
    if (item[key]) return item[key];
    const img = await loadImage(item.file);
    const canvas = drawImage(pageSource(img, key === 'big' ? item.quad : null, VIEW_PX), item.rot, VIEW_PX);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    canvas.width = canvas.height = 0;
    if (!item[key]) item[key] = URL.createObjectURL(blob);
    return item[key];
  }

  function dropBig(item) {
    for (const k of ['big', 'bigWhole']) if (item[k]) { URL.revokeObjectURL(item[k]); item[k] = null; }
  }

  function forget(item) { URL.revokeObjectURL(item.thumb); dropBig(item); }

  async function thumbOf(img, quad) {
    const canvas = drawImage(pageSource(img, quad, THUMB_PX), 0, THUMB_PX);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.7);
    canvas.width = canvas.height = 0;
    return URL.createObjectURL(blob);
  }

  // Looks for the sheet of paper in a photo. Returns its four corners, or null when the photo is already just a page.
  function findPage(img) {
    try {
      const found = DocScan.detect(img);
      return found && !DocScan.isWholePhoto(found.quad) ? found.quad : null;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async function prepare(file) {
    const img = await loadImage(file);
    const quad = autoCrop ? findPage(img) : null;
    return { thumb: await thumbOf(img, quad), quad };
  }

  async function addImages(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name));
    if (!files.length) { toast('No images found in that selection.'); return; }
    ui.result.replaceChildren();
    const failed = [];
    await Busy.run('Loading images…', async (p) => {
      for (let i = 0; i < files.length; i++) {
        await p.tick(`Image ${i + 1} of ${files.length}`, i, files.length);
        try { items.push({ id: nextId++, file: files[i], rot: 0, ...(await prepare(files[i])) }); } catch (_) { failed.push(files[i].name); }
      }
    });
    render();
    if (failed.length) toast(`Couldn't read: ${failed.join(', ')}. This phone may not support that image type.`, { ms: 8000 });
  }

  function tileBtn(label, ico, fn, { disabled = false, warn = false } = {}) {
    return h('button', { type: 'button', 'aria-label': label, title: label, disabled, class: warn ? 'warn' : '', onclick: fn }, icon(ico, 20));
  }

  function changed() { ui.result.replaceChildren(); render(); }

  function render() {
    const n = items.length;
    ui.empty.hidden = n > 0;
    ui.work.hidden = n === 0;
    ui.count.textContent = `${n} image${n === 1 ? '' : 's'}`;
    ui.grid.replaceChildren(...items.map((it, i) => h('li', { class: 'tile' },
      h('span', {
        class: 'frame tappable', role: 'button', tabindex: 0, 'aria-label': `Open page ${i + 1}`,
        onclick: () => openViewer(i),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(i); } },
      }, h('img', { src: it.thumb, alt: `Page ${i + 1}: ${it.file.name}`, style: `transform:rotate(${it.rot}deg)` })),
      h('span', { class: 'num' }, i + 1),
      it.quad ? h('span', { class: 'crop-badge' }, 'Cropped') : null,
      h('div', { class: 'tools' },
        tileBtn('Move earlier', 'left', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; changed(); }, { disabled: i === 0 }),
        tileBtn('Crop and straighten', 'crop', () => openEditor(it)),
        tileBtn('Rotate', 'rotate', () => { it.rot = (it.rot + 90) % 360; dropBig(it); changed(); }),
        tileBtn('Move later', 'right', () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; changed(); }, { disabled: i === n - 1 }),
        tileBtn('Remove', 'x', () => { forget(it); items.splice(i, 1); changed(); }, { warn: true }),
      ))));
  }

  const stamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `images-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  };

  async function create() {
    if (!items.length) return;
    ui.result.replaceChildren();
    const out = await Busy.run('Creating PDF…', async (p) => {
      const preset = QUALITY[ui.quality.value];
      const size = ui.size.value;
      const margin = Number(ui.margin.value);
      const pages = [];
      for (let i = 0; i < items.length; i++) {
        await p.tick(`Image ${i + 1} of ${items.length}`, i, items.length);
        const img = await renderJpeg(items[i].file, items[i].rot, preset, items[i].quad);
        pages.push({ ...img, ...layoutPage(img.pxW, img.pxH, size, margin) });
      }
      await p.tick('Building PDF…');
      return { blob: buildPdf(pages), count: pages.length };
    });
    if (!out) return;
    const name = `${cleanName(ui.name.value, stamp())}.pdf`;
    ui.result.replaceChildren(resultCard([{ name, blob: out.blob }], { title: 'PDF ready', note: `${out.count} page${out.count === 1 ? '' : 's'}` }));
    ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── auto-crop setting (remembered) ──
  let autoCrop = true;
  try { autoCrop = localStorage.getItem('autocrop') !== 'off'; } catch (_) { /* storage may be blocked */ }
  const autoBoxes = [];
  function autoSwitch() {
    const box = h('input', {
      type: 'checkbox', checked: autoCrop,
      onchange: (e) => {
        autoCrop = e.target.checked;
        try { localStorage.setItem('autocrop', autoCrop ? 'on' : 'off'); } catch (_) { /* ignore */ }
        autoBoxes.forEach((b) => { b.checked = autoCrop; });
      },
    });
    autoBoxes.push(box);
    return h('label', { class: 'check auto-crop' }, box,
      h('span', {}, h('strong', {}, 'Auto-crop pages'), h('span', { class: 'muted' }, ' Finds the paper in each photo, cuts away the background and straightens it.')));
  }

  // ── crop editor: drag the four corners ──
  const SVG = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const wholeQuad = () => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const insetQuad = () => [{ x: 0.06, y: 0.06 }, { x: 0.94, y: 0.06 }, { x: 0.94, y: 0.94 }, { x: 0.06, y: 0.94 }];
  let ed = null;

  function buildEditor() {
    const canvas = h('canvas');
    const svg = svgEl('svg');
    svg.style.touchAction = 'none';
    const shade = svgEl('path', { fill: 'rgba(0,0,0,.5)', 'fill-rule': 'evenodd' });
    const outline = svgEl('polygon', { fill: 'none', stroke: '#2dd4bf', 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
    svg.append(shade, outline);
    const grips = [0, 1, 2, 3].map(() => {
      const g = svgEl('g', { style: 'cursor:grab' });
      g.append(svgEl('circle', { r: 30, fill: 'transparent' }), svgEl('circle', { r: 12, fill: '#2dd4bf', stroke: '#fff', 'stroke-width': 3 }));
      svg.append(g);
      return g;
    });
    const stage = h('div', { class: 'crop-stage' }, canvas, svg);
    const dlg = h('dialog', { class: 'crop-dialog' },
      h('div', { class: 'crop-head' },
        h('strong', {}, 'Crop and straighten'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => dlg.close() }, 'Cancel'),
        h('button', { class: 'btn small primary', type: 'button', onclick: () => finishEditor() }, 'Done')),
      h('div', { class: 'crop-body' }, stage),
      h('p', { class: 'muted crop-hint' }, 'Drag the four dots onto the corners of the page.'),
      h('div', { class: 'crop-foot' },
        h('button', { class: 'btn', type: 'button', onclick: () => autoDetect(true) }, icon('wand', 18), 'Find page'),
        h('button', { class: 'btn', type: 'button', onclick: () => { ed.quad = wholeQuad(); redrawEditor(); } }, 'Whole photo')));
    document.body.append(dlg);
    dlg.addEventListener('close', () => { ed.img = null; });

    let active = -1;
    grips.forEach((g, i) => {
      g.addEventListener('pointerdown', (e) => { active = i; g.setPointerCapture(e.pointerId); e.preventDefault(); });
      g.addEventListener('pointermove', (e) => {
        if (active !== i) return;
        const r = svg.getBoundingClientRect();
        ed.quad[i] = { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
        redrawEditor();
      });
      const stop = () => { if (active === i) active = -1; };
      g.addEventListener('pointerup', stop);
      g.addEventListener('pointercancel', stop);
    });
    ed = { dlg, canvas, svg, shade, outline, grips, stage, quad: wholeQuad(), img: null, item: null, w: 0, h: 0 };
  }

  function redrawEditor() {
    const { w, h: hgt, quad } = ed;
    const P = quad.map((p) => [p.x * w, p.y * hgt]);
    ed.outline.setAttribute('points', P.map((p) => p.join(',')).join(' '));
    ed.shade.setAttribute('d', `M0 0H${w}V${hgt}H0Z M${P.map((p) => p.join(' ')).join(' L')}Z`);
    ed.grips.forEach((g, i) => g.setAttribute('transform', `translate(${P[i][0]} ${P[i][1]})`));
  }

  function autoDetect(loud) {
    const quad = ed.img ? findPage(ed.img) : null;
    if (quad) { ed.quad = quad; redrawEditor(); } else if (loud) toast("Couldn't find the page edges. Drag the dots onto the corners.");
    return !!quad;
  }

  async function openEditor(item) {
    ensureDialogs();
    ed.item = item;
    const img = await Busy.run('Opening…', () => loadImage(item.file));
    if (!img) return;
    ed.img = img;
    ed.dlg.showModal();
    const body = ed.dlg.querySelector('.crop-body');
    const ratio = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
    const availW = body.clientWidth - 24;
    const availH = body.clientHeight - 24;
    const w = Math.round(Math.min(availW, availH * ratio));
    const hgt = Math.round(w / ratio);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ed.w = w;
    ed.h = hgt;
    ed.canvas.width = Math.round(w * dpr);
    ed.canvas.height = Math.round(hgt * dpr);
    ed.canvas.style.width = `${w}px`;
    ed.canvas.style.height = `${hgt}px`;
    ed.svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
    ed.svg.setAttribute('width', w);
    ed.svg.setAttribute('height', hgt);
    ed.stage.style.width = `${w}px`;
    ed.stage.style.height = `${hgt}px`;
    const ctx = ed.canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, ed.canvas.width, ed.canvas.height);

    ed.quad = item.quad ? item.quad.map((p) => ({ ...p })) : null;
    if (!ed.quad) ed.quad = findPage(img) || insetQuad();
    redrawEditor();
  }

  async function finishEditor() {
    if (!DocScan.isSensible(ed.quad)) { toast("The four dots need to form a page shape. Move them so they don't cross over.", { ms: 6000 }); return; }
    const item = ed.item;
    const quad = DocScan.isWholePhoto(ed.quad) ? null : ed.quad.map((p) => ({ ...p }));
    const img = ed.img;
    ed.dlg.close();
    const thumb = await Busy.run('Updating…', () => thumbOf(img, quad));
    if (!thumb) return;
    URL.revokeObjectURL(item.thumb);
    dropBig(item);
    item.thumb = thumb;
    item.quad = quad;
    changed();
    if (pv && pv.dlg.open) buildSlides(items.indexOf(item));
  }


  // ── full-screen photo view: swipe between pages, crop, rotate, save, remove ──
  let pv = null;

  function ensureDialogs() {
    if (!pv) buildViewer(); // first, so the crop editor (built next) sits above it
    if (!ed) buildEditor();
  }

  function buildViewer() {
    const count = h('strong', { class: 'pv-count' });
    const wholeBtn = h('button', { class: 'btn small ghost', type: 'button', onclick: () => { pv.whole = !pv.whole; buildSlides(pv.index); } });
    const track = h('div', { class: 'pv-track' });
    const prev = h('button', { class: 'pv-nav prev', type: 'button', 'aria-label': 'Previous page', onclick: () => goTo(pv.index - 1) }, icon('left', 28));
    const next = h('button', { class: 'pv-nav next', type: 'button', 'aria-label': 'Next page', onclick: () => goTo(pv.index + 1) }, icon('right', 28));
    const act = (label, ico, fn, cls = '') => h('button', { type: 'button', class: cls, onclick: fn }, icon(ico, 22), h('span', {}, label));
    const dlg = h('dialog', { class: 'photo-dialog' },
      h('div', { class: 'pv-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('back', 24)),
        count, wholeBtn),
      h('div', { class: 'pv-stage' }, track, prev, next),
      h('div', { class: 'pv-bar' },
        act('Crop', 'crop', () => { const it = items[pv.index]; if (it) openEditor(it); }),
        act('Rotate', 'rotate', () => { const it = items[pv.index]; if (!it) return; it.rot = (it.rot + 90) % 360; dropBig(it); changed(); buildSlides(pv.index); }),
        act('Save', 'save', () => savePhoto()),
        act('Remove', 'trash', () => removeCurrent(), 'warn')));
    document.body.append(dlg);
    pv = { dlg, track, count, wholeBtn, prev, next, index: 0, whole: false, filling: 0 };

    let settle;
    track.addEventListener('scroll', () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const i = Math.min(items.length - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
        if (i !== pv.index) { pv.index = i; syncBar(); }
        fillAround(i);
      }, 60);
    }, { passive: true });
    dlg.addEventListener('close', () => { pv.filling++; });
  }

  function syncBar() {
    const n = items.length;
    const it = items[pv.index];
    pv.count.textContent = n ? `${pv.index + 1} / ${n}` : '';
    pv.prev.hidden = pv.index <= 0;
    pv.next.hidden = pv.index >= n - 1;
    pv.wholeBtn.hidden = !(it && it.quad);
    pv.wholeBtn.textContent = pv.whole ? 'Show cropped page' : 'Show full photo';
  }

  function goTo(i) {
    if (i < 0 || i >= items.length) return;
    pv.track.scrollTo({ left: i * pv.track.clientWidth, behavior: 'smooth' });
  }

  // one slide per photo; the pictures are only made for the page on screen and its neighbours
  function buildSlides(index) {
    const { track } = pv;
    pv.index = Math.min(items.length - 1, Math.max(0, index));
    track.style.scrollSnapType = 'none';
    track.replaceChildren(...items.map((it, i) => {
      const img = h('img', { alt: `Page ${i + 1}`, draggable: false });
      const ready = it[pv.whole && it.quad ? 'bigWhole' : 'big'];
      if (ready) img.src = ready;
      return h('div', { class: 'pv-slide' }, img, ready ? null : h('span', { class: 'pv-wait' }, 'Loading…'));
    }));
    track.scrollLeft = pv.index * track.clientWidth;
    track.style.scrollSnapType = '';
    syncBar();
    fillAround(pv.index);
  }

  async function fillAround(i) {
    const token = ++pv.filling;
    for (const j of [i, i + 1, i - 1]) {
      const it = items[j];
      const slide = pv.track.children[j];
      if (!it || !slide || slide.querySelector('img').getAttribute('src')) continue;
      try {
        const url = await bigOf(it, pv.whole);
        if (token !== pv.filling || !pv.dlg.open) return;
        const now = pv.track.children[j];
        if (now && items[j] === it) { now.querySelector('img').src = url; const w = now.querySelector('.pv-wait'); if (w) w.remove(); }
      } catch (e) {
        console.error(e);
        const w = slide.querySelector('.pv-wait');
        if (w) w.textContent = 'This photo could not be opened';
      }
    }
  }

  function openViewer(i) {
    ensureDialogs();
    pv.whole = false;
    pv.dlg.showModal();
    buildSlides(i);
  }

  function removeCurrent() {
    const it = items[pv.index];
    if (!it) return;
    forget(it);
    items.splice(pv.index, 1);
    changed();
    if (!items.length) { pv.dlg.close(); return; }
    buildSlides(pv.index);
  }

  async function savePhoto() {
    const it = items[pv.index];
    if (!it) return;
    const whole = pv.whole;
    const out = await Busy.run('Saving…', async () => {
      const { jpeg } = await renderJpeg(it.file, it.rot, QUALITY.high, whole ? null : it.quad);
      return new Blob([jpeg], { type: 'image/jpeg' });
    });
    if (!out) return;
    const base = cleanName((it.file.name || '').replace(/\.[^.]+$/, ''), `page-${pv.index + 1}`);
    await Files.saveWithToast(out, `${base}${it.quad && !whole ? '-page' : ''}.jpg`);
  }

  const pickImages = async () => addImages(await Files.pick({ accept: 'image/*', multiple: true }));
  const takePhoto = async () => addImages(await Files.pick({ accept: 'image/*', capture: 'environment' }));

  App.register({
    id: 'imgpdf',
    title: 'Images to PDF',

    build(root) {
      ui.empty = h('div', { class: 'card intro' },
        h('h2', {}, 'Photos and scans to PDF'),
        h('p', { class: 'muted' }, 'Pick pictures or take new ones, put them in order, get one PDF.'),
        autoSwitch(),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: pickImages }, icon('image', 20), 'Choose images'),
          h('button', { class: 'btn', type: 'button', onclick: takePhoto }, icon('camera', 20), 'Take photo')));

      ui.count = h('strong');
      ui.grid = h('ol', { class: 'grid' });
      ui.size = h('select', {}, h('option', { value: 'a4' }, 'A4'), h('option', { value: 'letter' }, 'Letter'), h('option', { value: 'fit' }, 'Same as image'));
      ui.margin = h('select', {}, h('option', { value: '0' }, 'None'), h('option', { value: '18' }, 'Small'), h('option', { value: '36' }, 'Large'));
      ui.quality = h('select', {}, h('option', { value: 'high' }, 'High (big file)'), h('option', { value: 'medium', selected: true }, 'Medium'), h('option', { value: 'small' }, 'Small file'));
      ui.name = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, placeholder: stamp() });
      ui.result = h('div');

      ui.work = h('div', { hidden: true },
        h('div', { class: 'bar' }, ui.count, h('span', { class: 'spacer' }),
          h('button', { class: 'btn small', type: 'button', onclick: pickImages }, icon('plus', 18), 'Add'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: takePhoto }, icon('camera', 18)),
          h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => { items.forEach(forget); items = []; changed(); } }, 'Clear')),
        ui.grid,
        h('div', { class: 'card settings' },
          h('div', { class: 'wide' }, autoSwitch()),
          h('label', {}, 'Page size', ui.size),
          h('label', {}, 'Margin', ui.margin),
          h('label', {}, 'Quality', ui.quality),
          h('label', { class: 'wide' }, 'File name', ui.name)),
        h('button', { class: 'btn primary big', type: 'button', onclick: create }, 'Create PDF'),
        ui.result);

      root.append(ui.empty, ui.work);
    },

    enter(args) { if (args && args.files) addImages(args.files); },

    leave() {
      if (pv && pv.dlg.open) pv.dlg.close();
      items.forEach(forget);
      items = [];
      ui.result.replaceChildren();
      ui.name.value = '';
      render();
    },
  });
})();
