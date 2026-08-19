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
    label: 'advanced metadata option',
    from: "  annotations?: Annotation[]\n  status?: string\n}",
    to: "  annotations?: Annotation[]\n  metadata?: PdfMetadata\n  status?: string\n}",
  },
  {
    label: 'advanced metadata apply',
    from: "    if (options.annotations) setAnnotations(options.annotations)\n    if (typeof options.page === 'number')",
    to: "    if (options.annotations) setAnnotations(options.annotations)\n    if (options.metadata) setMetadata(options.metadata)\n    if (typeof options.page === 'number')",
  },
])

patch('src/components/AdvancedTools.tsx', [
  {
    label: 'structure imports',
    from: "import { embedNativeNotes } from '../lib/pdf-notes'",
    to: "import { embedNativeNotes } from '../lib/pdf-notes'\nimport { addBatesNumbers, addFormField, addTopLevelBookmark, addUriLink, privacyCleanupPdf, type FormFieldKind } from '../lib/structure-tools'",
  },
  {
    label: 'metadata apply type',
    from: "type ApplyOptions = { page?: number; rotations?: number[]; annotations?: Annotation[]; status?: string }",
    to: "type ApplyOptions = { page?: number; rotations?: number[]; annotations?: Annotation[]; metadata?: PdfMetadata; status?: string }",
  },
  {
    label: 'structure states',
    from: "  const [crop, setCrop] = useState({ left: 0, right: 0, top: 0, bottom: 0 })",
    to: `  const [crop, setCrop] = useState({ left: 0, right: 0, top: 0, bottom: 0 })
  const [formKind, setFormKind] = useState<FormFieldKind>('text')
  const [formName, setFormName] = useState('field_name')
  const [formOptions, setFormOptions] = useState('Option 1, Option 2')
  const [formRequired, setFormRequired] = useState(false)
  const [fieldRect, setFieldRect] = useState({ x: 12, y: 18, width: 42, height: 7 })
  const [linkUrl, setLinkUrl] = useState('https://')
  const [linkRect, setLinkRect] = useState({ x: 12, y: 30, width: 35, height: 6 })
  const [bookmarkTitle, setBookmarkTitle] = useState('')
  const [batesPrefix, setBatesPrefix] = useState('DOC-')
  const [batesStart, setBatesStart] = useState(1)
  const [batesDigits, setBatesDigits] = useState(6)`,
  },
  {
    label: 'structure actions',
    from: "  const strongCompress = () => mutate('Strong compression', () => rasterCompressPdf(bytes, {",
    to: `  const createFormField = () => mutate('Adding form field', async () => (await addFormField(bytes, {
    kind: formKind,
    name: formName,
    pageIndex: currentPage,
    xPercent: fieldRect.x,
    yPercent: fieldRect.y,
    widthPercent: fieldRect.width,
    heightPercent: fieldRect.height,
    options: formOptions.split(',').map((value) => value.trim()).filter(Boolean),
    required: formRequired,
  })).bytes)
  const createLink = () => mutate('Adding PDF link', () => addUriLink(bytes, { pageIndex: currentPage, url: linkUrl, xPercent: linkRect.x, yPercent: linkRect.y, widthPercent: linkRect.width, heightPercent: linkRect.height }))
  const createBookmark = () => mutate('Adding bookmark', () => addTopLevelBookmark(bytes, bookmarkTitle || \`Page \${currentPage + 1}\`, currentPage))
  const applyBates = () => mutate('Adding Bates numbers', () => addBatesNumbers(bytes, { prefix: batesPrefix, start: batesStart, digits: batesDigits }))
  const privacyCleanup = () => mutate('Cleaning document privacy data', () => privacyCleanupPdf(bytes), { metadata: { title: '', author: '', subject: '', keywords: '' } })

  const strongCompress = () => mutate('Strong compression', () => rasterCompressPdf(bytes, {`,
  },
  {
    label: 'structure cards',
    from: "        <section className=\"advanced-card danger-card\"><h3><ScanLine /> Secure redaction</h3>",
    to: `        <section className="advanced-card structure-card"><h3><Type /> Create form field</h3><p>Add a real AcroForm widget to the current page.</p><div className="advanced-row"><select aria-label="Form field type" value={formKind} onChange={(e) => setFormKind(e.target.value as FormFieldKind)}><option value="text">Text field</option><option value="checkbox">Checkbox</option><option value="dropdown">Dropdown</option><option value="list">Option list</option><option value="radio">Radio group</option></select><input aria-label="Form field name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Field name" /></div>{['dropdown','list','radio'].includes(formKind) && <input aria-label="Form field options" value={formOptions} onChange={(e) => setFormOptions(e.target.value)} placeholder="Option 1, Option 2" />}<div className="position-grid">{(['x','y','width','height'] as const).map((key) => <label key={key}>{key}<input aria-label={\`Field \${key} percent\`} type="number" min="0" max="100" value={fieldRect[key]} onChange={(e) => setFieldRect({ ...fieldRect, [key]: Number(e.target.value) })} /><span>%</span></label>)}</div><label className="check-row"><input type="checkbox" checked={formRequired} onChange={(e) => setFormRequired(e.target.checked)} /> Required field</label><button onClick={createFormField}>Add form field</button></section>
        <section className="advanced-card structure-card"><h3><FileSearch /> Add web link</h3><p>Create a native clickable URI link rectangle on the current page.</p><input aria-label="Link URL" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" /><div className="position-grid">{(['x','y','width','height'] as const).map((key) => <label key={key}>{key}<input aria-label={\`Link \${key} percent\`} type="number" min="0" max="100" value={linkRect[key]} onChange={(e) => setLinkRect({ ...linkRect, [key]: Number(e.target.value) })} /><span>%</span></label>)}</div><button onClick={createLink}>Add clickable link</button></section>
        <section className="advanced-card structure-card"><h3><FilePlus2 /> Bookmark current page</h3><p>Add a top-level bookmark to the PDF outline.</p><input aria-label="Bookmark title" value={bookmarkTitle} onChange={(e) => setBookmarkTitle(e.target.value)} placeholder={\`Page \${currentPage + 1} bookmark\`} /><button onClick={createBookmark}>Add bookmark</button></section>
        <section className="advanced-card structure-card"><h3><Type /> Bates numbering</h3><p>Apply stable document-control IDs to every page.</p><div className="advanced-row"><input aria-label="Bates prefix" value={batesPrefix} onChange={(e) => setBatesPrefix(e.target.value)} placeholder="Prefix" /><input aria-label="Bates start" type="number" min="0" value={batesStart} onChange={(e) => setBatesStart(Number(e.target.value))} /></div><label>Digits <input aria-label="Bates digits" type="number" min="1" max="12" value={batesDigits} onChange={(e) => setBatesDigits(Number(e.target.value))} /></label><button onClick={applyBates}>Apply Bates numbers</button></section>
        <section className="advanced-card danger-card"><h3><ShieldCheck /> Privacy cleanup</h3><p>Remove document metadata, document/page additional actions, JavaScript name trees, embedded-file name trees, file-attachment annotations, and JavaScript/Launch annotation actions.</p><button className="danger-action" onClick={privacyCleanup}>Remove privacy data & active content</button></section>
        <section className="advanced-card danger-card"><h3><ScanLine /> Secure redaction</h3>`,
  },
])

patch('src/components/AllTools.tsx', [
  {
    label: 'structure actions all tools',
    from: "        { label: 'Document tools', description: 'Watermarks, page numbers, OCR export, optimize, protect and print.', icon: WandSparkles, run: () => activateTitle('Document tools') },",
    to: `        { label: 'Document tools', description: 'Watermarks, page numbers, OCR export, optimize, protect and print.', icon: WandSparkles, run: () => activateTitle('Document tools') },
        { label: 'Create form fields', description: 'Author text, checkbox, dropdown, list, or radio AcroForm fields.', icon: FormInput, run: () => activateTitle('Document tools') },
        { label: 'Add links & bookmarks', description: 'Add native URI links and PDF outline bookmarks.', icon: FileInput, run: () => activateTitle('Document tools') },
        { label: 'Bates numbering', description: 'Apply document-control identifiers across pages.', icon: Type, run: () => activateTitle('Document tools') },
        { label: 'Privacy cleanup', description: 'Remove metadata, embedded-file references, and unsafe active actions.', icon: Info, run: () => activateTitle('Document tools') },`,
  },
])

const cssPath = 'src/completion.css'
let css = fs.readFileSync(cssPath, 'utf8')
if (!css.includes('.position-grid{')) {
  css += `\n.position-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.position-grid label{display:grid;grid-template-columns:45px 1fr 16px;align-items:center;gap:5px;color:#aaaab2;font-size:11px;text-transform:capitalize}.position-grid input{padding:6px!important}.advanced-card select{width:100%;background:#121214;border:1px solid #36363d;border-radius:8px;color:#f5f5f6;padding:9px 10px}.check-row{display:flex!important;align-items:center;gap:7px!important;color:#aaaab2!important;font-size:12px!important}.check-row input{width:16px!important;height:16px!important;accent-color:#e5483f}.structure-card{border-color:#34343a}\n`
  fs.writeFileSync(cssPath, css)
}

console.log('Structure UI integration applied.')
