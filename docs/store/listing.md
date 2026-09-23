# Edge Add-ons submission — copy/paste reference

Fill this in at [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview)
(Edge → Extensions). You'll need a free Microsoft account and a one-time developer registration (no fee for
individual/Edge submissions, unlike Chrome's $5).

## Package
Upload `pocket-pdf-extension.zip` (built by `.\scripts\package-extension.ps1`, from `extension/`).

## Store listing

**Name**
```
Pocket PDF
```

**Short description** (132 characters max)
```
Offline, ad-free PDF toolkit: view, merge, split, compress, convert, night mode, Excel/CSV, ZIP. Nothing leaves your device.
```
*(That's 126 characters — under the limit.)*

**Detailed description**
```
Pocket PDF is a free PDF toolkit with no ads, no sign-up and no account. It runs entirely on your device — no
permissions requested, no data collected, no server anywhere in the picture.

What it does:
- View PDF — read any PDF, zoom, jump to pages, and a night mode that inverts every page for reading in the dark.
- Merge PDFs, and split one apart (pick pages, cut by ranges, or every N pages).
- Organize pages — reorder, rotate, delete, visually.
- Compress a PDF, keeping text sharp and selectable, or shrink it further.
- Turn photos into a PDF, with automatic page detection and cropping for photographed pages and notebooks.
- Convert a PDF to JPG or PNG images, or pull out the pictures already inside one.
- View Excel and CSV files, formatted like Excel, including big files.
- Open and extract ZIP files.

Everything happens locally in your browser. There is nothing to sign up for, nothing to upload, and nothing
tracking what you open. The full source is on GitHub: https://github.com/aithal007/no-ads-pdf
```

**Category**
```
Productivity
```

**Privacy policy URL**
```
https://github.com/aithal007/no-ads-pdf/blob/main/PRIVACY.md
```

**Website / support URL**
```
https://github.com/aithal007/no-ads-pdf
```

**Data collection questions in Partner Center**
Answer **No** / **None** to all of them — the extension requests zero permissions and has no network access, so
it structurally cannot collect anything.

**Screenshots** (in `docs/store/`, 2560×1600, scales down fine)
- `screenshot-1-home.png` — the tool grid
- `screenshot-2-night.png` — PDF viewer, night mode, a real handwritten lecture PDF
- `screenshot-3-merge.png` — merging two PDFs

**Icon**
`extension/icons/icon128.png` (Partner Center may also ask for a separate square store icon — the same file
works).

## v1.1.0 update: night mode floats over any PDF, not just inside the app

Adds `pdf-night.js` (a content script) so a moon button appears directly on top of any PDF Edge shows in its own
viewer — clicking it inverts the whole page. This needs new permissions the v1.0.0 submission didn't have, so it
goes through review again. When resubmitting:

**Permission justification** (Privacy page, appears now that a content script/host permission is declared)
```
The extension adds an optional night-mode button to pages that are PDF files (matched by their .pdf extension),
so a person doesn't have to leave Edge's own PDF viewer to invert the page's colours for reading in the dark.
It needs to run on those pages to place that button and apply the colour filter when clicked; it reads or sends
nothing from the page. file:///* is requested only so this also works for PDFs opened directly from disk (the
person must separately enable "Allow access to file URLs" for the extension, which Edge always requires
regardless of what a manifest declares).
```

**Single purpose description** — same one-purpose story as before still holds (local PDF/document viewing and
editing); the content script is part of that same purpose, not a second one, so no change needed there.

**Data collection questions** — still all unchecked. The content script reads nothing from the page and sends
nothing anywhere; it only adds a button and a CSS filter.
