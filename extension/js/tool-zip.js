// Open ZIP: browse, preview, save single files or extract everything
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, App, fmtSize, baseName, stem, mimeFor, ext, $ } = PP;

  const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'xml', 'log', 'ini', 'yml', 'yaml', 'js', 'css', 'html', 'srt', 'py']);

  function previewKind(name) {
    const m = mimeFor(name);
    if (m === 'application/pdf') return 'pdf';
    if (/^(xlsx|xlsm|xls|xlsb|ods)$/.test(ext(name))) return 'sheet';
    if (m.startsWith('image/') && ext(name) !== 'avif') return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (TEXT_EXT.has(ext(name))) return 'text';
    return null;
  }

  const ui = {};
  const zip = { name: '', data: null, entries: [], selected: new Set(), filter: '' };
  let dlg;
  let previewUrl = null;
  let previewName = null;

  async function openZip(fileOrBlob, name) {
    try {
      const data = new Uint8Array(await fileOrBlob.arrayBuffer());
      const entries = [];
      // The filter runs per entry without decompressing anything; returning false skips extraction.
      fflate.unzipSync(data, {
        filter(f) {
          const noise = f.name.startsWith('__MACOSX/') || baseName(f.name) === '.DS_Store';
          if (!f.name.endsWith('/') && !noise) entries.push({ name: f.name, size: f.originalSize });
          return false;
        },
      });
      if (!entries.length) { toast('That ZIP is empty.'); return; }

      Object.assign(zip, { name, data, entries, selected: new Set(), filter: '' });
      ui.search.value = '';
      ui.name.textContent = name;
      const total = entries.reduce((s, e) => s + e.size, 0);
      ui.meta.textContent = `${entries.length} file${entries.length === 1 ? '' : 's'} · ${fmtSize(total)} unpacked`;
      ui.empty.hidden = true;
      ui.work.hidden = false;
      render();
    } catch (err) {
      console.error(err);
      toast("Couldn't open that file. It may be password-protected, damaged, or not a ZIP.", { ms: 8000 });
    }
  }

  const extract = (name) => fflate.unzipSync(zip.data, { filter: (f) => f.name === name })[name];
  const visible = () => {
    const q = zip.filter.trim().toLowerCase();
    return q ? zip.entries.filter((e) => e.name.toLowerCase().includes(q)) : zip.entries;
  };
  const asBlob = (name) => new Blob([extract(name)], { type: mimeFor(name) });

  function render() {
    const shown = visible();
    ui.none.hidden = shown.length > 0;
    ui.list.replaceChildren(...shown.map((entry) => {
      const kind = previewKind(entry.name);
      const slash = entry.name.lastIndexOf('/');
      return h('li', {},
        h('input', {
          type: 'checkbox', checked: zip.selected.has(entry.name), 'aria-label': `Select ${entry.name}`,
          onchange: (e) => { if (e.target.checked) zip.selected.add(entry.name); else zip.selected.delete(entry.name); updateSelection(); },
        }),
        h('span', { class: 'name' },
          h('span', { class: 'base' }, baseName(entry.name)),
          slash > 0 ? h('span', { class: 'dir' }, entry.name.slice(0, slash)) : null),
        h('span', { class: 'size' }, fmtSize(entry.size)),
        h('button', { type: 'button', class: 'btn', onclick: () => (kind ? preview(entry, kind) : saveOne(entry.name)) }, kind ? 'View' : 'Save'));
    }));
    updateSelection();
  }

  function updateSelection() {
    const shown = visible();
    const n = zip.selected.size;
    ui.actions.hidden = n === 0;
    ui.sel.textContent = `${n} selected`;
    const inView = shown.filter((e) => zip.selected.has(e.name)).length;
    ui.all.checked = shown.length > 0 && inView === shown.length;
    ui.all.indeterminate = inView > 0 && inView < shown.length;
  }

  async function saveOne(name) {
    try { await Files.saveWithToast(asBlob(name), baseName(name)); } catch (e) { PP.reportError(e); }
  }

  // Saves entries into Downloads/Pocket PDF/<zip name>/<original folders>.
  async function saveEntries(names) {
    const root = stem(zip.name);
    try {
      await Files.saveMany(names.map((n) => {
        const slash = n.lastIndexOf('/');
        return { name: baseName(n), blob: asBlob(n), folder: slash > 0 ? `${root}/${n.slice(0, slash)}` : root };
      }), { folder: root });
    } catch (e) { PP.reportError(e); }
  }

  async function shareEntries(names) {
    const used = new Set();
    const items = names.map((n) => {
      let out = baseName(n);
      for (let i = 2; used.has(out); i++) out = baseName(n).replace(/(\.[^.]*)?$/, ` (${i})$1`);
      used.add(out);
      return { name: out, blob: asBlob(n) };
    });
    await Files.share(items);
  }

  // ── preview ──
  function cleanupPreview() {
    $('#zip-preview-body').replaceChildren();
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  }

  function closePreview() { if (dlg.open) dlg.close(); cleanupPreview(); }

  function preview(entry, kind) {
    if (kind === 'pdf') { App.open('viewer', { blob: asBlob(entry.name), name: baseName(entry.name) }); return; }
    if (kind === 'sheet') { App.open('sheet', { blob: asBlob(entry.name), name: baseName(entry.name) }); return; }
    let data;
    try { data = extract(entry.name); } catch (_) { toast("Couldn't extract that file."); return; }

    closePreview();
    previewName = entry.name;
    $('#zip-preview-title').textContent = baseName(entry.name);
    const body = $('#zip-preview-body');
    if (kind === 'text') {
      const limit = 200 * 1024;
      body.append(h('pre', {}, new TextDecoder().decode(data.subarray(0, limit)) + (data.length > limit ? '\n\n… (cut short, use Save for the whole file)' : '')));
    } else {
      previewUrl = URL.createObjectURL(new Blob([data], { type: mimeFor(entry.name) }));
      body.append(kind === 'image'
        ? h('img', { src: previewUrl, alt: baseName(entry.name) })
        : h(kind, { src: previewUrl, controls: true }));
    }
    dlg.showModal();
  }

  const pick = async () => {
    const [f] = await Files.pick({ accept: '.zip,application/zip,application/x-zip-compressed' });
    if (f) openZip(f, f.name);
  };

  App.register({
    id: 'zip',
    title: 'Open ZIP',

    build(root) {
      dlg = h('dialog', { id: 'zip-preview' },
        h('div', { class: 'preview-head' },
          h('strong', { id: 'zip-preview-title' }),
          h('button', { class: 'btn small', type: 'button', onclick: () => saveOne(previewName) }, 'Save'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: closePreview }, 'Close')),
        h('div', { class: 'preview-body', id: 'zip-preview-body' }));
      dlg.addEventListener('close', () => { if (!dlg.open) cleanupPreview(); });
      document.body.append(dlg);

      ui.empty = h('div', { class: 'card intro' },
        h('h2', {}, 'Open a ZIP file'),
        h('p', { class: 'muted' }, "Look inside, view or save single files, or extract everything."),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: pick }, icon('zip', 20), 'Choose ZIP file')));

      ui.name = h('strong');
      ui.meta = h('span', { class: 'muted' });
      ui.search = h('input', { type: 'search', placeholder: 'Search files', autocomplete: 'off', oninput: (e) => { zip.filter = e.target.value; render(); } });
      ui.all = h('input', {
        type: 'checkbox',
        onchange: (e) => { for (const en of visible()) { if (e.target.checked) zip.selected.add(en.name); else zip.selected.delete(en.name); } render(); },
      });
      ui.list = h('ul', { class: 'files' });
      ui.none = h('p', { class: 'muted', hidden: true }, 'No files match.');
      ui.sel = h('span');
      ui.actions = h('div', { class: 'actionbar', hidden: true },
        ui.sel, h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', type: 'button', onclick: () => shareEntries([...zip.selected]) }, icon('share', 18), 'Share'),
        h('button', { class: 'btn small primary', type: 'button', onclick: () => saveEntries([...zip.selected]) }, icon('save', 18), 'Save'));

      ui.work = h('div', { hidden: true },
        h('div', { class: 'bar' },
          h('div', { class: 'grow', style: 'min-width:0;display:flex;flex-direction:column' }, ui.name, ui.meta),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn small ghost', type: 'button', onclick: pick }, 'Other file')),
        h('button', { class: 'btn primary', type: 'button', style: 'width:100%;margin-bottom:10px', onclick: () => saveEntries(zip.entries.map((e) => e.name)) }, icon('save', 18), 'Extract all'),
        h('div', { class: 'search-row' }, ui.search, h('label', { class: 'check' }, ui.all, 'All')),
        ui.list, ui.none, ui.actions);

      root.append(ui.empty, ui.work);
    },

    enter(args) { if (args && args.blob) openZip(args.blob, args.name || 'archive.zip'); },

    leave() {
      closePreview();
      Object.assign(zip, { data: null, entries: [], selected: new Set() });
      ui.list.replaceChildren();
      ui.empty.hidden = false;
      ui.work.hidden = true;
    },
  });
})();
