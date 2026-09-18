// Shared plumbing for every tool: DOM helper, screens, progress overlay, saving/sharing files, PDF helpers.
// Everything is exposed on window.PP so the tool files can stay small.
(() => {
  'use strict';

  const native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const PF = native ? window.Capacitor.registerPlugin('PocketFiles') : null;

  class UserError extends Error {}  // message is safe to show to the user
  class Cancelled extends Error {}

  const $ = (sel, root = document) => root.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  // ───────────── tiny DOM helper ─────────────

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v; // static markup only, never user data
      else if (k === 'style' && typeof v === 'string') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
    return el;
  }

  const ICONS = {
    back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    view: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    merge: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".5"/>',
    split: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
    pages: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    compress: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    toimg: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><circle cx="10" cy="13" r="1.5"/><path d="m16 18-3-3-4 3"/>',
    extract: '<rect x="3" y="3" width="13" height="13" rx="2"/><path d="m3 12 3.5-3.5a1.5 1.5 0 0 1 2 0L16 16"/><path d="M8 21h11a2 2 0 0 0 2-2V8"/>',
    zip: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    save: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>',
  };

  function icon(name, size = 22) {
    return h('span', {
      class: 'ico',
      html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`,
    });
  }

  // ───────────── small utilities ─────────────

  const MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    svg: 'image/svg+xml', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
    xml: 'application/xml', html: 'text/html', zip: 'application/zip',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xls: 'application/vnd.ms-excel', ods: 'application/vnd.oasis.opendocument.spreadsheet', tsv: 'text/tab-separated-values',
  };
  const ext = (name) => (name.match(/\.([^./]+)$/) || [, ''])[1].toLowerCase();
  const baseName = (path) => path.slice(path.lastIndexOf('/') + 1);
  const stem = (name) => baseName(name).replace(/\.[^./]*$/, '');
  const mimeFor = (name) => MIME[ext(name)] || 'application/octet-stream';
  const cleanName = (s, fallback) => (s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim() || fallback;

  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
  }

  // "1-3, 5, 8-" -> [[1,3],[5,5],[8,max]]; throws UserError on nonsense or out-of-range pages
  function parseRanges(text, max) {
    const parts = String(text).split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) throw new UserError('Type which pages you want, for example 1-3, 5, 8-10.');
    return parts.map((p) => {
      const m = p.match(/^(\d*)-(\d*)$/) || p.match(/^(\d+)$/);
      if (!m) throw new UserError(`"${p}" isn't a page or range. Use something like 1-3, 5, 8-10.`);
      const isSingle = m.length === 2;
      const from = m[1] === '' ? 1 : Number(m[1]);
      const to = isSingle ? from : (m[2] === '' ? max : Number(m[2]));
      if (from < 1 || to < from || to > max) throw new UserError(`"${p}" isn't valid. This PDF has ${max} page${max === 1 ? '' : 's'}.`);
      return [from, to];
    });
  }

  // ───────────── toast ─────────────

  let toastTimer;
  function toast(msg, { action, ms = 5000 } = {}) {
    const t = $('#toast');
    t.replaceChildren(h('span', {}, msg));
    if (action) {
      t.append(h('button', { type: 'button', class: 'toast-action', onclick: () => { t.hidden = true; action.fn(); } }, action.label));
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action ? Math.max(ms, 8000) : ms);
  }

  function reportError(e) {
    if (e instanceof UserError) { toast(e.message, { ms: 7000 }); return; }
    console.error(e);
    toast('Something went wrong. If it keeps happening, try a smaller file or lower quality.', { ms: 7000 });
  }

  // ───────────── busy overlay with progress + cancel ─────────────

  const Busy = (() => {
    let cancelled = false;
    return {
      cancel() { cancelled = true; },
      // fn receives p; call `await p.tick(text, done, total)` to update the bar and honour Cancel.
      async run(label, fn) {
        cancelled = false;
        const box = $('#busy');
        const bar = $('#busy-bar');
        $('#busy-text').textContent = label;
        bar.removeAttribute('value');
        box.hidden = false;
        const p = {
          async tick(text, done, total) {
            if (cancelled) throw new Cancelled();
            $('#busy-text').textContent = text;
            if (total) { bar.max = total; bar.value = done; } else bar.removeAttribute('value');
            await nextFrame();
            if (cancelled) throw new Cancelled();
          },
        };
        try {
          return await fn(p);
        } catch (e) {
          if (e instanceof Cancelled) toast('Cancelled'); else reportError(e);
          return undefined;
        } finally {
          box.hidden = true;
        }
      },
    };
  })();

  // ───────────── dialogs ─────────────

  function askPassword(name, wrong) {
    const dlg = $('#pwd');
    $('#pwd-title').textContent = `${name} is password-protected`;
    $('#pwd-error').hidden = !wrong;
    const input = $('#pwd-input');
    input.value = '';
    return new Promise((resolve) => {
      const form = $('#pwd-form');
      const done = (val) => { form.onsubmit = null; $('#pwd-cancel').onclick = null; dlg.onclose = null; if (dlg.open) dlg.close(); resolve(val); };
      form.onsubmit = (e) => { e.preventDefault(); done(input.value); };
      $('#pwd-cancel').onclick = () => done(null);
      dlg.onclose = () => done(null);
      dlg.showModal();
      input.focus();
    });
  }

  // ───────────── files: pick / save / share ─────────────

  const CHUNK = 768 * 1024;
  const toB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.slice(r.result.indexOf(',') + 1));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  const fromB64 = (b64) => fetch(`data:application/octet-stream;base64,${b64}`).then((r) => r.blob());

  async function nativeWrite(blob, name, target, folder) {
    const { id } = await PF.begin({ name, mime: blob.type || mimeFor(name), target, folder: folder || '' });
    try {
      for (let o = 0; o < blob.size; o += CHUNK) await PF.append({ id, data: await toB64(blob.slice(o, o + CHUNK)) });
      return await PF.finish({ id });
    } catch (e) {
      await PF.abort({ id }).catch(() => {});
      throw e;
    }
  }

  function webDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const Files = {
    native,

    pick({ accept = '', multiple = false, capture = '' } = {}) {
      return new Promise((resolve) => {
        const input = h('input', { type: 'file', accept, multiple, style: 'display:none' });
        if (capture) input.setAttribute('capture', capture);
        input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
        input.addEventListener('cancel', () => { resolve([]); input.remove(); });
        document.body.append(input);
        input.click();
      });
    },

    async bytes(file) { return new Uint8Array(await file.arrayBuffer()); },

    // Writes to Downloads/Pocket PDF[/folder]. Returns { name, uri } (uri only on Android).
    async save(blob, name, { folder = '' } = {}) {
      if (!native) { webDownload(blob, name); return { name }; }
      const r = await nativeWrite(blob, name, 'downloads', folder);
      return { name: r.name || name, uri: r.uri };
    },

    async saveWithToast(blob, name, opts = {}) {
      try {
        const r = await Files.save(blob, name, opts);
        const where = opts.folder ? `Downloads/Pocket PDF/${opts.folder}` : 'Downloads/Pocket PDF';
        toast(native ? `Saved to ${where}` : `Saved ${r.name}`, r.uri ? { action: { label: 'Open', fn: () => Files.openExternal(r.uri, blob.type || mimeFor(name)) } } : {});
      } catch (e) { reportError(e); }
    },

    // items: [{ blob, name, folder? }]
    async saveMany(items, { folder = '' } = {}) {
      await Busy.run('Saving…', async (p) => {
        for (let i = 0; i < items.length; i++) {
          await p.tick(`Saving ${i + 1} of ${items.length}`, i, items.length);
          await Files.save(items[i].blob, items[i].name, { folder: items[i].folder ?? folder });
          if (!native) await sleep(350); // let the browser accept each download
        }
        const where = folder ? `Downloads/Pocket PDF/${folder}` : 'Downloads/Pocket PDF';
        toast(native ? `Saved ${items.length} files to ${where}` : `Saved ${items.length} files`);
      });
    },

    async share(items) {
      try {
        if (native) {
          const uris = [];
          for (const it of items) uris.push((await nativeWrite(it.blob, it.name, 'cache')).uri);
          const mimes = new Set(items.map((it) => it.blob.type || mimeFor(it.name)));
          await PF.share({ uris, mime: mimes.size === 1 ? [...mimes][0] : '*/*' });
          return;
        }
        const files = items.map((it) => new File([it.blob], it.name, { type: it.blob.type }));
        if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ files });
        else for (const it of items) webDownload(it.blob, it.name);
      } catch (e) {
        if (e && e.name === 'AbortError') return;
        reportError(e);
      }
    },

    async openExternal(uri, mime) {
      try { await PF.open({ uri, mime }); } catch (e) { toast(String(e.message || e)); }
    },

    async zip(items) {
      const entries = {};
      const used = new Set();
      for (const it of items) {
        let name = it.name;
        for (let i = 2; used.has(name); i++) name = it.name.replace(/(\.[^.]*)?$/, ` (${i})$1`);
        used.add(name);
        entries[name] = [new Uint8Array(await it.blob.arrayBuffer()), { level: 0 }];
      }
      return new Blob([fflate.zipSync(entries)], { type: 'application/zip' });
    },

    // Reads a content:// URI handed to us by another app ("Open with").
    async readUri(uri) {
      const { id, name } = await PF.openRead({ uri });
      const parts = [];
      try {
        for (;;) {
          const { data, eof } = await PF.read({ id, length: CHUNK });
          if (data) parts.push(await fromB64(data));
          if (eof) break;
        }
      } finally {
        PF.closeRead({ id }).catch(() => {});
      }
      return { name: name || 'file', blob: new Blob(parts) };
    },
  };

  // ───────────── result card (Save / Share / View) ─────────────

  // items: [{ name, blob, thumb? }]
  function resultCard(items, { title = 'Done', note = '', folder = '', zipName = 'files.zip' } = {}) {
    const many = items.length > 1;
    const isPdf = (it) => ext(it.name) === 'pdf';

    const actions = (it) => h('div', { class: 'row' },
      isPdf(it) ? h('button', { class: 'btn small', type: 'button', onclick: () => PP.App.open('viewer', { blob: it.blob, name: it.name }) }, icon('view', 18), 'View') : null,
      h('button', { class: 'btn small primary', type: 'button', onclick: () => Files.saveWithToast(it.blob, it.name, { folder }) }, icon('save', 18), 'Save'),
      h('button', { class: 'btn small', type: 'button', onclick: () => Files.share([it]) }, icon('share', 18), 'Share'),
    );

    const list = h('ul', { class: 'outputs' }, items.map((it) => h('li', {},
      it.thumb ? h('img', { src: it.thumb, alt: '', class: 'out-thumb' }) : h('span', { class: 'out-ico' }, icon('file', 22)),
      h('span', { class: 'out-name' }, h('strong', {}, it.name), h('span', { class: 'muted' }, fmtSize(it.blob.size))),
      many ? actions(it) : null,
    )));

    return h('div', { class: 'card result' },
      h('h2', {}, title),
      note ? h('p', { class: 'muted' }, note) : null,
      list,
      many
        ? h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => Files.saveMany(items, { folder }) }, icon('save', 18), 'Save all'),
          h('button', { class: 'btn', type: 'button', onclick: async () => Files.saveWithToast(await Files.zip(items), zipName, { folder: '' }) }, 'Save as ZIP'),
          items.length <= 50 ? h('button', { class: 'btn', type: 'button', onclick: () => Files.share(items) }, icon('share', 18), 'Share all') : null,
        )
        : actions(items[0]),
    );
  }

  // ───────────── PDF helpers ─────────────

  const Pdf = {
    async readFile(file) {
      const bytes = await Files.bytes(file);
      return { name: file.name, bytes, size: bytes.length };
    },

    // pdf-lib document (for editing). Fails clearly on locked / broken files.
    async load(bytes, name = 'That file') {
      try {
        return await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      } catch (e) {
        if (e instanceof PDFLib.EncryptedPDFError) throw new UserError(`${name} is password-protected, so it can't be edited.`);
        throw new UserError(`${name} doesn't look like a valid PDF.`);
      }
    },

    // Copies pages (0-based indexes) from src into out, keeping size and rotation. rot(i) adds extra degrees.
    async copyInto(out, src, indexes, rot = () => 0) {
      const copied = await out.copyPages(src, indexes);
      copied.forEach((page, k) => {
        const orig = src.getPage(indexes[k]);
        const mb = orig.getMediaBox();
        page.setMediaBox(mb.x, mb.y, mb.width, mb.height);
        const cb = orig.getCropBox();
        page.setCropBox(cb.x, cb.y, cb.width, cb.height);
        page.setRotation(PDFLib.degrees(((orig.getRotation().angle + rot(indexes[k])) % 360 + 360) % 360));
        out.addPage(page);
      });
    },

    _js: null,
    js() {
      if (!Pdf._js) {
        const base = (p) => new URL(p, document.baseURI).href;
        Pdf._js = import(base('lib/pdfjs/pdf.min.mjs')).then((m) => {
          m.GlobalWorkerOptions.workerSrc = base('lib/pdfjs/pdf.worker.min.mjs');
          return m;
        });
      }
      return Pdf._js;
    },

    // pdf.js document (for rendering). ask=false rejects locked files instead of prompting.
    async open(bytes, { name = 'This PDF', ask = true } = {}) {
      const lib = await Pdf.js();
      const base = (p) => new URL(p, document.baseURI).href;
      const task = lib.getDocument({
        data: bytes.slice(), // pdf.js takes ownership of the buffer it's given
        cMapUrl: base('lib/pdfjs/cmaps/'), cMapPacked: true,
        standardFontDataUrl: base('lib/pdfjs/standard_fonts/'),
        wasmUrl: base('lib/pdfjs/wasm/'), iccUrl: base('lib/pdfjs/iccs/'),
        isEvalSupported: false,
      });
      return new Promise((resolve, reject) => {
        task.onPassword = async (update, reason) => {
          if (!ask) { reject(new UserError(`${name} is password-protected.`)); task.destroy(); return; }
          const pw = await askPassword(name, reason === 2);
          if (pw == null) { reject(new Cancelled()); task.destroy(); } else update(pw);
        };
        task.promise.then(resolve, () => reject(new UserError(`${name} couldn't be opened. It may be damaged.`)));
      });
    },

    // Releases a pdf.js document's worker memory. Safe to call twice.
    close(doc) { try { doc.loadingTask.destroy().catch(() => {}); } catch (_) { /* already closed */ } },

    // Draws one page into a canvas, capped at maxPixels. rotation = extra degrees on top of the page's own.
    async render(doc, pageNo, { scale = 1, targetWidth = 0, rotation = 0, maxPixels = 12e6, canvas = document.createElement('canvas') } = {}) {
      const page = await doc.getPage(pageNo);
      const rot = (page.rotate + rotation) % 360;
      let s = scale;
      if (targetWidth) s = targetWidth / page.getViewport({ scale: 1, rotation: rot }).width;
      let vp = page.getViewport({ scale: s, rotation: rot });
      if (vp.width * vp.height > maxPixels) vp = page.getViewport({ scale: s * Math.sqrt(maxPixels / (vp.width * vp.height)), rotation: rot });
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      await page.render({ canvas, viewport: vp, background: '#ffffff' }).promise;
      page.cleanup();
      return canvas;
    },
  };

  // Lazy page thumbnails: only pages near the screen get drawn, one at a time.
  const Thumbs = (() => {
    let chain = Promise.resolve();
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) e.target.__thumb.request();
    }, { rootMargin: '500px' });

    return {
      make(doc, pageNo, { width = 170 } = {}) {
        const canvas = h('canvas');
        const el = h('div', { class: 'thumb' }, canvas);
        const t = {
          el, rotation: 0, requested: false, dead: false,
          draw() {
            chain = chain.then(async () => {
              if (t.dead) return;
              try {
                await Pdf.render(doc, pageNo, { targetWidth: width * Math.min(devicePixelRatio || 1, 2), rotation: t.rotation, maxPixels: 2e6, canvas });
              } catch (_) { /* document closed while queued */ }
            });
          },
          request() { if (!t.requested) { t.requested = true; t.draw(); } },
          setRotation(deg) { t.rotation = deg; if (t.requested) t.draw(); },
          destroy() { t.dead = true; observer.unobserve(el); },
        };
        el.__thumb = t;
        observer.observe(el);
        return t;
      },
    };
  })();

  // ───────────── screens & navigation ─────────────

  const defs = {};
  const screens = {};
  const stack = ['home'];

  const App = {
    register(def) { defs[def.id] = def; },
    get defs() { return defs; },
    get current() { return stack[stack.length - 1]; },

    open(id, args) {
      const def = defs[id];
      if (!def) return;
      if (!screens[id]) {
        const root = h('section', { class: 'screen', hidden: true, 'data-screen': id });
        $('#screens').append(root);
        screens[id] = root;
        def.build(root);
      }
      if (id !== App.current) stack.push(id);
      App.show();
      if (def.enter) def.enter(args, screens[id]);
    },

    // Returns false when already at the home screen (caller may then exit the app).
    back() {
      if (stack.length <= 1) return false;
      const id = stack.pop();
      if (defs[id].leave) defs[id].leave();
      App.show();
      return true;
    },

    show() {
      const id = App.current;
      for (const [sid, root] of Object.entries(screens)) root.hidden = sid !== id;
      $('#toast').hidden = true;
      $('#title').textContent = defs[id].title;
      $('#back').hidden = id === 'home';
      $('#header-sub').hidden = id !== 'home';
      window.scrollTo(0, 0);
    },
  };

  window.PP = { native, PF, UserError, Cancelled, $, h, icon, sleep, nextFrame, ext, baseName, stem, mimeFor, cleanName, fmtSize, parseRanges, toast, reportError, Busy, Files, Pdf, Thumbs, resultCard, App };
})();
