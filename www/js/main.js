// Home screen + app start-up + Android hooks (back button, "Open with")
(() => {
  'use strict';
  const { h, icon, Busy, Files, App, $, toast } = PP;

  const TOOLS = [
    { id: 'viewer', ico: 'view', title: 'View PDF', desc: 'Read any PDF, zoom and jump to pages', accept: 'application/pdf,.pdf' },
    { id: 'sheet', ico: 'table', title: 'View Excel', desc: 'Open Excel and CSV files', accept: '.xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv' },
    { id: 'imgpdf', ico: 'image', title: 'Images to PDF', desc: 'Photos and scans into one PDF' },
    { id: 'merge', ico: 'merge', title: 'Merge PDFs', desc: 'Combine several PDFs into one' },
    { id: 'split', ico: 'split', title: 'Split & extract', desc: 'Pull out pages or cut a PDF apart' },
    { id: 'organize', ico: 'pages', title: 'Organize pages', desc: 'Reorder, rotate or delete pages' },
    { id: 'compress', ico: 'compress', title: 'Compress', desc: 'Make a PDF smaller' },
    { id: 'toimg', ico: 'toimg', title: 'PDF to images', desc: 'Save pages as JPG or PNG' },
    { id: 'extract', ico: 'extract', title: 'Extract pictures', desc: 'Get the photos out of a PDF' },
    { id: 'zip', ico: 'zip', title: 'Open ZIP', desc: 'Look inside and extract ZIP files' },
  ];

  App.register({
    id: 'home',
    title: 'Pocket PDF',
    build(root) {
      root.append(
        h('div', { class: 'home-grid' }, TOOLS.map((t) => h('button', {
          type: 'button', class: 'tool-card', 'data-tool': t.id,
          onclick: async () => {
            if (t.accept) {
              const [f] = await Files.pick({ accept: t.accept });
              if (f) App.open(t.id, { file: f });
            } else App.open(t.id);
          },
        },
        h('span', { class: 'ico-wrap' }, icon(t.ico, 24)),
        h('strong', {}, t.title),
        h('span', { class: 'd' }, t.desc)))),
        h('p', { class: 'muted home-note' }, 'Your files never leave this phone. This app has no internet access at all.'));
    },
  });

  $('#back').append(icon('back', 24));
  $('#back').addEventListener('click', () => App.back());
  $('#busy-cancel').addEventListener('click', () => Busy.cancel());
  App.open('home');

  // ── a file handed to us by another app (Files, WhatsApp, Gmail…) ──
  async function handleIncoming(url) {
    const got = await Busy.run('Opening…', () => Files.readUri(url));
    if (!got) return;
    const head = new Uint8Array(await got.blob.slice(0, 4).arrayBuffer());
    const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
    const isZip = head[0] === 0x50 && head[1] === 0x4b;                                          // PK
    const isOle = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;   // old .xls
    const isSheet = isOle || /\.(xlsx|xlsm|xlsb|xls|ods|csv|tsv)$/i.test(got.name);
    while (App.back()) { /* back to home */ }
    if (isPdf) App.open('viewer', { blob: got.blob, name: /\.pdf$/i.test(got.name) ? got.name : `${got.name}.pdf` });
    else if (isSheet) App.open('sheet', { blob: got.blob, name: got.name });
    else if (isZip) App.open('zip', { blob: got.blob, name: got.name });
    else toast("Pocket PDF can open PDF, Excel/CSV and ZIP files.");
  }

  if (PP.native) {
    const CapApp = window.Capacitor.registerPlugin('App');
    CapApp.addListener('backButton', () => {
      const open = document.querySelectorAll('dialog[open]');
      if (open.length) { open.forEach((d) => d.close()); return; }
      if (!$('#busy').hidden) { Busy.cancel(); return; }
      if (!App.back()) CapApp.exitApp();
    });
    CapApp.addListener('appUrlOpen', ({ url }) => handleIncoming(url));
    CapApp.getLaunchUrl().then((r) => { if (r && r.url) handleIncoming(r.url); }).catch(() => {});
  } else {
    // Desktop browser (development): drag & drop a PDF, ZIP or images anywhere.
    addEventListener('dragover', (e) => e.preventDefault());
    addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      while (App.back()) { /* home */ }
      if (files.length === 1 && /\.pdf$/i.test(files[0].name)) App.open('viewer', { file: files[0] });
      else if (files.length === 1 && /\.(xlsx|xlsm|xls|ods|csv)$/i.test(files[0].name)) App.open('sheet', { file: files[0] });
      else if (files.length === 1 && /\.zip$/i.test(files[0].name)) App.open('zip', { blob: files[0], name: files[0].name });
      else App.open('imgpdf', { files });
    });
  }
})();
