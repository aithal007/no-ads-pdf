// Minimal PDF writer: one JPEG image per page, no dependencies.
// Exposes window.PdfKit = { buildPdf, layoutPage }.
(function (root) {
  'use strict';

  const enc = new TextEncoder();
  const fmt = (n) => String(Math.round(n * 100) / 100);

  const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
  const FIT_PT_PER_PX = 72 / 150; // "fit to image" pages assume 150 dpi

  // Works out the page box and where the image sits on it (all values in PDF points, origin bottom-left).
  function layoutPage(pxW, pxH, size, margin) {
    if (size === 'fit') {
      const w = pxW * FIT_PT_PER_PX;
      const h = pxH * FIT_PT_PER_PX;
      return { pageW: w + 2 * margin, pageH: h + 2 * margin, x: margin, y: margin, w, h };
    }
    let [pageW, pageH] = PAGE_SIZES[size] || PAGE_SIZES.a4;
    if (pxW > pxH) [pageW, pageH] = [pageH, pageW]; // landscape image -> landscape page
    const scale = Math.min((pageW - 2 * margin) / pxW, (pageH - 2 * margin) / pxH);
    const w = pxW * scale;
    const h = pxH * scale;
    return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
  }

  // pages: [{ jpeg: Uint8Array, pxW, pxH, pageW, pageH, x, y, w, h }]  ->  Blob (application/pdf)
  function buildPdf(pages) {
    const parts = [];
    const offsets = [];
    let pos = 0;

    const push = (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      parts.push(bytes);
      pos += bytes.length;
    };
    const begin = (id) => { offsets[id] = pos; push(`${id} 0 obj\n`); };
    const end = () => push('\nendobj\n');

    // Object ids: 1 catalog, 2 page tree, then (page, content, image) per page.
    const pageId = (i) => 3 + 3 * i;
    const count = pages.length;
    const size = 3 * count + 3;

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    begin(1); push('<< /Type /Catalog /Pages 2 0 R >>'); end();
    begin(2);
    push(`<< /Type /Pages /Count ${count} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`);
    end();

    pages.forEach((p, i) => {
      const pid = pageId(i);
      const cid = pid + 1;
      const iid = pid + 2;

      begin(pid);
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(p.pageW)} ${fmt(p.pageH)}] ` +
        `/Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
      end();

      const content = `q ${fmt(p.w)} 0 0 ${fmt(p.h)} ${fmt(p.x)} ${fmt(p.y)} cm /Im0 Do Q`;
      begin(cid);
      push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      end();

      begin(iid);
      push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
      end();
    });

    const xrefPos = pos;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let id = 1; id < size; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    push(`${xref}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

    return new Blob(parts, { type: 'application/pdf' });
  }

  root.PdfKit = { buildPdf, layoutPage };
})(typeof window !== 'undefined' ? window : globalThis);
