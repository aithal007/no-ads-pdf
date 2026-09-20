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
