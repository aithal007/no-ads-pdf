// Merge PDFs
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, Pdf, resultCard, App, cleanName, fmtSize, stem } = PP;

  const PDF_ACCEPT = 'application/pdf,.pdf';
  let items = []; // { id, name, bytes, pages, thumb }
  let nextId = 1;
  let ui = {};

  async function describe(file) {
    const { bytes } = await Pdf.readFile(file);
    const doc = await Pdf.open(bytes, { name: file.name, ask: false });
    try {
      const canvas = await Pdf.render(doc, 1, { targetWidth: 120, maxPixels: 1e6 });
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.7));
      return { bytes, pages: doc.numPages, thumb: URL.createObjectURL(blob) };
    } finally {
      Pdf.close(doc);
    }
  }

  async function add(files) {
    if (!files.length) return;
    ui.result.replaceChildren();
    await Busy.run('Reading PDFs…', async (p) => {
      for (let i = 0; i < files.length; i++) {
        await p.tick(`${files[i].name}`, i, files.length);
        try {
          items.push({ id: nextId++, name: files[i].name, ...(await describe(files[i])) });
        } catch (e) {
          if (e instanceof PP.UserError) toast(e.message, { ms: 6000 }); else toast(`${files[i].name} couldn't be read.`);
        }
      }
    });
    render();
  }

  function rowBtn(label, ico, fn, { disabled = false, warn = false } = {}) {
    return h('button', { type: 'button', 'aria-label': label, title: label, disabled, class: warn ? 'warn' : '', onclick: fn }, icon(ico, 20));
  }

  function changed() { ui.result.replaceChildren(); render(); }

  function render() {
    const n = items.length;
    ui.empty.hidden = n > 0;
    ui.work.hidden = n === 0;
    const total = items.reduce((s, it) => s + it.pages, 0);
    ui.count.textContent = `${n} file${n === 1 ? '' : 's'} · ${total} pages`;
    ui.make.disabled = n < 2;
    ui.hint.hidden = n >= 2;
    ui.list.replaceChildren(...items.map((it, i) => h('li', {},
      h('img', { class: 'mini', src: it.thumb, alt: '' }),
      h('span', { class: 'grow' }, h('strong', {}, it.name), h('span', { class: 'muted' }, `${it.pages} page${it.pages === 1 ? '' : 's'} · ${fmtSize(it.bytes.length)}`)),
      h('span', { class: 'rowbtns' },
        rowBtn('Move up', 'up', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; changed(); }, { disabled: i === 0 }),
        rowBtn('Move down', 'down', () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; changed(); }, { disabled: i === n - 1 }),
        rowBtn('Remove', 'x', () => { URL.revokeObjectURL(it.thumb); items.splice(i, 1); changed(); }, { warn: true })))));
  }

  async function merge() {
    ui.result.replaceChildren();
    const blob = await Busy.run('Merging…', async (p) => {
      const out = await PDFLib.PDFDocument.create();
      out.setProducer('Pocket PDF');
      out.setCreator('Pocket PDF');
      for (let i = 0; i < items.length; i++) {
        await p.tick(`Adding ${items[i].name}`, i, items.length);
        const src = await Pdf.load(items[i].bytes, items[i].name);
        await Pdf.copyInto(out, src, src.getPageIndices());
      }
      await p.tick('Saving…');
      return new Blob([await out.save()], { type: 'application/pdf' });
    });
    if (!blob) return;
    const name = `${cleanName(ui.name.value, 'merged')}.pdf`;
    ui.result.replaceChildren(resultCard([{ name, blob }], { title: 'Merged', note: `${items.reduce((s, it) => s + it.pages, 0)} pages from ${items.length} files` }));
    ui.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const pick = async () => add(await Files.pick({ accept: PDF_ACCEPT, multiple: true }));

  function reset() {
    items.forEach((it) => URL.revokeObjectURL(it.thumb));
    items = [];
    ui.result.replaceChildren();
    ui.name.value = '';
    render();
  }

  App.register({
    id: 'merge',
    title: 'Merge PDFs',

    build(root) {
      ui.empty = h('div', { class: 'card intro' },
        h('h2', {}, 'Combine PDFs into one'),
        h('p', { class: 'muted' }, 'Choose two or more PDFs, put them in the order you want, then merge.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: pick }, icon('plus', 20), 'Choose PDFs')));

      ui.count = h('strong');
      ui.list = h('ul', { class: 'stack' });
      ui.name = h('input', { type: 'text', autocomplete: 'off', spellcheck: false, placeholder: 'merged' });
      ui.hint = h('p', { class: 'muted' }, 'Add at least one more PDF to merge.');
      ui.make = h('button', { class: 'btn primary big', type: 'button', onclick: merge }, 'Merge PDFs');
      ui.result = h('div');

      ui.work = h('div', { hidden: true },
        h('div', { class: 'bar' }, ui.count, h('span', { class: 'spacer' }),
          h('button', { class: 'btn small', type: 'button', onclick: pick }, icon('plus', 18), 'Add'),
          h('button', { class: 'btn small ghost danger', type: 'button', onclick: reset }, 'Clear')),
        ui.list,
        h('div', { class: 'card settings' }, h('label', { class: 'wide' }, 'File name', ui.name)),
        ui.hint, ui.make, ui.result);

      root.append(ui.empty, ui.work);
    },

    enter(args) { if (args && args.files) add(args.files); },
    leave: reset,
  });
})();
