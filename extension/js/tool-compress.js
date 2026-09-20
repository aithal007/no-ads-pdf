// Compress PDF
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, Pdf, resultCard, App, fmtSize, stem, UserError } = PP;
  const { buildPdf } = window.PdfKit;

  // "Keep text": re-encode the JPEG pictures inside the PDF smaller. Text/vector data is untouched.
  const LIGHT = {
    low: { maxDim: 2800, q: 0.85 },
    medium: { maxDim: 1800, q: 0.72 },
    high: { maxDim: 1200, q: 0.55 },
  };
  // "Maximum": every page becomes one JPEG picture (text can no longer be selected).
  const HEAVY = {
    low: { dpi: 150, q: 0.75 },
    medium: { dpi: 110, q: 0.65 },
    high: { dpi: 80, q: 0.55 },
  };
  const MIN_IMAGE_BYTES = 30 * 1024; // don't bother with tiny pictures

  const ui = {};
  let file = null; // { name, bytes }
  let mode = 'light';

  // Reads width/height/components from a JPEG's SOF marker.
  function jpegInfo(b) {
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }

  function isPlainRgbJpeg(dict) {
    const { PDFName, PDFArray, PDFNumber } = PDFLib;
    if (dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) return false;
    let f = dict.lookup(PDFName.of('Filter'));
    if (f instanceof PDFArray) f = f.size() === 1 ? f.lookup(0) : null;
    if (f !== PDFName.of('DCTDecode')) return false;
    for (const key of ['Decode', 'Mask', 'ImageMask']) if (dict.has(PDFName.of(key))) return false;
    const bpc = dict.lookup(PDFName.of('BitsPerComponent'));
    if (bpc instanceof PDFNumber && bpc.asNumber() !== 8) return false;
    const cs = dict.lookup(PDFName.of('ColorSpace'));
    if (cs === PDFName.of('DeviceRGB')) return true;
    return cs instanceof PDFArray && cs.size() > 0 && cs.lookup(0) === PDFName.of('ICCBased');
  }

  async function shrinkImages(doc, { maxDim, q }, p) {
    const { PDFName, PDFNumber, PDFRawStream } = PDFLib;
    const candidates = doc.context.enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((obj) => obj instanceof PDFRawStream && obj.contents.length >= MIN_IMAGE_BYTES && isPlainRgbJpeg(obj.dict));

    let changed = 0;
    for (let i = 0; i < candidates.length; i++) {
      await p.tick(`Shrinking picture ${i + 1} of ${candidates.length}`, i, candidates.length);
      const obj = candidates[i];
      const info = jpegInfo(obj.contents);
      if (!info || info.comps !== 3) continue;
      let bmp;
      try {
        bmp = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }), { imageOrientation: 'none' });
      } catch (_) { continue; }
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const hgt = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hgt;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, hgt);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, w, hgt);
      bmp.close();
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      canvas.width = canvas.height = 0;
      if (!blob || blob.size >= obj.contents.length * 0.9) continue; // not worth it
      obj.contents = new Uint8Array(await blob.arrayBuffer());
      obj.dict.set(PDFName.of('Width'), PDFNumber.of(w));
      obj.dict.set(PDFName.of('Height'), PDFNumber.of(hgt));
      obj.dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      obj.dict.delete(PDFName.of('DecodeParms'));
      changed++;
    }
    return { changed, total: candidates.length };
  }

  async function compressKeepText(level, p) {
    await p.tick('Reading PDF…');
    const doc = await Pdf.load(file.bytes, file.name);
    const stats = await shrinkImages(doc, LIGHT[level], p);
    await p.tick('Saving…');
    return { blob: new Blob([await doc.save({ useObjectStreams: true })], { type: 'application/pdf' }), stats };
  }

  async function compressToImages(level, p) {
    const { dpi, q } = HEAVY[level];
    const doc = await Pdf.open(file.bytes, { name: file.name, ask: false });
    try {
      const pages = [];
      for (let n = 1; n <= doc.numPages; n++) {
        await p.tick(`Page ${n} of ${doc.numPages}`, n - 1, doc.numPages);
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await Pdf.render(doc, n, { scale: dpi / 72, maxPixels: 10e6 });
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
        const pxW = canvas.width;
        const pxH = canvas.height;
        canvas.width = canvas.height = 0;
        pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), pxW, pxH, pageW: vp.width, pageH: vp.height, x: 0, y: 0, w: vp.width, h: vp.height });
      }
      await p.tick('Building PDF…');
      return { blob: buildPdf(pages), stats: null };
    } finally {
      Pdf.close(doc);
    }
  }

  async function run() {
    ui.result.replaceChildren();
    const level = ui.level.value;
    const out = await Busy.run('Compressing…', (p) => (mode === 'light' ? compressKeepText(level, p) : compressToImages(level, p)));
    if (!out) return;

    const before = file.bytes.length;
    const after = out.blob.size;
    if (after >= before) {
      toast(out.stats && out.stats.total === 0
        ? 'This PDF has no big pictures to shrink. Try "Maximum" if you still want it smaller.'
        : 'Already as small as it gets at this setting. Try a stronger level.', { ms: 8000 });
      return;
    }
    const pct = Math.round((1 - after / before) * 100);
    const card = resultCard([{ name: `${stem(file.name)}-compressed.pdf`, blob: out.blob }], {
      title: 'Compressed',
      note: !out.stats ? 'Every page is now a picture, so text can no longer be selected.'
        : out.stats.total === 0 ? 'This PDF has no big pictures, so only its structure was tidied. Try "Maximum" for a smaller file.'
          : `${out.stats.changed} of ${out.stats.total} pictures shrunk. Text is untouched.`,
    });
    card.querySelector('h2').after(h('p', { class: 'summary' }, `${fmtSize(before)} → ${fmtSize(after)} (${pct}% smaller)`));
    ui.result.replaceChildren(card);
    ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setMode(m) {
    mode = m;
    for (const [k, b] of Object.entries(ui.segs)) b.setAttribute('aria-pressed', String(k === m));
    ui.modeNote.textContent = m === 'light'
      ? 'Makes the pictures inside the PDF smaller. Text stays sharp and selectable. Best for scans and photo PDFs.'
      : 'Turns every page into a picture. Smallest files, but text can no longer be selected or searched.';
    ui.result.replaceChildren();
  }

  async function load(f) {
    const bytes = await Busy.run('Reading…', () => Pdf.readFile(f));
    if (!bytes) return;
    file = bytes;
    ui.empty.hidden = true;
    ui.work.hidden = false;
    ui.file.replaceChildren(h('div', { class: 'card file-line' }, icon('file', 26),
      h('div', { class: 'grow' }, h('strong', {}, f.name), h('span', { class: 'muted' }, fmtSize(bytes.size))),
      h('button', { class: 'btn small ghost', type: 'button', onclick: pick }, 'Change')));
    ui.result.replaceChildren();
  }

  const pick = async () => { const [f] = await Files.pick({ accept: 'application/pdf,.pdf' }); if (f) load(f); };

  App.register({
    id: 'compress',
    title: 'Compress PDF',
    build(root) {
      ui.empty = h('div', { class: 'card intro' },
        h('h2', {}, 'Make a PDF smaller'),
        h('p', { class: 'muted' }, 'Handy for uploads and email size limits.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: pick }, icon('file', 20), 'Choose PDF')));
      ui.file = h('div');
      ui.segs = {
        light: h('button', { type: 'button', onclick: () => setMode('light') }, 'Keep text'),
        heavy: h('button', { type: 'button', onclick: () => setMode('heavy') }, 'Maximum'),
      };
      ui.modeNote = h('p', { class: 'muted' });
      ui.level = h('select', {},
        h('option', { value: 'low' }, 'Low: best quality'),
        h('option', { value: 'medium', selected: true }, 'Medium: balanced'),
        h('option', { value: 'high' }, 'High: smallest file'));
      ui.result = h('div');
      ui.work = h('div', { hidden: true },
        ui.file,
        h('div', { class: 'card' },
          h('div', { class: 'seg' }, Object.values(ui.segs)),
          ui.modeNote,
          h('label', { class: 'field' }, 'Compression', ui.level)),
        h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Compress'),
        ui.result);
      root.append(ui.empty, ui.work);
    },
    enter(args) { setMode('light'); if (args && args.file) load(args.file); },
    leave() { file = null; ui.result.replaceChildren(); ui.empty.hidden = false; ui.work.hidden = true; },
  });
})();
