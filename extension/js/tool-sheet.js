// Excel / CSV viewer (SheetJS, loaded only when this tool is opened)
(() => {
  'use strict';
  const { h, icon, toast, Busy, Files, App, UserError, ext, $ } = PP;

  const ACCEPT = '.xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
  const MAX_COLS = 200;          // wider than this is almost always formatting junk
  const CELLS_PER_CHUNK = 6000;  // rows are added in chunks so huge sheets stay responsive
  const MIN_ZOOM = 0.6;
  const MAX_ZOOM = 2.2;

  const ui = {};
  let X = null;                  // the SheetJS library
  let libPromise = null;
  let src = null;                // { blob, name }
  let sheets = [];               // [{ name, ws, rows, cols, widths }]
  let cur = null;                // the sheet being shown
  let shown = 0;                 // rows rendered so far
  let zoom = 1;
  let selected = null;

  function loadLib() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = h('script', { src: 'lib/xlsx.full.min.js' });
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { libPromise = null; reject(new UserError("Couldn't load the spreadsheet reader.")); };
        document.head.append(s);
      });
    }
    return libPromise;
  }

  const cellAt = (ws, r, c) => {
    const d = ws['!data'];
    if (d) { const row = d[r]; return row ? row[c] : undefined; }
    return ws[X.utils.encode_cell({ r, c })];
  };
  const textOf = (cell) => (cell ? (cell.w != null ? String(cell.w) : X.utils.format_cell(cell)) : '');

  async function parse(blob, name) {
    X = await loadLib();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let wb;
    try {
      if (/^(csv|tsv|txt)$/.test(ext(name))) {
        let text = new TextDecoder('utf-8').decode(bytes);
        if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes); // Excel's older CSV encoding
        wb = X.read(text, { type: 'string', dense: true });
      } else {
        // SheetJS quietly guesses at unknown data, so check the file's header first: real Excel/ODS files
        // are ZIPs ("PK") and old .xls files are OLE containers (D0 CF 11 E0), including password-protected ones.
        const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
        const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
        if (!zip && !ole) throw new UserError("That doesn't look like an Excel file. It may be damaged or have the wrong extension.");
        wb = X.read(bytes, { type: 'array', dense: true });
      }
    } catch (e) {
      if (e instanceof UserError) throw e;
      if (/password|encrypt/i.test(String(e && e.message))) throw new UserError('This file is password-protected, so it cannot be opened.');
      throw new UserError("That file couldn't be read. It may be damaged or not a spreadsheet.");
    }

    const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
    let names = wb.SheetNames.filter((_, i) => !(meta[i] && meta[i].Hidden));
    if (!names.length) names = wb.SheetNames;

    return names.map((n) => {
      const ws = wb.Sheets[n];
      const ref = ws['!ref'];
      const end = ref ? X.utils.decode_range(ref).e : { r: -1, c: -1 };
      const cols = Math.min(end.c + 1, MAX_COLS);
      const widths = Array.from({ length: cols }, (_, c) => {
        const w = (ws['!cols'] || [])[c];
        const px = w ? (w.wpx || (w.wch ? w.wch * 7 + 8 : 0)) : 0;
        return Math.min(360, Math.max(44, px || 92));
      });
      return { name: n, ws, rows: end.r + 1, cols, fullCols: end.c + 1, widths };
    });
  }

  // ── rendering ──
  function appendRows(count) {
    const { ws, rows, cols } = cur;
    const stop = Math.min(rows, shown + count);
    const frag = document.createDocumentFragment();
    for (let r = shown; r < stop; r++) {
      const tr = document.createElement('tr');
      const rn = document.createElement('th');
      rn.className = 'rn';
      rn.textContent = r + 1;
      tr.append(rn);
      for (let c = 0; c < cols; c++) {
        const cell = cellAt(ws, r, c);
        const td = document.createElement('td');
        if (cell) {
          td.textContent = textOf(cell);
          if (cell.t === 'n') td.className = 'n';
          else if (cell.t === 'b') td.className = 'b';
        }
        tr.append(td);
      }
      frag.append(tr);
    }
    ui.body.append(frag);
    shown = stop;
    updateInfo();
  }

  function updateInfo() {
    const fmt = (n) => n.toLocaleString();
    let msg = `${fmt(cur.rows)} row${cur.rows === 1 ? '' : 's'} × ${fmt(cur.fullCols)} column${cur.fullCols === 1 ? '' : 's'}`;
    if (cur.fullCols > MAX_COLS) msg += ` (first ${MAX_COLS} shown)`;
    if (shown < cur.rows) msg += ` · loaded ${fmt(shown)}, scroll for more`;
    ui.info.textContent = msg;
  }

  function showSheet(i) {
    cur = sheets[i];
    shown = 0;
    selected = null;
    ui.cellbar.textContent = 'Tap a cell to see its full value';
    ui.body.replaceChildren();
    ui.head.replaceChildren();
    ui.cols.replaceChildren();
    ui.empty.hidden = cur.rows > 0 && cur.cols > 0;

    if (cur.rows === 0 || cur.cols === 0) { ui.table.hidden = true; ui.info.textContent = ''; return; }
    ui.table.hidden = false;

    const total = 46 + cur.widths.reduce((a, b) => a + b, 0);
    ui.table.style.width = `${total}px`;
    ui.cols.append(h('col', { style: 'width:46px' }), ...cur.widths.map((w) => h('col', { style: `width:${w}px` })));
    ui.head.append(h('tr', {}, h('th', { class: 'rn corner' }), ...cur.widths.map((_, c) => h('th', {}, X.utils.encode_col(c)))));

    appendRows(Math.max(30, Math.floor(CELLS_PER_CHUNK / cur.cols)));
    ui.scroll.scrollTo(0, 0);
  }

  function maybeLoadMore() {
    if (!cur || shown >= cur.rows) return;
    const s = ui.scroll;
    if (s.scrollTop + s.clientHeight > s.scrollHeight - 900) appendRows(Math.max(30, Math.floor(CELLS_PER_CHUNK / cur.cols)));
  }

  function onCellTap(e) {
    const td = e.target.closest('td');
    if (!td) return;
    if (selected) selected.classList.remove('sel');
    selected = td;
    td.classList.add('sel');
    const r = td.parentElement.sectionRowIndex;
    const c = td.cellIndex - 1;
    const cell = cellAt(cur.ws, r, c);
    const ref = X.utils.encode_cell({ r, c });
    const value = textOf(cell);
    const formula = cell && cell.f ? `  =${cell.f}` : '';
    ui.cellbar.replaceChildren(h('strong', {}, ref), h('span', { class: 'cv' }, value === '' ? '(empty)' : value), formula ? h('span', { class: 'cf' }, formula) : null);
  }

  function setZoom(next) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    ui.table.style.zoom = zoom;
    ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    maybeLoadMore();
  }

  async function open(blob, name) {
    const result = await Busy.run('Opening spreadsheet…', async (p) => {
      await p.tick('Reading…');
      return parse(blob, name);
    });
    if (!result) { if (App.current === 'sheet') App.back(); return; }
    sheets = result;
    src = { blob, name };
    $('#title').textContent = name;
    ui.empty0.hidden = true;
    ui.wrap.hidden = false;

    ui.select.replaceChildren(...sheets.map((s, i) => h('option', { value: i }, s.name)));
    ui.select.hidden = sheets.length < 2;
    ui.count.hidden = sheets.length >= 2;
    ui.count.textContent = sheets[0].name;
    zoom = 1;
    setZoom(1);
    showSheet(0);
  }

  const pick = async () => { const [f] = await Files.pick({ accept: ACCEPT }); if (f) open(f, f.name); };

  function reset() {
    sheets = []; cur = null; src = null; selected = null; shown = 0;
    if (ui.body) { ui.body.replaceChildren(); ui.head.replaceChildren(); }
    ui.wrap.hidden = true;
    ui.empty0.hidden = false;
  }

  App.register({
    id: 'sheet',
    title: 'Excel viewer',

    build(root) {
      root.classList.add('viewer-screen');
      ui.empty0 = h('div', { class: 'card intro' },
        h('h2', {}, 'Open an Excel or CSV file'),
        h('p', { class: 'muted' }, 'Read spreadsheets (.xlsx, .xls, .csv, .ods) right here. They never leave your phone.'),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: pick }, icon('file', 20), 'Choose file')));

      ui.select = h('select', { class: 'sheet-select', 'aria-label': 'Sheet', onchange: (e) => showSheet(Number(e.target.value)) });
      ui.count = h('strong', { class: 'sheet-name' });
      ui.zoomLabel = h('span', { class: 'zl' }, '100%');
      ui.info = h('div', { class: 'sheet-info muted' });
      ui.empty = h('p', { class: 'muted', style: 'padding:24px;text-align:center', hidden: true }, 'This sheet is empty.');
      ui.cols = h('colgroup');
      ui.head = h('thead');
      ui.body = h('tbody');
      ui.body.addEventListener('click', onCellTap);
      ui.table = h('table', { class: 'grid-table' }, ui.cols, ui.head, ui.body);
      ui.scroll = h('div', { class: 'vscroll sheet-scroll' }, ui.table, ui.empty);
      ui.scroll.addEventListener('scroll', () => requestAnimationFrame(maybeLoadMore), { passive: true });
      ui.cellbar = h('div', { class: 'cellbar' }, 'Tap a cell to see its full value');

      ui.wrap = h('div', { class: 'vwrap', hidden: true },
        h('div', { class: 'vbar' },
          ui.select, ui.count,
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom / 1.2) }, icon('minus', 18)),
          ui.zoomLabel,
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom * 1.2) }, icon('plus', 18)),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Save a copy', onclick: () => src && Files.saveWithToast(src.blob, src.name) }, icon('save', 20)),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Share', onclick: () => src && Files.share([src]) }, icon('share', 20))),
        ui.info, ui.scroll, ui.cellbar);

      root.append(ui.empty0, ui.wrap);
    },

    async enter(args) {
      if (args && args.blob) await open(args.blob, args.name || 'spreadsheet.xlsx');
      else if (args && args.file) await open(args.file, args.file.name);
    },

    leave: reset,
  });
})();
