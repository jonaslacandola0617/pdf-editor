import { useEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  Clipboard,
  Copy,
  FileText,
  Highlighter,
  MessageSquareText,
  MousePointer2,
  PenLine,
  Redo2,
  ScanLine,
  Scissors,
  Settings2,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import '../context-action-menu.css'

const THEME_KEY = 'pdf-forge-theme'
const VIEW_KEY = 'pdf-forge-view-mode'
const ANNOTATION_ACTION_EVENT = 'pdf-forge:annotation-action'

// Dark is the default for first-time visitors. Existing users keep their explicit choice.
if (typeof window !== 'undefined' && localStorage.getItem(THEME_KEY) === null) {
  localStorage.setItem(THEME_KEY, 'dark')
  document.documentElement.dataset.theme = 'dark'
}

type AnnotationAction = 'copy' | 'cut' | 'paste' | 'duplicate' | 'delete' | 'properties'

type ContextMenuState = {
  x: number
  y: number
  pageIndex: number
  annotationId?: string
  hasSelection: boolean
  canPaste: boolean
  flyoutLeft: boolean
} | null

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

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function currentPageIndex() {
  const value = Number(document.querySelector<HTMLInputElement>('.floating-nav input')?.value)
  return Number.isFinite(value) && value > 0 ? value - 1 : 0
}

function selectedAnnotationId() {
  return document.querySelector<HTMLElement>('.annotation.selected[data-annotation-id]')?.dataset.annotationId
}

function dispatchAnnotationAction(action: AnnotationAction, pageIndex: number, annotationId?: string) {
  window.dispatchEvent(new CustomEvent(ANNOTATION_ACTION_EVENT, { detail: { action, pageIndex, annotationId } }))
}

function dispatchEditorShortcut(key: string, options: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.ctrlKey ?? false,
    shiftKey: options.shiftKey ?? false,
  }))
}

export function WorkbenchInteractions() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const wheelAccumulator = useRef(0)
  const lastPageTurn = useRef(0)
  const lastZoom = useRef(0)
  const scrollTimer = useRef(0)
  const programmaticPageUntil = useRef(0)
  const scrollSyncDispatching = useRef(false)

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
      if (!(event.target instanceof Element) || !event.target.closest('.forge-context-menu')) {
        setContextMenu(null)
        setToolsOpen(false)
      }
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
        setToolsOpen(false)
      }
    }
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [])

  useEffect(() => {
    const markProgrammaticPageNavigation = () => {
      programmaticPageUntil.current = performance.now() + 750
      window.clearTimeout(scrollTimer.current)
    }

    const onNavClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.floating-nav')) return
      if (target.closest('button, input')) markProgrammaticPageNavigation()
    }

    const onNavInput = (event: Event) => {
      if (scrollSyncDispatching.current) return
      const target = event.target as Element | null
      if (target?.matches('.floating-nav input')) markProgrammaticPageNavigation()
    }

    const onPageKey = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return
      if (['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'].includes(event.key)) markProgrammaticPageNavigation()
    }

    const onClipboardShortcut = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target) || !(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (!['c', 'x', 'v', 'd'].includes(key)) return

      const annotationId = selectedAnnotationId()
      const pageIndex = currentPageIndex()
      const canPaste = document.documentElement.dataset.forgeAnnotationClipboard === '1'
      if (key === 'c' && annotationId) {
        event.preventDefault()
        dispatchAnnotationAction('copy', pageIndex, annotationId)
      }
      if (key === 'x' && annotationId) {
        event.preventDefault()
        dispatchAnnotationAction('cut', pageIndex, annotationId)
      }
      if (key === 'd' && annotationId) {
        event.preventDefault()
        dispatchAnnotationAction('duplicate', pageIndex, annotationId)
      }
      if (key === 'v' && canPaste) {
        event.preventDefault()
        dispatchAnnotationAction('paste', pageIndex)
      }
    }

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.pdf-page')) return
      event.preventDefault()

      const pageView = target.closest<HTMLElement>('.page-view[data-page]')
      const pageValue = Number(pageView?.dataset.page)
      const pageIndex = Number.isFinite(pageValue) ? pageValue : currentPageIndex()
      const clickedAnnotation = target.closest<HTMLElement>('.annotation[data-annotation-id]')
      const selectedId = clickedAnnotation?.dataset.annotationId || selectedAnnotationId()
      const menuWidth = 256
      const submenuWidth = 238
      const gap = 8
      const flyoutLeft = event.clientX + menuWidth + gap + submenuWidth > window.innerWidth - 10

      setToolsOpen(false)
      setContextMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 392)),
        pageIndex,
        annotationId: selectedId,
        hasSelection: Boolean(selectedId),
        canPaste: document.documentElement.dataset.forgeAnnotationClipboard === '1',
        flyoutLeft,
      })
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
      markProgrammaticPageNavigation()
      const buttons = directNavButtons()
      const pageButton = direction > 0 ? buttons[1] : buttons[0]
      if (pageButton && !pageButton.disabled) pageButton.click()
    }

    // Keep the page indicator/current-page state in sync while the user scrolls
    // through Continuous view. Programmatic page jumps get a short lock so their
    // own smooth scroll cannot immediately overwrite the requested destination.
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target?.matches('.page-scroll.view-continuous')) return
      if (performance.now() < programmaticPageUntil.current) return
      window.clearTimeout(scrollTimer.current)
      scrollTimer.current = window.setTimeout(() => {
        if (performance.now() < programmaticPageUntil.current) return
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
        if (input && Number(input.value) !== closest.page + 1) {
          scrollSyncDispatching.current = true
          setReactPageInput(input, String(closest.page + 1))
          queueMicrotask(() => { scrollSyncDispatching.current = false })
        }
      }, 90)
    }

    document.addEventListener('click', onNavClick, true)
    document.addEventListener('input', onNavInput, true)
    window.addEventListener('keydown', onPageKey, true)
    window.addEventListener('keydown', onClipboardShortcut, true)
    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('wheel', onWheel, { passive: false, capture: true })
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.clearTimeout(scrollTimer.current)
      document.removeEventListener('click', onNavClick, true)
      document.removeEventListener('input', onNavInput, true)
      window.removeEventListener('keydown', onPageKey, true)
      window.removeEventListener('keydown', onClipboardShortcut, true)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('wheel', onWheel, true)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  const activate = (workflow: 'Edit' | 'Review' | 'Sign', ...titles: string[]) => {
    clickWorkflow(workflow)
    window.setTimeout(() => clickTool(...titles), 0)
    setContextMenu(null)
    setToolsOpen(false)
  }

  const runAnnotationAction = (action: AnnotationAction) => {
    if (!contextMenu) return
    dispatchAnnotationAction(action, contextMenu.pageIndex, contextMenu.annotationId)
    setContextMenu(null)
    setToolsOpen(false)
  }

  const runShortcut = (key: string, options: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
    dispatchEditorShortcut(key, options)
    setContextMenu(null)
    setToolsOpen(false)
  }

  if (!contextMenu) return null

  return (
    <div
      className={`forge-context-menu ${contextMenu.flyoutLeft ? 'flyout-left' : ''}`}
      role="menu"
      aria-label="PDF actions"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      <div
        className={`forge-context-submenu-host ${toolsOpen ? 'open' : ''}`}
        onMouseEnter={() => setToolsOpen(true)}
        onMouseLeave={() => setToolsOpen(false)}
      >
        <button
          className="forge-context-action has-submenu"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={toolsOpen}
          onClick={() => setToolsOpen((open) => !open)}
        >
          <Settings2 size={16} />
          <span>Tools</span>
          <ChevronRight className="forge-context-chevron" size={15} />
        </button>

        {toolsOpen && (
          <div className="forge-context-submenu" role="menu" aria-label="PDF tools">
            <div className="forge-context-submenu-title">TOOLS</div>
            <button role="menuitem" onClick={() => activate('Edit', 'Select')}><MousePointer2 size={16} /><span>Select</span></button>
            <button role="menuitem" onClick={() => activate('Edit', 'Edit existing text')}><PenLine size={16} /><span>Edit text</span></button>
            <button role="menuitem" onClick={() => activate('Edit', 'Add text')}><Type size={16} /><span>Add text</span></button>
            <div className="forge-context-separator" />
            <button role="menuitem" onClick={() => activate('Review', 'Sticky note')}><MessageSquareText size={16} /><span>Comment</span></button>
            <button role="menuitem" onClick={() => activate('Review', 'Highlight')}><Highlighter size={16} /><span>Highlight</span></button>
            <button role="menuitem" onClick={() => activate('Review', 'Draw')}><FileText size={16} /><span>Draw</span></button>
            <button role="menuitem" onClick={() => activate('Review', 'Redact')}><ScanLine size={16} /><span>Redact</span></button>
            <div className="forge-context-separator" />
            <button role="menuitem" onClick={() => activate('Sign', 'Signature')}><PenLine size={16} /><span>Signature</span></button>
          </div>
        )}
      </div>

      <div className="forge-context-separator" />

      <button className="forge-context-action" role="menuitem" disabled={!contextMenu.hasSelection} onClick={() => runAnnotationAction('cut')}>
        <Scissors size={16} /><span>Cut</span><kbd>Ctrl+X</kbd>
      </button>
      <button className="forge-context-action" role="menuitem" disabled={!contextMenu.hasSelection} onClick={() => runAnnotationAction('copy')}>
        <Copy size={16} /><span>Copy</span><kbd>Ctrl+C</kbd>
      </button>
      <button className="forge-context-action" role="menuitem" disabled={!contextMenu.canPaste} onClick={() => runAnnotationAction('paste')}>
        <Clipboard size={16} /><span>Paste</span><kbd>Ctrl+V</kbd>
      </button>
      <button className="forge-context-action" role="menuitem" disabled={!contextMenu.hasSelection} onClick={() => runAnnotationAction('duplicate')}>
        <Copy size={16} /><span>Duplicate</span><kbd>Ctrl+D</kbd>
      </button>

      <div className="forge-context-separator" />

      <button className="forge-context-action" role="menuitem" onClick={() => runShortcut('z', { ctrlKey: true })}>
        <Undo2 size={16} /><span>Undo</span><kbd>Ctrl+Z</kbd>
      </button>
      <button className="forge-context-action" role="menuitem" onClick={() => runShortcut('z', { ctrlKey: true, shiftKey: true })}>
        <Redo2 size={16} /><span>Redo</span><kbd>Ctrl+Shift+Z</kbd>
      </button>

      {contextMenu.hasSelection && (
        <>
          <div className="forge-context-separator" />
          <button className="forge-context-action" role="menuitem" onClick={() => runAnnotationAction('properties')}>
            <Settings2 size={16} /><span>Properties</span>
          </button>
          <button className="forge-context-action danger" role="menuitem" onClick={() => runAnnotationAction('delete')}>
            <Trash2 size={16} /><span>Delete</span><kbd>Del</kbd>
          </button>
        </>
      )}
    </div>
  )
}
