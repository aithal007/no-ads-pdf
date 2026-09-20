// Mirrors the web app (www/) into extension/, next to the extension-only files (manifest.json, background.js,
// icons/) which are hand-written and left alone. Run via `npm run build:extension` after changing www/, and before
// committing, so extension/ stays a working, load-unpacked-ready copy with no build step for anyone who clones it.
import { cpSync, rmSync } from 'node:fs';

const out = 'extension';
for (const name of ['index.html', 'css', 'js', 'lib']) {
  rmSync(`${out}/${name}`, { recursive: true, force: true });
  cpSync(`www/${name}`, `${out}/${name}`, { recursive: true });
}
console.log('extension/ synced from www/');
