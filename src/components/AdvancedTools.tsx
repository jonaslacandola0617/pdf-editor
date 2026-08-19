import { useRef, useState } from 'react'
import {
  BadgeCheck, Crop, FileLock2, FilePlus2, FileSearch, ImagePlus, Printer, ScanLine,
  ShieldCheck, Sparkles, Stamp, Type, WandSparkles, X,
} from 'lucide-react'
import type { Annotation, PdfMetadata } from '../types'
import {
  addHeaderFooter, addImageToPage, addWatermark, cropPage, downloadBytes, flattenAnnotations,
  insertBlankPage, reorderPdf, replacePageWithFile,
} from '../lib/pdf'
import { encryptPdf, optimizePdf } from '../lib/security'
import { makeSearchablePdf } from '../lib/searchable'
import { secureRedactPdf } from '../lib/redaction'

type ApplyOptions = {
  page?: number
  rotations?: number[]
  annotations?: Annotation[]
  status?: string
}

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

function remapInsert(annotations: Annotation[], index: number) {
  return annotations.map((ann) => ({ ...ann, page: ann.page >= index ? ann.page + 1 : ann.page }))
}

export function AdvancedTools({
  bytes, name, pageCount, currentPage, rotations, annotations, metadata,
  onBeforeMutate, onApply, onStatus,
}: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [watermark, setWatermark] = useState('DRAFT')
  const [header, setHeader] = useState('')
  const [footer, setFooter] = useState('')
  const [password, setPassword] = useState('')
  const [imageWidth, setImageWidth] = useState(35)
  const [crop, setCrop] = useState({ left: 0, right: 0, top: 0, bottom: 0 })
  const replaceInput = useRef<HTMLInputElement | null>(null)
  const imageInput = useRef<HTMLInputElement | null>(null)

  const mutate = async (label: string, task: () => Promise<ArrayBuffer>, options?: ApplyOptions) => {
    if (busy) return
    onBeforeMutate()
    setBusy(label)
    onStatus(`${label}…`)
    try {
      const next = await task()
      onApply(next, { ...options, status: `${label} complete` })
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  const insertAt = (index: number) => mutate(
    'Inserting blank page',
    () => insertBlankPage(bytes, index, 'match'),
    {
      page: index,
      rotations: [...rotations.slice(0, index), 0, ...rotations.slice(index)],
      annotations: remapInsert(annotations, index),
    },
  )

  const replaceCurrent = async (file: File | undefined) => {
    if (!file) return
    await mutate('Replacing page', () => replacePageWithFile(bytes, currentPage, file), {
      annotations: annotations.filter((ann) => ann.page !== currentPage),
    })
  }

  const addImage = async (file: File | undefined) => {
    if (!file) return
    await mutate('Adding image', () => addImageToPage(bytes, currentPage, file, { widthPercent: imageWidth / 100 }))
  }

  const applyCrop = () => mutate('Cropping page', () => cropPage(bytes, currentPage, {
    left: crop.left / 100,
    right: crop.right / 100,
    top: crop.top / 100,
    bottom: crop.bottom / 100,
  }))

  const applyWatermark = (text = watermark, pageOnly = false) => mutate(
    'Applying watermark',
    () => addWatermark(bytes, { text, pageIndex: pageOnly ? currentPage : undefined }),
  )

  const addPageFurniture = () => mutate('Adding headers and page numbers', () => addHeaderFooter(bytes, {
    header,
    footer,
    pageNumbers: true,
  }))

  const optimize = () => mutate('Optimizing PDF', () => optimizePdf(bytes))

  const searchable = () => mutate('Creating searchable PDF', () => makeSearchablePdf(bytes, (page, total) => {
    onStatus(`OCR searchable export: page ${page} of ${total}`)
  }))

  const applyRedactions = () => {
    const marks = annotations.filter((ann) => ann.type === 'redaction')
    if (!marks.length) {
      onStatus('Mark one or more areas with the Redact tool first.')
      return
    }
    void mutate('Applying secure redactions', () => secureRedactPdf(bytes, marks, rotations, (page, total) => {
      onStatus(`Secure redaction: page ${page} of ${total}`)
    }), {
      rotations: Array(pageCount).fill(0),
      annotations: annotations.filter((ann) => ann.type !== 'redaction'),
    })
  }

  const protect = async () => {
    if (!password.trim()) {
      onStatus('Enter a password for the protected export.')
      return
    }
    if (busy) return
    setBusy('Protecting PDF')
    onStatus('Creating AES-256 protected PDF…')
    try {
      const rotated = rotations.some(Boolean)
        ? await reorderPdf(bytes, Array.from({ length: pageCount }, (_, i) => i), rotations)
        : bytes
      const flattened = await flattenAnnotations(rotated, annotations.filter((ann) => ann.type !== 'redaction'), metadata)
      const protectedBytes = await encryptPdf(flattened.buffer.slice(flattened.byteOffset, flattened.byteOffset + flattened.byteLength) as ArrayBuffer, password)
      downloadBytes(new Uint8Array(protectedBytes), `${name.replace(/\.pdf$/i, '')}-protected.pdf`)
      onStatus('Protected PDF exported')
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Password protection failed')
    } finally {
      setBusy('')
    }
  }

  const print = async () => {
    if (busy) return
    setBusy('Preparing print')
    try {
      const rotated = rotations.some(Boolean)
        ? await reorderPdf(bytes, Array.from({ length: pageCount }, (_, i) => i), rotations)
        : bytes
      const flattened = await flattenAnnotations(rotated, annotations.filter((ann) => ann.type !== 'redaction'), metadata)
      const url = URL.createObjectURL(new Blob([flattened as BlobPart], { type: 'application/pdf' }))
      const frame = document.createElement('iframe')
      frame.style.position = 'fixed'
      frame.style.width = '1px'
      frame.style.height = '1px'
      frame.style.opacity = '0'
      frame.src = url
      document.body.appendChild(frame)
      frame.onload = () => {
        window.setTimeout(() => {
          frame.contentWindow?.focus()
          frame.contentWindow?.print()
          window.setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 2000)
        }, 300)
      }
      onStatus('Print dialog opened')
    } catch (error) {
      console.error(error)
      onStatus('Could not prepare this PDF for printing.')
    } finally {
      setBusy('')
    }
  }

  return (
    <>
      <button className="soft-btn advanced-tools-button" title="Document tools" onClick={() => setOpen(true)}>
        <WandSparkles /> Tools
      </button>
      {open && <div className="modal-backdrop advanced-backdrop" onMouseDown={() => !busy && setOpen(false)}>
        <section className="advanced-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="Document tools">
          <header>
            <div><span className="eyebrow">COMPLETE TOOLSET</span><h2>Document tools</h2><p>Permanent PDF operations run locally in your browser.</p></div>
            <button className="icon-btn" disabled={Boolean(busy)} onClick={() => setOpen(false)}><X /></button>
          </header>

          {busy && <div className="advanced-busy"><Sparkles /> {busy}…</div>}

          <div className="advanced-grid">
            <section className="advanced-card">
              <h3><FilePlus2 /> Pages</h3>
              <p>Build and replace document pages.</p>
              <div className="advanced-row"><button onClick={() => insertAt(currentPage)}>Blank before</button><button onClick={() => insertAt(currentPage + 1)}>Blank after</button></div>
              <button onClick={() => replaceInput.current?.click()}>Replace current page</button>
              <input ref={replaceInput} hidden type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => void replaceCurrent(e.target.files?.[0])} />
            </section>

            <section className="advanced-card">
              <h3><Crop /> Crop page</h3>
              <p>Set visible crop margins for the current page.</p>
              <div className="crop-grid">
                {(['top', 'right', 'bottom', 'left'] as const).map((side) => <label key={side}>{side}<input type="number" min="0" max="45" value={crop[side]} onChange={(e) => setCrop({ ...crop, [side]: Number(e.target.value) })} /><span>%</span></label>)}
              </div>
              <button onClick={applyCrop}>Apply crop</button>
            </section>

            <section className="advanced-card">
              <h3><Stamp /> Watermark & stamps</h3>
              <input value={watermark} onChange={(e) => setWatermark(e.target.value)} placeholder="Watermark text" />
              <div className="advanced-row"><button onClick={() => applyWatermark()}>All pages</button><button onClick={() => applyWatermark(watermark, true)}>Current page</button></div>
              <div className="stamp-row">{['APPROVED', 'DRAFT', 'CONFIDENTIAL'].map((stamp) => <button key={stamp} onClick={() => applyWatermark(stamp, true)}>{stamp}</button>)}</div>
            </section>

            <section className="advanced-card">
              <h3><Type /> Header, footer & numbers</h3>
              <input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="Header — supports {page} and {pages}" />
              <input value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Footer text" />
              <button onClick={addPageFurniture}>Apply + page numbers</button>
            </section>

            <section className="advanced-card">
              <h3><ImagePlus /> Insert image</h3>
              <p>Place a PNG/JPG centered on the current page.</p>
              <label>Width <input type="range" min="10" max="90" value={imageWidth} onChange={(e) => setImageWidth(Number(e.target.value))} /> {imageWidth}%</label>
              <button onClick={() => imageInput.current?.click()}>Choose image</button>
              <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg" onChange={(e) => void addImage(e.target.files?.[0])} />
            </section>

            <section className="advanced-card danger-card">
              <h3><ScanLine /> Secure redaction</h3>
              <p>Rasterizes pages containing redaction marks, permanently removing the original underlying content from those pages.</p>
              <button className="danger-action" onClick={applyRedactions}>Apply marked redactions</button>
            </section>

            <section className="advanced-card">
              <h3><FileSearch /> OCR searchable PDF</h3>
              <p>Add an invisible text layer to scanned pages so exported PDFs remain searchable outside PDF Forge.</p>
              <button onClick={searchable}>Make PDF searchable</button>
            </section>

            <section className="advanced-card">
              <h3><Sparkles /> Optimize</h3>
              <p>Recompress streams, generate object streams and linearize the PDF using local QPDF/WASM.</p>
              <button onClick={optimize}>Optimize PDF</button>
            </section>

            <section className="advanced-card">
              <h3><FileLock2 /> Password protect</h3>
              <p>Export a separate AES-256 encrypted copy. Your editable local original stays open.</p>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Open password" />
              <button onClick={() => void protect()}><ShieldCheck /> Export protected PDF</button>
            </section>

            <section className="advanced-card">
              <h3><Printer /> Print</h3>
              <p>Print the current PDF with PDF Forge annotations flattened into the output.</p>
              <button onClick={() => void print()}>Print document</button>
            </section>
          </div>

          <footer><BadgeCheck /> Local-first: these tools operate on this device.</footer>
        </section>
      </div>}
    </>
  )
}
