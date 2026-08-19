import { useRef, useState } from 'react'
import { ImagePlus, Stamp, Trash2 } from 'lucide-react'
import {
  createImageSignaturePreset,
  loadImageSignaturePresets,
  placeImageSignature,
  storeImageSignaturePresets,
  type ImageSignaturePreset,
} from '../lib/image-signatures'

type Props = {
  bytes: ArrayBuffer
  currentPage: number
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

export function ImageSignatureManager({ bytes, currentPage, onBeforeMutate, onApply, onStatus }: Props) {
  const input = useRef<HTMLInputElement | null>(null)
  const [presets, setPresets] = useState<ImageSignaturePreset[]>(() => loadImageSignaturePresets())
  const [selectedId, setSelectedId] = useState(() => loadImageSignaturePresets()[0]?.id || '')
  const [name, setName] = useState('')
  const [xPercent, setXPercent] = useState(58)
  const [yPercent, setYPercent] = useState(72)
  const [widthPercent, setWidthPercent] = useState(28)
  const [opacity, setOpacity] = useState(1)
  const [busy, setBusy] = useState(false)

  const selected = presets.find((preset) => preset.id === selectedId) || presets[0] || null

  const importImage = async (file: File) => {
    if (busy) return
    setBusy(true)
    onStatus(`Importing ${file.name} locally…`)
    try {
      const preset = await createImageSignaturePreset(file, name)
      const next = [preset, ...presets.filter((item) => item.id !== preset.id)].slice(0, 6)
      storeImageSignaturePresets(next)
      setPresets(next)
      setSelectedId(preset.id)
      setName('')
      onStatus(`${preset.name} saved as a local image signature`)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not import this signature image.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const place = async () => {
    if (!selected || busy) return
    setBusy(true)
    onBeforeMutate()
    onStatus(`Placing ${selected.name} on page ${currentPage + 1}…`)
    try {
      const next = await placeImageSignature(bytes, selected, currentPage, { xPercent, yPercent, widthPercent, opacity })
      onApply(next, { status: `${selected.name} placed on page ${currentPage + 1}` })
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not place this image signature.')
    } finally {
      setBusy(false)
    }
  }

  const remove = (id: string) => {
    const next = presets.filter((item) => item.id !== id)
    try {
      storeImageSignaturePresets(next)
      setPresets(next)
      if (selectedId === id) setSelectedId(next[0]?.id || '')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Could not update local image signatures.')
    }
  }

  return <section className="image-signature-manager">
    <div className="image-signature-heading">
      <div><Stamp /><span><strong>Reusable image signatures</strong><small>PNG/JPG · stored only in this browser</small></span></div>
      <button disabled={busy} onClick={() => input.current?.click()}><ImagePlus /> Import</button>
      <input ref={input} hidden type="file" accept="image/png,image/jpeg" onChange={(event) => event.target.files?.[0] && void importImage(event.target.files[0])} />
    </div>
    <label className="image-signature-name">Preset name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional name before import" /></label>

    {presets.length ? <div className="image-signature-workspace">
      <div className="image-signature-presets">
        {presets.map((preset) => <div key={preset.id} className={selected?.id === preset.id ? 'active' : ''}>
          <button className="image-signature-preset" onClick={() => setSelectedId(preset.id)}>
            <img src={preset.dataUrl} alt="" /><span>{preset.name}</span>
          </button>
          <button className="image-signature-delete" title={`Delete ${preset.name}`} onClick={() => remove(preset.id)}><Trash2 /></button>
        </div>)}
      </div>
      {selected && <div className="image-signature-placement">
        <div className="image-signature-preview"><img src={selected.dataUrl} alt={`${selected.name} preview`} /></div>
        <div className="image-signature-grid">
          <label>X from left<input aria-label="Image signature X percent" type="number" min="0" max="97" value={xPercent} onChange={(event) => setXPercent(Number(event.target.value))} /><span>%</span></label>
          <label>Y from top<input aria-label="Image signature Y percent" type="number" min="0" max="97" value={yPercent} onChange={(event) => setYPercent(Number(event.target.value))} /><span>%</span></label>
          <label>Width<input aria-label="Image signature width percent" type="number" min="3" max="95" value={widthPercent} onChange={(event) => setWidthPercent(Number(event.target.value))} /><span>%</span></label>
          <label>Opacity<input aria-label="Image signature opacity" type="number" min="10" max="100" value={Math.round(opacity * 100)} onChange={(event) => setOpacity(Number(event.target.value) / 100)} /><span>%</span></label>
        </div>
        <button className="image-signature-place" disabled={busy} onClick={() => void place()}><Stamp /> Place on page {currentPage + 1}</button>
        <p>This is a visual image signature, not a certificate-backed cryptographic digital signature.</p>
      </div>}
    </div> : <div className="native-object-empty">Import a transparent PNG or JPG signature to reuse it across local documents.</div>}
  </section>
}
