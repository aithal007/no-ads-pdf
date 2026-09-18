// Images → PDF
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, resultCard, App, cleanName, UserError, $ } = PP;
  const { buildPdf, layoutPage } = window.PdfKit;

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
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
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

  async function renderJpeg(file, rot, { maxDim, q }) {
    const canvas = drawImage(await loadImage(file), rot, maxDim);
    const { width: pxW, height: pxH } = canvas;
    const blob = await canvasToBlob(canvas, 'image/jpeg', q);
    canvas.width = canvas.height = 0; // release pixel memory early
    return { jpeg: new Uint8Array(await blob.arrayBuffer()), pxW, pxH };
  }

  async function makeThumb(file) {
    const canvas = drawImage(await loadImage(file), 0, 280);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.7);
    canvas.width = canvas.height = 0;
    return URL.createObjectURL(blob);
  }

  async function addImages(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name));
    if (!files.length) { toast('No images found in that selection.'); return; }
    ui.result.replaceChildren();
    const failed = [];
    await Busy.run('Loading images…', async (p) => {
      for (let i = 0; i < files.length; i++) {
        await p.tick(`Image ${i + 1} of ${files.length}`, i, files.length);
        try { items.push({ id: nextId++, file: files[i], thumb: await makeThumb(files[i]), rot: 0 }); } catch (_) { failed.push(files[i].name); }
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
      h('span', { class: 'frame' }, h('img', { src: it.thumb, alt: `Page ${i + 1}: ${it.file.name}`, style: `transform:rotate(${it.rot}deg)` })),
      h('span', { class: 'num' }, i + 1),
      h('div', { class: 'tools' },
        tileBtn('Move earlier', 'left', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; changed(); }, { disabled: i === 0 }),
        tileBtn('Rotate', 'rotate', () => { it.rot = (it.rot + 90) % 360; changed(); }),
        tileBtn('Move later', 'right', () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; changed(); }, { disabled: i === n - 1 }),
        tileBtn('Remove', 'x', () => { URL.revokeObjectURL(it.thumb); items.splice(i, 1); changed(); }, { warn: true }),
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
        const img = await renderJpeg(items[i].file, items[i].rot, preset);
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

  const pickImages = async () => addImages(await Files.pick({ accept: 'image/*', multiple: true }));
  const takePhoto = async () => addImages(await Files.pick({ accept: 'image/*', capture: 'environment' }));

  App.register({
    id: 'imgpdf',
    title: 'Images to PDF',

    build(root) {
      ui.empty = h('div', { class: 'card intro' },
        h('h2', {}, 'Photos and scans to PDF'),
        h('p', { class: 'muted' }, 'Pick pictures or take new ones, put them in order, get one PDF.'),
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
          h('button', { class: 'btn small ghost danger', type: 'button', onclick: () => { items.forEach((i) => URL.revokeObjectURL(i.thumb)); items = []; changed(); } }, 'Clear')),
        ui.grid,
        h('div', { class: 'card settings' },
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
      items.forEach((i) => URL.revokeObjectURL(i.thumb));
      items = [];
      ui.result.replaceChildren();
      ui.name.value = '';
      render();
    },
  });
})();
