import { useEffect, useRef, useState } from 'react'
import { Download, Paperclip, Plus, Trash2 } from 'lucide-react'
import { addPdfAttachment, extractPdfAttachment, listPdfAttachments, removePdfAttachment, type PdfAttachmentInfo } from '../lib/attachments'

type Props = {
  bytes: ArrayBuffer
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

function sizeLabel(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function downloadAttachment(name: string, data: Uint8Array) {
  const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AttachmentManager({ bytes, onBeforeMutate, onApply, onStatus }: Props) {
  const input = useRef<HTMLInputElement | null>(null)
  const [items, setItems] = useState<PdfAttachmentInfo[]>([])
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState('')

  const reload = async (source = bytes) => setItems(await listPdfAttachments(source))

  useEffect(() => {
    let cancelled = false
    void listPdfAttachments(bytes).then((next) => { if (!cancelled) setItems(next) }).catch((error) => {
      console.error(error)
      if (!cancelled) onStatus('Could not inspect PDF attachments.')
    })
    return () => { cancelled = true }
  }, [bytes, onStatus])

  const addFile = async (file: File) => {
    if (busy) return
    setBusy('add')
    onBeforeMutate()
    onStatus(`Attaching ${file.name}…`)
    try {
      const next = await addPdfAttachment(bytes, file, description)
      onApply(next, { status: `${file.name} attached` })
      setDescription('')
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not attach this file.')
    } finally {
      setBusy('')
      if (input.current) input.current.value = ''
    }
  }

  const extract = async (item: PdfAttachmentInfo) => {
    if (busy) return
    setBusy(`extract:${item.id}`)
    onStatus(`Extracting ${item.name}…`)
    try {
      const attachment = await extractPdfAttachment(bytes, item.id)
      downloadAttachment(attachment.name, attachment.data)
      onStatus(`${item.name} extracted`)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not extract this attachment.')
    } finally {
      setBusy('')
    }
  }

  const remove = async (item: PdfAttachmentInfo) => {
    if (busy) return
    setBusy(`remove:${item.id}`)
    onBeforeMutate()
    onStatus(`Removing ${item.name}…`)
    try {
      const next = await removePdfAttachment(bytes, item.id)
      onApply(next, { status: `${item.name} removed` })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not remove this attachment.')
    } finally {
      setBusy('')
    }
  }

  return <section className="attachment-manager">
    <div className="attachment-manager-heading">
      <div><Paperclip /><span><strong>File attachments</strong><small>Embedded inside the PDF</small></span></div>
      <span>{items.length}</span>
    </div>
    <div className="attachment-add-row">
      <input aria-label="Attachment description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" />
      <button disabled={Boolean(busy)} onClick={() => input.current?.click()}><Plus /> Attach file</button>
      <input ref={input} hidden type="file" onChange={(event) => event.target.files?.[0] && void addFile(event.target.files[0])} />
    </div>
    <div className="attachment-list">
      {items.map((item) => <div className="attachment-row" key={item.id}>
        <Paperclip />
        <span><strong>{item.name}</strong><small>{sizeLabel(item.size)}{item.description ? ` · ${item.description}` : ''}</small></span>
        <button title={`Extract ${item.name}`} disabled={Boolean(busy)} onClick={() => void extract(item)}><Download /></button>
        <button title={`Remove ${item.name}`} className="danger" disabled={Boolean(busy)} onClick={() => void remove(item)}><Trash2 /></button>
      </div>)}
      {!items.length && <div className="native-object-empty">No embedded file attachments found.</div>}
    </div>
  </section>
}
