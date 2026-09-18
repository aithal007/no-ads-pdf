// Copies the third-party browser libraries from node_modules into www/lib (run via `npm run libs`).
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const out = 'www/lib';
rmSync(`${out}/pdfjs`, { recursive: true, force: true });
mkdirSync(`${out}/pdfjs`, { recursive: true });

cpSync('node_modules/pdf-lib/dist/pdf-lib.min.js', `${out}/pdf-lib.min.js`);
cpSync('node_modules/fflate/umd/index.js', `${out}/fflate.min.js`);
cpSync('node_modules/xlsx/dist/xlsx.full.min.js', `${out}/xlsx.full.min.js`); // Excel/CSV reader, loaded on demand
// Capacitor's JS API (registerPlugin etc.). On Android it extends the bare bridge the WebView injects.
cpSync('node_modules/@capacitor/core/dist/capacitor.js', `${out}/capacitor.js`);

const pj = 'node_modules/pdfjs-dist';
cpSync(`${pj}/legacy/build/pdf.min.mjs`, `${out}/pdfjs/pdf.min.mjs`);
cpSync(`${pj}/legacy/build/pdf.worker.min.mjs`, `${out}/pdfjs/pdf.worker.min.mjs`);
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) cpSync(`${pj}/${dir}`, `${out}/pdfjs/${dir}`, { recursive: true });
console.log('libs copied');
