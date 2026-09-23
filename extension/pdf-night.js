// Runs on PDFs Edge/Chrome shows in their own built-in viewer (a web page, a downloaded file, whatever) — not
// inside the Pocket PDF app. Floats a moon button over the page; clicking it inverts the whole page (same effect
// as night mode in the app: white becomes black, every colour flips to its opposite), since a content script
// can't reach inside the browser's own PDF renderer to redraw it, but a CSS filter over the whole tab affects
// everything that's painted on screen, including that renderer's output.
(() => {
  'use strict';
  if (window.top !== window) return; // only the page itself, not an <iframe> that happens to hold a PDF

  const ID = 'pocketpdf-night';
  let on = false;

  const style = document.createElement('style');
  style.textContent = `
    html.${ID}-on { filter: invert(1) !important; background: #fff !important; }
    #${ID}-btn {
      all: initial; position: fixed; z-index: 2147483647; right: 20px; bottom: 20px;
      width: 48px; height: 48px; border-radius: 50%; background: #0f766e;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,.4); font-size: 22px; line-height: 1;
      transition: transform .15s ease; font-family: system-ui, sans-serif;
    }
    #${ID}-btn:hover { transform: scale(1.08); }
    html.${ID}-on #${ID}-btn { filter: invert(1); } /* cancel the page's own invert so the button looks normal */
  `;
  (document.head || document.documentElement).appendChild(style);

  const btn = document.createElement('div');
  btn.id = `${ID}-btn`;
  btn.title = 'Night mode (Pocket PDF)';
  btn.textContent = '\u{1F319}'; // 🌙
  btn.addEventListener('click', () => {
    on = !on;
    document.documentElement.classList.toggle(`${ID}-on`, on);
  });

  // Chrome/Edge build the PDF viewer's page asynchronously; keep trying until <body> exists, and keep the
  // button in place if the viewer ever rebuilds its DOM.
  const place = () => {
    if (document.getElementById(`${ID}-btn`)) return;
    (document.body || document.documentElement).appendChild(btn);
  };
  place();
  new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
})();
