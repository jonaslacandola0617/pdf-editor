import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  Bookmark,
  Check,
  ChevronRight,
  Download,
  FileInput,
  Files,
  FormInput,
  Highlighter,
  Library,
  Menu,
  PenLine,
  ScanLine,
  Search,
  Shapes,
  Split,
  Star,
  StickyNote,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { deleteDocument, listDocuments, saveDocument } from '../lib/storage'
import { fileSize } from '../lib/pdf'
import type { LibraryDocument } from '../types'

type ProductView = 'home' | 'documents' | 'tools'
type EditorMode = 'edit' | 'annotate' | 'sign' | 'organize'
type ToolIntent = 'edit' | 'merge' | 'optimize' | 'redact' | 'sign' | 'organize' | 'protect' | null

type ToolDefinition = {
  name: string
  description: string
  group: 'Edit' | 'Organize' | 'Optimize' | 'Protect' | 'Forms & Signatures'
  icon: React.ComponentType<{ size?: number }>
  intent: Exclude<ToolIntent, null>
}

const FAVORITES_KEY = 'pdf-forge-favorites'

const toolDefinitions: ToolDefinition[] = [
  { name: 'Edit PDF', description: 'Modify existing text and add new document content directly on the page.', group: 'Edit', icon: PenLine, intent: 'edit' },
  { name: 'Merge PDFs', description: 'Combine multiple documents into one professionally ordered PDF.', group: 'Organize', icon: FileInput, intent: 'merge' },
  { name: 'Organize Pages', description: 'Reorder, rotate, duplicate, extract, and remove pages visually.', group: 'Organize', icon: Files, intent: 'organize' },
  { name: 'Compress & Optimize', description: 'Reduce document overhead and image weight while preserving useful quality.', group: 'Optimize', icon: Archive, intent: 'optimize' },
  { name: 'Redact Content', description: 'Permanently remove sensitive visual content before the document is shared.', group: 'Protect', icon: ScanLine, intent: 'redact' },
  { name: 'Protect PDF', description: 'Apply password protection and document security controls.', group: 'Protect', icon: Bookmark, intent: 'protect' },
  { name: 'Fill & Sign', description: 'Complete form fields and place a reusable signature into the document.', group: 'Forms & Signatures', icon: FormInput, intent: 'sign' },
]

function readFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function findButtonByTitle(title: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.app-shell button[title]'))
    .find((button) => button.title === title)
}

function findButtonByText(text: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.app-shell button'))
    .find((button) => button.textContent?.trim() === text)
}

function openFilePicker() {
  const input = document.querySelector<HTMLInputElement>('.welcome input[type="file"], .app-shell input[type="file"]')
  input?.click()
}

function openStoredDocument(name: string) {
  const recent = Array.from(document.querySelectorAll<HTMLButtonElement>('.recent-row'))
    .find((button) => button.textContent?.includes(name))
  if (recent) {
    recent.click()
    return true
  }
  return false
}

function activateEditorMode(mode: EditorMode) {
  document.body.dataset.pdfMode = mode
  if (mode === 'organize') {
    findButtonByTitle('Pages')?.click()
  }
}

function runEditorIntent(intent: Exclude<ToolIntent, null>) {
  switch (intent) {
    case 'edit':
      activateEditorMode('edit')
      findButtonByTitle('Edit existing text')?.click()
      break
    case 'merge':
      findButtonByText('Merge')?.click()
      break
    case 'optimize':
      findButtonByTitle('Document tools')?.click()
      break
    case 'redact':
      activateEditorMode('annotate')
      findButtonByTitle('Redact')?.click()
      break
    case 'sign':
      activateEditorMode('sign')
      findButtonByTitle('Signature')?.click()
      break
    case 'organize':
      activateEditorMode('organize')
      break
    case 'protect':
      findButtonByTitle('Document tools')?.click()
      break
  }
}

function formatUpdatedAt(value: number) {
  const elapsed = Math.max(0, Date.now() - value)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Edited just now'
  if (minutes < 60) return `Edited ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Edited ${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `Edited ${days} day${days === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: value < Date.now() - 31_536_000_000 ? 'numeric' : undefined }).format(value)
}

function ProductBrand() {
  return <div className="product-brand"><span>PF</span><strong>PDF Forge</strong></div>
}

export function ProductExperience() {
  const [welcomeHost, setWelcomeHost] = useState<HTMLElement | null>(null)
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null)
  const [editorVisible, setEditorVisible] = useState(false)
  const [view, setView] = useState<ProductView>('home')
  const [mode, setMode] = useState<EditorMode>('edit')
  const [documents, setDocuments] = useState<LibraryDocument[]>([])
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites())
  const [documentQuery, setDocumentQuery] = useState('')
  const [documentFilter, setDocumentFilter] = useState<'all' | 'recent' | 'favorites'>('all')
  const [menuDocumentId, setMenuDocumentId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const pendingIntent = useRef<ToolIntent>(null)

  const refreshDocuments = async () => setDocuments(await listDocuments())

  useEffect(() => {
    const sync = () => {
      const welcome = document.querySelector<HTMLElement>('.welcome')
      const shell = document.querySelector<HTMLElement>('.app-shell')
      const topbar = document.querySelector<HTMLElement>('.topbar')
      setWelcomeHost(welcome)
      setEditorVisible(Boolean(shell))
      setTopbarHost(topbar)
      document.body.classList.toggle('pdf-product-home', Boolean(welcome))
      document.body.classList.toggle('pdf-product-editor', Boolean(shell))
      if (shell && !document.body.dataset.pdfMode) document.body.dataset.pdfMode = 'edit'
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      document.body.classList.remove('pdf-product-home', 'pdf-product-editor')
      delete document.body.dataset.pdfMode
    }
  }, [])

  useEffect(() => {
    if (!welcomeHost) return
    void refreshDocuments()
  }, [welcomeHost])

  useEffect(() => {
    if (!editorVisible || !pendingIntent.current) return
    const intent = pendingIntent.current
    pendingIntent.current = null
    window.setTimeout(() => runEditorIntent(intent), 160)
  }, [editorVisible])

  useEffect(() => {
    const observeMode = (event: Event) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest<HTMLButtonElement>('.editor-toolbar button, .rail button')
      if (!button) return
      const title = button.title
      if (['Edit existing text', 'Add text', 'Select'].includes(title)) setMode('edit')
      if (['Sticky note', 'Highlight', 'Rectangle', 'Draw', 'Redact'].includes(title)) setMode('annotate')
      if (['Signature', 'Form fields'].includes(title)) setMode('sign')
      if (title === 'Pages' && document.body.dataset.pdfMode === 'organize') setMode('organize')
    }
    document.addEventListener('click', observeMode, true)
    return () => document.removeEventListener('click', observeMode, true)
  }, [])

  const setEditorMode = (next: EditorMode) => {
    setMode(next)
    activateEditorMode(next)
    if (next === 'edit') findButtonByTitle('Select')?.click()
    if (next === 'annotate') findButtonByTitle('Highlight')?.click()
    if (next === 'sign') findButtonByTitle('Signature')?.click()
  }

  const startIntent = (intent: Exclude<ToolIntent, null>) => {
    if (editorVisible) {
      runEditorIntent(intent)
      return
    }
    pendingIntent.current = intent
    openFilePicker()
  }

  const toggleFavorite = (id: string) => {
    const next = new Set(favorites)
    next.has(id) ? next.delete(id) : next.add(id)
    setFavorites(next)
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
  }

  const duplicateStoredDocument = async (document: LibraryDocument) => {
    await saveDocument({
      ...document,
      id: crypto.randomUUID(),
      name: `${document.name.replace(/\.pdf$/i, '')} copy.pdf`,
      bytes: document.bytes.slice(0),
      updatedAt: Date.now(),
      annotations: document.annotations ? structuredClone(document.annotations) : undefined,
      rotations: document.rotations ? [...document.rotations] : undefined,
      metadata: document.metadata ? { ...document.metadata } : undefined,
    })
    setMenuDocumentId(null)
    await refreshDocuments()
  }

  const renameStoredDocument = async (document: LibraryDocument) => {
    const nextName = window.prompt('Rename document', document.name)
    if (!nextName?.trim() || nextName.trim() === document.name) return
    await saveDocument({ ...document, name: nextName.trim(), updatedAt: Date.now() })
    setMenuDocumentId(null)
    await refreshDocuments()
  }

  const removeStoredDocument = async (document: LibraryDocument) => {
    if (!window.confirm(`Remove ${document.name} from your local library?`)) return
    await deleteDocument(document.id)
    const next = new Set(favorites)
    next.delete(document.id)
    setFavorites(next)
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
    setMenuDocumentId(null)
    await refreshDocuments()
  }

  const filteredDocuments = useMemo(() => {
    const query = documentQuery.trim().toLocaleLowerCase()
    return documents.filter((document, index) => {
      if (documentFilter === 'favorites' && !favorites.has(document.id)) return false
      if (documentFilter === 'recent' && index > 9) return false
      return !query || document.name.toLocaleLowerCase().includes(query)
    })
  }, [documentFilter, documentQuery, documents, favorites])

  const paletteCommands = useMemo(() => [
    { label: 'Edit existing text', hint: 'Edit PDF text directly on the page', shortcut: '', run: () => runEditorIntent('edit') },
    { label: 'Add text', hint: 'Place new text on the current page', shortcut: '', run: () => { activateEditorMode('edit'); findButtonByTitle('Add text')?.click() } },
    { label: 'Highlight', hint: 'Mark document content for review', shortcut: '', run: () => { activateEditorMode('annotate'); findButtonByTitle('Highlight')?.click() } },
    { label: 'Add sticky note', hint: 'Place a PDF comment on the page', shortcut: '', run: () => { activateEditorMode('annotate'); findButtonByTitle('Sticky note')?.click() } },
    { label: 'Add signature', hint: 'Place a saved or drawn signature', shortcut: '', run: () => runEditorIntent('sign') },
    { label: 'Organize pages', hint: 'Reorder, rotate, duplicate, extract, or delete pages', shortcut: '', run: () => runEditorIntent('organize') },
    { label: 'Merge documents', hint: 'Append PDFs or images to this document', shortcut: '', run: () => findButtonByText('Merge')?.click() },
    { label: 'Extract pages', hint: 'Create a new PDF from selected pages', shortcut: '', run: () => findButtonByText('Extract')?.click() },
    { label: 'Document tools', hint: 'Open advanced document, security, OCR, and optimization tools', shortcut: '', run: () => findButtonByTitle('Document tools')?.click() },
    { label: 'Export PDF', hint: 'Download the finished document', shortcut: 'Ctrl S', run: () => findButtonByText('Export PDF')?.click() },
  ], [])

  const filteredCommands = paletteCommands.filter((command) => {
    const query = paletteQuery.trim().toLocaleLowerCase()
    return !query || `${command.label} ${command.hint}`.toLocaleLowerCase().includes(query)
  })

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        setPaletteQuery('')
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f' && editorVisible) {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="Find in document"]')
        if (input) {
          event.preventDefault()
          input.focus()
          input.select()
        }
      }
      if (event.key === 'Escape' && paletteOpen) setPaletteOpen(false)
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [editorVisible, paletteOpen])

  const homePortal = welcomeHost && createPortal(
    <div className="product-home-root">
      <header className="product-home-bar">
        <ProductBrand />
        <nav aria-label="PDF Forge sections">
          <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>Home</button>
          <button className={view === 'documents' ? 'active' : ''} onClick={() => setView('documents')}>Documents</button>
          <button className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')}>Tools</button>
        </nav>
        <button className="product-local-status" type="button" title="Files stay in this browser"><Check size={14} /> Local workspace</button>
      </header>

      <main className="product-home-content">
        {view === 'home' && <>
          <section className="product-home-hero">
            <div className="product-hero-copy">
              <span className="product-kicker">PDF WORKSPACE</span>
              <h1>Your PDF workspace</h1>
              <p>Edit, organize, sign, protect, and finish documents from one beautifully focused workspace.</p>
              <div className="product-hero-actions">
                <button className="product-primary" aria-label="Open PDF or images" onClick={openFilePicker}><Upload size={17} /> Open PDF</button>
                <button className="product-secondary" onClick={() => setView('tools')}><Menu size={17} /> Explore tools</button>
              </div>
            </div>
            <button className="product-drop-zone" onClick={openFilePicker}>
              <span className="product-drop-icon"><Upload size={22} /></span>
              <strong>Drop a PDF here to start working</strong>
              <small>Or choose a PDF, PNG, or JPG from your computer.</small>
            </button>
          </section>

          <section className="product-section">
            <div className="product-section-heading">
              <div><span className="product-kicker">CONTINUE WORKING</span><h2>{documents.length ? 'Recent documents' : 'Your documents'}</h2></div>
              {documents.length > 3 && <button onClick={() => setView('documents')}>View all <ChevronRight size={14} /></button>}
            </div>
            {documents.length ? <div className="product-recent-grid">
              {documents.slice(0, 4).map((document) => <button key={document.id} className="product-document-card" onClick={() => openStoredDocument(document.name)}>
                <span className="product-pdf-sheet"><span>PDF</span></span>
                <span className="product-document-copy"><strong>{document.name}</strong><small>{document.pageCount} pages · {fileSize(document.size)}</small><small>{formatUpdatedAt(document.updatedAt)}</small></span>
                <ChevronRight size={16} />
              </button>)}
            </div> : <div className="product-empty-state">
              <Files size={26} />
              <div><strong>No documents yet</strong><p>Open your first PDF and it will appear here for quick access later.</p></div>
              <button onClick={openFilePicker}>Open PDF</button>
            </div>}
          </section>

          <section className="product-section product-quick-tools">
            <div className="product-section-heading"><div><span className="product-kicker">QUICK TOOLS</span><h2>Finish common PDF work faster</h2></div><button onClick={() => setView('tools')}>View all tools <ChevronRight size={14} /></button></div>
            <div className="product-tool-strip">
              {toolDefinitions.slice(0, 5).map((item) => {
                const Icon = item.icon
                return <button key={item.name} onClick={() => startIntent(item.intent)}><Icon size={18} /><span><strong>{item.name}</strong><small>{item.description}</small></span><ChevronRight size={14} /></button>
              })}
            </div>
          </section>
        </>}

        {view === 'documents' && <section className="product-library-view">
          <div className="product-page-heading"><div><span className="product-kicker">LOCAL LIBRARY</span><h1>Documents</h1><p>Everything you have opened or edited in PDF Forge stays organized on this device.</p></div><button className="product-primary" onClick={openFilePicker}><Upload size={16} /> Open PDF</button></div>
          <div className="product-library-toolbar">
            <div className="product-search"><Search size={16} /><input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="Search documents" /></div>
            <div className="product-filter-tabs">
              <button className={documentFilter === 'all' ? 'active' : ''} onClick={() => setDocumentFilter('all')}>All</button>
              <button className={documentFilter === 'recent' ? 'active' : ''} onClick={() => setDocumentFilter('recent')}>Recent</button>
              <button className={documentFilter === 'favorites' ? 'active' : ''} onClick={() => setDocumentFilter('favorites')}>Favorites</button>
            </div>
          </div>
          {filteredDocuments.length ? <div className="product-document-list">
            {filteredDocuments.map((document) => <div className="product-document-row" key={document.id}>
              <button className="product-document-open" onClick={() => openStoredDocument(document.name)}>
                <span className="product-pdf-sheet compact"><span>PDF</span></span>
                <span><strong>{document.name}</strong><small>{document.pageCount} pages · {fileSize(document.size)} · {formatUpdatedAt(document.updatedAt)}</small></span>
              </button>
              <button className={`product-icon-button ${favorites.has(document.id) ? 'active' : ''}`} aria-label={favorites.has(document.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(document.id)}><Star size={16} fill={favorites.has(document.id) ? 'currentColor' : 'none'} /></button>
              <div className="product-row-menu-wrap">
                <button className="product-icon-button" aria-label={`More actions for ${document.name}`} onClick={() => setMenuDocumentId((id) => id === document.id ? null : document.id)}>•••</button>
                {menuDocumentId === document.id && <div className="product-row-menu">
                  <button onClick={() => openStoredDocument(document.name)}>Open document</button>
                  <button onClick={() => void renameStoredDocument(document)}>Rename</button>
                  <button onClick={() => void duplicateStoredDocument(document)}>Duplicate</button>
                  <button className="danger" onClick={() => void removeStoredDocument(document)}><Trash2 size={14} /> Remove from library</button>
                </div>}
              </div>
            </div>)}
          </div> : <div className="product-empty-state large"><Search size={28} /><div><strong>{documents.length ? 'No matching documents' : 'No documents yet'}</strong><p>{documents.length ? 'Try adjusting your search or changing the current filter.' : 'Open your first PDF and it will appear here for quick access later.'}</p></div>{documents.length ? <button onClick={() => { setDocumentQuery(''); setDocumentFilter('all') }}>Clear filters</button> : <button onClick={openFilePicker}>Open PDF</button>}</div>}
        </section>}

        {view === 'tools' && <section className="product-tools-view">
          <div className="product-page-heading"><div><span className="product-kicker">TOOL LIBRARY</span><h1>Tools</h1><p>Professional PDF actions, grouped by what you are trying to accomplish.</p></div></div>
          <div className="product-tool-groups">
            {(['Edit', 'Organize', 'Optimize', 'Protect', 'Forms & Signatures'] as const).map((group) => <section key={group}>
              <h2>{group}</h2>
              <div>{toolDefinitions.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon
                return <button key={item.name} onClick={() => startIntent(item.intent)}><span className="product-tool-icon"><Icon size={18} /></span><span><strong>{item.name}</strong><small>{item.description}</small></span><ChevronRight size={15} /></button>
              })}</div>
            </section>)}
          </div>
          <div className="product-capability-note"><Check size={16} /><span><strong>Only working capabilities are listed.</strong> PDF Forge will not advertise conversions or cloud workflows that the current app does not actually perform.</span></div>
        </section>}
      </main>
    </div>,
    welcomeHost,
  )

  const editorPortal = topbarHost && createPortal(
    <div className="product-editor-modes" role="navigation" aria-label="Editor modes">
      <button className={mode === 'edit' ? 'active' : ''} onClick={() => setEditorMode('edit')}>Edit</button>
      <button className={mode === 'annotate' ? 'active' : ''} onClick={() => setEditorMode('annotate')}>Annotate</button>
      <button className={mode === 'sign' ? 'active' : ''} onClick={() => setEditorMode('sign')}>Fill & Sign</button>
      <button className={mode === 'organize' ? 'active' : ''} onClick={() => setEditorMode('organize')}>Organize</button>
      <button className="product-command-trigger" title="Quick Actions · Ctrl/Cmd + K" onClick={() => { setPaletteOpen(true); setPaletteQuery('') }}><Search size={14} /><span>Quick Actions</span><kbd>⌘K</kbd></button>
    </div>,
    topbarHost,
  )

  const palettePortal = paletteOpen && createPortal(
    <div className="product-command-layer" role="presentation" onMouseDown={() => setPaletteOpen(false)}>
      <section className="product-command-palette" role="dialog" aria-modal="true" aria-label="Quick Actions" onMouseDown={(event) => event.stopPropagation()}>
        <div className="product-command-search"><Search size={18} /><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="What would you like to do?" /><button aria-label="Close Quick Actions" onClick={() => setPaletteOpen(false)}><X size={16} /></button></div>
        <div className="product-command-results">
          {filteredCommands.map((command) => <button key={command.label} onClick={() => { command.run(); setPaletteOpen(false) }}><span><strong>{command.label}</strong><small>{command.hint}</small></span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>)}
          {!filteredCommands.length && <div className="product-command-empty"><Search size={20} /><strong>No matching actions</strong><span>Try a tool name such as “merge”, “signature”, or “export”.</span></div>}
        </div>
        <footer><span>Navigate with search</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </div>,
    document.body,
  )

  return <>{homePortal}{editorPortal}{palettePortal}</>
}
