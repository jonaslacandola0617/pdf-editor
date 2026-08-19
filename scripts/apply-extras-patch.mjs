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

patch('src/App.tsx', [
  {
    label: 'lucide sticky note import',
    from: /Shapes,\s*Split,\s*Trash2,\s*Type/,
    to: 'Shapes, Split, StickyNote, Trash2, Type',
  },
  {
    label: 'extras library imports',
    from: "import { secureRedactPdf } from './lib/redaction'",
    to: "import { secureRedactPdf } from './lib/redaction'\nimport { embedNativeNotes } from './lib/pdf-notes'\nimport { annotationFromPreset, loadSignaturePresets, presetFromAnnotation, storeSignaturePresets, type SignaturePreset } from './lib/signature-presets'",
  },
  {
    label: 'comments panel type',
    from: "type Panel = 'pages' | 'library' | 'forms' | 'info'",
    to: "type Panel = 'pages' | 'library' | 'forms' | 'comments' | 'info'",
  },
  {
    label: 'signature preset state',
    from: "  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set())",
    to: "  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set())\n  const [signaturePresets, setSignaturePresets] = useState<SignaturePreset[]>(() => loadSignaturePresets())",
  },
  {
    label: 'reusable signature actions',
    from: /\n  const updateSelected = /,
    to: `
  const saveReusableSignature = (annotation: Annotation) => {
    const label = window.prompt('Name this reusable signature', \`Signature \${signaturePresets.length + 1}\`)
    if (label === null) return
    const preset = presetFromAnnotation(annotation, label)
    if (!preset) { setStatus('Draw a signature first.'); return }
    const next = [preset, ...signaturePresets].slice(0, 8)
    setSignaturePresets(next)
    storeSignaturePresets(next)
    setStatus('Reusable signature saved locally')
  }

  const insertSignaturePreset = (preset: SignaturePreset) => {
    addAnnotation(annotationFromPreset(preset, currentPage, color, strokeWidth))
    setStatus(\`Inserted \${preset.name}\`)
  }

  const removeSignaturePreset = (id: string) => {
    const next = signaturePresets.filter((preset) => preset.id !== id)
    setSignaturePresets(next)
    storeSignaturePresets(next)
  }

  const updateSelected = `,
  },
  {
    label: 'finalize native notes',
    from: /  const prepareFinalPdf = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[annotations, bytes, metadata, pageCount, rotations\]\)/,
    to: `  const prepareFinalPdf = useCallback(async () => {
    if (!bytes) throw new Error('No PDF is open.')
    const redactions = annotations.filter((ann) => ann.type === 'redaction')
    const notes = annotations.filter((ann) => ann.type === 'note')
    const ordinary = annotations.filter((ann) => ann.type !== 'redaction' && ann.type !== 'note')
    let finalized: Uint8Array
    if (redactions.length) {
      const flattened = await flattenAnnotations(bytes, annotationsForExport(ordinary, rotations), metadata)
      const redacted = await secureRedactPdf(arrayBufferFrom(flattened), redactions, rotations)
      finalized = new Uint8Array(redacted)
    } else {
      const rotated = rotations.some(Boolean) ? await reorderPdf(bytes, Array.from({ length: pageCount }, (_, i) => i), rotations) : bytes
      finalized = await flattenAnnotations(rotated, annotationsForExport(ordinary, rotations), metadata)
    }
    if (!notes.length) return finalized
    return new Uint8Array(await embedNativeNotes(arrayBufferFrom(finalized), notes))
  }, [annotations, bytes, metadata, pageCount, rotations])`,
  },
  {
    label: 'comments rail button',
    from: /(<button[\s\S]*?title="Form fields"[\s\S]*?<\/button>)/,
    to: `$1
          <button className={panel === 'comments' ? 'active' : ''} onClick={() => setPanel('comments')} title="Comments"><StickyNote /></button>`,
  },
  {
    label: 'comments panel',
    from: /\n        \{panel === 'info' &&/,
    to: `
        {panel === 'comments' && <>
          <div className="panel-heading"><div><span className="eyebrow">COMMENTS</span><h3>Notes</h3></div><span>{annotations.filter((ann) => ann.type === 'note').length}</span></div>
          <button className="drop-card comment-add" onClick={() => chooseTool('note')}><StickyNote /><strong>Add sticky note</strong><span>Click anywhere on a page</span></button>
          <div className="comment-list">
            {annotations.filter((ann) => ann.type === 'note').map((note) => <button key={note.id} className={selectedId === note.id ? 'active' : ''} onClick={() => { setCurrentPage(note.page); setSelectedId(note.id); chooseTool('select') }}><StickyNote /><span><strong>Page {note.page + 1}</strong><small>{note.text || 'Empty note'}</small></span></button>)}
            {!annotations.some((ann) => ann.type === 'note') && <div className="empty-panel"><StickyNote /><strong>No comments yet</strong><p>Add a sticky note and it will export as a standard PDF comment.</p></div>}
          </div>
        </>}

        {panel === 'info' &&`,
  },
  {
    label: 'note toolbar tool',
    from: /(\s*<button\s+className=\{tool === 'text'[\s\S]*?title="Add text"[\s\S]*?<\/button>)/,
    to: `$1
              <button className={tool === 'note' ? 'active' : ''} onClick={() => chooseTool('note')} title="Sticky note"><StickyNote /></button>`,
  },
  {
    label: 'note stage hint',
    from: "tool === 'text' ? 'Click anywhere on the page to add new text'",
    to: "tool === 'text' ? 'Click anywhere on the page to add new text' : tool === 'note' ? 'Click anywhere on the page to add a sticky note'",
  },
  {
    label: 'note right panel editor',
    from: /\{selected\?\.type === 'redaction' \?/,
    to: `{selected?.type === 'note' && <label className="property-field">Comment<textarea rows={6} value={selected.text || ''} onChange={(e) => setAnnotations((items) => items.map((ann) => ann.id === selected.id ? { ...ann, text: e.target.value } : ann))} placeholder="Write a comment…" /></label>}
            {selected?.type === 'redaction' ?`,
  },
  {
    label: 'signature presets right panel',
    from: /\{!selected && tool === 'editText' &&/,
    to: `{selected?.type === 'signature' && <div className="signature-preset-panel"><strong>Reusable signature</strong><button className="soft-btn" onClick={() => saveReusableSignature(selected)}>Save this signature</button></div>}
            {!selected && tool === 'signature' && signaturePresets.length > 0 && <div className="signature-preset-panel"><strong>Saved signatures</strong><div className="signature-preset-list">{signaturePresets.map((preset) => <div key={preset.id}><button onClick={() => insertSignaturePreset(preset)}>{preset.name}</button><button className="preset-delete" title="Delete saved signature" onClick={() => removeSignaturePreset(preset.id)}>×</button></div>)}</div></div>}
            {!selected && tool === 'note' && <div className="right-help"><strong>Sticky note</strong><p>Click a location on the page. Notes are stored locally while editing and export as standard PDF comment annotations.</p></div>}
            {!selected && tool === 'editText' &&`,
  },
])

patch('src/components/PdfPageCanvas.tsx', [
  {
    label: 'note placement tool',
    from: /(if \(tool === 'text'\) \{[\s\S]*?\n\s*\})/,
    to: `$1
    if (tool === 'note') {
      onAdd({ id: crypto.randomUUID(), page: pageIndex, type: 'note', x: p.x, y: p.y, text: 'New note', color: '#facc15' })
      return
    }`,
  },
  {
    label: 'note renderer',
    from: /(\s*if \(ann\.type === 'text'\) return)/,
    to: `
          if (ann.type === 'note') return <button key={ann.id} className={\`annotation note-annotation \${selected ? 'selected' : ''}\`} style={{ left: \`\${ann.x * 100}%\`, top: \`\${ann.y * 100}%\` }} title={ann.text || 'Note'} onPointerDown={(e) => beginAnnotationEdit(e, ann, 'move')}><span>💬</span></button>
$1`,
  },
])

patch('src/components/AdvancedTools.tsx', [
  {
    label: 'notes helper import',
    from: "import { secureRedactPdf } from '../lib/redaction'",
    to: "import { secureRedactPdf } from '../lib/redaction'\nimport { embedNativeNotes } from '../lib/pdf-notes'",
  },
  {
    label: 'advanced finalization notes',
    from: /  const prepareFinal = async \(\) => \{[\s\S]*?\n  \}/,
    to: `  const prepareFinal = async () => {
    const redactions = annotations.filter((ann) => ann.type === 'redaction')
    const notes = annotations.filter((ann) => ann.type === 'note')
    const ordinary = annotations.filter((ann) => ann.type !== 'redaction' && ann.type !== 'note')
    let finalized: Uint8Array
    if (redactions.length) {
      const flattened = await flattenAnnotations(bytes, forExport(ordinary, rotations), metadata)
      finalized = new Uint8Array(await secureRedactPdf(toArrayBuffer(flattened), redactions, rotations))
    } else {
      const rotated = rotations.some(Boolean) ? await reorderPdf(bytes, Array.from({ length: pageCount }, (_, i) => i), rotations) : bytes
      finalized = await flattenAnnotations(rotated, forExport(ordinary, rotations), metadata)
    }
    if (!notes.length) return finalized
    return new Uint8Array(await embedNativeNotes(toArrayBuffer(finalized), notes))
  }`,
  },
])

patch('src/components/AllTools.tsx', [
  {
    label: 'all tools icons',
    from: /MousePointer2, PenLine,/,
    to: 'Bookmark, MousePointer2, PenLine,',
  },
  {
    label: 'sticky note icon import',
    from: /Search, Shapes, Split,\s*Trash2, Type,/,
    to: 'Search, Shapes, Split, StickyNote, Trash2, Type,',
  },
  {
    label: 'all tools note action',
    from: /(\{ label: 'Add text',[^\n]+\n)/,
    to: `$1        { label: 'Sticky note', description: 'Add a PDF comment at a page location.', icon: StickyNote, run: () => activateTitle('Sticky note') },\n`,
  },
  {
    label: 'all tools bookmark action',
    from: /(\{ label: 'Search \/ OCR',[^\n]+\n)/,
    to: `        { label: 'Bookmarks & favorites', description: 'Navigate the PDF outline and favorite local documents.', icon: Bookmark, run: () => activateTitle('Bookmarks & favorites') },\n$1`,
  },
])

fs.appendFileSync('src/completion.css', `
.note-annotation{position:absolute!important;width:30px!important;height:30px!important;min-width:30px!important;padding:0!important;display:grid!important;place-items:center!important;transform:translate(-4px,-4px);border-radius:8px!important;border:1px solid #b68b13!important;background:#facc15!important;color:#372b03!important;box-shadow:0 4px 12px rgba(0,0,0,.24);font-size:16px!important;z-index:6}.note-annotation.selected{box-shadow:0 0 0 2px #fff,0 0 0 4px #e5483f,0 7px 18px rgba(0,0,0,.32)}.comment-list{display:flex;flex-direction:column;gap:5px;margin-top:10px}.comment-list>button{display:flex;align-items:flex-start;gap:8px;width:100%;text-align:left;border:1px solid transparent;background:#202024;color:#d8d8dc;border-radius:8px;padding:9px;cursor:pointer}.comment-list>button:hover,.comment-list>button.active{background:#29292e;border-color:#424249}.comment-list>button svg{color:#facc15;flex:0 0 auto}.comment-list>button span{min-width:0;display:flex;flex-direction:column;gap:3px}.comment-list>button strong{font-size:11px}.comment-list>button small{color:#8d8d96;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}.comment-add{margin-top:4px}.signature-preset-panel{display:flex;flex-direction:column;gap:8px;border-top:1px solid #303035;padding-top:14px;margin-top:14px}.signature-preset-panel>strong{font-size:12px}.signature-preset-list{display:flex;flex-direction:column;gap:5px}.signature-preset-list>div{display:grid;grid-template-columns:1fr 30px;gap:4px}.signature-preset-list button{border:1px solid #36363c;background:#25252a;color:#ddd;border-radius:7px;padding:7px 8px;text-align:left;cursor:pointer}.signature-preset-list .preset-delete{text-align:center;color:#e99590}.signature-preset-list button:hover{background:#303036}
`)

console.log('Extras state integration applied.')
