import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileJson, FormInput, Save, Upload } from 'lucide-react'
import {
  exportFormData,
  getPageTabOrder,
  importFormData,
  listAdvancedFormFields,
  setPageTabOrder,
  updateChoiceOptions,
  updateFormWidget,
  updateSimpleFormValue,
  updateTextFieldBehavior,
  type AdvancedFormFieldInfo,
  type FormWidgetGeometry,
  type FormWidgetInfo,
} from '../lib/advanced-forms'

type Props = {
  bytes: ArrayBuffer
  currentPage: number
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

type WidgetDraft = {
  geometry: FormWidgetGeometry
  backgroundColor: string
  borderColor: string
  borderWidth: string
}

type FieldDraft = {
  multiline: boolean
  password: boolean
  combing: boolean
  maxLength: string
  fontSize: string
  textColor: string
  alignment: 0 | 1 | 2
  options: string
  selected: string
  simpleValue: string
  checked: boolean
}

function widgetKey(field: string, widgetIndex: number) { return `${field}:${widgetIndex}` }
function fieldDraft(item: AdvancedFormFieldInfo): FieldDraft {
  const selected = Array.isArray(item.value) ? item.value.join(', ') : typeof item.value === 'string' ? item.value : ''
  return {
    multiline: Boolean(item.text?.multiline),
    password: Boolean(item.text?.password),
    combing: Boolean(item.text?.combing),
    maxLength: item.text?.maxLength ? String(item.text.maxLength) : '',
    fontSize: item.text?.fontSize ? String(Math.round(item.text.fontSize * 100) / 100) : '',
    textColor: item.text?.textColor || '#000000',
    alignment: item.text?.alignment || 0,
    options: item.options.join('\n'),
    selected,
    simpleValue: selected,
    checked: item.value === true,
  }
}

function widgetDraft(item: FormWidgetInfo): WidgetDraft {
  return {
    geometry: { ...item.geometry },
    backgroundColor: item.backgroundColor,
    borderColor: item.borderColor,
    borderWidth: String(item.borderWidth),
  }
}

function geometryChanged(a: FormWidgetGeometry, b: FormWidgetGeometry) {
  return (['x', 'y', 'width', 'height'] as const).some((key) => Math.abs(a[key] - b[key]) > 0.001)
}

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AdvancedFormWidgetManager({ bytes, currentPage, onBeforeMutate, onApply, onStatus }: Props) {
  const [fields, setFields] = useState<AdvancedFormFieldInfo[]>([])
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, FieldDraft>>({})
  const [widgetDrafts, setWidgetDrafts] = useState<Record<string, WidgetDraft>>({})
  const [tabOrder, setTabOrder] = useState<'unspecified' | 'row' | 'column' | 'structure'>('unspecified')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')
  const importInput = useRef<HTMLInputElement | null>(null)

  const hydrate = (next: AdvancedFormFieldInfo[]) => {
    setFields(next)
    setFieldDrafts(Object.fromEntries(next.map((field) => [field.name, fieldDraft(field)])))
    setWidgetDrafts(Object.fromEntries(next.flatMap((field) => field.widgets.map((widget) => [widgetKey(field.name, widget.widgetIndex), widgetDraft(widget)]))))
  }

  const reload = async (source = bytes) => {
    setLoading(true)
    try {
      const [next, tabs] = await Promise.all([listAdvancedFormFields(source), getPageTabOrder(source, currentPage)])
      hydrate(next)
      setTabOrder(tabs)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not inspect advanced form properties.')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([listAdvancedFormFields(bytes), getPageTabOrder(bytes, currentPage)])
      .then(([next, tabs]) => { if (!cancelled) { hydrate(next); setTabOrder(tabs) } })
      .catch((error) => { if (!cancelled) { console.error(error); onStatus(error instanceof Error ? error.message : 'Could not inspect advanced form properties.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bytes, currentPage, onStatus])

  const widgetCount = useMemo(() => fields.reduce((sum, field) => sum + field.widgets.length, 0), [fields])
  const patchField = (name: string, patch: Partial<FieldDraft>) => setFieldDrafts((current) => ({ ...current, [name]: { ...current[name], ...patch } }))
  const patchWidget = (key: string, patch: Partial<WidgetDraft>) => setWidgetDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  const patchGeometry = (key: string, field: keyof FormWidgetGeometry, value: string) => {
    const numeric = Number(value)
    setWidgetDrafts((current) => ({ ...current, [key]: { ...current[key], geometry: { ...current[key].geometry, [field]: Number.isFinite(numeric) ? numeric : 0 } } }))
  }

  const mutate = async (key: string, status: string, task: () => Promise<ArrayBuffer>) => {
    if (busy) return
    setBusy(key); onBeforeMutate(); onStatus(`${status}…`)
    try {
      const next = await task()
      onApply(next, { status: `${status} complete` })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : `${status} failed`)
    } finally { setBusy('') }
  }

  const saveWidget = (field: AdvancedFormFieldInfo, widget: FormWidgetInfo) => {
    const key = widgetKey(field.name, widget.widgetIndex)
    const draft = widgetDrafts[key]
    if (!draft) return
    void mutate(key, 'Updating form widget', () => updateFormWidget(bytes, field.name, widget.widgetIndex, {
      geometry: draft.geometry,
      backgroundColor: draft.backgroundColor,
      borderColor: draft.borderColor,
      borderWidth: Math.max(0, Number(draft.borderWidth) || 0),
    }))
  }

  const saveText = (field: AdvancedFormFieldInfo) => {
    const draft = fieldDrafts[field.name]
    if (!draft) return
    void mutate(field.name, 'Updating text field behavior', () => updateTextFieldBehavior(bytes, field.name, {
      multiline: draft.multiline,
      password: draft.password,
      combing: draft.combing,
      maxLength: draft.maxLength ? Number(draft.maxLength) : undefined,
      fontSize: draft.fontSize ? Number(draft.fontSize) : undefined,
      textColor: draft.textColor,
      alignment: draft.alignment,
    }))
  }

  const saveChoices = (field: AdvancedFormFieldInfo) => {
    const draft = fieldDrafts[field.name]
    if (!draft) return
    const options = draft.options.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
    const selected = draft.selected.split(',').map((value) => value.trim()).filter(Boolean)
    void mutate(field.name, 'Updating choice field options', () => updateChoiceOptions(bytes, field.name, options, selected))
  }

  const saveSimpleValue = (field: AdvancedFormFieldInfo) => {
    const draft = fieldDrafts[field.name]
    if (!draft) return
    const value = field.type === 'checkbox' ? draft.checked : field.type === 'radio' ? draft.simpleValue || null : null
    void mutate(field.name, 'Updating form field value', () => updateSimpleFormValue(bytes, field.name, value))
  }

  const saveTabOrder = () => void mutate('tabs', 'Updating page tab order', () => setPageTabOrder(bytes, currentPage, tabOrder))

  const exportJson = async () => {
    if (busy) return
    setBusy('export-json'); onStatus('Exporting form data JSON…')
    try {
      downloadJson('pdf-forge-form-data.json', await exportFormData(bytes))
      onStatus('Form data JSON exported')
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not export form data.')
    } finally { setBusy('') }
  }

  const importJson = async (file: File | undefined) => {
    if (!file || busy) return
    setBusy('import-json'); onBeforeMutate(); onStatus('Importing form data JSON…')
    try {
      const payload = JSON.parse(await file.text())
      const next = await importFormData(bytes, payload)
      onApply(next, { status: 'Form data JSON imported' })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : 'Could not import form data JSON.')
    } finally {
      setBusy('')
      if (importInput.current) importInput.current.value = ''
    }
  }

  return <section className="advanced-form-widget-manager">
    <div className="advanced-form-widget-heading">
      <FormInput />
      <span><strong>Advanced form widgets</strong><small>Widget geometry, appearance, text behavior, options, tab order and JSON data</small></span>
      <em>{fields.length} / {widgetCount}</em>
    </div>

    <div className="advanced-form-toolbar">
      <label>Page {currentPage + 1} tab order<select aria-label="Current page tab order" value={tabOrder} onChange={(event) => setTabOrder(event.target.value as typeof tabOrder)}><option value="unspecified">Unspecified</option><option value="row">Row</option><option value="column">Column</option><option value="structure">Structure</option></select></label>
      <button disabled={Boolean(busy)} onClick={saveTabOrder}><Save /> Save tab order</button>
      <button disabled={Boolean(busy)} onClick={() => void exportJson()}><Download /> Export JSON</button>
      <button disabled={Boolean(busy)} onClick={() => importInput.current?.click()}><Upload /> Import JSON</button>
      <input ref={importInput} hidden type="file" accept="application/json,.json" onChange={(event) => void importJson(event.target.files?.[0])} />
    </div>

    {loading && !fields.length && <div className="advanced-form-empty">Reading advanced form properties…</div>}
    {!loading && !fields.length && <div className="advanced-form-empty">No AcroForm fields found.</div>}

    {fields.length > 0 && <div className="advanced-form-list">
      {fields.map((field) => {
        const draft = fieldDrafts[field.name]
        if (!draft) return null
        return <div className="advanced-form-row" key={field.name}>
          <div className="advanced-form-meta"><FileJson /><span><strong>{field.name}</strong><small>{field.type} · {field.widgets.length} widget{field.widgets.length === 1 ? '' : 's'}</small></span></div>

          {field.type === 'text' && <div className="advanced-text-behavior">
            <div className="advanced-check-grid">
              <label><input aria-label={`Multiline ${field.name}`} type="checkbox" checked={draft.multiline} onChange={(event) => patchField(field.name, { multiline: event.target.checked })} />Multiline</label>
              <label><input aria-label={`Password ${field.name}`} type="checkbox" checked={draft.password} onChange={(event) => patchField(field.name, { password: event.target.checked })} />Password</label>
              <label><input aria-label={`Combing ${field.name}`} type="checkbox" checked={draft.combing} onChange={(event) => patchField(field.name, { combing: event.target.checked })} />Combing</label>
            </div>
            <div className="advanced-field-grid">
              <label>Max length<input aria-label={`Max length ${field.name}`} type="number" min="1" value={draft.maxLength} onChange={(event) => patchField(field.name, { maxLength: event.target.value })} /></label>
              <label>Font size<input aria-label={`Form font size ${field.name}`} type="number" min="1" max="300" step="0.5" value={draft.fontSize} onChange={(event) => patchField(field.name, { fontSize: event.target.value })} /></label>
              <label>Text color<input aria-label={`Form text color ${field.name}`} type="color" value={draft.textColor} onChange={(event) => patchField(field.name, { textColor: event.target.value })} /></label>
              <label>Alignment<select aria-label={`Form alignment ${field.name}`} value={draft.alignment} onChange={(event) => patchField(field.name, { alignment: Number(event.target.value) as 0 | 1 | 2 })}><option value={0}>Left</option><option value={1}>Center</option><option value={2}>Right</option></select></label>
            </div>
            <div className="advanced-form-actions"><button disabled={Boolean(busy)} onClick={() => saveText(field)}><Save /> Save text behavior</button></div>
          </div>}

          {(field.type === 'dropdown' || field.type === 'list') && <div className="advanced-choice-behavior">
            <label>Options (one per line)<textarea aria-label={`Choice options ${field.name}`} rows={4} value={draft.options} onChange={(event) => patchField(field.name, { options: event.target.value })} /></label>
            <label>Selected {field.type === 'list' ? '(comma-separated)' : ''}<input aria-label={`Choice selected ${field.name}`} value={draft.selected} onChange={(event) => patchField(field.name, { selected: event.target.value })} /></label>
            <div className="advanced-form-actions"><button disabled={Boolean(busy)} onClick={() => saveChoices(field)}><Save /> Save options</button></div>
          </div>}

          {field.type === 'checkbox' && <div className="advanced-simple-value"><label><input aria-label={`Checkbox value ${field.name}`} type="checkbox" checked={draft.checked} onChange={(event) => patchField(field.name, { checked: event.target.checked })} />Checked</label><button disabled={Boolean(busy)} onClick={() => saveSimpleValue(field)}><Save /> Save value</button></div>}
          {field.type === 'radio' && <div className="advanced-simple-value"><label>Selected option<select aria-label={`Radio value ${field.name}`} value={draft.simpleValue} onChange={(event) => patchField(field.name, { simpleValue: event.target.value })}><option value="">None</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select></label><button disabled={Boolean(busy)} onClick={() => saveSimpleValue(field)}><Save /> Save value</button></div>}

          {field.widgets.map((widget) => {
            const key = widgetKey(field.name, widget.widgetIndex)
            const wd = widgetDrafts[key]
            if (!wd) return null
            const changed = geometryChanged(wd.geometry, widget.geometry) || wd.backgroundColor !== widget.backgroundColor || wd.borderColor !== widget.borderColor || Math.abs((Number(wd.borderWidth) || 0) - widget.borderWidth) > 0.001
            return <div className="advanced-widget-row" key={key}>
              <div className="advanced-widget-meta">Widget {widget.widgetIndex + 1} · page {widget.pageIndex + 1}{changed ? ' · modified' : ''}</div>
              <div className="advanced-widget-grid">
                {(['x', 'y', 'width', 'height'] as const).map((property) => <label key={property}>{property === 'x' ? 'Left %' : property === 'y' ? 'Top %' : `${property[0].toUpperCase()}${property.slice(1)} %`}<input aria-label={`Form widget ${property} ${field.name} ${widget.widgetIndex + 1}`} type="number" min="0" max="100" step="0.1" value={wd.geometry[property]} onChange={(event) => patchGeometry(key, property, event.target.value)} /></label>)}
                <label>Background<input aria-label={`Form widget background ${field.name} ${widget.widgetIndex + 1}`} type="color" value={wd.backgroundColor} onChange={(event) => patchWidget(key, { backgroundColor: event.target.value })} /></label>
                <label>Border<input aria-label={`Form widget border color ${field.name} ${widget.widgetIndex + 1}`} type="color" value={wd.borderColor} onChange={(event) => patchWidget(key, { borderColor: event.target.value })} /></label>
                <label>Border width<input aria-label={`Form widget border width ${field.name} ${widget.widgetIndex + 1}`} type="number" min="0" step="0.25" value={wd.borderWidth} onChange={(event) => patchWidget(key, { borderWidth: event.target.value })} /></label>
              </div>
              <div className="advanced-form-actions"><button disabled={Boolean(busy)} onClick={() => saveWidget(field, widget)}><Save /> Save widget</button></div>
            </div>
          })}
        </div>
      })}
    </div>}
  </section>
}
