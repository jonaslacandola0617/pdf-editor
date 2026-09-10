# Security

## Scope

PDF Forge is a browser application. The production app does not expose a PDF-processing backend API. PDF bytes are processed client-side and saved library documents are stored in the browser's IndexedDB.

## Current protections

- Production Content Security Policy with no inline executable-script allowance
- Anti-framing protection (`frame-ancestors 'none'` and `X-Frame-Options: DENY`)
- MIME-sniffing protection (`X-Content-Type-Options: nosniff`)
- Restrictive browser Permissions Policy
- Strict referrer policy
- PDF.js eval-based execution path disabled for PDF loading paths owned by PDF Forge
- Authored/edited PDF URI links restricted to `http`, `https`, and `mailto`
- Privacy cleanup removes document/page additional actions, JavaScript name trees, embedded-file name trees, file-attachment annotations, and JavaScript/Launch annotation actions
- No application secrets or backend credentials are required by the client

## External resources

The application is local-first, not fully offline yet. The UI fonts are currently obtained from Google Fonts. Tesseract.js may fetch OCR runtime/language data from approved third-party CDNs on first OCR use. PDF document bytes are not intentionally included in those requests.

Self-hosting those assets is tracked as a hardening/privacy improvement.

## Reporting a vulnerability

Please do not include private or sensitive PDF documents in a public issue. Report the minimum reproduction needed to demonstrate the problem and avoid publishing secrets, credentials, or personal documents.
