# PDF Forge — Codex Engineering Handoff

Date prepared: 2026-09-05
Repository: `jonaslacandola0617/pdf-editor`
Production: `https://pdf.jonasl.online`
Product: PDF Forge

## 1. Mission

You are inheriting PDF Forge, a private, browser-first PDF editor and document manager whose product goal is to behave like Adobe Acrobat in workflow and capability.

Treat Acrobat as the behavioral reference, not merely a visual reference.

The product should eventually let a user open a PDF and naturally perform the same class of tasks they expect in Acrobat: edit existing text and images, add content, organize pages, search, OCR scans, comment, prepare/fill forms, sign, redact, protect, optimize, inspect document structure, and export a standards-compatible PDF.

Do not copy Adobe trademarks, logos, proprietary artwork, or branded assets. Match the information architecture, tool semantics, interaction model, and professional quality.

This is not a mockup project. Every exposed tool must perform a genuine PDF operation or be clearly labeled as limited/unsupported.

## 2. Non-negotiable product principles

### Local-first privacy

Core PDF processing stays on the user's device.

Current architecture intentionally avoids requiring a backend:

- PDF bytes are kept in memory and IndexedDB.
- The local document library is stored in IndexedDB.
- Workspace/session state and some presets are stored locally.
- PDF.js handles rendering/text extraction.
- Tesseract.js handles OCR locally in browser workers/WASM.
- PDFium/WASM handles native text/image content mutation.
- QPDF/WASM handles encryption/optimization/security operations.
- pdf-lib handles many PDF structure/page/form/annotation operations.

Do not introduce mandatory cloud upload, Azure OCR, Google OCR, blob storage, or a server database for normal editing merely because it is easier.

Optional cloud backup/sync can be designed later, but core editing must remain usable without it.

### No fake features

Never mark a feature complete because:

- a button exists;
- React state changed;
- a black rectangle was drawn over content;
- a build passed;
- a PDF downloaded.

A feature is complete only when the resulting PDF behavior is real.

Examples:

- secure redaction must remove the underlying content;
- existing text editing must change real PDF text/page objects;
- form creation must produce actual AcroForm fields;
- links must be `/Link` annotations;
- bookmarks must be actual outline entries;
- attachments must contain actual embedded-file streams;
- password protection must produce a PDF that genuinely requires the password;
- searchable OCR export must embed searchable text.

### Preserve PDF structure

Prefer native PDF object mutation.

Do not rasterize whole documents to simplify ordinary editing.

Raster rebuilding is acceptable only where the user is explicitly choosing a destructive/raster workflow, such as strong compression or a redaction strategy that requires it.

### Backward compatibility

The Playwright suite encodes many interaction contracts:

- button titles;
- aria-labels;
- status messages;
- modal names;
- control names;
- exported PDF semantics.

Before renaming a control or changing a DOM relationship, search the tests.

Prefer extending proven managers with isolated sections/components rather than rewriting them.

### Destructive operations

Use undo/redo when practical.

If an operation is irreversible, make that explicit and require an intentional Apply/confirm step.

## 3. Repository/runtime snapshot

At handoff creation the observed `main` head was:

`91885a0d9af7b97ccc81aa7adc6bf27689178de2`

Always run `git fetch --all --prune` and verify current `main` before doing work.

Current stack:

- React 19.2.8
- React DOM 19.2.8
- TypeScript 5.9+
- Vite 7.3.6
- pdfjs-dist 6.2.108
- pdf-lib 1.17.1
- @hyzyla/pdfium 2.1.13
- qpdf-run 0.2.1
- tesseract.js 7.0.0
- idb 8.0.3
- lucide-react 1.28.0
- Node >= 20.19.0
- CI uses Node 22

Required commands:

```bash
npm install
npm run test:unit
npm run build
npx playwright test
```

`npm run build` runs:

```bash
tsc -b && vite build
```

## 4. Architecture map

### Core editor

`src/App.tsx`

This remains the central editor/state coordinator for:

- current PDF bytes;
- active local document;
- PDF.js document lifecycle;
- pages/current page;
- rotations;
- zoom/view;
- annotations;
- search;
- forms;
- metadata;
- undo/redo;
- export;
- autosave;
- refresh/session restoration.

Avoid making this file larger unless the feature genuinely needs central state.

Prefer new `src/lib/*` modules and isolated components.

### Product shell

`src/components/ProductExperience.tsx`

This is the high-level Acrobat-style product experience.

It owns or coordinates:

- Home;
- Documents;
- Tools;
- Edit / Annotate / Sign / Organize modes;
- command palette;
- recent documents;
- favorites;
- high-level tool intents.

Do not add random top-level UI outside this product model.

### All Tools

`src/components/AllTools.tsx`

This is the discoverability layer modeled after Acrobat's All Tools concept.

A tool listed here should activate the real implementation, not create a second copy of the feature.

### Advanced/document/native-object workspace

`src/components/AdvancedTools.tsx`
`src/components/AdvancedToolsBase.tsx`

`AdvancedToolsBase` contains major document operations.

`AdvancedTools` wraps it and exposes the Embedded PDF Objects workspace.

Current manager families include:

- native page content;
- native comments;
- detailed Text/FreeText comment appearance;
- text markups;
- shapes;
- extended annotations;
- form properties;
- attachments;
- reusable image signatures;
- page labels / initial view / image export.

Keep managers isolated.

### Rendering

Important:

- `src/components/PdfPageCanvas.tsx`
- `src/components/LazyPdfPage.tsx`
- `src/components/Thumbnail.tsx`
- `src/lib/pdfjs.ts`

Past critical bug:

`Cannot use the same canvas during multiple render() operations`

Any PDF.js render path must cancel or await a stale render task before starting another render on the same canvas.

Stale PDF.js loading-task errors must also not overwrite successful newer document state.

### PDF engines

General/document operations:

- `src/lib/pdf.ts`
- `src/lib/document-extra.ts`
- `src/lib/document-view.ts`
- `src/lib/structure-tools.ts`
- `src/lib/redaction.ts`
- `src/lib/security.ts`
- `src/lib/searchable.ts`
- `src/lib/attachments.ts`
- `src/lib/form-properties.ts`

Native page-content editing:

- `src/lib/pdfium-edit.ts`
- `src/lib/pdfium-page-content.ts`
- `src/components/InlineNativeTextEditor.tsx`
- `src/components/NativePageContentManager.tsx`

OCR:

- `src/lib/ocr.ts`
- `src/lib/ocr-cache.ts`
- `src/lib/searchable.ts`
- `src/components/OcrActivity.tsx`
- `src/components/OcrTextOverlay.tsx`

Persistence:

- `src/lib/storage.ts`

## 5. Current capability inventory

Read the tests before assuming behavior, but the current product already includes substantial functionality.

### Local library/workspace

- Open PDF.
- Open PNG/JPG as PDF.
- Combine multiple inputs.
- Drag/drop.
- Local IndexedDB document library.
- Recent documents.
- Favorites.
- Rename/duplicate/delete local items.
- Autosave.
- Explicit Save.
- Refresh/session restore.
- Explicit Close disables forced reopen.

### Viewer

- PDF.js rendering.
- HiDPI canvas.
- Thumbnails.
- Page navigation.
- Keyboard page navigation.
- Zoom.
- Styled scrollbars.
- continuous/spread/fullscreen-style work from completion passes.
- native page labels.
- initial-view preferences.
- bookmark/navigation support.
- responsive desktop/tablet/mobile shell.

### Search/OCR

- Native PDF text search.
- Visible match highlighting.
- Next/previous match navigation.
- Local OCR fallback for scanned/image-only pages.
- OCR cache in IndexedDB.
- OCR word geometry overlays.
- Searchable OCR export.

Rule: native PDF text must always win. OCR supplements native text; it must not replace valid native text.

### Existing text editing

Real native PDF editing exists.

Capabilities include combinations of:

- select native text;
- replace;
- delete;
- move;
- font-size changes where supported;
- color/opacity changes;
- export/reopen persistence.

PDF text is not a Word document. It may consist of many independently positioned text objects.

Do not fake paragraph reflow.

### Existing image editing

Native PDF image-object work exists through PDFium/page-content tooling:

- enumerate image objects;
- move;
- resize;
- replace bitmap;
- extract;
- delete.

Next UX improvement should make more of this page-direct instead of list-manager-driven.

### Editor-created annotations

Tools include:

- Select
- Add Text
- Highlight
- Rectangle
- Draw/Ink
- Signature
- Sticky Note
- Redact

Editor objects participate in property editing/move/resize where applicable and export.

### Existing native annotations from other PDF editors

Coverage already includes:

- Text comments
- FreeText comments
- URI links
- bookmarks/outlines
- Highlight
- Underline
- StrikeOut
- Squiggly
- Square
- Circle
- Line
- Ink
- Polygon
- PolyLine
- Stamp
- Caret
- page FileAttachment annotations

Properties supported across the native managers include combinations of:

- comment text;
- author;
- color;
- opacity;
- border;
- rectangle;
- line endpoints;
- QuadPoints geometry;
- attachment extraction;
- icon/open state;
- FreeText typography/alignment.

Preserve unrelated PDF dictionary keys during edits.

### Organize Pages

Already includes substantial page operations:

- reorder;
- rotate;
- duplicate;
- delete;
- merge;
- extract;
- insert blank page;
- insert PDF/image before or after;
- replace page;
- crop;
- selected/bulk operations from completion work;
- image export.

Target remains Acrobat's thumbnail-first Organize Pages workflow.

### Document tools

Implemented work includes:

- watermark;
- headers/footers/page numbers;
- Bates numbering;
- image insertion;
- links;
- bookmarks;
- metadata/properties;
- page labels;
- initial view;
- page image export.

### Forms

On `main` already:

- fill text fields;
- checkboxes;
- dropdowns;
- option lists;
- radio groups;
- create common AcroForm fields;
- preserve interactive forms during normal export;
- explicit Flatten Forms;
- rename existing fields;
- tooltip/alternate name;
- read-only;
- required;
- export/no-export;
- delete fields and clean widget references.

Advanced form work is still open in PR #19.

### Signatures

Implemented visual signing:

- drawn signature;
- reusable local signature presets;
- PNG/JPG image signatures;
- permanent page placement.

These are not cryptographic digital signatures.

### Attachments

- add/list/extract/remove document-level embedded files;
- inspect/extract page-level FileAttachment annotations.

### Redaction/privacy

- mark redaction areas;
- destructive secure apply path;
- export is redaction-aware;
- metadata/privacy cleanup.

Acrobat-style rule:

1. Mark.
2. Review.
3. Apply.
4. Optionally sanitize hidden information.

Never call a black overlay secure redaction.

### Security/optimization

Local QPDF/WASM-based features include:

- PDF optimization;
- strong/raster compression;
- AES-256 password-protected export;
- privacy cleanup.

### Export

- normal PDF export;
- rotations;
- editor annotations;
- metadata;
- interactive form preservation;
- explicit form flatten;
- redaction-aware finalization;
- searchable OCR export;
- PNG/JPG page export;
- multi-page image ZIP;
- password-protected export.

## 6. Immediate priority: finish advanced AcroForm editing

Open draft PR:

`#19 — Complete advanced AcroForm widget editing`

Branch:

`feature/advanced-form-widgets`

Observed PR head:

`abe4566915b02f344cdbebcd984c30446b56b4e2`

Important: this PR was based on an older `main`.

Do not merge it directly over the newer UI/UX/native-page-content work.

Recommended strategy:

1. Fetch latest `main`.
2. Create a clean new branch from latest `main`.
3. Port only the product files from PR #19.
4. Fix types manually.
5. Integrate the manager into the latest `AdvancedTools.tsx`.
6. Bring over the targeted test.
7. Run all gates.
8. Supersede/close the old PR if appropriate.

PR #19 product files:

- `src/lib/advanced-forms.ts`
- `src/components/AdvancedFormWidgetManager.tsx`
- `src/advanced-form-widget-manager.css`
- `tests/advanced-form-widgets.spec.ts`

Do not ship temporary scaffolding:

- `.github/advanced-form-type-trigger`
- `.github/workflows/fix-advanced-form-types.yml`

The PR currently aims to add:

- per-widget X/Y/width/height;
- widget background color;
- border color;
- border width;
- text-field multiline;
- password mode;
- combing;
- max length;
- font size;
- text color;
- alignment;
- dropdown/list option editing;
- selected choice values;
- checkbox values;
- radio values;
- page tab order;
- local JSON form-data export/import.

Critical integration gap:

The PR branch's current `AdvancedTools.tsx` does not mount `AdvancedFormWidgetManager`.

The test expects `.advanced-form-widget-manager` inside the Embedded PDF Objects modal.

Mount it near the existing `FormFieldPropertyManager` and import its CSS.

Manually fix strict form-data typing. Use something equivalent to:

```ts
export type FormDataValue = string | string[] | boolean | null

export type FormDataPayload = {
  version: 1
  values: Record<string, FormDataValue>
}
```

Do not rely on a one-shot workflow to patch source.

Acrobat alignment:

This belongs to Prepare Form / field properties, not Fill & Sign.

Field authoring and field filling should remain distinct workflows.

## 7. Adobe Acrobat interaction target

Use current official Adobe Acrobat behavior as the reference when workflow is unclear.

### Edit PDF

Expected interaction:

1. Choose Edit.
2. Click real text/image content directly on the page.
3. Show a visible selection/bounding box.
4. Show contextual properties.
5. Modify the real underlying object.
6. Click outside to commit/deselect.

Text target:

- replace;
- delete;
- add;
- move;
- resize where meaningful;
- font;
- size;
- color;
- alignment;
- spacing where technically valid.

Image target:

- select;
- move;
- resize;
- rotate;
- crop;
- replace;
- delete;
- align/arrange.

If a font is embedded/subset and cannot encode the requested character, show a precise error. Do not silently corrupt the PDF.

### Scan & OCR

Target workflow:

- All Tools > Scan & OCR;
- In this file;
- page range;
- language;
- settings;
- Recognize Text;
- progress;
- searchable/selectable result;
- Review Recognized Text;
- highlight low-confidence/suspect words;
- manual correction;
- rerun selected pages.

Keep OCR local.

### Organize Pages

Target:

- thumbnail-centric workspace;
- multi-select;
- drag reorder;
- visible insertion indicator;
- rotate;
- delete;
- insert;
- replace;
- extract;
- split;
- crop;
- bulk operations;
- undo.

### Comments

Target:

- comment list synchronized with page annotations;
- author/date;
- filter;
- replies;
- status/resolve;
- search;
- selecting a comment navigates/highlights it.

### Forms

Prepare Form target:

- create fields;
- select field on page;
- drag/resize;
- properties;
- appearance;
- options;
- format;
- validation;
- calculation;
- action;
- tab order;
- align/distribute;
- duplicate/copy fields.

Fill target:

- normal data entry;
- keyboard tab;
- clear/reset;
- import/export form data.

### Redaction

Target:

- Mark for Redaction;
- mark text/areas;
- review marks;
- Apply;
- destructive warning;
- optional sanitization.

### Protect

Target:

- open password;
- owner/permissions password;
- printing permissions;
- copying permissions;
- editing/form/comment restrictions;
- security summary.

Only expose restrictions that are actually encoded in the PDF.

## 8. Backlog after advanced forms

### Phase A — finish form authoring

After PR #19:

- direct page selection of widgets;
- drag/resize field widgets on the page;
- align/distribute selected fields;
- duplicate fields;
- copy field across pages;
- checkbox/radio appearance styles;
- button captions;
- field font family where feasible;
- validation/calculation/action inspection;
- later XFDF/FDF interoperability.

### Phase B — make Edit PDF page-direct

The native engines are real, but some workflows are still manager-heavy.

Move common edits onto the page:

- click native text directly;
- direct text bounding handles;
- drag native text;
- image click selection;
- image handles;
- image crop/rotate;
- contextual right panel;
- keyboard Delete;
- duplicate/copy when feasible.

The Embedded Objects modal should be a power-user inspector, not the main everyday Edit workflow.

### Phase C — OCR professionalization

Implement:

- language selector;
- page-range selector;
- Recognize All Pages;
- orientation detection;
- deskew;
- grayscale/contrast/noise preprocessing;
- confidence/suspect review;
- manual OCR correction;
- rerun selected pages.

Tesseract may not match Acrobat's commercial OCR on every file. Mitigate with preprocessing and review, not mandatory cloud OCR.

### Phase D — comments/review

- `/IRT` threaded replies;
- comment status/state;
- filtering;
- author/date editing;
- comment summary;
- XFDF import/export.

### Phase E — security/sanitization

Feasible local work:

- separate user/open and owner/permissions passwords;
- printing permissions;
- copying permissions;
- editing restrictions;
- remove JavaScript;
- remove Launch actions;
- remove attachments optionally;
- remove comments/markups optionally;
- remove metadata;
- remove bookmarks;
- remove hidden layers where safely detectable;
- security inspection report.

### Phase F — PDF comparison

Local implementation:

1. open A and B;
2. compare page sizes/counts;
3. text diff;
4. rendered-page visual diff;
5. synchronized navigation;
6. overlay changed areas;
7. classify additions/removals/changes;
8. export report.

### Phase G — accessibility inspector

Feasible starting scope:

- title;
- document language;
- form labels/tooltips;
- image alt-text inspection where present;
- tagged/untagged indicator;
- bookmark structure;
- likely reading-order problems;
- report.

Do not claim PDF/UA compliance without a proper validator/remediation engine.

### Phase H — performance

Heavy engines:

- PDF.js;
- PDFium WASM;
- QPDF WASM;
- Tesseract.

Improve:

- lazy-load PDFium only when native editing starts;
- lazy-load QPDF only for protect/optimize;
- keep OCR lazy;
- configure PDF.js `standardFontDataUrl`;
- remove current standard-font warnings;
- virtualize large thumbnail/page lists;
- memory caps for very large pages;
- test 100+ page documents.

## 9. Hard blockers — do not fake these

### Word-like paragraph reflow

PDF text often consists of independently positioned objects.

Full Word-style document reflow is not currently solved.

Mitigation:

- text-line/block grouping;
- local block reflow;
- multi-object selection;
- overflow warnings.

Do not pretend arbitrary reflow exists.

### Cryptographic certificate signatures

Current signatures are visual.

True signing requires:

- PDF signature field;
- ByteRange;
- CMS/PKCS#7;
- private key/certificate;
- incremental save;
- validation;
- preferably PAdES;
- certificate-chain validation;
- revocation;
- timestamps.

A feasible local first step is user-imported `.p12/.pfx`.

Full enterprise trust/timestamp support may require PKI/TSA infrastructure.

### XFA / LiveCycle forms

Standard AcroForms are supported.

XFA is a separate runtime.

Detect it and explain the limitation rather than pretending it works.

### Acrobat-grade PDF/A / Preflight

Basic structural inspection is feasible.

Do not claim PDF/A compliance unless a real validator confirms it.

### Rich media / 3D / advanced PDF JavaScript

Low priority and security-sensitive.

Do not execute arbitrary PDF JavaScript just to claim compatibility.

## 10. Testing/release protocol

No feature is complete until browser verification passes.

Required:

```bash
npm install
npm run test:unit
npm run build
npx playwright test
```

Workflow:

`.github/workflows/browser-qa.yml`

The workflow performs:

- checkout;
- Node 22;
- dependency install;
- Playwright install;
- Chromium install;
- unit tests;
- production build;
- browser tests;
- failure artifacts.

Do not weaken tests just to get green CI.

### PDF mutation test pattern

For a new PDF feature:

1. Create deterministic input PDF.
2. Open through actual UI.
3. Perform operation through UI.
4. Export/download.
5. Reopen bytes with pdf-lib/PDF.js/PDFium/QPDF as appropriate.
6. Inspect the actual object/dictionary/stream/value.
7. Reopen in PDF Forge when useful.

Examples:

- `/Link`;
- `/Rect`;
- `/QuadPoints`;
- `/Outlines`;
- AcroForm flags;
- attachment stream bytes;
- password behavior;
- removed redacted text;
- persistent native text replacement.

### Browser console

Unexpected browser exceptions count as regressions even when UI later recovers.

Previously fixed examples:

- stale duplicate-page `getPage()` out-of-range;
- stale document loads overwriting success;
- overlapping PDF.js render tasks;
- OCR synthetic text missing style metadata.

## 11. UX rules

Do not expose every advanced option in the primary toolbar.

Use clear workflow modes:

- Edit;
- Annotate/Comment;
- Sign/Forms;
- Organize;
- Protect;
- Scan & OCR;
- All Tools.

Common visible-object edits should be page-centric.

Contextual properties:

- text -> text controls;
- image -> image controls;
- field -> form controls;
- annotation -> annotation controls;
- page -> page controls.

Avoid user-facing implementation jargon such as `PDFDict`, object ref, WASM table, or indirect function pointer.

Use professional labels:

- Edit PDF
- Add Text
- Organize Pages
- Scan & OCR
- Prepare Form
- Fill & Sign
- Protect PDF
- Redact
- Comments
- Document Properties
- Optimize PDF
- Export

## 12. Code rules for Codex

1. Read current implementation first.
2. Search tests before changing labels/DOM.
3. Put PDF structure logic in isolated `src/lib/*` modules.
4. Prefer isolated components for new tool groups.
5. Keep `App.tsx` changes minimal.
6. Preserve local-first privacy.
7. Do not add a backend unless genuinely necessary and approved.
8. Do not replace native editing with rasterization for convenience.
9. Every async mutation needs busy/status/error handling.
10. Ignore stale async document results after a newer byte state exists.
11. Cancel stale PDF.js canvas render tasks.
12. Preserve unknown PDF dictionary keys.
13. Clean dangling references after deletion.
14. Do not rewrite unchanged native geometry through rounded percentages.
15. Keep redaction/security destructive semantics explicit.
16. Do not ship temporary one-shot GitHub workflow patches.
17. Do not merge stale feature branches over newer `main`.
18. Use feature branches/PRs for substantial work.
19. Verify exported PDF structure.
20. Treat regression tests as product contracts.

## 13. Immediate Codex execution plan

### Step 1

```bash
git fetch --all --prune
git checkout main
git pull
```

Confirm current head.

### Step 2

Inspect PR #19, but do not merge it directly.

Read:

- `src/lib/advanced-forms.ts`
- `src/components/AdvancedFormWidgetManager.tsx`
- `src/advanced-form-widget-manager.css`
- `tests/advanced-form-widgets.spec.ts`

### Step 3

Create a clean branch:

```bash
git checkout -b feature/advanced-form-widgets-v2
```

Port only real product files.

Do not port the one-shot workflow/trigger.

### Step 4

Fix strict types directly.

### Step 5

Integrate `AdvancedFormWidgetManager` into the latest `AdvancedTools.tsx` next to the existing form property manager.

Pass:

- `bytes`
- `currentPage`
- `onBeforeMutate`
- `onApply`
- `onStatus`

Import the CSS.

Preserve the existing Objects button/modal contracts.

### Step 6

Run targeted QA:

```bash
npx playwright test tests/advanced-form-widgets.spec.ts
```

Then all gates:

```bash
npm run test:unit
npm run build
npx playwright test
```

### Step 7

Only merge after the exact candidate is green.

## 14. Definition of the Acrobat-clone goal

The goal is not pixel-for-pixel Adobe branding.

The goal is behavioral predictability.

A user familiar with Acrobat should be able to reason:

- “I want to edit this sentence” -> Edit -> click sentence -> edit.
- “I want to replace this image” -> Edit -> click image -> replace.
- “I want to rearrange pages” -> Organize Pages -> thumbnails.
- “This is scanned” -> Scan & OCR.
- “I need to hide this permanently” -> Redact -> mark -> Apply.
- “I need a fillable form” -> Prepare Form.
- “I need to sign” -> Fill & Sign.
- “I need comments” -> Comment.
- “I need a password” -> Protect.
- “I need smaller size” -> Optimize/Compress.
- “I need advanced PDF structures” -> Objects / advanced tools.

That workflow familiarity matters more than copying Acrobat's exact colors.

## 15. Official Adobe behavior references

When uncertain, use current official Adobe Acrobat HelpX documentation as the product-behavior source of truth.

Relevant topics:

- Edit PDF
- Change, replace, or delete text
- Add new text
- Format text
- Edit images/objects
- Organize Pages
- Scan & OCR / Recognize Text
- Correct recognized text
- Redaction / hidden-information removal
- Protect / security
- Prepare Form
- Fill & Sign
- Comments

Important behavior references:

- Acrobat Edit mode selects real content and exposes contextual properties.
- Existing text is selected and edited directly.
- New text is added by clicking on the page.
- Scans are OCR'd into searchable/selectable documents.
- OCR has page-range/language/settings and correction/review workflows.
- Organize Pages is thumbnail-centric.
- Redaction has a destructive Apply step.
- Security is encoded into the real PDF.

## 16. Final instruction

Do not spend the next iteration on another broad redesign.

The product already has substantial functionality and a high-level product shell.

Focus on closing capability gaps and moving common workflows closer to direct Acrobat-style page interaction.

For every feature:

1. identify the actual PDF structure/API;
2. implement the engine;
3. expose it in the correct workflow;
4. preserve local-first privacy;
5. test through the UI;
6. inspect the exported PDF;
7. reopen it when useful;
8. merge only after the full regression suite passes.

If blocked:

- finish all feasible surrounding work;
- document the exact blocker;
- document the best mitigation;
- do not substitute a fake implementation.

The quality bar is not “looks like a PDF editor.”

The quality bar is:

“An experienced Acrobat user can open PDF Forge and successfully perform the same class of PDF task, and the result is genuinely persisted into the PDF.”
