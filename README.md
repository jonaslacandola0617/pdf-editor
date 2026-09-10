# PDF Forge

PDF Forge is a local-first browser PDF editor and document workspace. The application is built with React, TypeScript, Vite, PDF.js, PDFium, pdf-lib, QPDF/WASM, and Tesseract.js.

Production: https://pdfforge.jonasl.online/

## Current capabilities

- Local document library backed by IndexedDB
- PDF viewing with thumbnails, zoom, continuous/single/spread modes, navigation, and search
- Native PDF text inspection and editing where the document structure permits it
- Text, highlights, shapes, drawing, comments, signatures, and redaction workflows
- Reorder, rotate, duplicate, insert, delete, merge, split, and extract pages
- Fill and manage AcroForm fields and advanced form widgets
- Inspect and edit native comments, links, bookmarks, shapes, markups, attachments, and page content
- Compress/optimize PDFs and raster-compress scan-heavy documents
- Add Bates numbering, bookmarks, web links, metadata, and document-view settings
- Password protection/decryption and privacy cleanup tools
- OCR fallback for scanned/image-only pages and searchable-PDF generation
- Export PDFs and selected pages/images
- Undo/redo and automatic local document persistence

## Workbench UX

The loaded-document Workbench is intentionally canvas-first. A labeled Navigator contains document-level areas such as Pages, Comments, Forms, Library, Info, and Bookmarks. Properties stay collapsed until they are relevant, while Edit, Review, Sign, and Pages modes progressively disclose task-specific tools.

## Development

Requirements: Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

The development server binds to `127.0.0.1` by default instead of all network interfaces.

Production build:

```bash
npm run build
```

Unit tests:

```bash
npm run test:unit
```

Full browser verification:

```bash
npm run test:browser
```

Everything:

```bash
npm run test:all
```

## Privacy and security model

PDF document bytes are processed in the browser and the local library is stored in IndexedDB. PDF Forge does not expose a document-processing API or upload PDFs to an application backend.

PDF-authored web links are restricted to `http`, `https`, and `mailto` schemes. Production also applies a Content Security Policy, anti-framing, MIME-sniffing protection, a restrictive Permissions Policy, and a strict referrer policy.

OCR is performed in-browser with Tesseract.js. At present, Tesseract's OCR runtime/language assets may be retrieved from approved third-party CDNs on first use, and the interface fonts are loaded from Google Fonts. Those requests do not contain the user's PDF document, but fully self-hosting these assets remains a privacy/performance improvement on the roadmap.

## Quality gates

The repository includes unit tests, a Playwright browser QA suite, and a responsive visual UX audit. Changes to the editor should keep all three gates green before being merged into `main`.
