# PDF Forge

A private, browser-based PDF editor and document manager. PDF Forge keeps the core workflow local to your browser and provides one workspace for viewing, organizing, annotating, filling, merging, splitting, and exporting PDFs.

## Features

- Local document library backed by IndexedDB
- PDF viewer with thumbnails, zoom, page navigation, and text search
- Reorder, rotate, duplicate, delete, and extract pages
- Merge PDFs and convert images to PDF pages
- Add text, highlights, rectangles, freehand ink, and signatures
- Fill existing AcroForm text, checkbox, dropdown, and radio fields
- Edit PDF title, author, subject, and keywords
- Undo/redo for page operations and annotations
- Export flattened annotations into a standard PDF
- No account or server upload required for the core editor

## Development

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Privacy

PDF documents are processed in the browser. Saved library items are stored in your browser's IndexedDB. Nothing in the app uploads a document to a backend service.
