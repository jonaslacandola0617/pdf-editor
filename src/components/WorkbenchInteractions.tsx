import { useEffect, useRef, useState } from 'react'
import { FileText, Highlighter, MessageSquareText, MousePointer2, PenLine, ScanLine, Settings2, Type, X } from 'lucide-react'

const THEME_KEY = 'pdf-forge-theme'
const VIEW_KEY = 'pdf-forge-view-mode'

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

function clickWorkflow(label: 'Edit' | 'Review' | 'Sign') {
  document.querySelector<HTMLButtonElement>(`.forge-editor-switch button[aria-label="${label}"]`)?.click()
}

function directNavButtons() {
  const nav = document.querySelector<HTMLElement>('.floating-nav')
  if (!nav) return []
  return Array.from(nav.children).filter((node): node is HTMLButtonElement => node instanceof HTMLButtonElement)
}

function replaceUserFacingEditTextLabels(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.forge-inspector-heading h3, .native-edit-help strong, .product-command-results strong').forEach((node) => {
    if (node.textContent?.trim() === 'Edit existing text' || node.textContent?.trim() === 'Edit existing PDF text') node.textContent = 'Edit text'
  })
}

function setReactPageInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export function WorkbenchInteractions() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const wheelAccumulator = useRef(0)
  const lastPageTurn = useRef(0)
  const lastZoom = useRef(0)
  const scrollFrame = useRef(0)

  useEffect(() => {
    replaceUserFacingEditTextLabels()
    const observer = new MutationObserver((entries) => {
      for (const entry of entries) {
        for (const node of entry.addedNodes) {
          if (node instanceof Element) replaceUserFacingEditTextLabels(node)
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const initializeView = () => {
      const shell = document.querySelector<HTMLElement>('.app-shell')
      if (!shell || shell.dataset.forgeViewInitialized === '1') return false
      const preferred = localStorage.getItem(VIEW_KEY) || 'continuous'
      const title = preferred === 'single' ? 'Single page view' : preferred === 'spread' ? 'Two-page view' : 'Continuous view'
      const button = document.querySelector<HTMLButtonElement>(`.floating-nav button[title="${title}"]`)
      if (!button) return false
      button.click()
      shell.dataset.forgeViewInitialized = '1'
      return true
    }

    const rememberView = (event: Event) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>('.floating-nav button[title]')
      if (!button) return
      if (button.title === 'Single page view') localStorage.setItem(VIEW_KEY, 'single')
      if (button.title === 'Continuous view') localStorage.setItem(VIEW_KEY, 'continuous')
      if (button.title === 'Two-page view') localStorage.setItem(VIEW_KEY, 'spread')
    }

    initializeView()
    const observer = new MutationObserver(() => initializeView())
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('click', rememberView, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('click', rememberView, true)
    }
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
      const selected = Boolean(document.querySelector('.annotation.selected, .annotation-transform-box, .native-text-selection'))
      setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 250), y: Math.min(event.clientY, window.innerHeight - 360), hasSelection: selected })
    }

    // Chrome/Edge expose precision-touchpad pinch as ctrl+wheel. Capture it before
    // the browser zooms the whole application and route it to PDF Forge zoom.
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

      // Continuous view scrolls naturally. In explicit Single Page mode, a wheel
      // gesture turns pages after a threshold so precision-trackpad inertia does not skip pages.
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

    // Keep the page indicator/current-page state in sync while the user scrolls
    // through Continuous view. The closest page to the viewport center wins.
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target?.matches('.page-scroll.view-continuous')) return
      cancelAnimationFrame(scrollFrame.current)
      scrollFrame.current = requestAnimationFrame(() => {
        const scrollerRect = target.getBoundingClientRect()
        const center = scrollerRect.top + scrollerRect.height / 2
        const pages = Array.from(target.querySelectorAll<HTMLElement>('.page-view[data-page]'))
        let closest: { page: number; distance: number } | null = null
        for (const page of pages) {
          const rect = page.getBoundingClientRect()
          const distance = Math.abs(rect.top + rect.height / 2 - center)
          const pageIndex = Number(page.dataset.page)
          if (Number.isFinite(pageIndex) && (!closest || distance < closest.distance)) closest = { page: pageIndex, distance }
        }
        if (!closest) return
        const input = document.querySelector<HTMLInputElement>('.floating-nav input')
        if (input && Number(input.value) !== closest.page + 1) setReactPageInput(input, String(closest.page + 1))
      })
    }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    document.addEventListener('scroll', onScroll, true)
    return () => {
      cancelAnimationFrame(scrollFrame.current)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  const activate = (workflow: 'Edit' | 'Review' | 'Sign', ...titles: string[]) => {
    clickWorkflow(workflow)
    window.setTimeout(() => clickTool(...titles), 0)
    setContextMenu(null)
  }

  return contextMenu ? (
    <div className="forge-context-menu" role="menu" aria-label="PDF quick tools" style={{ left: contextMenu.x, top: contextMenu.y }}>
      <header><span>QUICK TOOLS</span><button aria-label="Close quick tools" onClick={() => setContextMenu(null)}><X size={14} /></button></header>
      <button role="menuitem" onClick={() => activate('Edit', 'Select')}><MousePointer2 size={16} /><span><strong>Select</strong><small>Move, resize, rotate, or skew</small></span></button>
      <button role="menuitem" onClick={() => activate('Edit', 'Edit existing text')}><PenLine size={16} /><span><strong>Edit text</strong><small>Edit native PDF text</small></span></button>
      <button role="menuitem" onClick={() => activate('Edit', 'Add text')}><Type size={16} /><span><strong>Add text</strong><small>Place a new text annotation</small></span></button>
      <button role="menuitem" onClick={() => activate('Review', 'Sticky note')}><MessageSquareText size={16} /><span><strong>Comment</strong><small>Add a sticky note</small></span></button>
      <button role="menuitem" onClick={() => activate('Review', 'Highlight')}><Highlighter size={16} /><span><strong>Highlight</strong><small>Mark content for review</small></span></button>
      <button role="menuitem" onClick={() => activate('Review', 'Draw')}><FileText size={16} /><span><strong>Draw</strong><small>Draw directly on the page</small></span></button>
      <button role="menuitem" onClick={() => activate('Review', 'Redact')}><ScanLine size={16} /><span><strong>Redact</strong><small>Mark sensitive content</small></span></button>
      {contextMenu.hasSelection && <>
        <div className="forge-context-separator" />
        <button role="menuitem" onClick={() => { document.querySelector<HTMLButtonElement>('.forge-inspector-toggle')?.click(); setContextMenu(null) }}><Settings2 size={16} /><span><strong>Properties</strong><small>Open selection controls</small></span></button>
      </>}
    </div>
  ) : null
}
