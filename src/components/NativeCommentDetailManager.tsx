import { useEffect, useState } from 'react'
import { MessageSquareText, Save, Trash2 } from 'lucide-react'
import {
  deleteNativeCommentDetail,
  listNativeCommentDetails,
  updateNativeCommentDetail,
  type NativeCommentDetail,
  type NativeCommentGeometry,
} from '../lib/native-comment-details'

type Props = {
  bytes: ArrayBuffer
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

type Draft = {
  text: string
  author: string
  geometry: NativeCommentGeometry
  icon: string
  open: boolean
  fontSize: string
  textColor: string
  alignment: 0 | 1 | 2
}

function keyFor(item: NativeCommentDetail) { return `${item.pageIndex}:${item.annotationIndex}` }
function geometryChanged(a: NativeCommentGeometry, b: NativeCommentGeometry) {
  return (['x', 'y', 'width', 'height'] as const).some((field) => Math.abs(a[field] - b[field]) > 0.0001)
}
function draftsFor(items: NativeCommentDetail[]) {
  return Object.fromEntries(items.map((item) => [keyFor(item), {
    text: item.text,
    author: item.author,
    geometry: { ...item.geometry },
    icon: item.icon || 'Note',
    open: Boolean(item.open),
    fontSize: String(item.fontSize || 12),
    textColor: item.textColor || '#000000',
    alignment: item.alignment || 0,
  }])) as Record<string, Draft>
}

export function NativeCommentDetailManager({ bytes, onBeforeMutate, onApply, onStatus }: Props) {
  const [items, setItems] = useState<NativeCommentDetail[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const hydrate = (next: NativeCommentDetail[]) => { setItems(next); setDrafts(draftsFor(next)) }
  const reload = async (source = bytes) => {
    setLoading(true)
    try { hydrate(await listNativeCommentDetails(source)) }
    catch (error) { console.error(error); onStatus('Could not inspect native comment appearance details.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listNativeCommentDetails(bytes)
      .then((next) => { if (!cancelled) hydrate(next) })
      .catch((error) => { if (!cancelled) { console.error(error); onStatus('Could not inspect native comment appearance details.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bytes, onStatus])

  const patch = (key: string, value: Partial<Draft>) => setDrafts((current) => ({ ...current, [key]: { ...current[key], ...value } }))
  const patchGeometry = (key: string, field: keyof NativeCommentGeometry, value: string) => {
    const numeric = Number(value)
    setDrafts((current) => ({ ...current, [key]: { ...current[key], geometry: { ...current[key].geometry, [field]: Number.isFinite(numeric) ? numeric : 0 } } }))
  }

  const save = async (item: NativeCommentDetail) => {
    if (busy) return
    const key = keyFor(item); const draft = drafts[key]
    if (!draft) return
    setBusy(key); onBeforeMutate(); onStatus('Updating native comment appearance…')
    try {
      const next = await updateNativeCommentDetail(bytes, item.pageIndex, item.annotationIndex, {
        text: draft.text,
        author: draft.author,
        geometry: geometryChanged(draft.geometry, item.geometry) ? draft.geometry : undefined,
        icon: item.subtype === 'Text' ? draft.icon : undefined,
        open: item.subtype === 'Text' ? draft.open : undefined,
        fontSize: item.subtype === 'FreeText' ? Number(draft.fontSize) : undefined,
        textColor: item.subtype === 'FreeText' ? draft.textColor : undefined,
        alignment: item.subtype === 'FreeText' ? draft.alignment : undefined,
      })
      onApply(next, { status: 'Updating native comment appearance complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not update this native comment.')
    } finally { setBusy('') }
  }

  const remove = async (item: NativeCommentDetail) => {
    if (busy) return
    const key = keyFor(item)
    setBusy(key); onBeforeMutate(); onStatus('Deleting native comment…')
    try {
      const next = await deleteNativeCommentDetail(bytes, item.pageIndex, item.annotationIndex)
      onApply(next, { status: 'Deleting native comment complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not delete this native comment.')
    } finally { setBusy('') }
  }

  return <section className="native-comment-detail-manager">
    <div className="native-comment-detail-heading">
      <MessageSquareText />
      <span><strong>Comment placement & appearance</strong><small>Sticky-note icons/open state and FreeText typography</small></span>
      <em>{items.length}</em>
    </div>
    {loading && !items.length && <div className="native-comment-detail-empty">Reading comment appearance details…</div>}
    {!loading && !items.length && <div className="native-comment-detail-empty">No native sticky-note or FreeText comments found.</div>}
    {items.length > 0 && <div className="native-comment-detail-list">
      {items.map((item) => {
        const key = keyFor(item); const draft = drafts[key]
        if (!draft) return null
        return <div className="native-comment-detail-row" key={key}>
          <div className="native-comment-detail-meta"><MessageSquareText /><span>Page {item.pageIndex + 1} · {item.subtype}</span></div>
          <textarea aria-label={`Detailed native comment text page ${item.pageIndex + 1} index ${item.annotationIndex}`} rows={2} value={draft.text} onChange={(event) => patch(key, { text: event.target.value })} />
          <input aria-label={`Detailed native comment author page ${item.pageIndex + 1} index ${item.annotationIndex}`} placeholder="Author" value={draft.author} onChange={(event) => patch(key, { author: event.target.value })} />
          <div className="native-comment-detail-geometry">
            {(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{field === 'x' ? 'Left %' : field === 'y' ? 'Top %' : `${field[0].toUpperCase()}${field.slice(1)} %`}<input aria-label={`Detailed native comment ${field} page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="0" max="100" step="0.1" value={draft.geometry[field]} onChange={(event) => patchGeometry(key, field, event.target.value)} /></label>)}
          </div>
          {item.subtype === 'Text' && <div className="native-comment-detail-options">
            <label>Icon<select aria-label={`Native sticky icon page ${item.pageIndex + 1} index ${item.annotationIndex}`} value={draft.icon} onChange={(event) => patch(key, { icon: event.target.value })}>{['Note','Comment','Key','Help','NewParagraph','Paragraph','Insert'].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="native-comment-check"><input aria-label={`Native sticky open page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="checkbox" checked={draft.open} onChange={(event) => patch(key, { open: event.target.checked })} />Open popup by default</label>
          </div>}
          {item.subtype === 'FreeText' && <div className="native-comment-detail-options free-text-options">
            <label>Font size<input aria-label={`Native FreeText font size page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="4" max="144" step="1" value={draft.fontSize} onChange={(event) => patch(key, { fontSize: event.target.value })} /></label>
            <label>Text color<input aria-label={`Native FreeText color page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="color" value={draft.textColor} onChange={(event) => patch(key, { textColor: event.target.value })} /></label>
            <label>Alignment<select aria-label={`Native FreeText alignment page ${item.pageIndex + 1} index ${item.annotationIndex}`} value={draft.alignment} onChange={(event) => patch(key, { alignment: Number(event.target.value) as 0 | 1 | 2 })}><option value={0}>Left</option><option value={1}>Center</option><option value={2}>Right</option></select></label>
          </div>}
          <p>Geometry is rewritten only when changed. FreeText edits remove stale appearance streams so compliant viewers regenerate the visible text from updated Contents/DA values.</p>
          <div className="native-comment-detail-actions"><button disabled={Boolean(busy)} onClick={() => void save(item)}><Save /> Save</button><button className="danger-action" disabled={Boolean(busy)} onClick={() => void remove(item)}><Trash2 /> Delete</button></div>
        </div>
      })}
    </div>}
  </section>
}
