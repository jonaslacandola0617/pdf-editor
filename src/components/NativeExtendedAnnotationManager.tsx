import { useEffect, useMemo, useState } from 'react'
import { Download, FileArchive, PenLine, Save, Shapes, Stamp, Trash2 } from 'lucide-react'
import {
  deleteNativeExtendedAnnotation,
  extractNativeFileAttachment,
  listNativeExtendedAnnotations,
  updateNativeExtendedAnnotation,
  type AnnotationGeometry,
  type NativeExtendedAnnotationInfo,
} from '../lib/native-extended-annotations'

type Props = {
  bytes: ArrayBuffer
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

type Draft = {
  text: string
  author: string
  color: string
  opacity: string
  borderWidth: string
  geometry: AnnotationGeometry
  caretSymbol: 'None' | 'P'
  attachmentIcon: string
}

function keyFor(item: NativeExtendedAnnotationInfo) { return `${item.pageIndex}:${item.annotationIndex}` }
function iconFor(item: NativeExtendedAnnotationInfo) {
  if (item.subtype === 'Ink') return <PenLine />
  if (item.subtype === 'Stamp') return <Stamp />
  if (item.subtype === 'FileAttachment') return <FileArchive />
  return <Shapes />
}
function sizeLabel(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function draftsFor(items: NativeExtendedAnnotationInfo[]) {
  return Object.fromEntries(items.map((item) => [keyFor(item), {
    text: item.text,
    author: item.author,
    color: item.color,
    opacity: String(Math.round(item.opacity * 100)),
    borderWidth: String(item.borderWidth),
    geometry: { ...item.geometry },
    caretSymbol: item.caretSymbol || 'None',
    attachmentIcon: item.attachment?.icon || 'PushPin',
  }])) as Record<string, Draft>
}

function download(name: string, data: Uint8Array) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function NativeExtendedAnnotationManager({ bytes, onBeforeMutate, onApply, onStatus }: Props) {
  const [items, setItems] = useState<NativeExtendedAnnotationInfo[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const hydrate = (next: NativeExtendedAnnotationInfo[]) => {
    setItems(next)
    setDrafts(draftsFor(next))
  }

  const reload = async (source = bytes) => {
    setLoading(true)
    try { hydrate(await listNativeExtendedAnnotations(source)) }
    catch (error) { console.error(error); onStatus('Could not inspect extended native annotations in this document.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listNativeExtendedAnnotations(bytes)
      .then((next) => { if (!cancelled) hydrate(next) })
      .catch((error) => { if (!cancelled) { console.error(error); onStatus('Could not inspect extended native annotations in this document.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bytes, onStatus])

  const counts = useMemo(() => items.reduce<Record<string, number>>((acc, item) => {
    acc[item.subtype] = (acc[item.subtype] || 0) + 1
    return acc
  }, {}), [items])

  const patchDraft = (key: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  }

  const patchGeometry = (key: string, field: keyof AnnotationGeometry, value: string) => {
    const numeric = Number(value)
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...current[key],
        geometry: { ...current[key].geometry, [field]: Number.isFinite(numeric) ? numeric : 0 },
      },
    }))
  }

  const save = async (item: NativeExtendedAnnotationInfo) => {
    if (busy) return
    const key = keyFor(item)
    const draft = drafts[key]
    if (!draft) return
    setBusy(key)
    onBeforeMutate()
    onStatus('Updating native annotation…')
    try {
      const next = await updateNativeExtendedAnnotation(bytes, item.pageIndex, item.annotationIndex, {
        text: draft.text,
        author: draft.author,
        color: draft.color,
        opacity: Math.max(0, Math.min(100, Number(draft.opacity) || 0)) / 100,
        borderWidth: Math.max(0, Number(draft.borderWidth) || 0),
        geometry: draft.geometry,
        caretSymbol: draft.caretSymbol,
        attachmentIcon: draft.attachmentIcon,
      })
      onApply(next, { status: 'Updating native annotation complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not update this native annotation.')
    } finally { setBusy('') }
  }

  const remove = async (item: NativeExtendedAnnotationInfo) => {
    if (busy) return
    const key = keyFor(item)
    setBusy(key)
    onBeforeMutate()
    onStatus('Deleting native annotation…')
    try {
      const next = await deleteNativeExtendedAnnotation(bytes, item.pageIndex, item.annotationIndex)
      onApply(next, { status: 'Deleting native annotation complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not delete this native annotation.')
    } finally { setBusy('') }
  }

  const extract = async (item: NativeExtendedAnnotationInfo) => {
    if (busy || item.subtype !== 'FileAttachment') return
    const key = keyFor(item)
    setBusy(key)
    onStatus('Extracting page attachment…')
    try {
      const result = await extractNativeFileAttachment(bytes, item.pageIndex, item.annotationIndex)
      download(result.name, result.data)
      onStatus(`${result.name} extracted`)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not extract this page attachment.')
    } finally { setBusy('') }
  }

  return <section className="native-extended-manager">
    <div className="native-extended-heading">
      <Shapes />
      <span><strong>Extended annotations</strong><small>Ink, polygons, polylines, stamps, carets and page attachments</small></span>
      <em>{items.length}</em>
    </div>

    {!!items.length && <div className="native-extended-summary">
      {Object.entries(counts).map(([type, count]) => <span key={type}>{type} {count}</span>)}
    </div>}
    {loading && !items.length && <div className="native-extended-empty">Reading extended annotations…</div>}
    {!loading && !items.length && <div className="native-extended-empty">No supported extended annotations found.</div>}

    {items.length > 0 && <div className="native-extended-list">
      {items.map((item) => {
        const key = keyFor(item)
        const draft = drafts[key]
        if (!draft) return null
        return <div className="native-extended-row" key={key}>
          <div className="native-extended-meta">
            {iconFor(item)}
            <span>Page {item.pageIndex + 1} · {item.subtype}{item.inkStrokeCount ? ` · ${item.inkStrokeCount} stroke${item.inkStrokeCount === 1 ? '' : 's'}` : ''}{item.vertexCount ? ` · ${item.vertexCount} vertices` : ''}{item.stampName ? ` · ${item.stampName}` : ''}</span>
          </div>
          <textarea aria-label={`Extended annotation text page ${item.pageIndex + 1} index ${item.annotationIndex}`} rows={2} placeholder="Comment / description" value={draft.text} onChange={(event) => patchDraft(key, { text: event.target.value })} />
          <div className="native-extended-fields">
            <label>Author<input aria-label={`Extended annotation author page ${item.pageIndex + 1} index ${item.annotationIndex}`} value={draft.author} onChange={(event) => patchDraft(key, { author: event.target.value })} /></label>
            <label>Color<input aria-label={`Extended annotation color page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="color" value={draft.color} onChange={(event) => patchDraft(key, { color: event.target.value })} /></label>
            <label>Opacity %<input aria-label={`Extended annotation opacity page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="0" max="100" step="1" value={draft.opacity} onChange={(event) => patchDraft(key, { opacity: event.target.value })} /></label>
            <label>Border<input aria-label={`Extended annotation border page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="0" step="0.25" value={draft.borderWidth} onChange={(event) => patchDraft(key, { borderWidth: event.target.value })} /></label>
          </div>
          <div className="native-extended-geometry">
            {(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{field === 'x' ? 'Left %' : field === 'y' ? 'Top %' : `${field[0].toUpperCase()}${field.slice(1)} %`}<input aria-label={`Extended annotation ${field} page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="0" max="100" step="0.1" value={draft.geometry[field]} onChange={(event) => patchGeometry(key, field, event.target.value)} /></label>)}
          </div>
          {item.subtype === 'Caret' && <label className="native-extended-select">Caret symbol<select aria-label={`Caret symbol page ${item.pageIndex + 1} index ${item.annotationIndex}`} value={draft.caretSymbol} onChange={(event) => patchDraft(key, { caretSymbol: event.target.value as 'None' | 'P' })}><option value="None">None</option><option value="P">Paragraph</option></select></label>}
          {item.subtype === 'FileAttachment' && <div className="native-attachment-details">
            <span>{item.attachment?.name || 'attachment.bin'} · {sizeLabel(item.attachment?.size || 0)}</span>
            <label>Icon<select aria-label={`Page attachment icon page ${item.pageIndex + 1} index ${item.annotationIndex}`} value={draft.attachmentIcon} onChange={(event) => patchDraft(key, { attachmentIcon: event.target.value })}><option>PushPin</option><option>Paperclip</option><option>Graph</option><option>Tag</option></select></label>
          </div>}
          <p>Geometry uses page percentages. Ink and polygon geometry is transformed without changing the original stroke/vertex order.</p>
          <div className="native-extended-actions">
            {item.subtype === 'FileAttachment' && <button disabled={Boolean(busy)} onClick={() => void extract(item)}><Download /> Extract</button>}
            <button disabled={Boolean(busy)} onClick={() => void save(item)}><Save /> Save</button>
            <button className="danger-action" disabled={Boolean(busy)} onClick={() => void remove(item)}><Trash2 /> Delete</button>
          </div>
        </div>
      })}
    </div>}
  </section>
}
