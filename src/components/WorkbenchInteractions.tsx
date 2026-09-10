import { useEffect, useRef, useState } from 'react'
import { FileText, Highlighter, MessageSquareText, MousePointer2, PenLine, ScanLine, Settings2, Type, X } from 'lucide-react'

const THEME_KEY = 'pdf-forge-theme'

// Dark is the default for first-time visitors. Existing users keep their explicit choice.
if (typeof window !== 'undefined' && localStorage.getItem(THEME_KEY) === null) {
  localStorage.setItem(THEME_KEY, 'dark')
  document.documentElement.dataset.theme = 'dark'
}

type ContextMenuState = { x: number; y: number; hasSelection: boolean } | null

function clickTool(...titles: string[]) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.editor-toolbar button[title]'))
  const button = buttons.find((candidate) => titles.includes(candidate.title))
  button?.click()
}

function directNavButtons() {
  const nav = document.querySelector<HTMLElement>('.floating-nav')
  if (!nav) return []
  return Array.from(nav.children).filter((node): node is HTMLButtonElement => node instanceof HTMLButtonElement)
}

function renameLegacyEditTextLabels(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[title="Edit existing text"]').forEach((node) => { node.title = 'Edit text' })
  root.querySelectorAll<HTMLElement>('.forge-inspector-heading h3, .native-edit-help strong, .product-command-results strong').forEach((node) => {
    if (node.textContent?.trim() === 'Edit existing text' || node.textContent?.trim() === 'Edit existing PDF text') node.textContent = 'Edit text'
  })
}

export function WorkbenchInteractions() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const wheelAccumulator = useRef(0)
  const lastPageTurn = useRef(0)
  const lastZoom = useRef(0)

  useEffect(() => {
    renameLegacyEditTextLabels()
    const observer = new MutationObserver((entries) => {
      for (const entry of entries) {
        for (const node of entry.addedNodes) {
          if (node instanceof Element) renameLegacyEditTextLabels(node)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.forge-context-menu')) setContextMenu(null)
    }
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null) }
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [])

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.pdf-page')) return
      event.preventDefault()
      const selected = Boolean(document.querySelector('.annotation.selected, .native-text-selection'))
      setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 250), y: Math.min(event.clientY, window.innerHeight - 360), hasSelection: selected })
    }

    // Chrome/Edge expose precision-touchpad pinch as ctrl+wheel. Capture it before
    // the browser zooms the entire application and route it to PDF Forge zoom.
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element | null
      const stage = target?.closest('.document-stage')
      if (!stage) return

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const now = performance.now()
        if (now - lastZoom.current < 36) return
        lastZoom.current = now
        const buttons = directNavButtons()
        if (buttons.length < 2) return
        const zoomOut = buttons[buttons.length - 2]
        const zoomIn = buttons[buttons.length - 1]
        ;(event.deltaY < 0 ? zoomIn : zoomOut)?.click()
        return
      }

      const scroll = target?.closest('.page-scroll.view-single')
      if (!scroll || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return
      event.preventDefault()

      if (Math.sign(event.deltaY) !== Math.sign(wheelAccumulator.current)) wheelAccumulator.current = 0
      wheelAccumulator.current += event.deltaY
      const now = performance.now()
      if (Math.abs(wheelAccumulator.current) < 72 || now - lastPageTurn.current < 280) return

      const direction = Math.sign(wheelAccumulator.current)
      wheelAccumulator.current = 0
      lastPageTurn.current = now
      const buttons = directNavButtons()
      const pageButton = direction > 0 ? buttons[1] : buttons[0]
      if (pageButton && !pageButton.disabled) pageButton.click()
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('wheel', onWheel, true)
    }
  }, [])

  const activate = (...titles: string[]) => {
    clickTool(...titles)
    setContextMenu(null)
  }

  return contextMenu ? (
    <div className="forge-context-menu" role="menu" aria-label="PDF quick tools" style={{ left: contextMenu.x, top: contextMenu.y }}>
      <header><span>QUICK TOOLS</span><button aria-label="Close quick tools" onClick={() => setContextMenu(null)}><X size={14} /></button></header>
      <button role="menuitem" onClick={() => activate('Select')}><MousePointer2 size={16} /><span><strong>Select</strong><small>Move or transform an item</small></span></button>
      <button role="menuitem" onClick={() => activate('Edit text', 'Edit existing text')}><PenLine size={16} /><span><strong>Edit text</strong><small>Edit native PDF text</small></span></button>
      <button role="menuitem" onClick={() => activate('Add text')}><Type size={16} /><span><strong>Add text</strong><small>Place a new text annotation</small></span></button>
      <button role="menuitem" onClick={() => activate('Sticky note')}><MessageSquareText size={16} /><span><strong>Comment</strong><small>Add a sticky note</small></span></button>
      <button role="menuitem" onClick={() => activate('Highlight')}><Highlighter size={16} /><span><strong>Highlight</strong><small>Mark content for review</small></span></button>
      <button role="menuitem" onClick={() => activate('Draw')}><FileText size={16} /><span><strong>Draw</strong><small>Draw directly on the page</small></span></button>
      <button role="menuitem" onClick={() => activate('Redact')}><ScanLine size={16} /><span><strong>Redact</strong><small>Mark sensitive content</small></span></button>
      {contextMenu.hasSelection && <>
        <div className="forge-context-separator" />
        <button role="menuitem" onClick={() => { document.querySelector<HTMLButtonElement>('.forge-inspector-toggle')?.click(); setContextMenu(null) }}><Settings2 size={16} /><span><strong>Properties</strong><small>Open selection controls</small></span></button>
      </>}
    </div>
  ) : null
}
