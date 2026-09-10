import { useEffect, useRef, useState } from 'react'

type OverlayState = {
  left: number
  top: number
  width: number
  height: number
  value: string
}

function setReactTextAreaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

function sourceEditor() {
  return document.querySelector<HTMLTextAreaElement>('.native-text-editor .property-field textarea')
}

function selectionBox() {
  return document.querySelector<HTMLElement>('.native-text-selection')
}

function clickHiddenAction(selector: string) {
  const button = document.querySelector<HTMLButtonElement>(selector)
  if (!button || button.disabled) return false
  button.click()
  return true
}

export function InlineNativeTextEditor() {
  const [overlay, setOverlay] = useState<OverlayState | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const lastSelectionKey = useRef('')
  const originalValue = useRef('')
  const latestValue = useRef('')
  const finishing = useRef(false)

  const finishEdit = (mode: 'apply' | 'cancel') => {
    if (finishing.current) return
    finishing.current = true

    if (mode === 'cancel') {
      if (!clickHiddenAction('.native-edit-actions .soft-btn')) finishing.current = false
      return
    }

    const source = sourceEditor()
    if (!source) {
      finishing.current = false
      return
    }

    // Use the inline editor's latest value instead of relying on blur/change ordering.
    // Pointer-down outside the editor commits before the page can clear nativeSelection.
    const value = latestValue.current.replace(/[\r\n]+/g, ' ')
    setReactTextAreaValue(source, value)

    if (value === originalValue.current) {
      if (!clickHiddenAction('.native-edit-actions .soft-btn')) finishing.current = false
      return
    }

    if (!value.length) {
      if (!clickHiddenAction('.native-delete-button')) finishing.current = false
      return
    }

    if (!clickHiddenAction('.native-edit-actions .primary')) finishing.current = false
  }

  useEffect(() => {
    let frame = 0

    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = selectionBox()
        const source = sourceEditor()
        if (!box || !source || source.disabled) {
          setOverlay(null)
          document.body.classList.remove('inline-native-edit-active')
          lastSelectionKey.current = ''
          originalValue.current = ''
          latestValue.current = ''
          finishing.current = false
          return
        }

        const rect = box.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) {
          setOverlay(null)
          document.body.classList.remove('inline-native-edit-active')
          return
        }

        const key = `${box.style.left}:${box.style.top}:${box.style.width}:${box.style.height}`
        document.body.classList.add('inline-native-edit-active')
        setOverlay({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          value: source.value,
        })

        if (lastSelectionKey.current !== key) {
          lastSelectionKey.current = key
          originalValue.current = source.value
          latestValue.current = source.value
          finishing.current = false
          requestAnimationFrame(() => {
            const editor = editorRef.current
            if (!editor) return
            editor.focus({ preventScroll: true })
            editor.setSelectionRange(0, editor.value.length)
          })
        }
      })
    }

    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    window.addEventListener('resize', sync)
    document.addEventListener('scroll', sync, true)
    document.addEventListener('input', sync, true)
    sync()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', sync)
      document.removeEventListener('scroll', sync, true)
      document.removeEventListener('input', sync, true)
      document.body.classList.remove('inline-native-edit-active')
    }
  }, [])

  useEffect(() => {
    const commitBeforeSelectionChanges = (event: PointerEvent) => {
      const editor = editorRef.current
      if (!editor || !document.body.classList.contains('inline-native-edit-active')) return
      if (event.target instanceof Node && editor.contains(event.target)) return
      finishEdit('apply')
    }

    // Capture phase is intentional: commit native text before PDF/page handlers can
    // clear the native selection that the async save operation needs.
    document.addEventListener('pointerdown', commitBeforeSelectionChanges, true)
    return () => document.removeEventListener('pointerdown', commitBeforeSelectionChanges, true)
  }, [])

  if (!overlay) return null

  return (
    <textarea
      ref={editorRef}
      className="native-inline-text-input"
      aria-label="Edit selected PDF text directly on page"
      spellCheck={false}
      rows={1}
      value={overlay.value}
      style={{
        left: overlay.left,
        top: overlay.top,
        width: Math.max(56, overlay.width),
        minHeight: Math.max(24, overlay.height),
        fontSize: Math.max(11, overlay.height * 0.72),
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onChange={(event) => {
        const source = sourceEditor()
        if (!source) return
        finishing.current = false
        const value = event.target.value.replace(/[\r\n]+/g, ' ')
        latestValue.current = value
        setReactTextAreaValue(source, value)
        setOverlay((current) => current ? { ...current, value } : current)
      }}
      onBlur={() => finishEdit('apply')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          finishEdit('cancel')
          return
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          finishEdit('apply')
        }
      }}
    />
  )
}
