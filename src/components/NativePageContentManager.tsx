import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Image, RefreshCw, Save, Trash2, Type } from 'lucide-react'
import {
  deleteNativePageContentObject,
  extractNativeImage,
  listNativePageContent,
  replaceNativeImageBitmap,
  updateNativeImageGeometry,
  updateNativeTextContent,
  type NativeImageContentInfo,
  type NativePageContentInfo,
  type NativeTextContentInfo,
  type PageContentGeometry,
} from '../lib/pdfium-page-content'

type Props = {
  bytes: ArrayBuffer
  currentPage: number
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

type TextDraft = {
  text: string
  color: string
  opacity: string
  fontSize: string
  x: string
  y: string
}

type ImageDraft = {
  x: string
  y: string
  width: string
  height: string
}

function keyFor(item: NativePageContentInfo) { return `${item.type}:${item.objectIndex}` }
function rounded(value: number) { return Math.round(value * 100) / 100 }
function changedNumber(value: string, original: number) {
  const number = Number(value)
  return Number.isFinite(number) && Math.abs(number - original) > 0.001 ? number : undefined
}
function geometryChanged(draft: ImageDraft, original: PageContentGeometry) {
  return (['x', 'y', 'width', 'height'] as const).some((field) => {
    const number = Number(draft[field])
    return Number.isFinite(number) && Math.abs(number - original[field]) > 0.001
  })
}
function toDraft(item: NativePageContentInfo): TextDraft | ImageDraft {
  if (item.type === 'text') return {
    text: item.text,
    color: item.color,
    opacity: String(Math.round(item.opacity * 100)),
    fontSize: item.fontSize ? String(rounded(item.fontSize)) : '',
    x: String(rounded(item.geometry.x)),
    y: String(rounded(item.geometry.y)),
  }
  return {
    x: String(rounded(item.geometry.x)),
    y: String(rounded(item.geometry.y)),
    width: String(rounded(item.geometry.width)),
    height: String(rounded(item.geometry.height)),
  }
}

async function rgbaToPng(result: { width: number; height: number; rgba: Uint8Array }) {
  const canvas = document.createElement('canvas')
  canvas.width = result.width
  canvas.height = result.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Browser canvas is unavailable for image export.')
  context.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0)
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode this image as PNG.')), 'image/png'))
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function NativePageContentManager({ bytes, currentPage, onBeforeMutate, onApply, onStatus }: Props) {
  const [items, setItems] = useState<NativePageContentInfo[]>([])
  const [textDrafts, setTextDrafts] = useState<Record<string, TextDraft>>({})
  const [imageDrafts, setImageDrafts] = useState<Record<string, ImageDraft>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const replaceInputs = useRef<Record<string, HTMLInputElement | null>>({})

  const hydrate = (next: NativePageContentInfo[]) => {
    setItems(next)
    const nextText: Record<string, TextDraft> = {}
    const nextImages: Record<string, ImageDraft> = {}
    for (const item of next) {
      if (item.type === 'text') nextText[keyFor(item)] = toDraft(item) as TextDraft
      else nextImages[keyFor(item)] = toDraft(item) as ImageDraft
    }
    setTextDrafts(nextText)
    setImageDrafts(nextImages)
  }

  const reload = async (source = bytes) => {
    setLoading(true)
    try { hydrate(await listNativePageContent(source, currentPage)) }
    catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not inspect native page content.')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listNativePageContent(bytes, currentPage)
      .then((next) => { if (!cancelled) hydrate(next) })
      .catch((error) => { if (!cancelled) { console.error(error); onStatus(error instanceof Error ? error.message : 'Could not inspect native page content.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bytes, currentPage, onStatus])

  const counts = useMemo(() => ({
    text: items.filter((item) => item.type === 'text').length,
    image: items.filter((item) => item.type === 'image').length,
  }), [items])

  const patchText = (key: string, patch: Partial<TextDraft>) => setTextDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  const patchImage = (key: string, patch: Partial<ImageDraft>) => setImageDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }))

  const saveText = async (item: NativeTextContentInfo) => {
    if (busy) return
    const key = keyFor(item)
    const draft = textDrafts[key]
    if (!draft) return
    const nextOpacity = Math.max(0, Math.min(100, Number(draft.opacity) || 0)) / 100
    const textChanged = draft.text !== item.text
    const colorChanged = draft.color.toLowerCase() !== item.color.toLowerCase() || Math.abs(nextOpacity - item.opacity) > 0.001
    const x = changedNumber(draft.x, item.geometry.x)
    const y = changedNumber(draft.y, item.geometry.y)
    const fontSize = item.fontSize ? changedNumber(draft.fontSize, item.fontSize) : undefined
    if (!textChanged && !colorChanged && x === undefined && y === undefined && fontSize === undefined) {
      onStatus('No native text changes to apply.')
      return
    }
    setBusy(key); onBeforeMutate(); onStatus('Updating native page text…')
    try {
      const next = await updateNativeTextContent(bytes, currentPage, item.objectIndex, {
        text: textChanged ? draft.text : undefined,
        color: colorChanged ? draft.color : undefined,
        opacity: colorChanged ? nextOpacity : undefined,
        x,
        y,
        fontSize,
      })
      onApply(next, { status: 'Updating native page text complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not update this native page text.')
    } finally { setBusy('') }
  }

  const saveImageGeometry = async (item: NativeImageContentInfo) => {
    if (busy) return
    const key = keyFor(item)
    const draft = imageDrafts[key]
    if (!draft || !geometryChanged(draft, item.geometry)) { onStatus('No native image geometry changes to apply.'); return }
    const geometry: PageContentGeometry = {
      x: Number(draft.x), y: Number(draft.y), width: Number(draft.width), height: Number(draft.height),
    }
    setBusy(key); onBeforeMutate(); onStatus('Moving/resizing native PDF image…')
    try {
      const next = await updateNativeImageGeometry(bytes, currentPage, item.objectIndex, geometry)
      onApply(next, { status: 'Moving/resizing native PDF image complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not move/resize this native PDF image.')
    } finally { setBusy('') }
  }

  const replaceImage = async (item: NativeImageContentInfo, file: File | undefined) => {
    if (!file || busy) return
    const key = keyFor(item)
    setBusy(key); onBeforeMutate(); onStatus('Replacing native PDF image…')
    try {
      const next = await replaceNativeImageBitmap(bytes, currentPage, item.objectIndex, file)
      onApply(next, { status: 'Replacing native PDF image complete' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not replace this native PDF image.')
    } finally {
      setBusy('')
      const input = replaceInputs.current[key]
      if (input) input.value = ''
    }
  }

  const extractImage = async (item: NativeImageContentInfo) => {
    if (busy) return
    const key = keyFor(item)
    setBusy(key); onStatus('Extracting native PDF image…')
    try {
      const result = await extractNativeImage(bytes, currentPage, item.objectIndex)
      downloadBlob(`page-${currentPage + 1}-image-${item.objectIndex + 1}.png`, await rgbaToPng(result))
      onStatus('Native PDF image extracted')
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not extract this native PDF image.')
    } finally { setBusy('') }
  }

  const remove = async (item: NativePageContentInfo) => {
    if (busy) return
    const key = keyFor(item)
    setBusy(key); onBeforeMutate(); onStatus(`Deleting native ${item.type} object…`)
    try {
      const next = await deleteNativePageContentObject(bytes, currentPage, item.objectIndex)
      onApply(next, { status: `Deleting native ${item.type} object complete` })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : `Could not delete this native ${item.type} object.`)
    } finally { setBusy('') }
  }

  return <section className="native-page-content-manager">
    <div className="native-page-content-heading">
      <Type />
      <span><strong>Page content objects</strong><small>Underlying text and image objects on page {currentPage + 1}</small></span>
      <button className="native-page-content-refresh" title="Refresh page content objects" disabled={loading || Boolean(busy)} onClick={() => void reload()}><RefreshCw /></button>
    </div>
    <div className="native-page-content-summary"><span>Text {counts.text}</span><span>Images {counts.image}</span></div>
    {loading && !items.length && <div className="native-page-content-empty">Reading native page content…</div>}
    {!loading && !items.length && <div className="native-page-content-empty">No editable text or image page objects found on this page.</div>}

    {items.length > 0 && <div className="native-page-content-list">
      {items.map((item) => {
        const key = keyFor(item)
        if (item.type === 'text') {
          const draft = textDrafts[key]
          if (!draft) return null
          return <div className="native-page-content-row text-content-row" key={key}>
            <div className="native-page-content-meta"><Type /><span>Text object {item.objectIndex + 1}{item.fontSize ? ` · ${rounded(item.fontSize)} pt` : ''}</span></div>
            <textarea aria-label={`Native page text object ${item.objectIndex + 1}`} rows={3} value={draft.text} onChange={(event) => patchText(key, { text: event.target.value })} />
            <div className="native-page-text-fields">
              <label>Color<input aria-label={`Native page text color ${item.objectIndex + 1}`} type="color" value={draft.color} onChange={(event) => patchText(key, { color: event.target.value })} /></label>
              <label>Opacity %<input aria-label={`Native page text opacity ${item.objectIndex + 1}`} type="number" min="0" max="100" step="1" value={draft.opacity} onChange={(event) => patchText(key, { opacity: event.target.value })} /></label>
              <label>Left %<input aria-label={`Native page text x ${item.objectIndex + 1}`} type="number" step="0.1" value={draft.x} onChange={(event) => patchText(key, { x: event.target.value })} /></label>
              <label>Top %<input aria-label={`Native page text y ${item.objectIndex + 1}`} type="number" step="0.1" value={draft.y} onChange={(event) => patchText(key, { y: event.target.value })} /></label>
              {item.fontSize && <label>Size pt<input aria-label={`Native page text font size ${item.objectIndex + 1}`} type="number" min="1" max="300" step="0.5" value={draft.fontSize} onChange={(event) => patchText(key, { fontSize: event.target.value })} /></label>}
            </div>
            <p>Text replacement uses the embedded PDF font. Font-size changes scale the existing native text object uniformly because this PDFium WASM build does not expose a direct font-size setter.</p>
            <div className="native-page-content-actions"><button disabled={Boolean(busy)} onClick={() => void saveText(item)}><Save /> Save</button><button className="danger-action" disabled={Boolean(busy)} onClick={() => void remove(item)}><Trash2 /> Delete</button></div>
          </div>
        }

        const draft = imageDrafts[key]
        if (!draft) return null
        return <div className="native-page-content-row image-content-row" key={key}>
          <div className="native-page-content-meta"><Image /><span>Image object {item.objectIndex + 1}{item.pixelWidth && item.pixelHeight ? ` · ${item.pixelWidth}×${item.pixelHeight}px` : ''}</span></div>
          <div className="native-page-image-fields">
            {(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{field === 'x' ? 'Left %' : field === 'y' ? 'Top %' : `${field[0].toUpperCase()}${field.slice(1)} %`}<input aria-label={`Native page image ${field} ${item.objectIndex + 1}`} type="number" step="0.1" value={draft[field]} onChange={(event) => patchImage(key, { [field]: event.target.value })} /></label>)}
          </div>
          <input ref={(node) => { replaceInputs.current[key] = node }} hidden type="file" accept="image/png,image/jpeg" onChange={(event) => void replaceImage(item, event.target.files?.[0])} />
          <p>Replacement changes the bitmap of the existing PDF image object, preserving its native object position/z-order. Geometry edits transform the existing object in-place.</p>
          <div className="native-page-content-actions image-actions">
            <button disabled={Boolean(busy)} onClick={() => void saveImageGeometry(item)}><Save /> Move / resize</button>
            <button disabled={Boolean(busy)} onClick={() => replaceInputs.current[key]?.click()}><Image /> Replace</button>
            <button disabled={Boolean(busy)} onClick={() => void extractImage(item)}><Download /> Extract PNG</button>
            <button className="danger-action" disabled={Boolean(busy)} onClick={() => void remove(item)}><Trash2 /> Delete</button>
          </div>
        </div>
      })}
    </div>}
  </section>
}
