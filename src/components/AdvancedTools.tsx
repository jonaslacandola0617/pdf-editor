import { useRef, useState } from 'react'
import {
  BadgeCheck, Crop, FileLock2, FilePlus2, FileSearch, ImagePlus, Printer, ScanLine,
  ShieldCheck, Sparkles, Stamp, Type, WandSparkles, X,
} from 'lucide-react'
import type { Annotation, PdfMetadata, Point } from '../types'
import {
  addHeaderFooter, addImageToPage, addWatermark, cropPage, downloadBytes, flattenAnnotations, flattenFormFields,
  insertBlankPage, reorderPdf, replacePageWithFile,
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
      const rotated = rotations.some(Boolean) ? await reorderPdf(bytes, Array.from({ length: pageCount }, (_, i) => i), rotations) : bytes
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

  const chooseInsert = (position: 'before' | 'after') => {
    insertPosition.current = position
    insertInput.current?.click()
  }

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

  const replaceCurrent = async (file: File | undefined) => {
    if (!file) return
    await mutate('Replacing page', () => replacePageWithFile(bytes, currentPage, file), { annotations: annotations.filter((ann) => ann.page !== currentPage) })
  }
  const addImage = async (file: File | undefined) => { if (file) await mutate('Adding image', () => addImageToPage(bytes, currentPage, file, { widthPercent: imageWidth / 100 })) }
  const applyCrop = () => mutate('Cropping page', () => cropPage(bytes, currentPage, { left: crop.left / 100, right: crop.right / 100, top: crop.top / 100, bottom: crop.bottom / 100 }))
  const applyWatermark = (text = watermark, pageOnly = false) => mutate('Applying watermark', () => addWatermark(bytes, { text, pageIndex: pageOnly ? currentPage : undefined }))
  const addPageFurniture = () => mutate('Adding headers and page numbers', () => addHeaderFooter(bytes, { header, footer, pageNumbers: true }))
  const optimize = () => mutate('Optimizing PDF', () => optimizePdf(bytes))
  const searchable = () => mutate('Creating searchable PDF', () => makeSearchablePdf(bytes, (page, total) => onStatus(`OCR searchable export: page ${page} of ${total}`)))
  const createFormField = () => mutate('Adding form field', async () => (await addFormField(bytes, {
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
  const flattenForm = () => mutate('Flattening form fields', () => flattenFormFields(bytes))
  const createLink = () => mutate('Adding PDF link', () => addUriLink(bytes, { pageIndex: currentPage, url: linkUrl, xPercent: linkRect.x, yPercent: linkRect.y, widthPercent: linkRect.width, heightPercent: linkRect.height }))
  const createBookmark = () => mutate('Adding bookmark', () => addTopLevelBookmark(bytes, bookmarkTitle || `Page ${currentPage + 1}`, currentPage))
  const applyBates = () => mutate('Adding Bates numbers', () => addBatesNumbers(bytes, { prefix: batesPrefix, start: batesStart, digits: batesDigits }))
  const privacyCleanup = () => mutate('Cleaning document privacy data', () => privacyCleanupPdf(bytes), { metadata: { title: '', author: '', subject: '', keywords: '' } })

  const strongCompress = () => mutate('Strong compression', () => rasterCompressPdf(bytes, {
    quality: compressionQuality / 100,
    onProgress: (page, total) => onStatus(`Strong compression: page ${page} of ${total}`),
  }))

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

  return <>
    <button className="soft-btn advanced-tools-button" title="Document tools" onClick={() => setOpen(true)}><WandSparkles /> Tools</button>
    {open && <div className="modal-backdrop advanced-backdrop" onMouseDown={() => !busy && setOpen(false)}><section className="advanced-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="Document tools">
      <header><div><span className="eyebrow">COMPLETE TOOLSET</span><h2>Document tools</h2><p>Permanent PDF operations run locally in your browser.</p></div><button className="icon-btn" disabled={Boolean(busy)} onClick={() => setOpen(false)}><X /></button></header>
      {busy && <div className="advanced-busy"><Sparkles /> {busy}…</div>}
      <div className="advanced-grid">
        <section className="advanced-card"><h3><FilePlus2 /> Pages</h3><p>Build, insert and replace document pages.</p><div className="advanced-row"><button onClick={() => insertAt(currentPage)}>Blank before</button><button onClick={() => insertAt(currentPage + 1)}>Blank after</button></div><div className="advanced-row"><button onClick={() => chooseInsert('before')}>Insert file before</button><button onClick={() => chooseInsert('after')}>Insert file after</button></div><button onClick={() => replaceInput.current?.click()}>Replace current page</button><input ref={insertInput} hidden multiple type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => void insertExternal(e.target.files)} /><input ref={replaceInput} hidden type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => void replaceCurrent(e.target.files?.[0])} /></section>
        <section className="advanced-card"><h3><Crop /> Crop page</h3><p>Set visible crop margins for the current page.</p><div className="crop-grid">{(['top', 'right', 'bottom', 'left'] as const).map((side) => <label key={side}>{side}<input type="number" min="0" max="45" value={crop[side]} onChange={(e) => setCrop({ ...crop, [side]: Number(e.target.value) })} /><span>%</span></label>)}</div><button onClick={applyCrop}>Apply crop</button></section>
        <section className="advanced-card"><h3><Stamp /> Watermark & stamps</h3><input value={watermark} onChange={(e) => setWatermark(e.target.value)} placeholder="Watermark text" /><div className="advanced-row"><button onClick={() => applyWatermark()}>All pages</button><button onClick={() => applyWatermark(watermark, true)}>Current page</button></div><div className="stamp-row">{['APPROVED', 'DRAFT', 'CONFIDENTIAL'].map((stamp) => <button key={stamp} onClick={() => applyWatermark(stamp, true)}>{stamp}</button>)}</div></section>
        <section className="advanced-card"><h3><Type /> Header, footer & numbers</h3><input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="Header — supports {page} and {pages}" /><input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Footer text" /><button onClick={addPageFurniture}>Apply + page numbers</button></section>
        <section className="advanced-card"><h3><ImagePlus /> Insert image</h3><p>Place a PNG/JPG centered on the current page.</p><label>Width <input type="range" min="10" max="90" value={imageWidth} onChange={(e) => setImageWidth(Number(e.target.value))} /> {imageWidth}%</label><button onClick={() => imageInput.current?.click()}>Choose image</button><input ref={imageInput} hidden type="file" accept="image/png,image/jpeg" onChange={(e) => void addImage(e.target.files?.[0])} /></section>
        <section className="advanced-card structure-card"><h3><Type /> Create form field</h3><p>Add a real AcroForm widget to the current page.</p><div className="advanced-row"><select aria-label="Form field type" value={formKind} onChange={(e) => setFormKind(e.target.value as FormFieldKind)}><option value="text">Text field</option><option value="checkbox">Checkbox</option><option value="dropdown">Dropdown</option><option value="list">Option list</option><option value="radio">Radio group</option></select><input aria-label="Form field name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Field name" /></div>{['dropdown','list','radio'].includes(formKind) && <input aria-label="Form field options" value={formOptions} onChange={(e) => setFormOptions(e.target.value)} placeholder="Option 1, Option 2" />}<div className="position-grid">{(['x','y','width','height'] as const).map((key) => <label key={key}>{key}<input aria-label={`Field ${key} percent`} type="number" min="0" max="100" value={fieldRect[key]} onChange={(e) => setFieldRect({ ...fieldRect, [key]: Number(e.target.value) })} /><span>%</span></label>)}</div><label className="check-row"><input type="checkbox" checked={formRequired} onChange={(e) => setFormRequired(e.target.checked)} /> Required field</label><div className="advanced-row"><button onClick={createFormField}>Add form field</button><button onClick={flattenForm}>Flatten form fields</button></div></section>
        <section className="advanced-card structure-card"><h3><FileSearch /> Add web link</h3><p>Create a native clickable URI link rectangle on the current page.</p><input aria-label="Link URL" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com" /><div className="position-grid">{(['x','y','width','height'] as const).map((key) => <label key={key}>{key}<input aria-label={`Link ${key} percent`} type="number" min="0" max="100" value={linkRect[key]} onChange={(e) => setLinkRect({ ...linkRect, [key]: Number(e.target.value) })} /><span>%</span></label>)}</div><button onClick={createLink}>Add clickable link</button></section>
        <section className="advanced-card structure-card"><h3><FilePlus2 /> Bookmark current page</h3><p>Add a top-level bookmark to the PDF outline.</p><input aria-label="Bookmark title" value={bookmarkTitle} onChange={(e) => setBookmarkTitle(e.target.value)} placeholder={`Page ${currentPage + 1} bookmark`} /><button onClick={createBookmark}>Add bookmark</button></section>
        <section className="advanced-card structure-card"><h3><Type /> Bates numbering</h3><p>Apply stable document-control IDs to every page.</p><div className="advanced-row"><input aria-label="Bates prefix" value={batesPrefix} onChange={(e) => setBatesPrefix(e.target.value)} placeholder="Prefix" /><input aria-label="Bates start" type="number" min="0" value={batesStart} onChange={(e) => setBatesStart(Number(e.target.value))} /></div><label>Digits <input aria-label="Bates digits" type="number" min="1" max="12" value={batesDigits} onChange={(e) => setBatesDigits(Number(e.target.value))} /></label><button onClick={applyBates}>Apply Bates numbers</button></section>
        <section className="advanced-card danger-card"><h3><ShieldCheck /> Privacy cleanup</h3><p>Remove document metadata, document/page additional actions, JavaScript name trees, embedded-file name trees, file-attachment annotations, and JavaScript/Launch annotation actions.</p><button className="danger-action" onClick={privacyCleanup}>Remove privacy data & active content</button></section>
        <section className="advanced-card danger-card"><h3><ScanLine /> Secure redaction</h3><p>Rasterizes pages containing redaction marks, permanently removing the original underlying content from those pages.</p><button className="danger-action" onClick={applyRedactions}>Apply marked redactions</button></section>
        <section className="advanced-card"><h3><FileSearch /> OCR searchable PDF</h3><p>Add an invisible text layer to scanned pages so exported PDFs remain searchable outside PDF Forge.</p><button onClick={searchable}>Make PDF searchable</button></section>
        <section className="advanced-card"><h3><Sparkles /> Lossless optimize</h3><p>Recompress streams, generate object streams and linearize the PDF using local QPDF/WASM. Native text and forms are preserved.</p><button onClick={optimize}>Optimize PDF</button></section>
        <section className="advanced-card"><h3><Sparkles /> Strong compression</h3><p>For scans and image-heavy PDFs. Rasterizes pages to JPEG, so native text, links and forms become page imagery. OCR can be added again afterward.</p><label>JPEG quality <input type="range" min="40" max="90" value={compressionQuality} onChange={(e) => setCompressionQuality(Number(e.target.value))} /> {compressionQuality}%</label><button onClick={strongCompress}>Compress aggressively</button></section>
        <section className="advanced-card"><h3><FileLock2 /> Password protect</h3><p>Export a separate AES-256 encrypted copy. Your editable local original stays open.</p><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Open password" /><button onClick={() => void protect()}><ShieldCheck /> Export protected PDF</button></section>
        <section className="advanced-card"><h3><Printer /> Print</h3><p>Print the finalized PDF. Pending rotations, annotations and redactions are applied first.</p><button onClick={() => void print()}>Print document</button></section>
      </div>
      <footer><BadgeCheck /> Local-first: these tools operate on this device.</footer>
    </section></div>}
  </>
}
