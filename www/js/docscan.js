// Document scanner: finds the sheet of paper in a photo and straightens it (perspective correction).
// No libraries. Detection works on a small copy of the photo, so it takes a fraction of a second.
//   DocScan.detect(img)            -> { quad: [TL, TR, BR, BL] as {x, y} in 0..1 } or null when no page is found
//   DocScan.crop(img, quad, max)   -> canvas holding the straightened page
// Exposed on window.DocScan.
(function (root) {
  'use strict';

  const ANALYZE_MAX = 600;     // longest side (px) of the copy used for detection
  const PAPER_MAX_SAT = 0.32;  // paper is grey/white (low saturation); tables and cloth are more colourful
  const PAPER_MIN_VAL = 55;    // ...but not black
  const MIN_PAGE_FRACTION = 0.12;
  const EDGE_INSET = 0.008;
  const GUTTER_MIN_RIDGE = 0.012; // a column counts as 'a dark line' in a row if it's this much darker than both neighbours
  const GUTTER_MIN_AGREE = 0.65;  // ...in at least this share of the page's rows
  const GUTTER_MAX_TINT = 0.10;   // ...and isn't colourful (printed margin lines are)
  const CREASE_MIN_DEPTH = 0.02;  // full-resolution re-check: at least 2% darker than the paper beside it
  const CREASE_MIN_WIDTH = 0.004; // ...and at least 0.4% of the page width wide (a printed line is thinner)

  const dims = (img) => [img.naturalWidth || img.width, img.naturalHeight || img.height];

  function smallCopy(img) {
    const [W, H] = dims(img);
    const s = Math.min(1, ANALYZE_MAX / Math.max(W, H));
    const w = Math.max(8, Math.round(W * s));
    const h = Math.max(8, Math.round(H * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  }

  // ── binary morphology with a square window (separable, prefix sums) ──
  function windowPass(src, w, h, r, horizontal, needAll) {
    const out = new Uint8Array(w * h);
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const pre = new Int32Array(len + 1);
    for (let l = 0; l < lines; l++) {
      const at = (i) => (horizontal ? l * w + i : i * w + l);
      for (let i = 0; i < len; i++) pre[i + 1] = pre[i] + src[at(i)];
      for (let i = 0; i < len; i++) {
        const a = Math.max(0, i - r);
        const b = Math.min(len - 1, i + r);
        const sum = pre[b + 1] - pre[a];
        out[at(i)] = needAll ? (sum === b - a + 1 ? 1 : 0) : (sum > 0 ? 1 : 0); // erode : dilate
      }
    }
    return out;
  }
  const dilate = (m, w, h, r) => windowPass(windowPass(m, w, h, r, true, false), w, h, r, false, false);
  const erode = (m, w, h, r) => windowPass(windowPass(m, w, h, r, true, true), w, h, r, false, true);

  // Largest 4-connected blob of 1s; returns a new mask containing only that blob (and its pixel count).
  function largestBlob(mask, w, h) {
    const label = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    let best = 0;
    let bestLabel = 0;
    let next = 0;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || label[i]) continue;
      next++;
      let sp = 0;
      let count = 0;
      stack[sp++] = i;
      label[i] = next;
      while (sp) {
        const p = stack[--sp];
        count++;
        const x = p % w;
        const y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[sp++] = p + w; }
      }
      if (count > best) { best = count; bestLabel = next; }
    }
    const out = new Uint8Array(w * h);
    if (bestLabel) for (let i = 0; i < mask.length; i++) if (label[i] === bestLabel) out[i] = 1;
    return { mask: out, count: best };
  }

  function bounds(mask, w, h) {
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return { x0, x1, y0, y1 };
  }

  // Open notebooks show two pages. A crease is a thin, neutral-coloured dark line that runs the whole height of
  // the paper, so we count how many rows agree that a column is darker than both of its neighbours.
  // (Text and shading only agree in a minority of rows; a printed margin line is coloured, so it's rejected.)
  // Returns { x: column to cut at or -1, frac: best agreement seen, at: where }.
  function findGutter(mask, lum, sat, w, h, b, side) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const none = { x: -1, frac: 0, at: -1 };
    if (bw < 40 || bh < 40) return none;
    const k = Math.max(2, Math.round(Math.max(w, h) / 150));

    // brightness relative to the row's typical brightness (removes top-to-bottom shading)
    const rowBase = new Float32Array(h);
    for (let y = b.y0; y <= b.y1; y++) {
      const vals = [];
      for (let x = b.x0; x <= b.x1; x++) if (mask[y * w + x]) vals.push(lum[y * w + x]);
      if (vals.length > bw * 0.3) { vals.sort((p, q) => p - q); rowBase[y] = vals[vals.length >> 1]; }
    }

    const from = Math.max(b.x0 + k, side === 'left' ? b.x0 + Math.round(bw * 0.05) : b.x1 - Math.round(bw * 0.40));
    const to = Math.min(b.x1 - k, side === 'left' ? b.x0 + Math.round(bw * 0.40) : b.x1 - Math.round(bw * 0.05));
    let best = { x: -1, frac: 0, tint: 0 };
    for (let x = from; x <= to; x++) {
      let rows = 0, dark = 0, tint = 0;
      for (let y = b.y0; y <= b.y1; y++) {
        const i = y * w + x;
        if (!(rowBase[y] > 0 && mask[i] && mask[i - k] && mask[i + k])) continue;
        rows++;
        const ridge = (lum[i - k] + lum[i + k]) / 2 / rowBase[y] - lum[i] / rowBase[y];
        if (ridge > GUTTER_MIN_RIDGE) { dark++; tint += sat[i] - (sat[i - k] + sat[i + k]) / 2; }
      }
      if (rows < bh * 0.5) continue;
      const frac = dark / rows;
      if (frac > best.frac) best = { x, frac, tint: dark ? tint / dark : 0 };
    }
    const isCrease = best.frac >= GUTTER_MIN_AGREE && best.tint < GUTTER_MAX_TINT;
    return { x: isCrease ? best.x : -1, frac: best.frac, at: best.x, tint: best.tint };
  }

  // The candidate crease was found on the shrunken copy, where a thin printed margin line can look like one.
  // Re-check it on a full-resolution strip of the photo: a crease is a wide, neutral-coloured shadow;
  // a margin line is narrow and usually coloured (red, blue...).
  function confirmCrease(img, x, b, w, h) {
    const [W, H] = dims(img);
    const sx = W / w, sy = H / h;
    const bwFull = (b.x1 - b.x0 + 1) * sx;
    const R = Math.max(14, Math.round(bwFull * 0.035));
    const fx = Math.round(x * sx);
    const x0 = Math.max(0, fx - R), x1 = Math.min(W - 1, fx + R);
    const sw = x1 - x0 + 1;
    const y0 = Math.round((b.y0 + (b.y1 - b.y0) * 0.1) * sy);
    const y1 = Math.round((b.y1 - (b.y1 - b.y0) * 0.1) * sy);
    const sh = y1 - y0 + 1;
    if (sw < 12 || sh < 40) return { ok: false, why: 'strip too small' };

    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, x0, y0, sw, sh, 0, 0, sw, sh);
    const d = ctx.getImageData(0, 0, sw, sh).data;

    const rel = Array.from({ length: sw }, () => []);
    const chroma = Array.from({ length: sw }, () => []);
    const rowLum = new Float32Array(sw);
    for (let y = 0; y < sh; y++) {
      const rs = [];
      for (let i = 0; i < sw; i++) {
        const p = (y * sw + i) * 4;
        rowLum[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        const mx = Math.max(d[p], d[p + 1], d[p + 2]);
        chroma[i].push(mx > 0 ? (mx - Math.min(d[p], d[p + 1], d[p + 2])) / mx : 0);
        rs.push(rowLum[i]);
      }
      const sorted = rs.slice().sort((p, q) => p - q);
      const base = sorted[sorted.length >> 1] || 1;
      for (let i = 0; i < sw; i++) rel[i].push(rowLum[i] / base);
    }
    const med = (arr) => { const t = arr.slice().sort((p, q) => p - q); return t[t.length >> 1]; };
    const prof = rel.map(med);
    const tintProf = chroma.map(med);
    const q = Math.max(3, sw >> 2);
    const avg = (a, from, to) => { let t = 0; for (let i = from; i < to; i++) t += a[i]; return t / (to - from); };
    const base = (avg(prof, 0, q) + avg(prof, sw - q, sw)) / 2;
    const baseTint = (avg(tintProf, 0, q) + avg(tintProf, sw - q, sw)) / 2;

    let minAt = q;
    for (let i = q; i < sw - q; i++) if (prof[i] < prof[minAt]) minAt = i;
    const depth = base - prof[minAt];
    const half = base - depth / 2;
    let lo = minAt, hi = minAt;
    while (lo > 0 && prof[lo - 1] < half) lo--;
    while (hi < sw - 1 && prof[hi + 1] < half) hi++;
    const widthFrac = (hi - lo + 1) / bwFull;
    let tint = 0;
    for (let i = Math.max(0, minAt - 1); i <= Math.min(sw - 1, minAt + 1); i++) tint = Math.max(tint, tintProf[i] - baseTint);

    const ok = depth >= CREASE_MIN_DEPTH && widthFrac >= CREASE_MIN_WIDTH && tint <= GUTTER_MAX_TINT;
    return { ok, depth: Math.round(depth * 1000) / 1000, width: Math.round(widthFrac * 10000) / 10000, tint: Math.round(tint * 1000) / 1000 };
  }

  // least-squares line v = a*t + b, ignoring points that sit far from the line (text, notches, blobs)
  function fitLine(pts) {
    if (pts.length < 6) return null;
    let use = pts;
    let a = 0;
    let b = 0;
    for (let it = 0; it < 5; it++) {
      let n = 0, st = 0, sv = 0, stt = 0, stv = 0;
      for (const p of use) { n++; st += p[0]; sv += p[1]; stt += p[0] * p[0]; stv += p[0] * p[1]; }
      const den = n * stt - st * st;
      if (Math.abs(den) < 1e-9) return null;
      a = (n * stv - st * sv) / den;
      b = (sv - a * st) / n;
      const res = pts.map((p) => Math.abs(p[1] - (a * p[0] + b)));
      const sorted = res.slice().sort((p, q) => p - q);
      const limit = Math.max(1.5, 3 * sorted[sorted.length >> 1]);
      const kept = pts.filter((_, i) => res[i] <= limit);
      if (kept.length < 6) break;
      use = kept;
    }
    return { a, b };
  }

  // y = a1*x + b1 (top/bottom edge) meets x = a2*y + b2 (left/right edge)
  function meet(hz, vt) {
    const den = 1 - vt.a * hz.a;
    if (Math.abs(den) < 1e-6) return null;
    const x = (vt.a * hz.b + vt.b) / den;
    return { x, y: hz.a * x + hz.b };
  }

  function detect(img) {
    const { data, w, h } = smallCopy(img);
    const n = w * h;
    const lum = new Float32Array(n);
    const sat = new Float32Array(n);
    let mask = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], bl = data[p + 2];
      const mx = Math.max(r, g, bl);
      const mn = Math.min(r, g, bl);
      lum[i] = 0.299 * r + 0.587 * g + 0.114 * bl;
      sat[i] = mx > 0 ? (mx - mn) / mx : 0;
      mask[i] = mx >= PAPER_MIN_VAL && sat[i] <= PAPER_MAX_SAT ? 1 : 0;
    }

    const r1 = Math.max(2, Math.round(Math.max(w, h) / 200));
    const r2 = Math.max(3, Math.round(Math.max(w, h) / 90));
    mask = erode(dilate(mask, w, h, r1), w, h, r1);   // close: ink and text no longer punch holes in the page
    mask = dilate(erode(mask, w, h, r2), w, h, r2);   // open: thin stripes and threads on the background vanish

    let blob = largestBlob(mask, w, h);
    if (blob.count < n * MIN_PAGE_FRACTION) return null;
    let reg = blob.mask;
    let b = bounds(reg, w, h);

    // Two-page spreads: cut at the crease and keep the bigger side.
    const gutters = {};
    for (const side of ['left', 'right']) {
      const found = findGutter(reg, lum, sat, w, h, b, side);
      gutters[side] = { agree: Math.round(found.frac * 100) / 100, tint: Math.round((found.tint || 0) * 1000) / 1000, at: found.at, cut: found.x };
      const x = found.x;
      if (x < 0) continue;
      const sure = confirmCrease(img, x, b, w, h);
      gutters[side].confirm = sure;
      if (!sure.ok) continue;
      for (let y = 0; y < h; y++) {
        for (let xx = 0; xx < w; xx++) {
          if (side === 'left' ? xx <= x + 1 : xx >= x - 1) reg[y * w + xx] = 0;
        }
      }
      b = bounds(reg, w, h);
    }
    blob = largestBlob(reg, w, h);
    reg = blob.mask;
    if (blob.count < n * MIN_PAGE_FRACTION) return null;
    b = bounds(reg, w, h);
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;

    // Trace the four sides of the paper (skipping the rounded corners) and fit a straight line to each.
    const top = [], bottom = [], left = [], right = [];
    for (let x = b.x0 + Math.round(bw * 0.08); x <= b.x1 - Math.round(bw * 0.08); x++) {
      let yT = -1, yB = -1;
      for (let y = b.y0; y <= b.y1; y++) if (reg[y * w + x]) { yT = y; break; }
      for (let y = b.y1; y >= b.y0; y--) if (reg[y * w + x]) { yB = y; break; }
      if (yT >= 0) { top.push([x, yT]); bottom.push([x, yB + 1]); }
    }
    for (let y = b.y0 + Math.round(bh * 0.08); y <= b.y1 - Math.round(bh * 0.08); y++) {
      let xL = -1, xR = -1;
      for (let x = b.x0; x <= b.x1; x++) if (reg[y * w + x]) { xL = x; break; }
      for (let x = b.x1; x >= b.x0; x--) if (reg[y * w + x]) { xR = x; break; }
      if (xL >= 0) { left.push([y, xL]); right.push([y, xR + 1]); }
    }
    const lt = fitLine(top), lb = fitLine(bottom), ll = fitLine(left), lr = fitLine(right);
    if (!lt || !lb || !ll || !lr) return null;
    const pts = [meet(lt, ll), meet(lt, lr), meet(lb, lr), meet(lb, ll)]; // TL, TR, BR, BL
    if (pts.some((p) => !p)) return null;

    // pull the corners in a hair so no sliver of table or cloth survives along the edges
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    const quad = pts.map((p) => ({
      x: Math.min(1, Math.max(0, (cx + (p.x - cx) * (1 - EDGE_INSET)) / w)),
      y: Math.min(1, Math.max(0, (cy + (p.y - cy) * (1 - EDGE_INSET)) / h)),
    }));
    if (!isSensible(quad)) return null;
    return { quad, debug: { gutters, w, h } };
  }

  const area = (q) => {
    let s = 0;
    for (let i = 0; i < 4; i++) { const a = q[i], c = q[(i + 1) % 4]; s += a.x * c.y - c.x * a.y; }
    return Math.abs(s) / 2;
  };

  function isSensible(q) {
    if (area(q) < MIN_PAGE_FRACTION) return false;
    // convex, in TL-TR-BR-BL order
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-6) return false;
      if (sign && Math.sign(cross) !== sign) return false;
      sign = Math.sign(cross);
    }
    return true;
  }

  // True when the quad is basically the whole photo (nothing worth cropping).
  function isWholePhoto(q) {
    return area(q) > 0.97 && q.every((p, i) => Math.abs(p.x - (i === 1 || i === 2 ? 1 : 0)) < 0.02 && Math.abs(p.y - (i >= 2 ? 1 : 0)) < 0.02);
  }

  // square (0..1) -> quad projective map (P. Heckbert), so we can look up where each output pixel comes from
  function squareToQuad(q) {
    const [p0, p1, p2, p3] = q;
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      return { a: p1.x - p0.x, b: p2.x - p1.x, c: p0.x, d: p1.y - p0.y, e: p2.y - p1.y, f: p0.y, g: 0, h: 0, affine: true };
    }
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / den;
    const hh = (dx1 * dy3 - dx3 * dy1) / den;
    return {
      a: p1.x - p0.x + g * p1.x, b: p3.x - p0.x + hh * p3.x, c: p0.x,
      d: p1.y - p0.y + g * p1.y, e: p3.y - p0.y + hh * p3.y, f: p0.y, g, h: hh,
    };
  }

  // Straightens the quad (0..1 coords of the photo) into a flat page no larger than maxDim on its long side.
  function crop(img, quadNorm, maxDim) {
    const [W, H] = dims(img);
    const q = quadNorm.map((p) => ({ x: p.x * W, y: p.y * H }));
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let outW = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
    let outH = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const s = Math.min(1, maxDim / Math.max(outW, outH));
    outW = Math.max(1, Math.round(outW * s));
    outH = Math.max(1, Math.round(outH * s));

    // Read the photo at about the resolution we need (not full size), so phones don't run out of memory.
    const longSide = Math.max(dist(q[0], q[1]), dist(q[3], q[2]), dist(q[0], q[3]), dist(q[1], q[2]));
    const scale = Math.min(1, (Math.max(outW, outH) * 1.15) / longSide);
    const sw = Math.max(1, Math.round(W * scale));
    const sh = Math.max(1, Math.round(H * scale));
    const src = document.createElement('canvas');
    src.width = sw;
    src.height = sh;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, sw, sh);
    const sd = sctx.getImageData(0, 0, sw, sh).data;

    const m = squareToQuad(q.map((p) => ({ x: p.x * scale, y: p.y * scale })));
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const octx = out.getContext('2d');
    const od = octx.createImageData(outW, outH);
    const o = od.data;
    const maxX = sw - 1, maxY = sh - 1;
    for (let j = 0; j < outH; j++) {
      const v = (j + 0.5) / outH;
      for (let i = 0; i < outW; i++) {
        const u = (i + 0.5) / outW;
        const wgt = m.g * u + m.h * v + 1;
        let x = (m.a * u + m.b * v + m.c) / wgt - 0.5;
        let y = (m.d * u + m.e * v + m.f) / wgt - 0.5;
        x = x < 0 ? 0 : x > maxX ? maxX : x;
        y = y < 0 ? 0 : y > maxY ? maxY : y;
        const x0 = x | 0, y0 = y | 0;
        const x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
        const fx = x - x0, fy = y - y0;
        const p00 = (y0 * sw + x0) * 4, p10 = (y0 * sw + x1) * 4, p01 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
        const k = (j * outW + i) * 4;
        for (let c = 0; c < 3; c++) {
          const top = sd[p00 + c] + (sd[p10 + c] - sd[p00 + c]) * fx;
          const bot = sd[p01 + c] + (sd[p11 + c] - sd[p01 + c]) * fx;
          o[k + c] = top + (bot - top) * fy;
        }
        o[k + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  root.DocScan = { detect, crop, isWholePhoto, isSensible };
})(typeof window !== 'undefined' ? window : globalThis);
