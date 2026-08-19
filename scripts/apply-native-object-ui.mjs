import fs from 'node:fs'

function patch(path, transforms) {
  let source = fs.readFileSync(path, 'utf8')
  for (const { label, from, to } of transforms) {
    const next = source.replace(from, to)
    if (next === source) throw new Error(`${path}: patch failed: ${label}`)
    source = next
  }
  fs.writeFileSync(path, source)
}

patch('src/components/AdvancedTools.tsx', [
  {
    label: 'native manager import',
    from: "import { embedNativeNotes } from '../lib/pdf-notes'",
    to: "import { embedNativeNotes } from '../lib/pdf-notes'\nimport { NativeObjectManager } from './NativeObjectManager'",
  },
  {
    label: 'native manager card',
    from: "      <div className=\"advanced-grid\">",
    to: "      <div className=\"advanced-grid\">\n        <NativeObjectManager bytes={bytes} onBeforeMutate={onBeforeMutate} onApply={onApply} onStatus={onStatus} />",
  },
])

patch('src/components/AllTools.tsx', [
  {
    label: 'manage native objects action',
    from: "        { label: 'Document tools', description: 'Watermarks, page numbers, OCR export, optimize, protect and print.', icon: WandSparkles, run: () => activateTitle('Document tools') },",
    to: "        { label: 'Document tools', description: 'Watermarks, page numbers, OCR export, optimize, protect and print.', icon: WandSparkles, run: () => activateTitle('Document tools') },\n        { label: 'Manage embedded objects', description: 'Edit or remove existing comments, URI links and outline bookmarks.', icon: FileSearch, run: () => activateTitle('Document tools') },",
  },
])

const cssPath = 'src/completion.css'
let css = fs.readFileSync(cssPath, 'utf8')
if (!css.includes('.native-object-manager{')) {
  css += `\n.native-object-manager{grid-column:1/-1}.native-object-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.native-object-tabs button{justify-content:flex-start!important;min-width:0}.native-object-tabs button.active{background:#3a2a25!important;border-color:#734235!important;color:#ff9a83!important}.native-object-tabs button svg{width:14px}.native-object-tabs button span{margin-left:auto;color:#85858f;font-size:10px}.native-object-list{display:flex;flex-direction:column;gap:8px;max-height:360px;overflow:auto;padding-right:3px}.native-object-row{display:flex;flex-direction:column;gap:7px;border:1px solid #303036;background:#19191d;border-radius:9px;padding:10px}.native-object-row textarea,.native-object-row input{width:100%;background:#111113;border:1px solid #36363d;border-radius:7px;color:#ededf0;padding:8px;font-size:11px}.native-object-row textarea{resize:vertical}.native-object-meta{display:flex;align-items:center;gap:6px;color:#92929c;font-size:10px}.native-object-meta svg{width:13px;color:#c0c0c8}.native-object-actions{display:flex;justify-content:flex-end;gap:6px}.native-object-actions button{padding:6px 9px!important;font-size:10px}.native-object-actions svg{width:12px}.native-object-empty{padding:18px;text-align:center;color:#777781;font-size:11px;border:1px dashed #303036;border-radius:8px}@media(max-width:760px){.native-object-tabs{grid-template-columns:1fr}.native-object-manager{grid-column:auto}}\n`
  fs.writeFileSync(cssPath, css)
}

console.log('Native PDF object manager integrated.')
