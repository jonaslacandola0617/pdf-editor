import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight,
  Copy, Download, FileInput, FileOutput, FilePlus2, Files, FormInput, Highlighter, ImagePlus,
  Info, Library, Menu, Minus, MousePointer2, PenLine, Plus, Redo2, RotateCcw, RotateCw,
  Save, Search, Shapes, Split, Trash2, Type, Undo2, Upload, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import { PdfPageCanvas } from './components/PdfPageCanvas'
import { Thumbnail } from './components/Thumbnail'
import { pdfjsLib, type PDFDocumentProxy } from './lib/pdfjs'
import {
  createPdfFromFiles, downloadBytes, duplicatePage, extractPages, fileSize, flattenAnnotations,
  mergePdfs, parsePageRange, readFormFields, readMetadata, reorderPdf, updateFormField,
} from './lib/pdf'
import { deleteDocument, listDocuments, saveDocument } from './lib/storage'
import type { Annotation, FormFieldState, LibraryDocument, PdfMetadata, Tool } from './types'
import './styles.css'

type Panel = 'pages' | 'library' | 'forms' | 'info'
type HistorySnapshot = {
  bytes: ArrayBuffer
  annotations: Annotation[]
  rotations: number[]
  metadata: PdfMetadata
}

const EMPTY_META: PdfMetadata = { title: '', author: '', subject: '', keywords: '' }
const COLORS = ['#111111', '#ef4444', '#f59e0b', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899']

function cloneSnapshot(s: HistorySnapshot): HistorySnapshot {
  return {
    bytes: s.bytes.slice(0),
    annotations: structuredClone(s.annotations),
    rotations: [...s.rotations],
    metadata: { ...s.metadata },
  }
}

function remapAnnotations(annotations: Annotation[], order: number[]) {
  const map = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]))
  return annotations
    .filter((a) => map.has(a.page))
    .map((a) => ({ ...a, page: map.get(a.page)! }))
}

function inverseRotatePoint(x: number, y: number, rotation: number) {
  const r = ((rotation % 360) + 360) % 360
  if (r === 90) return { x: y, y: 1 - x }
  if (r === 180) return { x: 1 - x, y: 1 - y }
  if (r === 270) return { x: 1 - y, y: x }
  return { x, y }
}

function annotationsForExport(annotations: Annotation[], rotations: number[]) {
  return annotations.map((ann) => {
    const rotation = rotations[ann.page] || 0
    if (!rotation) return ann
    if (ann.points) {
      return { ...ann, points: ann.points.map((p) => inverseRotatePoint(p.x, p.y, rotation)) }
    }
    if (ann.width && ann.height) {
      const corners = [
        inverseRotatePoint(ann.x, ann.y, rotation),
        inverseRotatePoint(ann.x + ann.width, ann.y, rotation),
        inverseRotatePoint(ann.x, ann.y + ann.height, rotation),
        inverseRotatePoint(ann.x + ann.width, ann.y + ann.height, rotation),
      ]
      const xs = corners.map((p) => p.x)
      const ys = corners.map((p) => p.y)
      return {
        ...ann,
        x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      }
    }
    const p = inverseRotatePoint(ann.x, ann.y, rotation)
    return { ...ann, x: p.x, y: p.y }
  })
}

function App() {
  const [documents, setDocuments] = useState<LibraryDocument[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [name, setName] = useState('Untitled.pdf')
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [rotations, setRotations] = useState<number[]>([])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#111111')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [fontSize, setFontSize] = useState(18)
  const [zoom, setZoom] = useState(1.05)
  const [panel, setPanel] = useState<Panel>('pages')
  const [metadata, setMetadata] = useState<PdfMetadata>(EMPTY_META)
  const [formFields, setFormFields] = useState<FormFieldState[]>([])
  const [searchText, setSearchText] = useState('')
  const [searchMatches, setSearchMatches] = useState<number[]>([])
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [history, setHistory] = useState<HistorySnapshot[]>([])
  const [future, setFuture] = useState<HistorySnapshot[]>([])
  const [extractOpen, setExtractOpen] = useState(false)
  const [extractRange, setExtractRange] = useState('1')
  const [status, setStatus] = useState('Ready')
  const [dragPage, setDragPage] = useState<number | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const mergeInput = useRef<HTMLInputElement | null>(null)

  const refreshLibrary = useCallback(async () => setDocuments(await listDocuments()), [])

  useEffect(() => { refreshLibrary() }, [refreshLibrary])

  useEffect(() => {
    if (!bytes) { setPdf(null); setPageCount(0); return }
    let cancelled = false
    const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) })
    task.promise.then((doc) => {
      if (cancelled) return
      setPdf(doc)
      setPageCount(doc.numPages)
      setCurrentPage((p) => Math.min(p, doc.numPages - 1))
      setRotations((prev) => Array.from({ length: doc.numPages }, (_, i) => prev[i] || 0))
    }).catch((error) => {
      console.error(error)
      setStatus('Could not open this PDF. It may be encrypted or damaged.')
    })
    return () => { cancelled = true; task.destroy() }
  }, [bytes])

  useEffect(() => {
    if (!bytes || !activeId) return
    const timer = setTimeout(async () => {
      await saveDocument({
        id: activeId, name, bytes: bytes.slice(0), pageCount, size: bytes.byteLength,
        updatedAt: Date.now(), annotations, rotations, metadata,
      })
      refreshLibrary()
    }, 500)
    return () => clearTimeout(timer)
  }, [activeId, annotations, bytes, metadata, name, pageCount, refreshLibrary, rotations])

  const snapshot = useCallback((): HistorySnapshot | null => bytes ? {
    bytes: bytes.slice(0), annotations: structuredClone(annotations), rotations: [...rotations], metadata: { ...metadata },
  } : null, [annotations, bytes, metadata, rotations])

  const pushHistory = useCallback(() => {
    const snap = snapshot()
    if (!snap) return
    setHistory((h) => [...h.slice(-24), snap])
    setFuture([])
  }, [snapshot])

  const restore = (snap: HistorySnapshot) => {
    setBytes(snap.bytes.slice(0))
    setAnnotations(structuredClone(snap.annotations))
    setRotations([...snap.rotations])
    setMetadata({ ...snap.metadata })
    setSelectedId(null)
  }

  const undo = useCallback(() => {
    if (!history.length) return
    const now = snapshot()
    const prev = history[history.length - 1]
    if (now) setFuture((f) => [cloneSnapshot(now), ...f].slice(0, 25))
    setHistory((h) => h.slice(0, -1))
    restore(prev)
  }, [history, snapshot])

  const redo = useCallback(() => {
    if (!future.length) return
    const now = snapshot()
    const next = future[0]
    if (now) setHistory((h) => [...h.slice(-24), cloneSnapshot(now)])
    setFuture((f) => f.slice(1))
    restore(next)
  }, [future, snapshot])

  const loadNewDocument = async (docName: string, raw: ArrayBuffer, existing?: LibraryDocument) => {
    const id = existing?.id || crypto.randomUUID()
    let meta = existing?.metadata || EMPTY_META
    try { if (!existing?.metadata) meta = await readMetadata(raw) } catch { /* ignore metadata errors */ }
    setActiveId(id)
    setName(docName)
    setBytes(raw.slice(0))
    setAnnotations(existing?.annotations || [])
    setRotations(existing?.rotations || [])
    setMetadata(meta)
    setCurrentPage(0)
    setSelectedId(null)
    setHistory([])
    setFuture([])
    setPanel('pages')
    setSearchText('')
    setSearchMatches([])
    try { setFormFields(await readFormFields(raw)) } catch { setFormFields([]) }
    try {
      const count = (await pdfjsLib.getDocument({ data: new Uint8Array(raw.slice(0)) }).promise).numPages
      await saveDocument({ id, name: docName, bytes: raw.slice(0), pageCount: count, size: raw.byteLength, updatedAt: Date.now(), annotations: existing?.annotations || [], rotations: existing?.rotations || [], metadata: meta })
      refreshLibrary()
    } catch { /* viewer effect will surface load failures */ }
  }

  const importFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files)
    if (!arr.length) return
    setStatus('Opening document…')
    try {
      let raw: ArrayBuffer
      let docName: string
      if (arr.length === 1 && (arr[0].type === 'application/pdf' || arr[0].name.toLowerCase().endsWith('.pdf'))) {
        raw = await arr[0].arrayBuffer()
        docName = arr[0].name
      } else {
        raw = await createPdfFromFiles(arr)
        docName = arr.length === 1 ? `${arr[0].name.replace(/\.[^.]+$/, '')}.pdf` : 'Combined document.pdf'
      }
      await loadNewDocument(docName, raw)
      setStatus('Document loaded')
    } catch (error) {
      console.error(error)
      setStatus('Unable to open the selected file.')
    }
  }

  const openLibraryDoc = async (doc: LibraryDocument) => {
    await loadNewDocument(doc.name, doc.bytes, doc)
    setStatus('Opened from local library')
  }

  const closeDocument = () => {
    setActiveId(null); setBytes(null); setPdf(null); setName('Untitled.pdf'); setAnnotations([]); setRotations([])
    setCurrentPage(0); setHistory([]); setFuture([]); setPanel('library'); setSelectedId(null)
  }

  const mergeFiles = async (files: FileList | null) => {
    if (!bytes || !files?.length) return
    pushHistory()
    setStatus('Merging files…')
    try {
      const next = await mergePdfs(bytes, Array.from(files))
      const extraCount = (await pdfjsLib.getDocument({ data: new Uint8Array(next.slice(0)) }).promise).numPages - pageCount
      setBytes(next)
      setRotations((r) => [...r, ...Array(Math.max(0, extraCount)).fill(0)])
      setStatus('Files merged')
    } catch (error) {
      console.error(error); setStatus('Merge failed. Check that the files are valid PDFs or images.')
    }
  }

  const rotatePage = (delta: number) => {
    pushHistory()
    setRotations((r) => r.map((v, i) => i === currentPage ? (v + delta + 360) % 360 : v))
  }

  const deletePage = async () => {
    if (!bytes || pageCount <= 1) return
    pushHistory()
    const order = Array.from({ length: pageCount }, (_, i) => i).filter((i) => i !== currentPage)
    const next = await reorderPdf(bytes, order, order.map(() => 0))
    setBytes(next)
    setRotations(order.map((i) => rotations[i] || 0))
    setAnnotations(remapAnnotations(annotations, order))
    setCurrentPage(Math.min(currentPage, pageCount - 2))
  }

  const copyPage = async () => {
    if (!bytes) return
    pushHistory()
    const next = await duplicatePage(bytes, currentPage)
    const nextRotations = [...rotations]
    nextRotations.splice(currentPage + 1, 0, rotations[currentPage] || 0)
    const nextAnnotations = annotations.map((a) => ({ ...a, page: a.page > currentPage ? a.page + 1 : a.page }))
    const duplicates = annotations.filter((a) => a.page === currentPage).map((a) => ({ ...structuredClone(a), id: crypto.randomUUID(), page: currentPage + 1 }))
    setBytes(next); setRotations(nextRotations); setAnnotations([...nextAnnotations, ...duplicates]); setCurrentPage(currentPage + 1)
  }

  const movePage = async (from: number, to: number) => {
    if (!bytes || from === to || to < 0 || to >= pageCount) return
    pushHistory()
    const order = Array.from({ length: pageCount }, (_, i) => i)
    const [moved] = order.splice(from, 1)
    order.splice(to, 0, moved)
    const next = await reorderPdf(bytes, order, order.map(() => 0))
    setBytes(next)
    setRotations(order.map((i) => rotations[i] || 0))
    setAnnotations(remapAnnotations(annotations, order))
    setCurrentPage(to)
  }

  const addAnnotation = (ann: Annotation) => {
    pushHistory()
    setAnnotations((a) => [...a, ann])
    setSelectedId(ann.id)
    setTool('select')
  }

  const updateSelected = (patch: Partial<Annotation>) => {
    if (!selectedId) return
    pushHistory()
    setAnnotations((a) => a.map((ann) => ann.id === selectedId ? { ...ann, ...patch } : ann))
  }

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    pushHistory()
    setAnnotations((a) => a.filter((ann) => ann.id !== selectedId))
    setSelectedId(null)
  }, [pushHistory, selectedId])

  const exportPdf = useCallback(async () => {
    if (!bytes) return
    setStatus('Preparing export…')
    try {
      const rotated = rotations.some(Boolean)
        ? await reorderPdf(bytes, Array.from({ length: pageCount }, (_, i) => i), rotations)
        : bytes
      const output = await flattenAnnotations(rotated, annotationsForExport(annotations, rotations), metadata)
      downloadBytes(output, name.replace(/\.pdf$/i, '') + '-edited.pdf')
      setStatus('Export complete')
    } catch (error) {
      console.error(error); setStatus('Export failed for this document.')
    }
  }, [annotations, bytes, metadata, name, pageCount, rotations])

  const saveToLibrary = async () => {
    if (!bytes || !activeId) return
    await saveDocument({ id: activeId, name, bytes: bytes.slice(0), pageCount, size: bytes.byteLength, updatedAt: Date.now(), annotations, rotations, metadata })
    await refreshLibrary()
    setStatus('Saved to local library')
  }

  const runExtract = async () => {
    if (!bytes) return
    const indices = parsePageRange(extractRange, pageCount)
    if (!indices.length) { setStatus('Enter a valid page range, such as 1-3, 5.'); return }
    const out = await extractPages(bytes, indices)
    downloadBytes(out, `${name.replace(/\.pdf$/i, '')}-pages-${extractRange.replace(/\s/g, '')}.pdf`)
    setExtractOpen(false)
    setStatus(`Extracted ${indices.length} page${indices.length === 1 ? '' : 's'}`)
  }

  const searchPdf = useCallback(async () => {
    if (!pdf || !searchText.trim()) { setSearchMatches([]); return }
    const q = searchText.trim().toLowerCase()
    const found: number[] = []
    setStatus('Searching…')
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1)
      const content = await page.getTextContent()
      const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').toLowerCase()
      if (text.includes(q)) found.push(i)
    }
    setSearchMatches(found); setSearchMatchIndex(0)
    if (found.length) setCurrentPage(found[0])
    setStatus(found.length ? `${found.length} matching page${found.length === 1 ? '' : 's'}` : 'No matches')
  }, [pdf, searchText])

  const cycleSearch = (delta: number) => {
    if (!searchMatches.length) return
    const next = (searchMatchIndex + delta + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(next); setCurrentPage(searchMatches[next])
  }

  const changeFormField = async (field: FormFieldState, nextValue: string | boolean) => {
    if (!bytes) return
    pushHistory()
    try {
      const next = await updateFormField(bytes, field, nextValue)
      setBytes(next)
      setFormFields(await readFormFields(next))
      setStatus('Form field updated')
    } catch (error) {
      console.error(error); setStatus('This form field could not be changed.')
    }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); e.shiftKey ? redo() : undo(); return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); exportPdf(); return }
      if (typing) return
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setCurrentPage((p) => Math.min(pageCount - 1, p + 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setCurrentPage((p) => Math.max(0, p - 1))
      if (e.key === 'Escape') { setTool('select'); setSelectedId(null) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [deleteSelected, exportPdf, pageCount, redo, undo])

  const selected = useMemo(() => annotations.find((a) => a.id === selectedId) || null, [annotations, selectedId])
  const pageAnnotations = useMemo(() => annotations.filter((a) => a.page === currentPage), [annotations, currentPage])

  const dropFiles = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    if (bytes) await mergeFiles(e.dataTransfer.files)
    else await importFiles(files)
  }

  if (!bytes || !pdf) {
    return (
      <main className="welcome" onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
        <div className="welcome-orb" />
        <header className="welcome-header">
          <div className="brand"><span className="brand-mark">P</span><span>PDF Forge</span></div>
          <span className="privacy-pill"><Check size={14} /> Local-first</span>
        </header>
        <section className="welcome-content">
          <div className="hero-copy">
            <span className="eyebrow">YOUR PDF WORKSPACE</span>
            <h1>Edit PDFs without<br /><em>giving them away.</em></h1>
            <p>Open, organize, annotate, fill, merge, split and export PDFs directly in your browser. Your core editing workflow stays on your device.</p>
            <div className="hero-actions">
              <button className="primary large" onClick={() => fileInput.current?.click()}><Upload size={18} /> Open PDF or images</button>
              <span>or drop files anywhere</span>
            </div>
          </div>
          <div className="recent-card">
            <div className="recent-title"><div><span className="eyebrow">LOCAL LIBRARY</span><h2>Recent documents</h2></div><Archive size={20} /></div>
            {documents.length ? (
              <div className="recent-list">
                {documents.slice(0, 6).map((doc) => (
                  <button key={doc.id} className="recent-row" onClick={() => openLibraryDoc(doc)}>
                    <span className="pdf-file-icon">PDF</span>
                    <span className="recent-meta"><strong>{doc.name}</strong><small>{doc.pageCount} pages · {fileSize(doc.size)}</small></span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            ) : <div className="empty-recent"><Files size={36} /><p>Your recent PDFs will live here.</p></div>}
          </div>
        </section>
        <section className="feature-strip">
          <span><PenLine /> Annotate & sign</span><span><Menu /> Organize pages</span><span><Split /> Merge & extract</span><span><FormInput /> Fill forms</span>
        </section>
        <input ref={fileInput} hidden type="file" accept="application/pdf,image/png,image/jpeg" multiple onChange={(e) => e.target.files && importFiles(e.target.files)} />
      </main>
    )
  }

  return (
    <main className="app-shell" onDragOver={(e) => e.preventDefault()} onDrop={dropFiles}>
      <header className="topbar">
        <div className="brand compact"><span className="brand-mark">P</span><span>PDF Forge</span></div>
        <div className="doc-title">
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Document name" />
          <span>{pageCount} pages · {bytes ? fileSize(bytes.byteLength) : ''}</span>
        </div>
        <div className="top-actions">
          <button className="icon-btn" title="Undo" disabled={!history.length} onClick={undo}><Undo2 /></button>
          <button className="icon-btn" title="Redo" disabled={!future.length} onClick={redo}><Redo2 /></button>
          <span className="divider" />
          <button className="soft-btn" onClick={saveToLibrary}><Save /> Save</button>
          <button className="primary" onClick={exportPdf}><Download /> Export PDF</button>
          <button className="icon-btn" title="Close document" onClick={closeDocument}><X /></button>
        </div>
      </header>

      <section className="workspace">
        <nav className="rail" aria-label="Workspace panels">
          <button className={panel === 'library' ? 'active' : ''} onClick={() => setPanel('library')} title="Library"><Library /></button>
          <button className={panel === 'pages' ? 'active' : ''} onClick={() => setPanel('pages')} title="Pages"><Files /></button>
          <button className={panel === 'forms' ? 'active' : ''} onClick={() => setPanel('forms')} title="Form fields"><FormInput /></button>
          <button className={panel === 'info' ? 'active' : ''} onClick={() => setPanel('info')} title="Document info"><Info /></button>
        </nav>

        <aside className="left-panel">
          {panel === 'pages' && <>
            <div className="panel-heading"><div><span className="eyebrow">ORGANIZE</span><h3>Pages</h3></div><span>{pageCount}</span></div>
            <div className="page-actions-grid">
              <button onClick={() => rotatePage(-90)} title="Rotate left"><RotateCcw /> Left</button>
              <button onClick={() => rotatePage(90)} title="Rotate right"><RotateCw /> Right</button>
              <button onClick={copyPage}><Copy /> Duplicate</button>
              <button onClick={deletePage} disabled={pageCount <= 1}><Trash2 /> Delete</button>
            </div>
            <div className="thumbnail-list">
              {Array.from({ length: pageCount }, (_, i) => (
                <div
                  key={`${i}-${rotations[i] || 0}`}
                  className="thumb-drag-wrap"
                  draggable
                  onDragStart={() => setDragPage(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragPage !== null) movePage(dragPage, i); setDragPage(null) }}
                >
                  <Thumbnail pdf={pdf} pageIndex={i} rotation={rotations[i] || 0} active={currentPage === i} onClick={() => setCurrentPage(i)} />
                </div>
              ))}
            </div>
          </>}

          {panel === 'library' && <>
            <div className="panel-heading"><div><span className="eyebrow">LOCAL</span><h3>Library</h3></div><button className="icon-btn small" onClick={() => fileInput.current?.click()}><Plus /></button></div>
            <button className="drop-card" onClick={() => fileInput.current?.click()}><Upload /><strong>Open files</strong><span>PDF, PNG or JPG</span></button>
            <div className="library-list">
              {documents.map((doc) => (
                <div key={doc.id} className={`library-item ${doc.id === activeId ? 'active' : ''}`}>
                  <button onClick={() => openLibraryDoc(doc)}><span className="pdf-file-icon">PDF</span><span><strong>{doc.name}</strong><small>{doc.pageCount} pages · {fileSize(doc.size)}</small></span></button>
                  <button className="trash-mini" title="Remove from library" onClick={async () => { await deleteDocument(doc.id); refreshLibrary() }}><Trash2 /></button>
                </div>
              ))}
            </div>
          </>}

          {panel === 'forms' && <>
            <div className="panel-heading"><div><span className="eyebrow">ACROFORM</span><h3>Form fields</h3></div><span>{formFields.length}</span></div>
            {!formFields.length && <div className="empty-panel"><FormInput /><strong>No form fields found</strong><p>You can still add text anywhere using the Text tool.</p></div>}
            <div className="form-list">
              {formFields.map((field) => <label key={field.name} className="form-field"><span>{field.name}</span><small>{field.type}</small>
                {field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(field.value)} onChange={(e) => changeFormField(field, e.target.checked)} />
                  : field.options?.length ? <select value={String(field.value)} onChange={(e) => changeFormField(field, e.target.value)}><option value="">Choose…</option>{field.options.map((o) => <option key={o}>{o}</option>)}</select>
                    : <input value={String(field.value)} onChange={(e) => setFormFields((fs) => fs.map((f) => f.name === field.name ? { ...f, value: e.target.value } : f))} onBlur={(e) => changeFormField(field, e.target.value)} />}
              </label>)}
            </div>
          </>}

          {panel === 'info' && <>
            <div className="panel-heading"><div><span className="eyebrow">DOCUMENT</span><h3>Properties</h3></div><Info /></div>
            <div className="meta-form">
              <label>Title<input value={metadata.title} onChange={(e) => setMetadata({ ...metadata, title: e.target.value })} /></label>
              <label>Author<input value={metadata.author} onChange={(e) => setMetadata({ ...metadata, author: e.target.value })} /></label>
              <label>Subject<input value={metadata.subject} onChange={(e) => setMetadata({ ...metadata, subject: e.target.value })} /></label>
              <label>Keywords<textarea rows={4} value={metadata.keywords} onChange={(e) => setMetadata({ ...metadata, keywords: e.target.value })} placeholder="invoice, client, 2026" /></label>
            </div>
          </>}
        </aside>

        <section className="editor-column">
          <div className="editor-toolbar">
            <div className="tool-group">
              <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Select"><MousePointer2 /></button>
              <button className={tool === 'text' ? 'active' : ''} onClick={() => setTool('text')} title="Add text"><Type /></button>
              <button className={tool === 'highlight' ? 'active' : ''} onClick={() => setTool('highlight')} title="Highlight"><Highlighter /></button>
              <button className={tool === 'rectangle' ? 'active' : ''} onClick={() => setTool('rectangle')} title="Rectangle"><Shapes /></button>
              <button className={tool === 'ink' ? 'active' : ''} onClick={() => setTool('ink')} title="Draw"><PenLine /></button>
              <button className={tool === 'signature' ? 'active' : ''} onClick={() => setTool('signature')} title="Signature"><span className="signature-icon">⌁</span></button>
            </div>
            <span className="divider" />
            <div className="search-box"><Search /><input value={searchText} onChange={(e) => setSearchText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchPdf()} placeholder="Find in document" />{searchMatches.length > 0 && <><span>{searchMatchIndex + 1}/{searchMatches.length}</span><button onClick={() => cycleSearch(-1)}><ChevronLeft /></button><button onClick={() => cycleSearch(1)}><ChevronRight /></button></>}</div>
            <div className="toolbar-spacer" />
            <button className="soft-btn" onClick={() => mergeInput.current?.click()}><FileInput /> Merge</button>
            <button className="soft-btn" onClick={() => { setExtractRange(String(currentPage + 1)); setExtractOpen(true) }}><Split /> Extract</button>
          </div>

          <div className="document-stage">
            <div className="stage-top-hint">{tool === 'select' ? status : tool === 'text' ? 'Click anywhere on the page to add text' : tool === 'highlight' || tool === 'rectangle' ? 'Drag on the page to place the annotation' : 'Draw directly on the page'}</div>
            <div className="page-scroll">
              <PdfPageCanvas
                pdf={pdf} pageIndex={currentPage} zoom={zoom} rotation={rotations[currentPage] || 0}
                annotations={pageAnnotations} tool={tool} color={color} strokeWidth={strokeWidth} fontSize={fontSize}
                selectedId={selectedId} onSelect={setSelectedId} onAdd={addAnnotation}
              />
            </div>
            <div className="floating-nav">
              <button onClick={() => setCurrentPage((p) => Math.max(0, p - 1))} disabled={currentPage === 0}><ChevronLeft /></button>
              <span><input value={currentPage + 1} onChange={(e) => setCurrentPage(Math.max(0, Math.min(pageCount - 1, Number(e.target.value) - 1 || 0)))} /> / {pageCount}</span>
              <button onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))} disabled={currentPage === pageCount - 1}><ChevronRight /></button>
              <span className="divider" />
              <button onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}><ZoomOut /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(2.4, z + 0.1))}><ZoomIn /></button>
            </div>
          </div>
        </section>

        <aside className="right-panel">
          <div className="panel-heading"><div><span className="eyebrow">{selected ? 'SELECTION' : 'TOOLS'}</span><h3>{selected ? selected.type[0].toUpperCase() + selected.type.slice(1) : 'Appearance'}</h3></div>{selected && <button className="icon-btn small danger" onClick={deleteSelected}><Trash2 /></button>}</div>
          {selected?.type === 'text' && <label className="property-field">Text<textarea rows={5} value={selected.text || ''} onChange={(e) => setAnnotations((a) => a.map((ann) => ann.id === selected.id ? { ...ann, text: e.target.value } : ann))} onBlur={() => {}} /></label>}
          <div className="property-section"><span>Color</span><div className="color-grid">{COLORS.map((c) => <button key={c} className={(selected?.color || color) === c ? 'active' : ''} style={{ background: c }} onClick={() => selected ? updateSelected({ color: c }) : setColor(c)} aria-label={`Color ${c}`} />)}<label className="custom-color"><input type="color" value={selected?.color || color} onChange={(e) => selected ? updateSelected({ color: e.target.value }) : setColor(e.target.value)} /></label></div></div>
          {(selected?.type === 'text' || (!selected && tool === 'text')) && <label className="property-field">Font size <div className="stepper"><button onClick={() => selected ? updateSelected({ fontSize: Math.max(8, (selected.fontSize || 18) - 1) }) : setFontSize((s) => Math.max(8, s - 1))}><Minus /></button><input type="number" value={selected?.fontSize || fontSize} onChange={(e) => selected ? updateSelected({ fontSize: Number(e.target.value) }) : setFontSize(Number(e.target.value))} /><button onClick={() => selected ? updateSelected({ fontSize: (selected.fontSize || 18) + 1 }) : setFontSize((s) => s + 1)}><Plus /></button></div></label>}
          {(selected?.type === 'rectangle' || selected?.type === 'ink' || selected?.type === 'signature' || (!selected && ['rectangle', 'ink', 'signature'].includes(tool))) && <label className="property-field">Stroke width <input className="range" type="range" min="1" max="12" step="1" value={selected?.strokeWidth || strokeWidth} onChange={(e) => selected ? updateSelected({ strokeWidth: Number(e.target.value) }) : setStrokeWidth(Number(e.target.value))} /><strong>{selected?.strokeWidth || strokeWidth}px</strong></label>}
          {!selected && <div className="right-help"><strong>Editing tips</strong><p>Use the page thumbnails to drag pages into a new order. Drop another PDF or image over the editor to append it.</p><p><kbd>Ctrl</kbd> + <kbd>S</kbd> exports. <kbd>Ctrl</kbd> + <kbd>Z</kbd> undoes. Arrow keys move between pages.</p></div>}
          <div className="quick-actions">
            <span>Page {currentPage + 1}</span>
            <div><button onClick={() => movePage(currentPage, currentPage - 1)} disabled={currentPage === 0}><ArrowUp /></button><button onClick={() => movePage(currentPage, currentPage + 1)} disabled={currentPage === pageCount - 1}><ArrowDown /></button></div>
          </div>
        </aside>
      </section>

      {extractOpen && <div className="modal-backdrop" onMouseDown={() => setExtractOpen(false)}><div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-icon"><FileOutput /></div><h2>Extract pages</h2><p>Create a new PDF containing only the pages you choose. Use ranges like <strong>1-3, 5, 8-10</strong>.</p>
        <label>Page range<input autoFocus value={extractRange} onChange={(e) => setExtractRange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runExtract()} /></label>
        <div className="modal-actions"><button className="soft-btn" onClick={() => setExtractOpen(false)}>Cancel</button><button className="primary" onClick={runExtract}><Split /> Extract PDF</button></div>
      </div></div>}

      <input ref={fileInput} hidden type="file" accept="application/pdf,image/png,image/jpeg" multiple onChange={(e) => e.target.files && importFiles(e.target.files)} />
      <input ref={mergeInput} hidden type="file" accept="application/pdf,image/png,image/jpeg" multiple onChange={(e) => mergeFiles(e.target.files)} />
    </main>
  )
}

export default App
