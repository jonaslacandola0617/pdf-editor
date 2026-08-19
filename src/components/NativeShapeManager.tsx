import { useEffect, useState } from 'react'
import { Circle, Minus, Save, Square, Trash2 } from 'lucide-react'
import { deleteNativeShape, listNativeShapes, updateNativeShape, type NativeShapeInfo } from '../lib/native-shapes'

type Props = {
  bytes: ArrayBuffer
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

type Draft = {
  strokeColor: string
  fillColor: string
  opacity: string
  borderWidth: string
  x1: string
  y1: string
  x2: string
  y2: string
}

function keyFor(item: NativeShapeInfo) { return `${item.pageIndex}:${item.annotationIndex}` }
function iconFor(subtype: NativeShapeInfo['subtype']) { return subtype === 'Circle' ? <Circle /> : subtype === 'Line' ? <Minus /> : <Square /> }

function draftsFor(items: NativeShapeInfo[]) {
  return Object.fromEntries(items.map((item) => [keyFor(item), {
    strokeColor: item.strokeColor,
    fillColor: item.fillColor,
    opacity: String(Math.round(item.opacity * 100)),
    borderWidth: String(item.borderWidth),
    x1: String(item.line?.x1 ?? ''),
    y1: String(item.line?.y1 ?? ''),
    x2: String(item.line?.x2 ?? ''),
    y2: String(item.line?.y2 ?? ''),
  }])) as Record<string, Draft>
}

export function NativeShapeManager({ bytes, onBeforeMutate, onApply, onStatus }: Props) {
  const [items, setItems] = useState<NativeShapeInfo[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const hydrate = (next: NativeShapeInfo[]) => {
    setItems(next)
    setDrafts(draftsFor(next))
  }

  const reload = async (source = bytes) => {
    setLoading(true)
    try { hydrate(await listNativeShapes(source)) }
    catch (error) { console.error(error); onStatus('Could not inspect native shape annotations in this document.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listNativeShapes(bytes)
      .then((next) => { if (!cancelled) hydrate(next) })
      .catch((error) => { if (!cancelled) { console.error(error); onStatus('Could not inspect native shape annotations in this document.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bytes, onStatus])

  const setDraft = (key: string, field: keyof Draft, value: string) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], [field]: value } }))
  }

  const save = async (item: NativeShapeInfo) => {
    if (busy) return
    const key = keyFor(item)
    const draft = drafts[key]
    if (!draft) return
    setBusy(key)
    onBeforeMutate()
    onStatus('Updating native shape annotation…')
    try {
      const next = await updateNativeShape(bytes, item.pageIndex, item.annotationIndex, {
        strokeColor: draft.strokeColor,
        fillColor: draft.fillColor,
        opacity: Math.max(0, Math.min(100, Number(draft.opacity) || 0)) / 100,
        borderWidth: Math.max(0, Number(draft.borderWidth) || 0),
        line: item.subtype === 'Line' ? {
          x1: Number(draft.x1), y1: Number(draft.y1), x2: Number(draft.x2), y2: Number(draft.y2),
        } : undefined,
      })
      onApply(next, { status: 'Updating native shape annotation complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not update this native shape annotation.')
    } finally { setBusy('') }
  }

  const remove = async (item: NativeShapeInfo) => {
    if (busy) return
    const key = keyFor(item)
    setBusy(key)
    onBeforeMutate()
    onStatus('Deleting native shape annotation…')
    try {
      const next = await deleteNativeShape(bytes, item.pageIndex, item.annotationIndex)
      onApply(next, { status: 'Deleting native shape annotation complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not delete this native shape annotation.')
    } finally { setBusy('') }
  }

  return <section className="native-shape-manager">
    <div className="native-shape-heading">
      <Square />
      <span><strong>Shape annotations</strong><small>Existing squares, circles and lines from other PDF editors</small></span>
      <em>{items.length}</em>
    </div>

    {loading && !items.length && <div className="native-shape-empty">Reading shape annotations…</div>}
    {!loading && !items.length && <div className="native-shape-empty">No native square, circle or line annotations found.</div>}

    {items.length > 0 && <div className="native-shape-list">
      {items.map((item) => {
        const key = keyFor(item)
        const draft = drafts[key]
        if (!draft) return null
        return <div className="native-shape-row" key={key}>
          <div className="native-shape-meta">{iconFor(item.subtype)}<span>Page {item.pageIndex + 1} · {item.subtype}</span></div>
          <div className="native-shape-fields">
            <label>Stroke<input aria-label={`Native shape stroke page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="color" value={draft.strokeColor} onChange={(event) => setDraft(key, 'strokeColor', event.target.value)} /></label>
            {item.subtype !== 'Line' && <label>Fill<input aria-label={`Native shape fill page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="color" value={draft.fillColor} onChange={(event) => setDraft(key, 'fillColor', event.target.value)} /></label>}
            <label>Opacity %<input aria-label={`Native shape opacity page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="0" max="100" step="1" value={draft.opacity} onChange={(event) => setDraft(key, 'opacity', event.target.value)} /></label>
            <label>Border width<input aria-label={`Native shape border page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="0" step="0.25" value={draft.borderWidth} onChange={(event) => setDraft(key, 'borderWidth', event.target.value)} /></label>
          </div>
          {item.subtype === 'Line' && <div className="native-line-fields">
            {(['x1', 'y1', 'x2', 'y2'] as const).map((field) => <label key={field}>{field.toUpperCase()}<input aria-label={`Native line ${field} page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" step="1" value={draft[field]} onChange={(event) => setDraft(key, field, event.target.value)} /></label>)}
          </div>}
          <p>Edits preserve the native annotation subtype, rectangle and unrelated dictionary properties.</p>
          <div className="native-shape-actions">
            <button disabled={Boolean(busy)} onClick={() => void save(item)}><Save /> Save</button>
            <button className="danger-action" disabled={Boolean(busy)} onClick={() => void remove(item)}><Trash2 /> Delete</button>
          </div>
        </div>
      })}
    </div>}
  </section>
}
