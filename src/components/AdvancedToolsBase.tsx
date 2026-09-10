import { useRef, useState } from 'react'
import {
  BadgeCheck, Crop, FileLock2, FilePlus2, FileSearch, ImagePlus, Printer, ScanLine,
  ShieldCheck, Sparkles, Stamp, Type, WandSparkles, X,
} from 'lucide-react'
import type { Annotation, PdfMetadata, Point } from '../types'
import {
  addHeaderFooter, addImageToPage, addWatermark, cropPage, downloadBytes, flattenAnnotations, flattenFormFields,
  insertBlankPage, rotatePdfPages, replacePageWithFile,
} from '../lib/pdf'
import { insertFilesAt, rasterCompressPdf } from '../lib/document-extra'
import { encryptPdf, optimizePdf } from '../lib/security'
import { makeSearchablePdf } from '../lib/searchable'
import { secureRedactPdf } from '../lib/redaction'
import { embedNativeNotes } from '../lib/pdf-notes'
import { addBatesNumbers, addFormField, addTopLevelBookmark, addUriLink, privacyCleanupPdf, type FormFieldKind } from '../lib/structure-tools'

type ApplyOptions = { page?: number; rotations?: number[]; annotations?: Annotation[]; metadata?: PdfMetadata; status?: string }
type Props = {
  bytes: ArrayBuffer
  name: string
  pageCount: number
  currentPage: number
  rotations: number[]
  annotations: Annotation[]
  metadata: PdfMetadata
  onBeforeMutate: () => void
  onApply: (bytes: ArrayBuffer, options?: ApplyOptions) => void
  onStatus: (status: string) => void
}

type ToolCategory = 'pages' | 'forms' | 'security' | 'output'
type ToolId =
  | 'pages' | 'crop' | 'watermark' | 'furniture' | 'image'
  | 'form' | 'link' | 'bookmark' | 'bates'
  | 'privacy' | 'redaction'
  | 'ocr' | 'optimize' | 'compress' | 'protect' | 'print'

type ToolMeta = {
  id: ToolId
  label: string
  description: string
  icon: React.ComponentType<{ size?: number }>
}

const categories: Array<{ id: ToolCategory; label: string; description: string; tools: ToolMeta[] }> = [
  {
    id: 'pages', label: 'Pages & content', description: 'Build pages and add visible content.', tools: [
      { id: 'pages', label: 'Pages', description: 'Insert, replace, or add blank pages.', icon: FilePlus2 },
      { id: 'crop', label: 'Crop page', description: 'Adjust the visible crop margins of this page.', icon: Crop },
      { id: 'watermark', label: 'Watermark & stamps', description: 'Add a watermark or common document stamp.', icon: Stamp },
      { id: 'furniture', label: 'Header, footer & numbers', description: 'Apply headers, footers, and page numbering.', icon: Type },
      { id: 'image', label: 'Insert image', description: 'Place a PNG or JPG on the current page.', icon: ImagePlus },
    ],
  },
  {
    id: 'forms', label: 'Forms & navigation', description: 'Interactive fields and document navigation.', tools: [
      { id: 'form', label: 'Create form field', description: 'Add a real interactive AcroForm field.', icon: Type },
      { id: 'link', label: 'Add web link', description: 'Create a clickable web link on this page.', icon: FileSearch },
      { id: 'bookmark', label: 'Bookmark page', description: 'Add the current page to the PDF outline.', icon: FilePlus2 },
      { id: 'bates', label: 'Bates numbering', description: 'Apply stable document-control numbers.', icon: Type },
    ],
  },
  {
    id: 'security', label: 'Security & privacy', description: 'Sensitive and irreversible document operations.', tools: [
      { id: 'privacy', label: 'Privacy cleanup', description: 'Remove metadata, scripts, attachments, and active content.', icon: ShieldCheck },
      { id: 'redaction', label: 'Secure redaction', description: 'Permanently remove content covered by redaction marks.', icon: ScanLine },
    ],
  },
  {
    id: 'output', label: 'Output & optimize', description: 'Searchability, size, protection, and printing.', tools: [
      { id: 'ocr', label: 'OCR searchable PDF', description: 'Add a searchable text layer to scanned pages.', icon: FileSearch },
      { id: 'optimize', label: 'Lossless optimize', description: 'Reduce structural overhead while preserving native content.', icon: Sparkles },
      { id: 'compress', label: 'Strong compression', description: 'Raster-compress scans and image-heavy documents.', icon: Sparkles },
      { id: 'protect', label: 'Password protect', description: 'Export a separate AES-256 encrypted copy.', icon: FileLock2 },
      { id: 'print', label: 'Print', description: 'Finalize pending edits and open the print dialog.', icon: Printer },
    ],
  },
]

function remapInsert(annotations: Annotation[], index: number, count = 1) {
  return annotations.map((ann) => ({ ...ann, page: ann.page >= index ? ann.page + count : ann.page }))
}

function inverseRotatePoint(x: number, y: number, rotation: number): Point {
  const r = ((rotation % 360) + 360) % 360
  if (r === 90) return { x: y, y: 1 - x }
  if (r === 180) return { x: 1 - x, y: 1 - y }
  if (r === 270) return { x: 1 - y, y: x }
  return { x, y }
}

function forExport(annotations: Annotation[], rotations: number[]) {
  return annotations.map((ann) => {
    const rotation = rotations[ann.page] || 0
    if (!rotation) return ann
    if (ann.points) return { ...ann, points: ann.points.map((p) => inverseRotatePoint(p.x, p.y, rotation)) }
    if (ann.width && ann.height) {
      const corners = [
        inverseRotatePoint(ann.x, ann.y, rotation),
        inverseRotatePoint(ann.x + ann.width, ann.y, rotation),
        inverseRotatePoint(ann.x, ann.y + ann.height, rotation),
        inverseRotatePoint(ann.x + ann.width, ann.y + ann.height, rotation),
      ]
      const xs = corners.map((p) => p.x); const ys = corners.map((p) => p.y)
      return { ...ann, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    }
    const point = inverseRotatePoint(ann.x, ann.y, rotation)
    return { ...ann, x: point.x, y: point.y }
  })
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function AdvancedTools({ bytes, name, pageCount, currentPage, rotations, annotations, metadata, onBeforeMutate, onApply, onStatus }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [activeCategory, setActiveCategory] = useState<ToolCategory>('pages')
  const [activeTool, setActiveTool] = useState<ToolId>('pages')
  const [watermark, setWatermark] = useState('DRAFT')
  const [header, setHeader] = useState('')
  const [footer, setFooter] = useState('')
  const [password, setPassword] = useState('')
  const [imageWidth, setImageWidth] = useState(35)
  const [compressionQuality, setCompressionQuality] = useState(68)
  const [crop, setCrop] = useState({ left: 0, right: 0, top: 0, bottom: 0 })
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
  const [batesDigits, setBatesDigits] = useState(6)
  const replaceInput = useRef<HTMLInputElement | null>(null)
  const insertInput = useRef<HTMLInputElement | null>(null)
  const insertPosition = useRef<'before' | 'after'>('after')
  const imageInput = useRef<HTMLInputElement | null>(null)

  const mutate = async (label: string, task: () => Promise<ArrayBuffer>, options?: ApplyOptions) => {
    if (busy) return
    onBeforeMutate(); setBusy(label); onStatus(`${label}…`)
    try { const next = await task(); onApply(next, { ...options, status: `${label} complete` }) }
    catch (error) { console.error(error); onStatus(error instanceof Error ? error.message : `${label} failed`) }
    finally { setBusy('') }
  }

  const prepareFinal = async () => {
    const redactions = annotations.filter((ann) => ann.type === 'redaction')
    const notes = annotations.filter((ann) => ann.type === 'note')
    const ordinary = annotations.filter((ann) => ann.type !== 'redaction' && ann.type !== 'note')
    let finalized: Uint8Array
    if (redactions.length) {
      const flattened = await flattenAnnotations(bytes, forExport(ordinary, rotations), metadata)
      finalized = new Uint8Array(await secureRedactPdf(toArrayBuffer(flattened), redactions, rotations))
    } else {
      const rotated = rotations.some(Boolean) ? await rotatePdfPages(bytes, rotations) : bytes
      finalized = await flattenAnnotations(rotated, forExport(ordinary, rotations), metadata)
    }
    if (!notes.length) return finalized
    return new Uint8Array(await embedNativeNotes(toArrayBuffer(finalized), notes))
  }

  const insertAt = (index: number) => mutate('Inserting blank page', () => insertBlankPage(bytes, index, 'match'), {
    page: index,
    rotations: [...rotations.slice(0, index), 0, ...rotations.slice(index)],
    annotations: remapInsert(annotations, index),
  })

  const chooseInsert = (position: 'before' | 'after') => { insertPosition.current = position; insertInput.current?.click() }

  const insertExternal = async (files: FileList | null) => {
    if (!files?.length || busy) return
    const index = insertPosition.current === 'before' ? currentPage : currentPage + 1
    onBeforeMutate(); setBusy('Inserting pages'); onStatus('Inserting PDF/image pages…')
    try {
      const result = await insertFilesAt(bytes, index, Array.from(files))
      onApply(result.bytes, {
        page: index,
        rotations: [...rotations.slice(0, index), ...Array(result.inserted).fill(0), ...rotations.slice(index)],
        annotations: remapInsert(annotations, index, result.inserted),
        status: `Inserted ${result.inserted} page${result.inserted === 1 ? '' : 's'}`,
      })
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not insert these pages.')
    } finally {
      setBusy('')
      if (insertInput.current) insertInput.current.value = ''
    }
  }

  const replaceCurrent = async (file: File | undefined) => { if (file) await mutate('Replacing page', () => replacePageWithFile(bytes, currentPage, file), { annotations: annotations.filter((ann) => ann.page !== currentPage) }) }
  const addImage = async (file: File | undefined) => { if (file) await mutate('Adding image', () => addImageToPage(bytes, currentPage, file, { widthPercent: imageWidth / 100 })) }
  const applyCrop = () => mutate('Cropping page', () => cropPage(bytes, currentPage, { left: crop.left / 100, right: crop.right / 100, top: crop.top / 100, bottom: crop.bottom / 100 }))
  const applyWatermark = (text = watermark, pageOnly = false) => mutate('Applying watermark', () => addWatermark(bytes, { text, pageIndex: pageOnly ? currentPage : undefined }))
  const addPageFurniture = () => mutate('Adding headers and page numbers', () => addHeaderFooter(bytes, { header, footer, pageNumbers: true }))
  const optimize = () => mutate('Optimizing PDF', () => optimizePdf(bytes))
  const searchable = () => mutate('Creating searchable PDF', () => makeSearchablePdf(bytes, (page, total) => onStatus(`OCR searchable export: page ${page} of ${total}`)))
  const createFormField = () => mutate('Adding form field', async () => (await addFormField(bytes, {
    kind: formKind, name: formName, pageIndex: currentPage,
    xPercent: fieldRect.x, yPercent: fieldRect.y, widthPercent: fieldRect.width, heightPercent: fieldRect.height,
    options: formOptions.split(',').map((value) => value.trim()).filter(Boolean), required: formRequired,
  })).bytes)
  const flattenForm = () => mutate('Flattening form fields', () => flattenFormFields(bytes))
  const createLink = () => mutate('Adding PDF link', () => addUriLink(bytes, { pageIndex: currentPage, url: linkUrl, xPercent: linkRect.x, yPercent: linkRect.y, widthPercent: linkRect.width, heightPercent: linkRect.height }))
  const createBookmark = () => mutate('Adding bookmark', () => addTopLevelBookmark(bytes, bookmarkTitle || `Page ${currentPage + 1}`, currentPage))
  const applyBates = () => mutate('Adding Bates numbers', () => addBatesNumbers(bytes, { prefix: batesPrefix, start: batesStart, digits: batesDigits }))
  const privacyCleanup = () => mutate('Cleaning document privacy data', () => privacyCleanupPdf(bytes), { metadata: { title: '', author: '', subject: '', keywords: '' } })
  const strongCompress = () => mutate('Strong compression', () => rasterCompressPdf(bytes, { quality: compressionQuality / 100, onProgress: (page, total) => onStatus(`Strong compression: page ${page} of ${total}`) }))

  const applyRedactions = () => {
    const marks = annotations.filter((ann) => ann.type === 'redaction')
    if (!marks.length) { onStatus('Mark one or more areas with the Redact tool first.'); return }
    void mutate('Applying secure redactions', () => secureRedactPdf(bytes, marks, rotations, (page, total) => onStatus(`Secure redaction: page ${page} of ${total}`)), {
      rotations: Array(pageCount).fill(0), annotations: annotations.filter((ann) => ann.type !== 'redaction'),
    })
  }

  const protect = async () => {
    if (!password.trim()) { onStatus('Enter a password for the protected export.'); return }
    if (busy) return
    setBusy('Protecting PDF'); onStatus('Creating AES-256 protected PDF…')
    try {
      const finalized = await prepareFinal()
      const protectedBytes = await encryptPdf(toArrayBuffer(finalized), password)
      downloadBytes(new Uint8Array(protectedBytes), `${name.replace(/\.pdf$/i, '')}-protected.pdf`)
      onStatus('Protected PDF exported')
    } catch (error) { console.error(error); onStatus(error instanceof Error ? error.message : 'Password protection failed') }
    finally { setBusy('') }
  }

  const print = async () => {
    if (busy) return
    setBusy('Preparing print')
    try {
      const finalized = await prepareFinal()
      const url = URL.createObjectURL(new Blob([finalized as BlobPart], { type: 'application/pdf' }))
      const frame = document.createElement('iframe')
      frame.style.position = 'fixed'; frame.style.width = '1px'; frame.style.height = '1px'; frame.style.opacity = '0'; frame.src = url
      document.body.appendChild(frame)
      frame.onload = () => window.setTimeout(() => {
        frame.contentWindow?.focus(); frame.contentWindow?.print()
        window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 2000)
      }, 300)
      onStatus('Print dialog opened')
    } catch (error) { console.error(error); onStatus('Could not prepare this PDF for printing.') }
    finally { setBusy('') }
  }

  const chooseCategory = (category: ToolCategory) => {
    setActiveCategory(category)
    const first = categories.find((item) => item.id === category)?.tools[0]
    if (first) setActiveTool(first.id)
  }

  const currentCategory = categories.find((item) => item.id === activeCategory) || categories[0]
  const currentTool = currentCategory.tools.find((item) => item.id === activeTool) || currentCategory.tools[0]
  const ToolIcon = currentTool.icon

  const toolContent = () => {
    switch (activeTool) {
      case 'pages':
        return <div className="advanced-focus-form"><div className="advanced-row"><button onClick={() => insertAt(currentPage)}>Blank before</button><button onClick={() => insertAt(currentPage + 1)}>Blank after</button></div><div className="advanced-row"><button onClick={() => chooseInsert('before')}>Insert file before</button><button onClick={() => chooseInsert('after')}>Insert file after</button></div><button onClick={() => replaceInput.current?.click()}>Replace current page</button><input ref={insertInput} hidden multiple type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => void insertExternal(e.target.files)} /><input ref={replaceInput} hidden type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => void replaceCurrent(e.target.files?.[0])} /></div>
      case 'crop':
        return <div className="advanced-focus-form"><div className="crop-grid">{(['top', 'right', 'bottom', 'left'] as const).map((side) => <label key={side}>{side}<input type="number" min="0" max="45" value={crop[side]} onChange={(e) => setCrop({ ...crop, [side]: Number(e.target.value) })} /><span>%</span></label>)}</div><button onClick={applyCrop}>Apply crop</button></div>
      case 'watermark':
        return <div className="advanced-focus-form"><label>Watermark text<input value={watermark} onChange={(e) => setWatermark(e.target.value)} placeholder="DRAFT" /></label><div className="advanced-row"><button onClick={() => applyWatermark()}>Apply to all pages</button><button onClick={() => applyWatermark(watermark, true)}>Current page only</button></div><div className="stamp-row">{['APPROVED', 'DRAFT', 'CONFIDENTIAL'].map((stamp) => <button key={stamp} onClick={() => applyWatermark(stamp, true)}>{stamp}</button>)}</div></div>
      case 'furniture':
        return <div className="advanced-focus-form"><label>Header<input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="Supports {page} and {pages}" /></label><label>Footer<input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Footer text" /></label><button onClick={addPageFurniture}>Apply header, footer & page numbers</button></div>
      case 'image':
        return <div className="advanced-focus-form"><label>Image width <input type="range" min="10" max="90" value={imageWidth} onChange={(e) => setImageWidth(Number(e.target.value))} /><strong>{imageWidth}%</strong></label><button onClick={() => imageInput.current?.click()}>Choose PNG or JPG</button><input ref={imageInput} hidden type="file" accept="image/png,image/jpeg" onChange={(e) => void addImage(e.target.files?.[0])} /></div>
      case 'form':
        return <div className="advanced-focus-form"><div className="advanced-row"><select aria-label="Form field type" value={formKind} onChange={(e) => setFormKind(e.target.value as FormFieldKind)}><option value="text">Text field</option><option value="checkbox">Checkbox</option><option value="dropdown">Dropdown</option><option value="list">Option list</option><option value="radio">Radio group</option></select><input aria-label="Form field name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Field name" /></div>{['dropdown','list','radio'].includes(formKind) && <input aria-label="Form field options" value={formOptions} onChange={(e) => setFormOptions(e.target.value)} placeholder="Option 1, Option 2" />}<div className="position-grid">{(['x','y','width','height'] as const).map((key) => <label key={key}>{key}<input aria-label={`Field ${key} percent`} type="number" min="0" max="100" value={fieldRect[key]} onChange={(e) => setFieldRect({ ...fieldRect, [key]: Number(e.target.value) })} /><span>%</span></label>)}</div><label className="check-row"><input type="checkbox" checked={formRequired} onChange={(e) => setFormRequired(e.target.checked)} /> Required field</label><div className="advanced-row"><button onClick={createFormField}>Add form field</button><button onClick={flattenForm}>Flatten form fields</button></div></div>
      case 'link':
        return <div className="advanced-focus-form"><label>Web address<input aria-label="Link URL" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" /></label><div className="position-grid">{(['x','y','width','height'] as const).map((key) => <label key={key}>{key}<input aria-label={`Link ${key} percent`} type="number" min="0" max="100" value={linkRect[key]} onChange={(e) => setLinkRect({ ...linkRect, [key]: Number(e.target.value) })} /><span>%</span></label>)}</div><button onClick={createLink}>Add clickable link</button></div>
      case 'bookmark':
        return <div className="advanced-focus-form"><label>Bookmark title<input aria-label="Bookmark title" value={bookmarkTitle} onChange={(e) => setBookmarkTitle(e.target.value)} placeholder={`Page ${currentPage + 1} bookmark`} /></label><button onClick={createBookmark}>Bookmark current page</button></div>
      case 'bates':
        return <div className="advanced-focus-form"><div className="advanced-row"><label>Prefix<input aria-label="Bates prefix" value={batesPrefix} onChange={(e) => setBatesPrefix(e.target.value)} placeholder="DOC-" /></label><label>Start<input aria-label="Bates start" type="number" min="0" value={batesStart} onChange={(e) => setBatesStart(Number(e.target.value))} /></label></div><label>Digits<input aria-label="Bates digits" type="number" min="1" max="12" value={batesDigits} onChange={(e) => setBatesDigits(Number(e.target.value))} /></label><button onClick={applyBates}>Apply Bates numbers</button></div>
      case 'privacy':
        return <div className="advanced-focus-form danger-focus"><p>Removes metadata, document/page additional actions, JavaScript name trees, embedded-file name trees, file-attachment annotations, and JavaScript/Launch annotation actions.</p><button className="danger-action" onClick={privacyCleanup}>Remove privacy data & active content</button></div>
      case 'redaction':
        return <div className="advanced-focus-form danger-focus"><p>Pages containing redaction marks are rasterized so the covered source content is permanently removed, not merely hidden by a rectangle.</p><button className="danger-action" onClick={applyRedactions}>Apply marked redactions</button></div>
      case 'ocr':
        return <div className="advanced-focus-form"><p>Add an invisible text layer to scanned pages so the exported document remains searchable outside PDF Forge.</p><button onClick={searchable}>Make PDF searchable</button></div>
      case 'optimize':
        return <div className="advanced-focus-form"><p>Recompress streams, generate object streams, and linearize the PDF using local QPDF/WASM. Native text and forms are preserved.</p><button onClick={optimize}>Optimize PDF</button></div>
      case 'compress':
        return <div className="advanced-focus-form"><p>Designed for scans and image-heavy PDFs. This rasterizes pages, so native text, links, and forms become page imagery.</p><label>JPEG quality<input type="range" min="40" max="90" value={compressionQuality} onChange={(e) => setCompressionQuality(Number(e.target.value))} /><strong>{compressionQuality}%</strong></label><button onClick={strongCompress}>Compress aggressively</button></div>
      case 'protect':
        return <div className="advanced-focus-form"><p>Your editable local original stays open. PDF Forge exports a separate AES-256 encrypted copy.</p><label>Open password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" /></label><button onClick={() => void protect()}><ShieldCheck /> Export protected PDF</button></div>
      case 'print':
        return <div className="advanced-focus-form"><p>Pending rotations, annotations, notes, and redactions are finalized before the browser print dialog opens.</p><button onClick={() => void print()}>Print document</button></div>
    }
  }

  return <>
    <button className="soft-btn advanced-tools-button" title="Document tools" onClick={() => setOpen(true)}><WandSparkles /> Tools</button>
    {open && <div className="modal-backdrop advanced-backdrop" onMouseDown={() => !busy && setOpen(false)}>
      <section className="advanced-modal advanced-focus-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="Document tools">
        <header><div><span className="eyebrow">COMPLETE TOOLSET</span><h2>Document tools</h2><p>Choose a category, then one task. Only the controls for that task stay on screen.</p></div><button className="icon-btn" disabled={Boolean(busy)} title="Close Document tools" onClick={() => setOpen(false)}><X /></button></header>
        {busy && <div className="advanced-busy"><Sparkles /> {busy}…</div>}
        <div className="advanced-focus-layout">
          <nav className="advanced-category-rail" aria-label="Document tool categories">
            {categories.map((category, index) => <button key={category.id} className={activeCategory === category.id ? 'active' : ''} onClick={() => chooseCategory(category.id)}><i>{String(index + 1).padStart(2, '0')}</i><span><strong>{category.label}</strong><small>{category.description}</small></span></button>)}
          </nav>
          <nav className="advanced-tool-rail" aria-label={`${currentCategory.label} tools`}>
            <div><span>TOOLS</span><strong>{currentCategory.label}</strong></div>
            {currentCategory.tools.map((item) => {
              const Icon = item.icon
              return <button key={item.id} className={activeTool === item.id ? 'active' : ''} onClick={() => setActiveTool(item.id)}><Icon size={16} /><span>{item.label}</span></button>
            })}
          </nav>
          <main className="advanced-tool-pane">
            <header><span className="advanced-tool-glyph"><ToolIcon size={21} /></span><div><span className="eyebrow">{currentCategory.label}</span><h3>{currentTool.label}</h3><p>{currentTool.description}</p></div></header>
            <div className="advanced-tool-content">{toolContent()}</div>
          </main>
        </div>
        <footer><BadgeCheck /> Local-first: these tools operate on this device.</footer>
      </section>
    </div>}
  </>
}
