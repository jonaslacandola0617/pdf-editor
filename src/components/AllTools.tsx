import { useEffect, useMemo, useState } from 'react'
import {
  Bookmark, Copy, Download, FileInput, Files, FormInput, Highlighter, Info, Library, Menu,
  MousePointer2, PanelLeft, PenLine, RotateCcw, RotateCw, Save, ScanLine, Search, Shapes,
  SlidersHorizontal, Split, StickyNote, Trash2, Type, Upload, WandSparkles, X,
} from 'lucide-react'

type ToolAction = {
  label: string
  description: string
  icon: React.ComponentType<{ size?: number }>
  run: () => void
}

type ToolSection = {
  id: 'edit' | 'pages' | 'document' | 'file'
  title: string
  subtitle: string
  actions: ToolAction[]
}

type MobileSheet = 'left' | 'right' | null

function findButtonByTitle(title: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[title]'))
    .find((button) => button.title === title)
}

function findButtonByText(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.app-shell button'))
    .find((button) => button.textContent?.trim() === label)
}

function labelButton(button: HTMLButtonElement | undefined, label: string) {
  if (!button) return
  if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', button.title || label)
  if (!button.title) button.title = label
}

export function AllTools() {
  const [editorVisible, setEditorVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<ToolSection['id']>('edit')
  const [query, setQuery] = useState('')
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 760)
  const [mobileSheet, setMobileSheet] = useState<MobileSheet>(null)

  useEffect(() => {
    const sync = () => {
      const visible = Boolean(document.querySelector('.app-shell'))
      setEditorVisible(visible)
      if (!visible) {
        setOpen(false)
        setMobileSheet(null)
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const update = () => {
      const next = window.innerWidth <= 760
      setMobile(next)
      if (!next) setMobileSheet(null)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('mobile-left-open', mobile && mobileSheet === 'left')
    document.body.classList.toggle('mobile-right-open', mobile && mobileSheet === 'right')
    return () => {
      document.body.classList.remove('mobile-left-open', 'mobile-right-open')
    }
  }, [mobile, mobileSheet])

  useEffect(() => {
    if (!mobile || !editorVisible) return
    const revealPanel = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.rail button')) setMobileSheet('left')
    }
    document.addEventListener('click', revealPanel, true)
    return () => document.removeEventListener('click', revealPanel, true)
  }, [editorVisible, mobile])

  useEffect(() => {
    if (!editorVisible) return
    const applyAccessibleNames = () => {
      const nav = Array.from(document.querySelectorAll<HTMLButtonElement>('.floating-nav > button'))
      const navLabels = ['Previous page', 'Next page', 'Fit page', 'Fit width', 'Zoom out', 'Zoom in']
      nav.forEach((button, index) => labelButton(button, navLabels[index] || 'Document navigation'))

      const searchButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.search-box button'))
      labelButton(searchButtons[0], 'Previous search result')
      labelButton(searchButtons[1], 'Next search result')

      const quick = Array.from(document.querySelectorAll<HTMLButtonElement>('.quick-actions button'))
      labelButton(quick[0], 'Move page up')
      labelButton(quick[1], 'Move page down')

      const stepper = Array.from(document.querySelectorAll<HTMLButtonElement>('.stepper button'))
      labelButton(stepper[0], 'Decrease font size')
      labelButton(stepper[stepper.length - 1], 'Increase font size')

      labelButton(document.querySelector<HTMLButtonElement>('.right-panel .panel-heading .icon-btn.danger') || undefined, 'Delete selected annotation')
      labelButton(document.querySelector<HTMLButtonElement>('.advanced-modal > header .icon-btn') || undefined, 'Close document tools')
      document.querySelector<HTMLInputElement>('.custom-color input')?.setAttribute('aria-label', 'Custom color')
    }

    applyAccessibleNames()
    const observer = new MutationObserver(applyAccessibleNames)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [editorVisible])

  useEffect(() => {
    if (!editorVisible) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (open) {
        setOpen(false)
        setQuery('')
        return
      }
      if (mobileSheet) {
        setMobileSheet(null)
        return
      }
      const objectClose = document.querySelector<HTMLButtonElement>('.native-object-modal [title="Close embedded objects"]')
      if (objectClose) {
        objectClose.click()
        return
      }
      const advancedClose = document.querySelector<HTMLButtonElement>('.advanced-modal > header .icon-btn')
      if (advancedClose) {
        advancedClose.click()
        return
      }
      const modal = document.querySelector<HTMLElement>('.modal-backdrop > .modal')
      const backdrop = modal?.parentElement
      if (backdrop) backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [editorVisible, mobileSheet, open])

  if (!editorVisible) return null

  const closeTools = () => {
    setOpen(false)
    setQuery('')
  }

  const activateTitle = (title: string) => {
    findButtonByTitle(title)?.click()
    closeTools()
  }

  const activateText = (label: string) => {
    findButtonByText(label)?.click()
    closeTools()
  }

  const openFiles = () => {
    document.querySelector<HTMLInputElement>('.app-shell input[type="file"]')?.click()
    closeTools()
  }

  const focusSearch = () => {
    closeTools()
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Find in document"]')
      input?.focus()
      input?.select()
    }, 40)
  }

  const sections: ToolSection[] = [
    {
      id: 'edit',
      title: 'Edit & annotate',
      subtitle: 'Everyday text, markup, comments and signing.',
      actions: [
        { label: 'Select', description: 'Select, move and resize annotations.', icon: MousePointer2, run: () => activateTitle('Select') },
        { label: 'Edit existing text', description: 'Change text already embedded in the PDF.', icon: PenLine, run: () => activateTitle('Edit existing text') },
        { label: 'Add text', description: 'Place a new editable text annotation.', icon: Type, run: () => activateTitle('Add text') },
        { label: 'Sticky note', description: 'Add a standard PDF comment.', icon: StickyNote, run: () => activateTitle('Sticky note') },
        { label: 'Highlight', description: 'Mark an area with color.', icon: Highlighter, run: () => activateTitle('Highlight') },
        { label: 'Rectangle', description: 'Draw an outlined box.', icon: Shapes, run: () => activateTitle('Rectangle') },
        { label: 'Redact', description: 'Mark sensitive content for destructive redaction.', icon: ScanLine, run: () => activateTitle('Redact') },
        { label: 'Draw', description: 'Add freehand ink.', icon: PenLine, run: () => activateTitle('Draw') },
        { label: 'Signature', description: 'Draw a handwritten signature.', icon: PenLine, run: () => activateTitle('Signature') },
      ],
    },
    {
      id: 'pages',
      title: 'Organize pages',
      subtitle: 'Rearrange, combine, extract and build the document.',
      actions: [
        { label: 'Pages', description: 'Open thumbnails and reorder pages.', icon: Files, run: () => activateTitle('Pages') },
        { label: 'Rotate left', description: 'Rotate the current page left.', icon: RotateCcw, run: () => activateTitle('Rotate left') },
        { label: 'Rotate right', description: 'Rotate the current page right.', icon: RotateCw, run: () => activateTitle('Rotate right') },
        { label: 'Duplicate', description: 'Copy the current page.', icon: Copy, run: () => activateText('Duplicate') },
        { label: 'Delete page', description: 'Remove the current page.', icon: Trash2, run: () => activateText('Delete') },
        { label: 'Merge files', description: 'Append PDFs or images.', icon: FileInput, run: () => activateText('Merge') },
        { label: 'Extract pages', description: 'Save selected pages as a PDF.', icon: Split, run: () => activateText('Extract') },
        { label: 'More page tools', description: 'Insert, replace, crop and add images.', icon: WandSparkles, run: () => activateTitle('Document tools') },
      ],
    },
    {
      id: 'document',
      title: 'Document & security',
      subtitle: 'Permanent PDF operations and structure tools.',
      actions: [
        { label: 'Document tools', description: 'Watermarks, page numbers, OCR, optimize, protect and print.', icon: WandSparkles, run: () => activateTitle('Document tools') },
        { label: 'PDF objects', description: 'Comments, links, bookmarks, forms, attachments and native annotations.', icon: Shapes, run: () => activateTitle('Embedded PDF objects') },
        { label: 'Create PDF widgets', description: 'Author interactive form widgets.', icon: FormInput, run: () => activateTitle('Document tools') },
        { label: 'Add links & bookmarks', description: 'Create native links and outline bookmarks.', icon: FileInput, run: () => activateTitle('Document tools') },
        { label: 'Bates numbering', description: 'Apply document-control identifiers.', icon: Type, run: () => activateTitle('Document tools') },
        { label: 'Privacy cleanup', description: 'Remove metadata and unsafe active content.', icon: Info, run: () => activateTitle('Document tools') },
        { label: 'Bookmarks & favorites', description: 'Navigate the outline and favorite local PDFs.', icon: Bookmark, run: () => activateTitle('Bookmarks & favorites') },
        { label: 'Search / OCR', description: 'Find text; scanned pages use local OCR.', icon: Search, run: focusSearch },
        { label: 'Form fields', description: 'Fill detected AcroForm fields.', icon: FormInput, run: () => activateTitle('Form fields') },
        { label: 'Document info', description: 'Edit title, author and keywords.', icon: Info, run: () => activateTitle('Document info') },
      ],
    },
    {
      id: 'file',
      title: 'File',
      subtitle: 'Open, keep, export and finish documents.',
      actions: [
        { label: 'Open files', description: 'Open PDF, PNG, or JPG files.', icon: Upload, run: openFiles },
        { label: 'Local library', description: 'View PDFs stored in this browser.', icon: Library, run: () => activateTitle('Library') },
        { label: 'Save locally', description: 'Save editor state to IndexedDB.', icon: Save, run: () => activateText('Save') },
        { label: 'Export PDF', description: 'Download the finished PDF.', icon: Download, run: () => activateText('Export PDF') },
      ],
    },
  ]

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return sections.find((section) => section.id === activeSection)?.actions || []
    return sections.flatMap((section) => section.actions).filter((action) =>
      `${action.label} ${action.description}`.toLocaleLowerCase().includes(needle),
    )
  }, [activeSection, query])

  const currentSection = sections.find((section) => section.id === activeSection) || sections[0]

  return (
    <>
      {!mobile && <button className={`all-tools-launcher ${open ? 'active' : ''}`} type="button" title="All Tools" aria-label="All Tools" aria-expanded={open} onClick={() => { setMobileSheet(null); setOpen((value) => !value) }}>
        <Menu size={18} /><span>Tools</span>
      </button>}

      {mobile && <nav className="mobile-workspace-bar" aria-label="Mobile workspace controls">
        <button title="Panels" onClick={() => { setOpen(false); setMobileSheet((value) => value === 'left' ? null : 'left') }}><PanelLeft /><span>Panels</span></button>
        <button title="Properties" onClick={() => { setOpen(false); setMobileSheet((value) => value === 'right' ? null : 'right') }}><SlidersHorizontal /><span>Properties</span></button>
        <button title="All Tools" aria-label="All Tools" aria-expanded={open} onClick={() => { setMobileSheet(null); setOpen((value) => !value) }}><Menu /><span>Tools</span></button>
      </nav>}

      {mobileSheet && <>
        <button className="mobile-sheet-backdrop" aria-label="Close workspace panel" onClick={() => setMobileSheet(null)} />
        <button className="mobile-sheet-close" title="Close workspace panel" onClick={() => setMobileSheet(null)}><X /></button>
      </>}

      {open && (
        <div className="all-tools-layer" role="presentation">
          <button className="all-tools-backdrop" aria-label="Close All Tools" onClick={closeTools} />
          <aside className="all-tools-drawer" aria-label="All Tools">
            <header className="all-tools-header">
              <div className="all-tools-heading"><span className="all-tools-eyebrow">PDF FORGE</span><h2>All Tools</h2><p>Find an action without crowding the editor.</p></div>
              <button className="all-tools-close" type="button" title="Close All Tools" onClick={closeTools}><X size={18} /></button>
            </header>

            <div className="all-tools-search">
              <Search size={16} />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools" aria-label="Search All Tools" />
              {query && <button aria-label="Clear tool search" onClick={() => setQuery('')}><X size={14} /></button>}
            </div>

            <nav className="all-tools-categories" aria-label="Tool categories">
              {sections.map((section) => <button key={section.id} className={activeSection === section.id && !query ? 'active' : ''} onClick={() => { setActiveSection(section.id); setQuery('') }}>
                {section.title}
              </button>)}
            </nav>

            <div className="all-tools-content">
              <section className="all-tools-section">
                <div className="all-tools-section-title">
                  <h3>{query ? `Search results${filtered.length ? ` · ${filtered.length}` : ''}` : currentSection.title}</h3>
                  <p>{query ? `Matches for “${query}”` : currentSection.subtitle}</p>
                </div>
                <div className="all-tools-grid">
                  {filtered.map((action) => {
                    const Icon = action.icon
                    return <button className="all-tools-action" type="button" key={`${action.label}-${action.description}`} onClick={action.run}>
                      <span className="all-tools-action-icon"><Icon size={18} /></span>
                      <span><strong>{action.label}</strong><small>{action.description}</small></span>
                    </button>
                  })}
                  {!filtered.length && <div className="all-tools-empty"><Search /><strong>No matching tools</strong><span>Try a different action or category.</span></div>}
                </div>
              </section>
            </div>

            <footer className="all-tools-footer"><span className="all-tools-local-dot" />PDFs, OCR and security tools stay on this device.</footer>
          </aside>
        </div>
      )}
    </>
  )
}
