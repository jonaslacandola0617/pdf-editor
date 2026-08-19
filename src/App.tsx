import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileInput,
  FileOutput,
  Files,
  FormInput,
  Highlighter,
  Info,
  Library,
  Menu,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  ScanLine,
  Search,
  Shapes,
  Split,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { AdvancedTools } from './components/AdvancedTools'
import { LazyPdfPage } from './components/LazyPdfPage'
import { PdfPageCanvas } from './components/PdfPageCanvas'
import { Thumbnail } from './components/Thumbnail'
import {
  createPdfFromFiles,
  downloadBytes,
  duplicatePage,
  extractPages,
  fileSize,
  flattenAnnotations,
  mergePdfs,
  parsePageRange,
  readFormFields,
  readMetadata,
  reorderPdf,
  updateFormField,
} from './lib/pdf'
import { deleteNativeTextObject, pickNativeTextObject, replaceNativeTextObject } from './lib/pdfium-edit'
import { pdfjsLib, type PDFDocumentProxy } from './lib/pdfjs'
import { secureRedactPdf } from './lib/redaction'
import { decryptPdf } from './lib/security'
import { deleteDocument, listDocuments, saveDocument } from './lib/storage'
import type {
  Annotation,
  FormFieldState,
  LibraryDocument,
  NativeTextSelection,
  PdfMetadata,
  Point,
  Tool,
} from './types'
import './styles.css'
import './native-edit.css'

type Panel = 'pages' | 'library' | 'forms' | 'info'
type ViewMode = 'single' | 'continuous' | 'spread'

type HistorySnapshot = {
  bytes: ArrayBuffer
  annotations: Annotation[]
  rotations: number[]
  metadata: PdfMetadata
}

type AdvancedApplyOptions = {
  page?: number
  rotations?: number[]
  annotations?: Annotation[]
  status?: string
}

const EMPTY_META: PdfMetadata = { title: '', author: '', subject: '', keywords: '' }
const COLORS = [
  '#111111', '#ef4444', '#f59e0b', '#facc15', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
]

function cloneSnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return {
    bytes: snapshot.bytes.slice(0),
    annotations: structuredClone(snapshot.annotations),
    rotations: [...snapshot.rotations],
    metadata: { ...snapshot.metadata },
  }
}

function remapAnnotations(annotations: Annotation[], order: number[]) {
  const map = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]))
  return annotations
    .filter((annotation) => map.has(annotation.page))
    .map((annotation) => ({ ...annotation, page: map.get(annotation.page)! }))
}

function inverseRotatePoint(x: number, y: number, rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360
  if (normalized === 90) return { x: y, y: 1 - x }
  if (normalized === 180) return { x: 1 - x, y: 1 - y }
  if (normalized === 270) return { x: 1 - y, y: x }
  return { x, y }
}

function annotationsForExport(annotations: Annotation[], rotations: number[]) {
  return annotations.map((annotation) => {
    const rotation = rotations[annotation.page] || 0
    if (!rotation) return annotation

    if (annotation.points) {
      return {
        ...annotation,
        points: annotation.points.map((point) => inverseRotatePoint(point.x, point.y, rotation)),
      }
    }

    if (annotation.width && annotation.height) {
      const corners = [
        inverseRotatePoint(annotation.x, annotation.y, rotation),
        inverseRotatePoint(annotation.x + annotation.width, annotation.y, rotation),
        inverseRotatePoint(annotation.x, annotation.y + annotation.height, rotation),
        inverseRotatePoint(annotation.x + annotation.width, annotation.y + annotation.height, rotation),
      ]
      const xs = corners.map((point) => point.x)
      const ys = corners.map((point) => point.y)
      return {
        ...annotation,
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      }
    }

    const point = inverseRotatePoint(annotation.x, annotation.y, rotation)
    return { ...annotation, x: point.x, y: point.y }
  })
}

function arrayBufferFrom(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export default function App() {
  const [documents, setDocuments] = useState<LibraryDocument[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [name, setName] = useState('Untitled.pdf')
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set())
  const [rotations, setRotations] = useState<number[]>([])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [nativeSelection, setNativeSelection] = useState<NativeTextSelection | null>(null)
  const [nativeDraft, setNativeDraft] = useState('')
  const [nativeBusy, setNativeBusy] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState('#111111')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [fontSize, setFontSize] = useState(18)
  const [zoom, setZoom] = useState(1.05)
  const [viewMode, setViewMode] = useState<ViewMode>('single')
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

  const refreshLibrary = useCallback(async () => {
    setDocuments(await listDocuments())
  }, [])

  useEffect(() => {
    void refreshLibrary()
  }, [refreshLibrary])

  useEffect(() => {
    if (!bytes) {
      setPdf(null)
      setPageCount(0)
      return
    }

    let cancelled = false
    const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) })
    task.promise
      .then((document) => {
        if (cancelled) return
        setPdf(document)
        setPageCount(document.numPages)
        setCurrentPage((page) => Math.min(page, document.numPages - 1))
        setRotations((previous) => Array.from(
          { length: document.numPages },
          (_, index) => previous[index] || 0,
        ))
        setSelectedPages((previous) => new Set([...previous].filter((index) => index < document.numPages)))
      })
      .catch((error) => {
        console.error(error)
        setStatus('Could not open this PDF. It may be encrypted or damaged.')
      })

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [bytes])

  useEffect(() => {
    if (!bytes || !activeId) return
    const timer = window.setTimeout(async () => {
      await saveDocument({
        id: activeId,
        name,
        bytes: bytes.slice(0),
        pageCount,
        size: bytes.byteLength,
        updatedAt: Date.now(),
        annotations,
        rotations,
        metadata,
      })
      await refreshLibrary()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [activeId, annotations, bytes, metadata, name, pageCount, refreshLibrary, rotations])

  useEffect(() => {
    setNativeSelection(null)
    setNativeDraft('')
  }, [currentPage])

  useEffect(() => {
    if (viewMode === 'single') return
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`.page-view[data-page="${currentPage}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 30)
  }, [currentPage, viewMode])

  const snapshot = useCallback((): HistorySnapshot | null => {
    if (!bytes) return null
    return {
      bytes: bytes.slice(0),
      annotations: structuredClone(annotations),
      rotations: [...rotations],
      metadata: { ...metadata },
    }
  }, [annotations, bytes, metadata, rotations])

  const pushHistory = useCallback(() => {
    const current = snapshot()
    if (!current) return
    setHistory((items) => [...items.slice(-24), current])
    setFuture([])
  }, [snapshot])

  const restore = (state: HistorySnapshot) => {
    setBytes(state.bytes.slice(0))
    setAnnotations(structuredClone(state.annotations))
    setRotations([...state.rotations])
    setMetadata({ ...state.metadata })
    setSelectedId(null)
    setSelectedPages(new Set())
    setNativeSelection(null)
    setNativeDraft('')
  }

  const undo = useCallback(() => {
    if (!history.length) return
    const current = snapshot()
    const previous = history[history.length - 1]
    if (current) setFuture((items) => [cloneSnapshot(current), ...items].slice(0, 25))
    setHistory((items) => items.slice(0, -1))
    restore(previous)
  }, [history, snapshot])

  const redo = useCallback(() => {
    if (!future.length) return
    const current = snapshot()
    const next = future[0]
    if (current) setHistory((items) => [...items.slice(-24), cloneSnapshot(current)])
    setFuture((items) => items.slice(1))
    restore(next)
  }, [future, snapshot])

  const chooseTool = (next: Tool) => {
    setTool(next)
    if (next === 'editText') setSelectedId(null)
    if (next !== 'editText') {
      setNativeSelection(null)
      setNativeDraft('')
    }
  }

  const decryptInputPdf = async (file: File) => {
    const raw = await file.arrayBuffer()
    const task = pdfjsLib.getDocument({ data: new Uint8Array(raw.slice(0)) })
    try {
      await task.promise
      return raw
    } catch (error) {
      const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
      if (!/password/i.test(message)) throw error
      const password = window.prompt(`Enter the password for ${file.name}`)
      if (password === null) throw new Error('Password-protected PDF was not opened.')
      setStatus('Decrypting PDF locally…')
      return decryptPdf(raw, password)
    } finally {
      void task.destroy().catch(() => undefined)
    }
  }

  const preparedFiles = async (files: File[]) => Promise.all(files.map(async (file) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) return file
    const raw = await decryptInputPdf(file)
    return new File([raw], file.name, { type: 'application/pdf', lastModified: file.lastModified })
  }))

  const loadNewDocument = async (
    documentName: string,
    raw: ArrayBuffer,
    existing?: LibraryDocument,
  ) => {
    const id = existing?.id || crypto.randomUUID()
    let nextMetadata = existing?.metadata || EMPTY_META
    try {
      if (!existing?.metadata) nextMetadata = await readMetadata(raw)
    } catch {
      // Metadata is optional.
    }

    setActiveId(id)
    setName(documentName)
    setBytes(raw.slice(0))
    setAnnotations(existing?.annotations || [])
    setRotations(existing?.rotations || [])
    setMetadata(nextMetadata)
    setCurrentPage(0)
    setSelectedPages(new Set())
    setSelectedId(null)
    setNativeSelection(null)
    setNativeDraft('')
    setHistory([])
    setFuture([])
    setPanel('pages')
    setSearchText('')
    setSearchMatches([])
    setViewMode('single')

    try {
      setFormFields(await readFormFields(raw))
    } catch {
      setFormFields([])
    }

    try {
      const task = pdfjsLib.getDocument({ data: new Uint8Array(raw.slice(0)) })
      const document = await task.promise
      const count = document.numPages
      await task.destroy()
      await saveDocument({
        id,
        name: documentName,
        bytes: raw.slice(0),
        pageCount: count,
        size: raw.byteLength,
        updatedAt: Date.now(),
        annotations: existing?.annotations || [],
        rotations: existing?.rotations || [],
        metadata: nextMetadata,
      })
      await refreshLibrary()
    } catch {
      // The viewer effect reports load failures.
    }
  }

  const importFiles = async (files: FileList | File[]) => {
    const selectedFiles = Array.from(files)
    if (!selectedFiles.length) return
    setStatus('Opening document…')

    try {
      let raw: ArrayBuffer
      let documentName: string
      if (
        selectedFiles.length === 1 &&
        (selectedFiles[0].type === 'application/pdf' || selectedFiles[0].name.toLowerCase().endsWith('.pdf'))
      ) {
        raw = await decryptInputPdf(selectedFiles[0])
        documentName = selectedFiles[0].name
      } else {
        const prepared = await preparedFiles(selectedFiles)
        raw = await createPdfFromFiles(prepared)
        documentName = selectedFiles.length === 1
          ? `${selectedFiles[0].name.replace(/\.[^.]+$/, '')}.pdf`
          : 'Combined document.pdf'
      }
      await loadNewDocument(documentName, raw)
      setStatus('Document loaded')
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : 'Unable to open the selected file.')
    }
  }

  const openLibraryDoc = async (document: LibraryDocument) => {
    await loadNewDocument(document.name, document.bytes, document)
    setStatus('Opened from local library')
  }

  const closeDocument = () => {
    setActiveId(null)
    setBytes(null)
    setPdf(null)
    setName('Untitled.pdf')
    setAnnotations([])
    setRotations([])
    setSelectedPages(new Set())
    setCurrentPage(0)
    setHistory([])
    setFuture([])
    setPanel('library')
    setSelectedId(null)
    setNativeSelection(null)
    setNativeDraft('')
    setViewMode('single')
  }

  const mergeFiles = async (files: FileList | null) => {
    if (!bytes || !files?.length) return
    pushHistory()
    setStatus('Merging files…')

    try {
      const prepared = await preparedFiles(Array.from(files))
      const next = await mergePdfs(bytes, prepared)
      const task = pdfjsLib.getDocument({ data: new Uint8Array(next.slice(0)) })
      const document = await task.promise
      const extraCount = document.numPages - pageCount
      await task.destroy()
      setBytes(next)
      setRotations((items) => [...items, ...Array(Math.max(0, extraCount)).fill(0)])
      setSelectedPages(new Set())
      setStatus('Files merged')
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : 'Merge failed.')
    }
  }

  const rotatePage = (delta: number) => {
    pushHistory()
    setNativeSelection(null)
    setRotations((items) => items.map(
      (value, index) => index === currentPage ? (value + delta + 360) % 360 : value,
    ))
  }

  const deletePage = async () => {
    if (!bytes || pageCount <= 1) return
    pushHistory()
    const order = Array.from({ length: pageCount }, (_, index) => index)
      .filter((index) => index !== currentPage)
    const next = await reorderPdf(bytes, order, order.map(() => 0))
    setBytes(next)
    setRotations(order.map((index) => rotations[index] || 0))
    setAnnotations(remapAnnotations(annotations, order))
    setCurrentPage(Math.min(currentPage, pageCount - 2))
    setSelectedPages(new Set())
  }

  const copyPage = async () => {
    if (!bytes) return
    pushHistory()
    const next = await duplicatePage(bytes, currentPage)
    const nextRotations = [...rotations]
    nextRotations.splice(currentPage + 1, 0, rotations[currentPage] || 0)
    const nextAnnotations = annotations.map((annotation) => ({
      ...annotation,
      page: annotation.page > currentPage ? annotation.page + 1 : annotation.page,
    }))
    const duplicates = annotations
      .filter((annotation) => annotation.page === currentPage)
      .map((annotation) => ({
        ...structuredClone(annotation),
        id: crypto.randomUUID(),
        page: currentPage + 1,
      }))
    setBytes(next)
    setRotations(nextRotations)
    setAnnotations([...nextAnnotations, ...duplicates])
    setCurrentPage(currentPage + 1)
    setSelectedPages(new Set())
  }

  const movePage = async (from: number, to: number) => {
    if (!bytes || from === to || to < 0 || to >= pageCount) return
    pushHistory()
    const order = Array.from({ length: pageCount }, (_, index) => index)
    const [moved] = order.splice(from, 1)
    order.splice(to, 0, moved)
    const next = await reorderPdf(bytes, order, order.map(() => 0))
    setBytes(next)
    setRotations(order.map((index) => rotations[index] || 0))
    setAnnotations(remapAnnotations(annotations, order))
    setCurrentPage(to)
    setSelectedPages(new Set())
  }

  const togglePageSelected = (index: number, checked: boolean) => {
    setSelectedPages((previous) => {
      const next = new Set(previous)
      if (checked) next.add(index)
      else next.delete(index)
      return next
    })
  }

  const bulkRotate = (delta: number) => {
    if (!selectedPages.size) return
    pushHistory()
    setRotations((items) => items.map(
      (value, index) => selectedPages.has(index) ? (value + delta + 360) % 360 : value,
    ))
    setStatus(`Rotated ${selectedPages.size} selected pages`)
  }

  const bulkDelete = async () => {
    if (!bytes || !selectedPages.size) return
    if (selectedPages.size >= pageCount) {
      setStatus('A PDF must keep at least one page.')
      return
    }
    pushHistory()
    const order = Array.from({ length: pageCount }, (_, index) => index)
      .filter((index) => !selectedPages.has(index))
    const next = await reorderPdf(bytes, order, order.map(() => 0))
    const currentNew = Math.max(0, order.indexOf(currentPage))
    setBytes(next)
    setRotations(order.map((index) => rotations[index] || 0))
    setAnnotations(remapAnnotations(annotations, order))
    setCurrentPage(currentNew)
    setSelectedPages(new Set())
    setStatus('Selected pages deleted')
  }

  const sourceWithRotations = async () => {
    if (!bytes) return null
    return rotations.some(Boolean)
      ? reorderPdf(bytes, Array.from({ length: pageCount }, (_, index) => index), rotations)
      : bytes
  }

  const bulkExtract = async () => {
    if (!selectedPages.size) return
    const source = await sourceWithRotations()
    if (!source) return
    const indices = [...selectedPages].sort((a, b) => a - b)
    const output = await extractPages(source, indices)
    downloadBytes(output, `${name.replace(/\.pdf$/i, '')}-selected-pages.pdf`)
    setStatus(`Extracted ${indices.length} selected pages`)
  }

  const addAnnotation = (annotation: Annotation) => {
    pushHistory()
    setAnnotations((items) => [...items, annotation])
    setSelectedId(annotation.id)
    setNativeSelection(null)
    setTool('select')
  }

  const updateSelected = (patch: Partial<Annotation>) => {
    if (!selectedId) return
    pushHistory()
    setAnnotations((items) => items.map(
      (annotation) => annotation.id === selectedId ? { ...annotation, ...patch } : annotation,
    ))
  }

  const updateAnnotationLive = (id: string, patch: Partial<Annotation>) => {
    setAnnotations((items) => items.map(
      (annotation) => annotation.id === id ? { ...annotation, ...patch } : annotation,
    ))
  }

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    pushHistory()
    setAnnotations((items) => items.filter((annotation) => annotation.id !== selectedId))
    setSelectedId(null)
  }, [pushHistory, selectedId])

  const pickNativeText = async (pageIndex: number, displayPoint: Point, hint: string) => {
    if (!bytes || nativeBusy) return
    setCurrentPage(pageIndex)
    setNativeBusy(true)
    setNativeSelection(null)
    setNativeDraft('')
    setStatus('Finding editable PDF text…')

    try {
      const rotation = rotations[pageIndex] || 0
      const point = inverseRotatePoint(displayPoint.x, displayPoint.y, rotation)
      const picked = await pickNativeTextObject(bytes, pageIndex, point, hint)
      setNativeSelection(picked)
      setNativeDraft(picked?.text || '')
      setSelectedId(null)
      setStatus(picked
        ? 'Text object selected — edit it in the right panel'
        : 'No editable PDF text object at that spot')
    } catch (error) {
      console.error(error)
      setStatus('That text could not be opened for editing.')
    } finally {
      setNativeBusy(false)
    }
  }

  const applyNativeTextEdit = async () => {
    if (
      !bytes || !nativeSelection || nativeBusy ||
      nativeDraft === nativeSelection.text || !nativeDraft.length
    ) return

    pushHistory()
    setNativeBusy(true)
    setStatus('Updating existing PDF text…')
    try {
      const next = await replaceNativeTextObject(bytes, nativeSelection, nativeDraft)
      setBytes(next)
      setSearchMatches([])
      setNativeSelection(null)
      setNativeDraft('')
      setStatus('Existing PDF text updated')
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : 'Could not update this PDF text object.')
    } finally {
      setNativeBusy(false)
    }
  }

  const deleteNativeText = async () => {
    if (!bytes || !nativeSelection || nativeBusy) return
    pushHistory()
    setNativeBusy(true)
    setStatus('Deleting existing PDF text…')
    try {
      const next = await deleteNativeTextObject(bytes, nativeSelection)
      setBytes(next)
      setSearchMatches([])
      setNativeSelection(null)
      setNativeDraft('')
      setStatus('Existing PDF text deleted')
    } catch (error) {
      console.error(error)
      setStatus(error instanceof Error ? error.message : 'Could not delete this PDF text object.')
    } finally {
      setNativeBusy(false)
    }
  }

  const prepareFinalPdf = useCallback(async () => {
    if (!bytes) throw new Error('No PDF is open.')
    const redactions = annotations.filter((annotation) => annotation.type === 'redaction')
    const ordinary = annotations.filter((annotation) => annotation.type !== 'redaction')

    if (redactions.length) {
      const flattened = await flattenAnnotations(
        bytes,
        annotationsForExport(ordinary, rotations),
        metadata,
      )
      const redacted = await secureRedactPdf(arrayBufferFrom(flattened), redactions, rotations)
      return new Uint8Array(redacted)
    }

    const rotated = rotations.some(Boolean)
      ? await reorderPdf(bytes, Array.from({ length: pageCount }, (_, index) => index), rotations)
      : bytes
    return flattenAnnotations(rotated, annotationsForExport(ordinary, rotations), metadata)
  }, [annotations, bytes, metadata, pageCount, rotations])

  const exportPdf = useCallback(async () => {
    if (!bytes) return
    setStatus('Preparing export…')
    try {
      const output = await prepareFinalPdf()
      downloadBytes(output, `${name.replace(/\.pdf$/i, '')}-edited.pdf`)
      setStatus('Export complete')
    } catch (error) {
      console.error(error)
      setStatus('Export failed for this document.')
    }
  }, [bytes, name, prepareFinalPdf])

  const saveToLibrary = async () => {
    if (!bytes || !activeId) return
    await saveDocument({
      id: activeId,
      name,
      bytes: bytes.slice(0),
      pageCount,
      size: bytes.byteLength,
      updatedAt: Date.now(),
      annotations,
      rotations,
      metadata,
    })
    await refreshLibrary()
    setStatus('Saved to local library')
  }

  const applyAdvancedMutation = (next: ArrayBuffer, options: AdvancedApplyOptions = {}) => {
    setBytes(next.slice(0))
    if (options.rotations) setRotations(options.rotations)
    if (options.annotations) setAnnotations(options.annotations)
    if (typeof options.page === 'number') setCurrentPage(Math.max(0, options.page))
    setSelectedPages(new Set())
    setSelectedId(null)
    setNativeSelection(null)
    setNativeDraft('')
    setSearchMatches([])
    if (options.status) setStatus(options.status)
    void readFormFields(next).then(setFormFields).catch(() => setFormFields([]))
  }

  const fitView = async (mode: 'page' | 'width') => {
    if (!pdf) return
    try {
      const page = await pdf.getPage(currentPage + 1)
      const viewport = page.getViewport({ scale: 1, rotation: rotations[currentPage] || 0 })
      const scroller = document.querySelector<HTMLElement>('.page-scroll')
      if (!scroller) return
      const widthScale = Math.max(0.4, (scroller.clientWidth - 80) / viewport.width)
      const heightScale = Math.max(0.4, (scroller.clientHeight - 125) / viewport.height)
      setZoom(Math.min(2.4, mode === 'width' ? widthScale : Math.min(widthScale, heightScale)))
    } catch {
      // Ignore transient PDF reloads.
    }
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.querySelector<HTMLElement>('.app-shell')?.requestFullscreen()
    } catch {
      setStatus('Fullscreen is not available in this browser context.')
    }
  }

  const runExtract = async () => {
    const indices = parsePageRange(extractRange, pageCount)
    if (!indices.length) {
      setStatus('Enter a valid page range, such as 1-3, 5.')
      return
    }
    const source = await sourceWithRotations()
    if (!source) return
    const output = await extractPages(source, indices)
    downloadBytes(output, `${name.replace(/\.pdf$/i, '')}-pages-${extractRange.replace(/\s/g, '')}.pdf`)
    setExtractOpen(false)
    setStatus(`Extracted ${indices.length} page${indices.length === 1 ? '' : 's'}`)
  }

  const searchPdf = useCallback(async () => {
    if (!bytes || !searchText.trim()) {
      setSearchMatches([])
      return
    }
    const query = searchText.trim().toLowerCase()
    const found: number[] = []
    setStatus('Searching…')
    const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) })
    try {
      const document = await task.promise
      for (let index = 0; index < document.numPages; index++) {
        const page = await document.getPage(index + 1)
        const content = await page.getTextContent()
        const text = content.items
          .map((item) => 'str' in item ? item.str : '')
          .join(' ')
          .toLowerCase()
        if (text.includes(query)) found.push(index)
      }
      setSearchMatches(found)
      setSearchMatchIndex(0)
      if (found.length) setCurrentPage(found[0])
      setStatus(found.length
        ? `${found.length} matching page${found.length === 1 ? '' : 's'}`
        : 'No matches')
    } catch (error) {
      console.error(error)
      setSearchMatches([])
      setStatus('Search failed for this document.')
    } finally {
      void task.destroy()
    }
  }, [bytes, searchText])

  const cycleSearch = (delta: number) => {
    if (!searchMatches.length) return
    const next = (searchMatchIndex + delta + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(next)
    setCurrentPage(searchMatches[next])
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
      console.error(error)
      setStatus('This form field could not be changed.')
    }
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void exportPdf()
        return
      }
      if (typing) return
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected()
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        setCurrentPage((page) => Math.min(pageCount - 1, page + 1))
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        setCurrentPage((page) => Math.max(0, page - 1))
      }
      if (event.key === 'Escape') {
        setTool('select')
        setSelectedId(null)
        setNativeSelection(null)
        setNativeDraft('')
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [deleteSelected, exportPdf, pageCount, redo, undo])

  const selected = useMemo(
    () => annotations.find((annotation) => annotation.id === selectedId) || null,
    [annotations, selectedId],
  )
  const selectedPageList = useMemo(
    () => [...selectedPages].sort((a, b) => a - b),
    [selectedPages],
  )
  const annotationsForPage = (index: number) => annotations.filter(
    (annotation) => annotation.page === index,
  )

  const dropFiles = async (event: React.DragEvent) => {
    event.preventDefault()
    const dropped = Array.from(event.dataTransfer.files)
    if (!dropped.length) return
    if (bytes) await mergeFiles(event.dataTransfer.files)
    else await importFiles(dropped)
  }

  const pageCanvas = (index: number, lazy = false) => {
    const common = {
      pdf,
      pageIndex: index,
      zoom,
      rotation: rotations[index] || 0,
      annotations: annotationsForPage(index),
      tool,
      color,
      strokeWidth,
      fontSize,
      selectedId,
      nativeSelection,
      onSelect: setSelectedId,
      onAdd: addAnnotation,
      onPickNativeText: (point: Point, hint: string) => void pickNativeText(index, point, hint),
      onBeginAnnotationEdit: pushHistory,
      onUpdateAnnotation: updateAnnotationLive,
    }

    if (lazy) {
      return <LazyPdfPage key={index} {...common} onFocus={() => setCurrentPage(index)} />
    }

    return (
      <div
        className="page-view"
        data-page={index}
        key={index}
        onPointerDownCapture={() => setCurrentPage(index)}
      >
        <PdfPageCanvas {...common} />
      </div>
    )
  }

  if (!bytes || !pdf) {
    return (
      <main className="welcome" onDragOver={(event) => event.preventDefault()} onDrop={dropFiles}>
        <div className="welcome-orb" />
        <header className="welcome-header">
          <div className="brand"><span className="brand-mark">P</span><span>PDF Forge</span></div>
          <span className="privacy-pill"><Check size={14} /> Local-first</span>
        </header>
        <section className="welcome-content">
          <div className="hero-copy">
            <span className="eyebrow">YOUR PDF WORKSPACE</span>
            <h1>Edit PDFs without<br /><em>giving them away.</em></h1>
            <p>Open, organize, annotate, edit text, OCR, redact, protect, optimize and export PDFs directly in your browser.</p>
            <div className="hero-actions">
              <button className="primary large" onClick={() => fileInput.current?.click()}>
                <Upload size={18} /> Open PDF or images
              </button>
              <span>or drop files anywhere</span>
            </div>
          </div>
          <div className="recent-card">
            <div className="recent-title">
              <div><span className="eyebrow">LOCAL LIBRARY</span><h2>Recent documents</h2></div>
              <Archive size={20} />
            </div>
            {documents.length ? (
              <div className="recent-list">
                {documents.slice(0, 6).map((document) => (
                  <button key={document.id} className="recent-row" onClick={() => void openLibraryDoc(document)}>
                    <span className="pdf-file-icon">PDF</span>
                    <span className="recent-meta">
                      <strong>{document.name}</strong>
                      <small>{document.pageCount} pages · {fileSize(document.size)}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-recent"><Files size={36} /><p>Your recent PDFs will live here.</p></div>
            )}
          </div>
        </section>
        <section className="feature-strip">
          <span><PenLine /> Edit & sign</span>
          <span><Menu /> Organize pages</span>
          <span><ScanLine /> OCR & redact</span>
          <span><FormInput /> Fill forms</span>
        </section>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          multiple
          onChange={(event) => event.target.files && void importFiles(event.target.files)}
        />
      </main>
    )
  }

  return (
    <main className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={dropFiles}>
      <header className="topbar">
        <div className="brand compact"><span className="brand-mark">P</span><span>PDF Forge</span></div>
        <div className="doc-title">
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Document name" />
          <span>{pageCount} pages · {fileSize(bytes.byteLength)}</span>
        </div>
        <div className="top-actions">
          <button className="icon-btn" title="Undo" disabled={!history.length} onClick={undo}><Undo2 /></button>
          <button className="icon-btn" title="Redo" disabled={!future.length} onClick={redo}><Redo2 /></button>
          <span className="divider" />
          <button className="soft-btn" onClick={() => void saveToLibrary()}><Save /> Save</button>
          <button className="primary" onClick={() => void exportPdf()}><Download /> Export PDF</button>
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
          {panel === 'pages' && (
            <>
              <div className="panel-heading">
                <div><span className="eyebrow">ORGANIZE</span><h3>Pages</h3></div>
                <span>{pageCount}</span>
              </div>
              <div className="page-actions-grid">
                <button onClick={() => rotatePage(-90)} title="Rotate left"><RotateCcw /> Left</button>
                <button onClick={() => rotatePage(90)} title="Rotate right"><RotateCw /> Right</button>
                <button onClick={() => void copyPage()}><Copy /> Duplicate</button>
                <button onClick={() => void deletePage()} disabled={pageCount <= 1}><Trash2 /> Delete</button>
              </div>
              <div className="page-select-toolbar">
                <label>
                  <input
                    type="checkbox"
                    checked={selectedPages.size === pageCount && pageCount > 0}
                    onChange={(event) => setSelectedPages(
                      event.target.checked
                        ? new Set(Array.from({ length: pageCount }, (_, index) => index))
                        : new Set(),
                    )}
                  />
                  Select all
                </label>
                {selectedPages.size > 0 && <span>{selectedPages.size} selected</span>}
              </div>
              {selectedPages.size > 0 && (
                <div className="bulk-page-actions">
                  <button title="Rotate selected left" onClick={() => bulkRotate(-90)}><RotateCcw /></button>
                  <button title="Rotate selected right" onClick={() => bulkRotate(90)}><RotateCw /></button>
                  <button title="Extract selected pages" onClick={() => void bulkExtract()}><Split /></button>
                  <button title="Delete selected pages" onClick={() => void bulkDelete()}><Trash2 /></button>
                </div>
              )}
              <div className="thumbnail-list">
                {Array.from({ length: pageCount }, (_, index) => (
                  <div
                    key={`${index}-${rotations[index] || 0}`}
                    className={`thumb-drag-wrap ${selectedPages.has(index) ? 'multi-selected' : ''}`}
                    draggable
                    onDragStart={() => setDragPage(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragPage !== null) void movePage(dragPage, index)
                      setDragPage(null)
                    }}
                  >
                    <label className="page-select-check" onPointerDown={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select page ${index + 1}`}
                        checked={selectedPages.has(index)}
                        onChange={(event) => togglePageSelected(index, event.target.checked)}
                      />
                    </label>
                    <Thumbnail
                      pdf={pdf}
                      pageIndex={index}
                      rotation={rotations[index] || 0}
                      active={currentPage === index}
                      onClick={() => setCurrentPage(index)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {panel === 'library' && (
            <>
              <div className="panel-heading">
                <div><span className="eyebrow">LOCAL</span><h3>Library</h3></div>
                <button className="icon-btn small" onClick={() => fileInput.current?.click()}><Plus /></button>
              </div>
              <button className="drop-card" onClick={() => fileInput.current?.click()}>
                <Upload /><strong>Open files</strong><span>PDF, PNG or JPG</span>
              </button>
              <div className="library-list">
                {documents.map((document) => (
                  <div key={document.id} className={`library-item ${document.id === activeId ? 'active' : ''}`}>
                    <button onClick={() => void openLibraryDoc(document)}>
                      <span className="pdf-file-icon">PDF</span>
                      <span><strong>{document.name}</strong><small>{document.pageCount} pages · {fileSize(document.size)}</small></span>
                    </button>
                    <button
                      className="trash-mini"
                      title="Remove from library"
                      onClick={async () => {
                        await deleteDocument(document.id)
                        await refreshLibrary()
                      }}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {panel === 'forms' && (
            <>
              <div className="panel-heading">
                <div><span className="eyebrow">ACROFORM</span><h3>Form fields</h3></div>
                <span>{formFields.length}</span>
              </div>
              {!formFields.length && (
                <div className="empty-panel"><FormInput /><strong>No form fields found</strong><p>You can still add text anywhere using the Text tool.</p></div>
              )}
              <div className="form-list">
                {formFields.map((field) => (
                  <label key={field.name} className="form-field">
                    <span>{field.name}</span>
                    <small>{field.type}</small>
                    {field.type === 'checkbox' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(field.value)}
                        onChange={(event) => void changeFormField(field, event.target.checked)}
                      />
                    ) : field.options?.length ? (
                      <select
                        value={String(field.value)}
                        onChange={(event) => void changeFormField(field, event.target.value)}
                      >
                        <option value="">Choose…</option>
                        {field.options.map((option) => <option key={option}>{option}</option>)}
                      </select>
                    ) : (
                      <input
                        value={String(field.value)}
                        onChange={(event) => setFormFields((items) => items.map(
                          (item) => item.name === field.name ? { ...item, value: event.target.value } : item,
                        ))}
                        onBlur={(event) => void changeFormField(field, event.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>
            </>
          )}

          {panel === 'info' && (
            <>
              <div className="panel-heading"><div><span className="eyebrow">DOCUMENT</span><h3>Properties</h3></div><Info /></div>
              <div className="meta-form">
                <label>Title<input value={metadata.title} onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} /></label>
                <label>Author<input value={metadata.author} onChange={(event) => setMetadata({ ...metadata, author: event.target.value })} /></label>
                <label>Subject<input value={metadata.subject} onChange={(event) => setMetadata({ ...metadata, subject: event.target.value })} /></label>
                <label>Keywords<textarea rows={4} value={metadata.keywords} onChange={(event) => setMetadata({ ...metadata, keywords: event.target.value })} placeholder="invoice, client, 2026" /></label>
              </div>
            </>
          )}
        </aside>

        <section className="editor-column">
          <div className="editor-toolbar">
            <div className="tool-group">
              <button className={tool === 'select' ? 'active' : ''} onClick={() => chooseTool('select')} title="Select"><MousePointer2 /></button>
              <button className={tool === 'editText' ? 'active' : ''} onClick={() => chooseTool('editText')} title="Edit existing text"><PenLine /></button>
              <button className={tool === 'text' ? 'active' : ''} onClick={() => chooseTool('text')} title="Add text"><Type /></button>
              <button className={tool === 'highlight' ? 'active' : ''} onClick={() => chooseTool('highlight')} title="Highlight"><Highlighter /></button>
              <button className={tool === 'rectangle' ? 'active' : ''} onClick={() => chooseTool('rectangle')} title="Rectangle"><Shapes /></button>
              <button className={tool === 'redaction' ? 'active' : ''} onClick={() => chooseTool('redaction')} title="Redact"><ScanLine /></button>
              <button className={tool === 'ink' ? 'active' : ''} onClick={() => chooseTool('ink')} title="Draw"><PenLine /></button>
              <button className={tool === 'signature' ? 'active' : ''} onClick={() => chooseTool('signature')} title="Signature"><span className="signature-icon">⌁</span></button>
            </div>
            <span className="divider" />
            <div className="search-box">
              <Search />
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void searchPdf()}
                placeholder="Find in document"
              />
              {searchMatches.length > 0 && (
                <>
                  <span>{searchMatchIndex + 1}/{searchMatches.length}</span>
                  <button onClick={() => cycleSearch(-1)}><ChevronLeft /></button>
                  <button onClick={() => cycleSearch(1)}><ChevronRight /></button>
                </>
              )}
            </div>
            <div className="toolbar-spacer" />
            <button className="soft-btn" onClick={() => mergeInput.current?.click()}><FileInput /> Merge</button>
            <button className="soft-btn" onClick={() => { setExtractRange(String(currentPage + 1)); setExtractOpen(true) }}><Split /> Extract</button>
            <AdvancedTools
              bytes={bytes}
              name={name}
              pageCount={pageCount}
              currentPage={currentPage}
              rotations={rotations}
              annotations={annotations}
              metadata={metadata}
              onBeforeMutate={pushHistory}
              onApply={applyAdvancedMutation}
              onStatus={setStatus}
            />
          </div>

          <div className="document-stage">
            <div className="stage-top-hint">
              {tool === 'select' && status}
              {tool === 'editText' && (
                nativeBusy
                  ? 'Loading PDF text engine…'
                  : nativeSelection
                    ? 'Edit the selected PDF text in the right panel'
                    : 'Click existing PDF text to edit it'
              )}
              {tool === 'text' && 'Click anywhere on the page to add new text'}
              {(tool === 'highlight' || tool === 'rectangle') && 'Drag on the page to place the annotation'}
              {tool === 'redaction' && 'Drag over sensitive content, then apply secure redactions from Tools'}
              {(tool === 'ink' || tool === 'signature') && 'Draw directly on the page'}
            </div>
            <div className={`page-scroll view-${viewMode}`}>
              {viewMode === 'single' && pageCanvas(currentPage)}
              {viewMode === 'continuous' && (
                <div className="continuous-stack">
                  {Array.from({ length: pageCount }, (_, index) => pageCanvas(index, true))}
                </div>
              )}
              {viewMode === 'spread' && (
                <div className="spread-view">
                  {[currentPage, currentPage + 1]
                    .filter((index) => index < pageCount)
                    .map((index) => pageCanvas(index))}
                </div>
              )}
            </div>
            <div className="floating-nav">
              <button onClick={() => setCurrentPage((page) => Math.max(0, page - 1))} disabled={currentPage === 0}><ChevronLeft /></button>
              <span>
                <input
                  value={currentPage + 1}
                  onChange={(event) => setCurrentPage(Math.max(
                    0,
                    Math.min(pageCount - 1, Number(event.target.value) - 1 || 0),
                  ))}
                /> / {pageCount}
              </span>
              <button onClick={() => setCurrentPage((page) => Math.min(pageCount - 1, page + 1))} disabled={currentPage === pageCount - 1}><ChevronRight /></button>
              <span className="divider" />
              <div className="view-mode-group">
                <button title="Single page view" className={viewMode === 'single' ? 'view-active' : ''} onClick={() => setViewMode('single')}>1</button>
                <button title="Continuous view" className={viewMode === 'continuous' ? 'view-active' : ''} onClick={() => setViewMode('continuous')}>↕</button>
                <button title="Two-page view" className={viewMode === 'spread' ? 'view-active' : ''} onClick={() => setViewMode('spread')}>2</button>
                <button title="Fullscreen" onClick={() => void toggleFullscreen()}>⛶</button>
              </div>
              <button title="Fit page" onClick={() => void fitView('page')}><span>Fit</span></button>
              <button title="Fit width" onClick={() => void fitView('width')}><span>W</span></button>
              <button onClick={() => setZoom((value) => Math.max(0.4, value - 0.1))}><ZoomOut /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((value) => Math.min(2.4, value + 0.1))}><ZoomIn /></button>
            </div>
          </div>
        </section>

        <aside className="right-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">{nativeSelection ? 'PDF TEXT' : selected ? 'SELECTION' : 'TOOLS'}</span>
              <h3>{nativeSelection ? 'Edit existing text' : selected ? selected.type[0].toUpperCase() + selected.type.slice(1) : 'Appearance'}</h3>
            </div>
            {selected && !nativeSelection && (
              <button className="icon-btn small danger" onClick={deleteSelected}><Trash2 /></button>
            )}
          </div>

          {nativeSelection ? (
            <div className="native-text-editor">
              <label className="property-field">
                Existing PDF text
                <textarea
                  rows={7}
                  value={nativeDraft}
                  disabled={nativeBusy}
                  onChange={(event) => setNativeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      void applyNativeTextEdit()
                    }
                  }}
                />
              </label>
              <div className="native-edit-meta">
                <span>Page {nativeSelection.page + 1}</span>
                {nativeSelection.fontSize && <span>Original size {Math.round(nativeSelection.fontSize * 10) / 10} pt</span>}
              </div>
              <p className="native-edit-note">
                This changes the underlying PDF text object. PDFs do not reflow like Word, so a much longer replacement can overlap nearby content. The original embedded font controls which replacement characters can be written.
              </p>
              {!nativeDraft.length && (
                <p className="native-edit-warning">The draft is empty. Use Delete text object to remove the underlying object completely.</p>
              )}
              <div className="native-edit-actions">
                <button className="soft-btn" disabled={nativeBusy} onClick={() => { setNativeSelection(null); setNativeDraft('') }}>Cancel</button>
                <button
                  className="primary"
                  disabled={nativeBusy || !nativeDraft.length || nativeDraft === nativeSelection.text}
                  onClick={() => void applyNativeTextEdit()}
                >
                  {nativeBusy ? 'Applying…' : 'Apply to PDF'}
                </button>
              </div>
              <button className="soft-btn native-delete-button" disabled={nativeBusy} onClick={() => void deleteNativeText()}>
                <Trash2 /> Delete text object
              </button>
            </div>
          ) : (
            <>
              {selected?.type === 'text' && (
                <label className="property-field">
                  Text
                  <textarea
                    rows={5}
                    value={selected.text || ''}
                    onChange={(event) => setAnnotations((items) => items.map(
                      (annotation) => annotation.id === selected.id
                        ? { ...annotation, text: event.target.value }
                        : annotation,
                    ))}
                  />
                </label>
              )}

              {selected?.type === 'redaction' ? (
                <div className="right-help">
                  <strong>Redaction mark</strong>
                  <p>This red box is reversible until export or <b>Tools → Apply marked redactions</b>. Normal export also applies it destructively.</p>
                </div>
              ) : (
                <div className="property-section">
                  <span>Color</span>
                  <div className="color-grid">
                    {COLORS.map((preset) => (
                      <button
                        key={preset}
                        className={(selected?.color || color) === preset ? 'active' : ''}
                        style={{ background: preset }}
                        onClick={() => {
                          if (selected) updateSelected({ color: preset })
                          else setColor(preset)
                        }}
                        aria-label={`Color ${preset}`}
                      />
                    ))}
                    <label className="custom-color">
                      <input
                        type="color"
                        value={selected?.color || color}
                        onChange={(event) => {
                          if (selected) updateSelected({ color: event.target.value })
                          else setColor(event.target.value)
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}

              {(selected?.type === 'text' || (!selected && tool === 'text')) && (
                <label className="property-field">
                  Font size
                  <div className="stepper">
                    <button onClick={() => {
                      if (selected) updateSelected({ fontSize: Math.max(8, (selected.fontSize || 18) - 1) })
                      else setFontSize((value) => Math.max(8, value - 1))
                    }}><Minus /></button>
                    <input
                      type="number"
                      value={selected?.fontSize || fontSize}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        if (selected) updateSelected({ fontSize: value })
                        else setFontSize(value)
                      }}
                    />
                    <button onClick={() => {
                      if (selected) updateSelected({ fontSize: (selected.fontSize || 18) + 1 })
                      else setFontSize((value) => value + 1)
                    }}><Plus /></button>
                  </div>
                </label>
              )}

              {(
                selected?.type === 'rectangle' ||
                selected?.type === 'ink' ||
                selected?.type === 'signature' ||
                (!selected && ['rectangle', 'ink', 'signature'].includes(tool))
              ) && (
                <label className="property-field">
                  Stroke width
                  <input
                    className="range"
                    type="range"
                    min="1"
                    max="12"
                    step="1"
                    value={selected?.strokeWidth || strokeWidth}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (selected) updateSelected({ strokeWidth: value })
                      else setStrokeWidth(value)
                    }}
                  />
                  <strong>{selected?.strokeWidth || strokeWidth}px</strong>
                </label>
              )}

              {!selected && tool === 'editText' && (
                <div className="right-help native-edit-help">
                  <strong>Edit existing PDF text</strong>
                  <p>Click text already printed on the page. PDF Forge selects the underlying PDF text object and opens its real contents here.</p>
                  <p>Scanned/image text can be searched and copied with OCR, but it is not a native text object.</p>
                </div>
              )}
              {!selected && tool === 'redaction' && (
                <div className="right-help">
                  <strong>Secure redaction</strong>
                  <p>Drag over sensitive areas. Redaction is applied destructively during normal export or from Document tools.</p>
                </div>
              )}
              {!selected && tool !== 'editText' && tool !== 'redaction' && (
                <div className="right-help">
                  <strong>Editing tips</strong>
                  <p>Selected annotations can be dragged. Box annotations expose a resize handle.</p>
                  <p><kbd>Ctrl</kbd> + <kbd>S</kbd> exports. <kbd>Ctrl</kbd> + <kbd>Z</kbd> undoes. Arrow keys move between pages.</p>
                </div>
              )}
            </>
          )}

          <div className="quick-actions">
            <span>Page {currentPage + 1}{selectedPageList.length ? ` · ${selectedPageList.length} selected` : ''}</span>
            <div>
              <button onClick={() => void movePage(currentPage, currentPage - 1)} disabled={currentPage === 0}><ArrowUp /></button>
              <button onClick={() => void movePage(currentPage, currentPage + 1)} disabled={currentPage === pageCount - 1}><ArrowDown /></button>
            </div>
          </div>
        </aside>
      </section>

      {extractOpen && (
        <div className="modal-backdrop" onMouseDown={() => setExtractOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-icon"><FileOutput /></div>
            <h2>Extract pages</h2>
            <p>Create a new PDF containing only the pages you choose. Use ranges like <strong>1-3, 5, 8-10</strong>.</p>
            <label>
              Page range
              <input
                autoFocus
                value={extractRange}
                onChange={(event) => setExtractRange(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void runExtract()}
              />
            </label>
            <div className="modal-actions">
              <button className="soft-btn" onClick={() => setExtractOpen(false)}>Cancel</button>
              <button className="primary" onClick={() => void runExtract()}><Split /> Extract PDF</button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        hidden
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        multiple
        onChange={(event) => event.target.files && void importFiles(event.target.files)}
      />
      <input
        ref={mergeInput}
        hidden
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        multiple
        onChange={(event) => void mergeFiles(event.target.files)}
      />
    </main>
  )
}
