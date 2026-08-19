import { useEffect, useMemo, useState } from 'react'
import { FileInput, RefreshCw, Save, Trash2 } from 'lucide-react'
import {
  deleteFormField,
  listFormFieldProperties,
  updateFormFieldProperties,
  type FormFieldPropertyInfo,
} from '../lib/form-properties'

type Props = {
  bytes: ArrayBuffer
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

export function FormFieldPropertyManager({ bytes, onBeforeMutate, onApply, onStatus }: Props) {
  const [fields, setFields] = useState<FormFieldPropertyInfo[]>([])
  const [selectedName, setSelectedName] = useState('')
  const [draftName, setDraftName] = useState('')
  const [tooltip, setTooltip] = useState('')
  const [readOnly, setReadOnly] = useState(false)
  const [required, setRequired] = useState(false)
  const [exported, setExported] = useState(true)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const selected = useMemo(() => fields.find((field) => field.name === selectedName) || null, [fields, selectedName])

  const load = async (source = bytes, preferred = selectedName) => {
    setLoading(true)
    try {
      const next = await listFormFieldProperties(source)
      setFields(next)
      const nextName = next.some((field) => field.name === preferred) ? preferred : next[0]?.name || ''
      setSelectedName(nextName)
    } catch (error) {
      console.error(error)
      onStatus('Could not inspect AcroForm field properties in this document.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listFormFieldProperties(bytes)
      .then((next) => {
        if (cancelled) return
        setFields(next)
        setSelectedName((current) => next.some((field) => field.name === current) ? current : next[0]?.name || '')
      })
      .catch((error) => { if (!cancelled) { console.error(error); onStatus('Could not inspect AcroForm field properties in this document.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bytes, onStatus])

  useEffect(() => {
    if (!selected) {
      setDraftName('')
      setTooltip('')
      setReadOnly(false)
      setRequired(false)
      setExported(true)
      return
    }
    setDraftName(selected.name)
    setTooltip(selected.tooltip)
    setReadOnly(selected.readOnly)
    setRequired(selected.required)
    setExported(selected.exported)
  }, [selected])

  const save = async () => {
    if (!selected || busy) return
    setBusy('save')
    onBeforeMutate()
    onStatus('Updating form field properties…')
    try {
      const result = await updateFormFieldProperties(bytes, selected.name, { name: draftName, tooltip, readOnly, required, exported })
      onApply(result.bytes, { status: 'Updating form field properties complete' })
      await load(result.bytes, result.name)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not update this form field.')
    } finally {
      setBusy('')
    }
  }

  const remove = async () => {
    if (!selected || busy) return
    setBusy('delete')
    onBeforeMutate()
    onStatus('Deleting form field…')
    try {
      const next = await deleteFormField(bytes, selected.name)
      onApply(next, { status: 'Deleting form field complete' })
      await load(next, '')
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not delete this form field.')
    } finally {
      setBusy('')
    }
  }

  return <section className="form-property-manager">
    <div className="form-property-heading">
      <div><FileInput /><span><strong>Existing form field properties</strong><small>Rename fields and manage native AcroForm flags</small></span></div>
      <button title="Refresh form field properties" disabled={loading || Boolean(busy)} onClick={() => void load()}><RefreshCw /></button>
    </div>

    {loading && !fields.length && <div className="form-property-empty">Reading AcroForm fields…</div>}
    {!loading && !fields.length && <div className="form-property-empty">No interactive AcroForm fields found.</div>}

    {fields.length > 0 && <div className="form-property-workspace">
      <div className="form-property-list" role="list" aria-label="Existing form fields">
        {fields.map((field) => <button key={field.name} className={field.name === selectedName ? 'active' : ''} onClick={() => setSelectedName(field.name)}>
          <span><strong>{field.name}</strong><small>{field.type}</small></span>
          <em>{field.readOnly ? 'RO' : ''}{field.required ? ' REQ' : ''}{!field.exported ? ' NO-EXPORT' : ''}</em>
        </button>)}
      </div>

      {selected && <div className="form-property-editor">
        <div className="form-property-summary"><strong>{selected.type}</strong><span>Current name: {selected.name}</span></div>
        <label>Field name<input aria-label="Existing field name" value={draftName} onChange={(event) => setDraftName(event.target.value)} /></label>
        <label>Tooltip / alternate name<input aria-label="Existing field tooltip" value={tooltip} onChange={(event) => setTooltip(event.target.value)} placeholder="Shown by compatible PDF viewers" /></label>
        <div className="form-property-flags">
          <label><input aria-label="Existing field read only" type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} /><span><strong>Read only</strong><small>Prevent editing in PDF readers</small></span></label>
          <label><input aria-label="Existing field required" type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /><span><strong>Required</strong><small>Require a value on form submission</small></span></label>
          <label><input aria-label="Existing field exported" type="checkbox" checked={exported} onChange={(event) => setExported(event.target.checked)} /><span><strong>Export value</strong><small>Include this value when form data is submitted</small></span></label>
        </div>
        <div className="form-property-actions">
          <button disabled={Boolean(busy)} onClick={() => void save()}><Save /> Save properties</button>
          <button className="form-property-delete" disabled={Boolean(busy)} onClick={() => void remove()}><Trash2 /> Delete field</button>
        </div>
        <p>Renaming keeps the field in its current hierarchy. Deleting removes the field and its page widgets.</p>
      </div>}
    </div>}
  </section>
}
