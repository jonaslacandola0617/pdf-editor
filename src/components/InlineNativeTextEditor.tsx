import { useEffect, useRef, useState } from 'react'

type OverlayState = {
  left: number
  top: number
  width: number
  height: number
  value: string
  key: string
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

export function InlineNativeTextEditor() {
  const [overlay, setOverlay] = useState<OverlayState | null>(null)
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const lastSelectionKey = useRef('')

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
          key,
        })

        if (lastSelectionKey.current !== key) {
          lastSelectionKey.current = key
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

  if (!overlay) return null

  return (
    <textarea
      ref={editorRef}
      className="native-inline-text-input"
      aria-label="Edit selected PDF text directly on page"
      spellCheck={false}
      value={overlay.value}
      style={{
        left: overlay.left,
        top: overlay.top,
        width: Math.max(56, overlay.width),
        minHeight: Math.max(24, overlay.height),
        fontSize: Math.max(11, overlay.height * 0.72),
      }}
      onChange={(event) => {
        const source = sourceEditor()
        if (!source) return
        const value = event.target.value.replace(/[\r\n]+/g, ' ')
        setReactTextAreaValue(source, value)
        setOverlay((current) => current ? { ...current, value } : current)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          document.querySelector<HTMLButtonElement>('.native-edit-actions .soft-btn')?.click()
          return
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          document.querySelector<HTMLButtonElement>('.native-edit-actions .primary')?.click()
        }
      }}
    />
  )
}
