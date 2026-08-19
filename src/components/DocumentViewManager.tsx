import { useEffect, useMemo, useState } from 'react'
import { Download, Eye, Images, ListOrdered, Plus, Trash2 } from 'lucide-react'
import {
  clearPageLabels,
  listPageLabelRules,
  removePageLabelRule,
  setInitialView,
  upsertPageLabelRule,
  type InitialViewOptions,
  type PageLabelRule,
  type PageLabelStyle,
} from '../lib/document-view'
import { downloadBinary, renderPdfPagesToImages, zipStore, type PageImageFormat } from '../lib/image-export'
import { parsePageRange } from '../lib/pdf'

type Props = {
  bytes: ArrayBuffer
  name: string
  pageCount: number
  currentPage: number
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

const STYLE_LABELS: Record<PageLabelStyle, string> = {
  decimal: '1, 2, 3…',
  'roman-upper': 'I, II, III…',
  'roman-lower': 'i, ii, iii…',
  'letters-upper': 'A, B, C…',
  'letters-lower': 'a, b, c…',
  none: 'Prefix only',
}

export function DocumentViewManager({ bytes, name, pageCount, currentPage, onBeforeMutate, onApply, onStatus }: Props) {
  const [rules, setRules] = useState<PageLabelRule[]>([])
  const [rulePage, setRulePage] = useState(currentPage + 1)
  const [ruleStyle, setRuleStyle] = useState<PageLabelStyle>('decimal')
  const [rulePrefix, setRulePrefix] = useState('')
  const [ruleStart, setRuleStart] = useState(1)
  const [startPage, setStartPage] = useState(currentPage + 1)
  const [magnification, setMagnification] = useState<InitialViewOptions['magnification']>('fit-page')
  const [pageMode, setPageMode] = useState<InitialViewOptions['pageMode']>('none')
  const [pageLayout, setPageLayout] = useState<InitialViewOptions['pageLayout']>('single')
  const [imageScope, setImageScope] = useState<'current' | 'all' | 'range'>('current')
  const [imageRange, setImageRange] = useState(String(currentPage + 1))
  const [format, setFormat] = useState<PageImageFormat>('png')
  const [dpi, setDpi] = useState(150)
  const [jpegQuality, setJpegQuality] = useState(90)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let cancelled = false
    void listPageLabelRules(bytes).then((next) => { if (!cancelled) setRules(next) }).catch((error) => {
      console.error(error)
      if (!cancelled) onStatus('Could not read this PDF’s page labels.')
    })
    return () => { cancelled = true }
  }, [bytes, onStatus])

  useEffect(() => {
    setRulePage(currentPage + 1)
    setStartPage(currentPage + 1)
    if (imageScope === 'current') setImageRange(String(currentPage + 1))
  }, [currentPage, imageScope])

  const mutate = async (label: string, operation: () => Promise<ArrayBuffer>) => {
    if (busy) return
    setBusy(label)
    onBeforeMutate()
    onStatus(`${label}…`)
    try {
      const next = await operation()
      onApply(next, { status: `${label} complete` })
      setRules(await listPageLabelRules(next))
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  const addRule = () => void mutate('Updating page labels', () => upsertPageLabelRule(bytes, {
    startPage: Math.max(0, Math.min(pageCount - 1, rulePage - 1)),
    style: ruleStyle,
    prefix: rulePrefix,
    startNumber: ruleStart,
  }))

  const removeRule = (rule: PageLabelRule) => void mutate('Removing page label rule', () => removePageLabelRule(bytes, rule.startPage))
  const clearRules = () => void mutate('Clearing page labels', () => clearPageLabels(bytes))
  const applyInitialView = () => void mutate('Saving initial view', () => setInitialView(bytes, {
    pageIndex: Math.max(0, Math.min(pageCount - 1, startPage - 1)),
    magnification,
    pageMode,
    pageLayout,
  }))

  const exportPages = async () => {
    if (busy) return
    let pages: number[]
    try {
      pages = imageScope === 'all'
        ? Array.from({ length: pageCount }, (_, index) => index)
        : imageScope === 'current'
          ? [currentPage]
          : parsePageRange(imageRange, pageCount)
      if (!pages.length) throw new Error('Choose at least one valid page to export.')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Invalid page range.')
      return
    }

    setBusy('image-export')
    onStatus(`Rendering ${pages.length} page${pages.length === 1 ? '' : 's'} locally…`)
    try {
      const files = await renderPdfPagesToImages(bytes, { pageIndices: pages, format, dpi, jpegQuality: jpegQuality / 100 })
      const base = name.replace(/\.pdf$/i, '') || 'document'
      if (files.length === 1) {
        downloadBinary(files[0].data, `${base}-${files[0].name}`, format === 'png' ? 'image/png' : 'image/jpeg')
      } else {
        downloadBinary(zipStore(files), `${base}-page-images.zip`, 'application/zip')
      }
      onStatus(`${files.length} page image${files.length === 1 ? '' : 's'} exported`)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Page image export failed.')
    } finally {
      setBusy('')
    }
  }

  const ruleSummary = useMemo(() => rules.map((rule) => ({ ...rule, label: `${rule.prefix}${STYLE_LABELS[rule.style]}${rule.style !== 'none' && rule.startNumber !== 1 ? ` from ${rule.startNumber}` : ''}` })), [rules])

  return <section className="document-view-manager">
    <div className="document-view-heading"><Eye /><span><strong>Page labels, initial view & images</strong><small>Native PDF navigation settings and local raster export</small></span></div>

    <div className="document-view-grid">
      <section className="document-view-card">
        <h4><ListOrdered /> Page labels</h4>
        <p>Start a new native page-label range. Rules continue until the next rule.</p>
        <div className="page-label-form">
          <label>Start page<input aria-label="Page label start page" type="number" min="1" max={pageCount} value={rulePage} onChange={(event) => setRulePage(Number(event.target.value))} /></label>
          <label>Style<select aria-label="Page label style" value={ruleStyle} onChange={(event) => setRuleStyle(event.target.value as PageLabelStyle)}>{Object.entries(STYLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Prefix<input aria-label="Page label prefix" value={rulePrefix} onChange={(event) => setRulePrefix(event.target.value)} placeholder="A-" /></label>
          <label>Starts at<input aria-label="Page label start number" type="number" min="1" value={ruleStart} disabled={ruleStyle === 'none'} onChange={(event) => setRuleStart(Number(event.target.value))} /></label>
        </div>
        <button disabled={Boolean(busy)} onClick={addRule}><Plus /> Add / replace rule</button>
        <div className="page-label-rules">
          {ruleSummary.map((rule) => <div key={rule.startPage}><span><strong>Page {rule.startPage + 1}</strong><small>{rule.label}</small></span><button title={`Remove page label rule at page ${rule.startPage + 1}`} disabled={Boolean(busy)} onClick={() => removeRule(rule)}><Trash2 /></button></div>)}
          {!rules.length && <div className="document-view-empty">No native page-label rules.</div>}
        </div>
        {rules.length > 0 && <button className="subtle-danger" disabled={Boolean(busy)} onClick={clearRules}>Clear all page labels</button>}
      </section>

      <section className="document-view-card">
        <h4><Eye /> Initial view</h4>
        <p>Choose how compatible PDF viewers should open this document.</p>
        <label>Start page<input aria-label="Initial view start page" type="number" min="1" max={pageCount} value={startPage} onChange={(event) => setStartPage(Number(event.target.value))} /></label>
        <label>Magnification<select aria-label="Initial view magnification" value={magnification} onChange={(event) => setMagnification(event.target.value as InitialViewOptions['magnification'])}><option value="fit-page">Fit page</option><option value="fit-width">Fit width</option><option value="actual-size">Actual size</option></select></label>
        <label>Navigation panel<select aria-label="Initial view panel" value={pageMode} onChange={(event) => setPageMode(event.target.value as InitialViewOptions['pageMode'])}><option value="none">None</option><option value="outlines">Bookmarks</option><option value="thumbnails">Page thumbnails</option><option value="attachments">Attachments</option><option value="fullscreen">Full screen</option></select></label>
        <label>Page layout<select aria-label="Initial view layout" value={pageLayout} onChange={(event) => setPageLayout(event.target.value as InitialViewOptions['pageLayout'])}><option value="single">Single page</option><option value="one-column">One column</option><option value="two-column-left">Two columns — odd left</option><option value="two-column-right">Two columns — odd right</option><option value="two-page-left">Two-page — odd left</option><option value="two-page-right">Two-page — odd right</option></select></label>
        <button disabled={Boolean(busy)} onClick={applyInitialView}>Save initial view</button>
      </section>

      <section className="document-view-card image-export-card">
        <h4><Images /> Export pages as images</h4>
        <p>Render locally with PDF.js. Multiple pages download as a ZIP without uploading the PDF.</p>
        <div className="image-export-row"><label>Pages<select aria-label="Image export pages" value={imageScope} onChange={(event) => setImageScope(event.target.value as typeof imageScope)}><option value="current">Current page</option><option value="all">All pages</option><option value="range">Page range</option></select></label>{imageScope === 'range' && <label>Range<input aria-label="Image export range" value={imageRange} onChange={(event) => setImageRange(event.target.value)} placeholder="1-3, 6" /></label>}</div>
        <div className="image-export-row"><label>Format<select aria-label="Image export format" value={format} onChange={(event) => setFormat(event.target.value as PageImageFormat)}><option value="png">PNG</option><option value="jpeg">JPG</option></select></label><label>DPI<input aria-label="Image export DPI" type="number" min="72" max="300" value={dpi} onChange={(event) => setDpi(Number(event.target.value))} /></label>{format === 'jpeg' && <label>Quality<input aria-label="Image export JPEG quality" type="number" min="35" max="100" value={jpegQuality} onChange={(event) => setJpegQuality(Number(event.target.value))} /></label>}</div>
        <button className="image-export-button" disabled={Boolean(busy)} onClick={() => void exportPages()}><Download /> {busy === 'image-export' ? 'Rendering…' : 'Export page images'}</button>
      </section>
    </div>
  </section>
}
