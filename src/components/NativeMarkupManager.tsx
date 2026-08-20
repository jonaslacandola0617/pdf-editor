import { useEffect, useState } from 'react'
import { Highlighter, Save, Trash2 } from 'lucide-react'
import {
  deleteNativeMarkup,
  listNativeMarkups,
  updateNativeMarkup,
  type NativeMarkupGeometry,
  type NativeMarkupInfo,
} from '../lib/native-markups'

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
  geometry: NativeMarkupGeometry
}

function keyFor(item: NativeMarkupInfo) { return `${item.pageIndex}:${item.annotationIndex}` }

function draftsFor(items: NativeMarkupInfo[]) {
  return Object.fromEntries(items.map((item) => [keyFor(item), {
    text: item.text,
    author: item.author,
    color: item.color,
    opacity: String(Math.round(item.opacity * 100)),
    geometry: { ...item.geometry },
  }])) as Record<string, Draft>
}

export function NativeMarkupManager({ bytes, onBeforeMutate, onApply, onStatus }: Props) {
  const [items, setItems] = useState<NativeMarkupInfo[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const hydrate = (next: NativeMarkupInfo[]) => {
    setItems(next)
    setDrafts(draftsFor(next))
  }

  const reload = async (source = bytes) => {
    setLoading(true)
    try { hydrate(await listNativeMarkups(source)) }
    catch (error) { console.error(error); onStatus('Could not inspect native text markup annotations in this document.') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listNativeMarkups(bytes)
      .then((next) => { if (!cancelled) hydrate(next) })
      .catch((error) => { if (!cancelled) { console.error(error); onStatus('Could not inspect native text markup annotations in this document.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bytes, onStatus])

  const setDraft = (key: string, field: Exclude<keyof Draft, 'geometry'>, value: string) => {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], [field]: value } }))
  }

  const setGeometry = (key: string, field: keyof NativeMarkupGeometry, value: string) => {
    const numeric = Number(value)
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], geometry: { ...current[key].geometry, [field]: Number.isFinite(numeric) ? numeric : 0 } },
    }))
  }

  const save = async (item: NativeMarkupInfo) => {
    if (busy) return
    const key = keyFor(item)
    const draft = drafts[key]
    if (!draft) return
    setBusy(key)
    onBeforeMutate()
    onStatus('Updating text markup annotation…')
    try {
      const next = await updateNativeMarkup(bytes, item.pageIndex, item.annotationIndex, {
        text: draft.text,
        author: draft.author,
        color: draft.color,
        opacity: Math.max(0, Math.min(100, Number(draft.opacity) || 0)) / 100,
        geometry: draft.geometry,
      })
      onApply(next, { status: 'Updating text markup annotation complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not update this text markup annotation.')
    } finally { setBusy('') }
  }

  const remove = async (item: NativeMarkupInfo) => {
    if (busy) return
    const key = keyFor(item)
    setBusy(key)
    onBeforeMutate()
    onStatus('Deleting text markup annotation…')
    try {
      const next = await deleteNativeMarkup(bytes, item.pageIndex, item.annotationIndex)
      onApply(next, { status: 'Deleting text markup annotation complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not delete this text markup annotation.')
    } finally { setBusy('') }
  }

  return <section className="native-markup-manager">
    <div className="native-markup-heading">
      <Highlighter />
      <span><strong>Text markup annotations</strong><small>Existing highlights, underlines, strikeouts and squiggles</small></span>
      <em>{items.length}</em>
    </div>

    {loading && !items.length && <div className="native-markup-empty">Reading text markup annotations…</div>}
    {!loading && !items.length && <div className="native-markup-empty">No native text markup annotations found.</div>}

    {items.length > 0 && <div className="native-markup-list">
      {items.map((item) => {
        const key = keyFor(item)
        const draft = drafts[key]
        if (!draft) return null
        return <div className="native-markup-row" key={key}>
          <div className="native-markup-meta"><Highlighter /><span>Page {item.pageIndex + 1} · {item.subtype} · {item.quadCount || 1} text region{item.quadCount === 1 ? '' : 's'}</span></div>
          <textarea aria-label={`Native markup text page ${item.pageIndex + 1} index ${item.annotationIndex}`} rows={2} placeholder="Comment text" value={draft.text} onChange={(event) => setDraft(key, 'text', event.target.value)} />
          <div className="native-markup-fields">
            <label>Author<input aria-label={`Native markup author page ${item.pageIndex + 1} index ${item.annotationIndex}`} value={draft.author} onChange={(event) => setDraft(key, 'author', event.target.value)} /></label>
            <label>Color<input aria-label={`Native markup color page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="color" value={draft.color} onChange={(event) => setDraft(key, 'color', event.target.value)} /></label>
            <label>Opacity %<input aria-label={`Native markup opacity page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="0" max="100" step="1" value={draft.opacity} onChange={(event) => setDraft(key, 'opacity', event.target.value)} /></label>
          </div>
          <div className="native-markup-geometry">
            {(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{field === 'x' ? 'Left %' : field === 'y' ? 'Top %' : `${field[0].toUpperCase()}${field.slice(1)} %`}<input aria-label={`Native markup ${field} page ${item.pageIndex + 1} index ${item.annotationIndex}`} type="number" min="0" max="100" step="0.1" value={draft.geometry[field]} onChange={(event) => setGeometry(key, field, event.target.value)} /></label>)}
          </div>
          <p>Position and size transform the existing native QuadPoints, preserving region order and the annotation subtype.</p>
          <div className="native-markup-actions">
            <button disabled={Boolean(busy)} onClick={() => void save(item)}><Save /> Save</button>
            <button className="danger-action" disabled={Boolean(busy)} onClick={() => void remove(item)}><Trash2 /> Delete</button>
          </div>
        </div>
      })}
    </div>}
  </section>
}
