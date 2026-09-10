import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FileInput,
  Files,
  FormInput,
  Grid2X2,
  Library,
  List,
  Menu,
  Moon,
  MoreHorizontal,
  PenLine,
  Plus,
  ScanLine,
  Search,
  Split,
  Star,
  Sun,
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
type ToolIntent = 'edit' | 'merge' | 'optimize' | 'redact' | 'sign' | 'organize' | 'protect' | 'document' | 'objects' | 'forms' | 'imageToPdf' | null
type DocumentDialog = { type: 'rename' | 'remove'; document: LibraryDocument } | null

type ToolDefinition = {
  name: string
  description: string
  group: 'Edit' | 'Organize' | 'Convert' | 'Optimize' | 'Protect' | 'Forms & Signatures'
  icon: React.ComponentType<{ size?: number }>
  intent: Exclude<ToolIntent, null>
}

const FAVORITES_KEY = 'pdf-forge-favorites'
const THEME_KEY = 'pdf-forge-theme'

const toolDefinitions: ToolDefinition[] = [
  { name: 'Edit PDF', description: 'Modify existing text and add new document content directly on the page.', group: 'Edit', icon: PenLine, intent: 'edit' },
  { name: 'Add Images', description: 'Place a PNG or JPG into the current page with precise sizing.', group: 'Edit', icon: Upload, intent: 'document' },
  { name: 'Watermark, Header & Footer', description: 'Apply professional document furniture and automatic page numbers.', group: 'Edit', icon: Type, intent: 'document' },
  { name: 'Merge PDFs', description: 'Combine multiple documents into one professionally ordered PDF.', group: 'Organize', icon: FileInput, intent: 'merge' },
  { name: 'Organize Pages', description: 'Reorder, rotate, duplicate, extract, and remove pages visually.', group: 'Organize', icon: Files, intent: 'organize' },
  { name: 'Extract Pages', description: 'Create a separate PDF from the pages you choose.', group: 'Organize', icon: Split, intent: 'organize' },
  { name: 'Image to PDF', description: 'Turn PNG and JPG images into a clean, shareable PDF document.', group: 'Convert', icon: FileInput, intent: 'imageToPdf' },
  { name: 'Export Pages as Images', description: 'Render document pages as high-quality local image files.', group: 'Convert', icon: Download, intent: 'objects' },
  { name: 'Compress & Optimize', description: 'Reduce document overhead and image weight while preserving useful quality.', group: 'Optimize', icon: Archive, intent: 'optimize' },
  { name: 'Make PDF Searchable', description: 'Add a local OCR text layer to scanned documents.', group: 'Optimize', icon: Search, intent: 'document' },
  { name: 'Redact Content', description: 'Permanently remove sensitive visual content before the document is shared.', group: 'Protect', icon: ScanLine, intent: 'redact' },
  { name: 'Protect PDF', description: 'Apply password protection and document security controls.', group: 'Protect', icon: Bookmark, intent: 'protect' },
  { name: 'Remove Private Data', description: 'Clear metadata, scripts, embedded files, and unsafe active content.', group: 'Protect', icon: Trash2, intent: 'document' },
  { name: 'Fill & Sign', description: 'Complete form fields and place a reusable signature into the document.', group: 'Forms & Signatures', icon: FormInput, intent: 'sign' },
  { name: 'Create Form Fields', description: 'Add and arrange interactive fields directly on document pages.', group: 'Forms & Signatures', icon: FormInput, intent: 'forms' },
]

const quickTools = ['Edit PDF', 'Organize Pages', 'Merge PDFs', 'Compress & Optimize', 'Fill & Sign', 'Redact Content']

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

function openStoredDocument(id: string) {
  window.dispatchEvent(new CustomEvent('pdf-forge:open-document', { detail: id }))
}

function activateEditorMode(mode: EditorMode) {
  document.body.dataset.pdfMode = mode
  if (mode === 'organize') findButtonByTitle('Pages')?.click()
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
    case 'protect':
    case 'document':
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
    case 'objects':
      findButtonByTitle('Embedded PDF objects')?.click()
      break
    case 'forms':
      activateEditorMode('sign')
      findButtonByTitle('Form fields')?.click()
      break
    case 'imageToPdf':
      openFilePicker()
      break
  }
}

function formatUpdatedAt(value: number) {
  const elapsed = Math.max(0, Date.now() - value)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: value < Date.now() - 31_536_000_000 ? 'numeric' : undefined }).format(value)
}

function ProductBrand() {
  return (
    <div className="forge-brand">
      <span className="forge-brand-seal"><b>F</b><i>PDF</i></span>
      <span className="forge-brand-copy"><strong>PDF Forge</strong><small>Document workshop</small></span>
    </div>
  )
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
  const [documentSort, setDocumentSort] = useState<'updated' | 'name' | 'pages'>('updated')
  const [libraryLayout, setLibraryLayout] = useState<'list' | 'grid'>('list')
  const [menuDocumentId, setMenuDocumentId] = useState<string | null>(null)
  const [documentDialog, setDocumentDialog] = useState<DocumentDialog>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light')
  const pendingIntent = useRef<ToolIntent>(null)

  const refreshDocuments = async () => setDocuments(await listDocuments())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

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
    if (intent === 'imageToPdf') {
      openFilePicker()
      return
    }
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

  const renameStoredDocument = async (document: LibraryDocument, nextName: string) => {
    if (!nextName.trim() || nextName.trim() === document.name) return
    await saveDocument({ ...document, name: nextName.trim(), updatedAt: Date.now() })
    setMenuDocumentId(null)
    setDocumentDialog(null)
    await refreshDocuments()
  }

  const removeStoredDocument = async (document: LibraryDocument) => {
    await deleteDocument(document.id)
    const next = new Set(favorites)
    next.delete(document.id)
    setFavorites(next)
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
    setMenuDocumentId(null)
    setDocumentDialog(null)
    await refreshDocuments()
  }

  const filteredDocuments = useMemo(() => {
    const query = documentQuery.trim().toLocaleLowerCase()
    return documents.filter((document, index) => {
      if (documentFilter === 'favorites' && !favorites.has(document.id)) return false
      if (documentFilter === 'recent' && index > 9) return false
      return !query || document.name.toLocaleLowerCase().includes(query)
    }).sort((a, b) => documentSort === 'name'
      ? a.name.localeCompare(b.name)
      : documentSort === 'pages'
        ? b.pageCount - a.pageCount
        : b.updatedAt - a.updatedAt)
  }, [documentFilter, documentQuery, documentSort, documents, favorites])

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

  const recentDocuments = documents.slice(0, 6)
  const currentLabel = view === 'home' ? 'Workbench' : view === 'documents' ? 'Document archive' : 'Tool index'

  const homePortal = welcomeHost && createPortal(
    <div className={`forge-product-root ${view === 'home' ? 'home-stage' : ''}`}>
      {view !== 'home' && <aside className="forge-mast">
        <ProductBrand />
        <nav className="forge-mast-nav" aria-label="PDF Forge sections">
          <button onClick={() => setView('home')} title="Workbench" aria-label="Workbench">
            <span>01</span><Clock3 size={17} /><em>Workbench</em>
          </button>
          <button className={view === 'documents' ? 'active' : ''} onClick={() => setView('documents')} title="Documents" aria-label="Documents">
            <span>02</span><Library size={17} /><em>Documents</em>
          </button>
          <button className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')} title="Tool index" aria-label="Tools">
            <span>03</span><Menu size={17} /><em>Tools</em>
          </button>
        </nav>
        <div className="forge-mast-foot">
          <span className="forge-local-dot" />
          <div><strong>Local desk</strong><small>Files stay here</small></div>
        </div>
      </aside>}

      <section className="forge-product-surface">
        <header className={`forge-product-bar ${view === 'home' ? 'forge-home-bar' : ''}`}>
          {view === 'home' ? (
            <>
              <ProductBrand />
              <nav className="forge-home-nav" aria-label="PDF Forge">
                <button onClick={() => setView('documents')}><Library size={17} /> Documents</button>
                <button onClick={() => setView('tools')}><Menu size={17} /> All tools</button>
              </nav>
            </>
          ) : (
            <div className="forge-product-context"><span>PDF FORGE /</span><strong>{currentLabel}</strong></div>
          )}
          <div className="forge-product-actions">
            <button className="forge-quiet-action" onClick={() => { setPaletteOpen(true); setPaletteQuery('') }}><Search size={15} /><span>Quick actions</span><kbd>⌘K</kbd></button>
            <button className="forge-theme-switch" type="button" aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} appearance`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </header>

        <main className="forge-product-main">
          {view === 'home' && (
            <section className="forge-workbench-stage">
              <section className="forge-focus-zone" aria-label="Open a document">
                <div className="forge-focus-visual" aria-hidden="true">
                  <span className="forge-paper-back back-two" />
                  <span className="forge-paper-back back-one" />
                  <span className="forge-paper-front"><i>PDF</i><Upload size={30} /></span>
                </div>
                <span className="forge-folio-label">START HERE</span>
                <h1>Open a document</h1>
                <p>Choose a PDF and start working immediately. You can also drop a PDF anywhere on this screen.</p>
                <div className="forge-focus-actions">
                  <button className="forge-main-open" onClick={openFilePicker}><Upload size={19} /> Open PDF</button>
                  <button className="forge-image-build" onClick={openFilePicker}><Plus size={17} /> Create from images</button>
                </div>
                <span className="forge-focus-note"><Check size={14} /> Processed locally on this device</span>
              </section>

              <section className="forge-recent-shelf" aria-label="Recent documents">
                <div className="forge-shelf-heading">
                  <div><span>RECENT</span><h2>Pick up where you left off</h2></div>
                  {documents.length > 5 && <button onClick={() => setView('documents')}>See all documents <ChevronRight size={15} /></button>}
                </div>
                {recentDocuments.length ? (
                  <div className="forge-shelf-track">
                    {recentDocuments.slice(0, 5).map((document) => (
                      <button key={document.id} className="forge-shelf-file" onClick={() => openStoredDocument(document.id)}>
                        <span className="forge-shelf-paper"><i>PDF</i><b>{document.pageCount}</b></span>
                        <span className="forge-shelf-copy">
                          <strong>{document.name}</strong>
                          <small>{fileSize(document.size)} · {formatUpdatedAt(document.updatedAt)}</small>
                        </span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="forge-shelf-empty">
                    <span>No recent files yet.</span>
                    <small>Your recently opened PDFs will appear here automatically.</small>
                  </div>
                )}
              </section>

              <section className="forge-task-dock" aria-label="Start with a task">
                <div className="forge-dock-label">
                  <span>OR START WITH A TASK</span>
                  <small>Choose the result you want.</small>
                </div>
                <div className="forge-dock-actions">
                  {toolDefinitions.filter((tool) => quickTools.includes(tool.name)).map((item) => {
                    const Icon = item.icon
                    return (
                      <button key={item.name} onClick={() => startIntent(item.intent)} title={item.description}>
                        <Icon size={19} />
                        <span>{item.name.replace(' & Optimize', '').replace(' Content', '')}</span>
                      </button>
                    )
                  })}
                  <button className="forge-dock-more" onClick={() => setView('tools')}><Menu size={19} /><span>All tools</span></button>
                </div>
              </section>
            </section>
          )}

          {view === 'documents' && (
            <section className="forge-archive-view">
              <div className="forge-page-title">
                <div><span className="forge-folio-label">DOCUMENT ARCHIVE · 02</span><h1>Every document,<br /><em>within reach.</em></h1><p>Search, sort, favorite, reopen, duplicate, or remove documents kept in this local browser workspace.</p></div>
                <button className="forge-primary-action" onClick={openFilePicker}><Upload size={16} /> Open PDF</button>
              </div>

              <div className="forge-archive-toolbar">
                <div className="forge-search-field"><Search size={16} /><input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="Search document names" /></div>
                <div className="forge-archive-controls">
                  <div className="forge-filter-set" aria-label="Document filters">
                    <button className={documentFilter === 'all' ? 'active' : ''} onClick={() => setDocumentFilter('all')}>All</button>
                    <button className={documentFilter === 'recent' ? 'active' : ''} onClick={() => setDocumentFilter('recent')}>Recent</button>
                    <button className={documentFilter === 'favorites' ? 'active' : ''} onClick={() => setDocumentFilter('favorites')}>Starred</button>
                  </div>
                  <label className="forge-sort">Order<select aria-label="Sort documents" value={documentSort} onChange={(event) => setDocumentSort(event.target.value as typeof documentSort)}><option value="updated">Last worked</option><option value="name">Name</option><option value="pages">Page count</option></select></label>
                  <div className="forge-view-set" aria-label="Document layout">
                    <button aria-label="List view" className={libraryLayout === 'list' ? 'active' : ''} onClick={() => setLibraryLayout('list')}><List size={15} /></button>
                    <button aria-label="Grid view" className={libraryLayout === 'grid' ? 'active' : ''} onClick={() => setLibraryLayout('grid')}><Grid2X2 size={15} /></button>
                  </div>
                </div>
              </div>

              {filteredDocuments.length ? (
                <div className={`forge-document-archive ${libraryLayout}`}>
                  {libraryLayout === 'list' && <div className="forge-archive-head"><span>Document</span><span>Pages</span><span>Size</span><span>Last worked</span><span /></div>}
                  {filteredDocuments.map((document, index) => (
                    <article className="forge-archive-item" key={document.id}>
                      <button className="forge-archive-open" onClick={() => openStoredDocument(document.id)}>
                        <span className="forge-archive-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="forge-pdf-sheet"><i>PDF</i><b>{document.pageCount}</b></span>
                        <span className="forge-archive-name"><strong>{document.name}</strong><small>{document.pageCount} pages · {fileSize(document.size)}</small></span>
                        <span className="forge-archive-pages">{document.pageCount}</span>
                        <span className="forge-archive-size">{fileSize(document.size)}</span>
                        <span className="forge-archive-date">{formatUpdatedAt(document.updatedAt)}</span>
                      </button>
                      <button className={`forge-star-action ${favorites.has(document.id) ? 'active' : ''}`} aria-label={favorites.has(document.id) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(document.id)}><Star size={15} fill={favorites.has(document.id) ? 'currentColor' : 'none'} /></button>
                      <div className="forge-row-menu-wrap">
                        <button className="forge-more-action" aria-label={`More actions for ${document.name}`} onClick={() => setMenuDocumentId((id) => id === document.id ? null : document.id)}><MoreHorizontal size={17} /></button>
                        {menuDocumentId === document.id && (
                          <div className="forge-row-menu">
                            <button onClick={() => openStoredDocument(document.id)}>Open document</button>
                            <button onClick={() => { setRenameDraft(document.name); setDocumentDialog({ type: 'rename', document }); setMenuDocumentId(null) }}>Rename</button>
                            <button onClick={() => void duplicateStoredDocument(document)}>Duplicate</button>
                            <button className="danger" onClick={() => { setDocumentDialog({ type: 'remove', document }); setMenuDocumentId(null) }}><Trash2 size={14} /> Remove from archive</button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="forge-empty-archive">
                  <Search size={24} />
                  <strong>{documents.length ? 'Nothing matches that search.' : 'Your archive is empty.'}</strong>
                  <p>{documents.length ? 'Change the search or filter and the archive will update instantly.' : 'Open a PDF and it will be kept here for quick return.'}</p>
                  {documents.length ? <button onClick={() => { setDocumentQuery(''); setDocumentFilter('all') }}>Clear search</button> : <button onClick={openFilePicker}>Open PDF</button>}
                </div>
              )}
            </section>
          )}

          {view === 'tools' && (
            <section className="forge-tools-view">
              <div className="forge-page-title">
                <div><span className="forge-folio-label">TOOL INDEX · 03</span><h1>Choose the job.<br /><em>Not the jargon.</em></h1><p>Every working PDF Forge capability, organized by what you are trying to accomplish.</p></div>
                <button className="forge-primary-action" onClick={openFilePicker}><Upload size={16} /> Open a document</button>
              </div>
              <div className="forge-tool-index">
                {(['Edit', 'Organize', 'Convert', 'Optimize', 'Protect', 'Forms & Signatures'] as const).map((group, groupIndex) => (
                  <section key={group} className="forge-tool-chapter">
                    <header><span>{String(groupIndex + 1).padStart(2, '0')}</span><h2>{group}</h2></header>
                    <div>
                      {toolDefinitions.filter((item) => item.group === group).map((item, itemIndex) => {
                        const Icon = item.icon
                        return (
                          <button key={item.name} onClick={() => startIntent(item.intent)}>
                            <span className="forge-tool-code">{groupIndex + 1}.{itemIndex + 1}</span>
                            <span className="forge-tool-icon"><Icon size={17} /></span>
                            <span className="forge-tool-copy"><strong>{item.name}</strong><small>{item.description}</small></span>
                            <ChevronRight size={14} />
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
              <div className="forge-capability-rule"><Check size={14} /><span>Only capabilities backed by the current PDF Forge engine are listed here.</span></div>
            </section>
          )}
        </main>
      </section>
    </div>,
    welcomeHost,
  )

  const editorPortal = topbarHost && createPortal(
    <>
      <div className="forge-editor-switch" role="navigation" aria-label="Editor modes">
        <span className="forge-switch-label">WORKFLOW</span>
        <button className={mode === 'edit' ? 'active' : ''} aria-label="Edit" onClick={() => setEditorMode('edit')}><i>01</i>Edit</button>
        <button className={mode === 'annotate' ? 'active' : ''} aria-label="Review" onClick={() => setEditorMode('annotate')}><i>02</i>Review</button>
        <button className={mode === 'sign' ? 'active' : ''} aria-label="Sign" onClick={() => setEditorMode('sign')}><i>03</i>Sign</button>
        <button className={mode === 'organize' ? 'active' : ''} aria-label="Pages" onClick={() => setEditorMode('organize')}><i>04</i>Pages</button>
        <button className="forge-command-trigger" title="Quick Actions · Ctrl/Cmd + K" onClick={() => { setPaletteOpen(true); setPaletteQuery('') }}><Search size={13} /><span>Actions</span><kbd>⌘K</kbd></button>
      </div>
      <button className="forge-editor-theme" type="button" aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} appearance`} title="Change appearance" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}</button>
    </>,
    topbarHost,
  )

  const dialogPortal = documentDialog && createPortal(
    <div className="product-dialog-layer" role="presentation" onMouseDown={() => setDocumentDialog(null)}>
      <section className={`product-dialog ${documentDialog.type === 'remove' ? 'destructive' : ''}`} role="dialog" aria-modal="true" aria-labelledby="product-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="product-dialog-icon">{documentDialog.type === 'remove' ? <Trash2 size={19} /> : <Type size={19} />}</span>
          <div>
            <h2 id="product-dialog-title">{documentDialog.type === 'remove' ? 'Remove this document?' : 'Rename document'}</h2>
            <p>{documentDialog.type === 'remove'
              ? `${documentDialog.document.name} will be removed from this local workspace. The original file on your computer will not be changed.`
              : 'Choose a clear name so this document is easy to find later.'}</p>
          </div>
        </header>
        {documentDialog.type === 'rename' && <label className="product-dialog-field">Document name<input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameStoredDocument(documentDialog.document, renameDraft) }} /></label>}
        <footer>
          <button className="product-secondary" onClick={() => setDocumentDialog(null)}>Cancel</button>
          {documentDialog.type === 'remove'
            ? <button className="product-danger" onClick={() => void removeStoredDocument(documentDialog.document)}>Remove Document</button>
            : <button className="product-primary" disabled={!renameDraft.trim()} onClick={() => void renameStoredDocument(documentDialog.document, renameDraft)}>Save Name</button>}
        </footer>
      </section>
    </div>,
    document.body,
  )

  const palettePortal = paletteOpen && createPortal(
    <div className="product-command-layer" role="presentation" onMouseDown={() => setPaletteOpen(false)}>
      <section className="product-command-palette" role="dialog" aria-modal="true" aria-label="Quick Actions" onMouseDown={(event) => event.stopPropagation()}>
        <div className="product-command-search"><Search size={18} /><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Name the task…" /><button aria-label="Close Quick Actions" onClick={() => setPaletteOpen(false)}><X size={16} /></button></div>
        <div className="product-command-results">
          {filteredCommands.map((command, index) => <button key={command.label} onClick={() => { command.run(); setPaletteOpen(false) }}><i>{String(index + 1).padStart(2, '0')}</i><span><strong>{command.label}</strong><small>{command.hint}</small></span>{command.shortcut && <kbd>{command.shortcut}</kbd>}</button>)}
          {!filteredCommands.length && <div className="product-command-empty"><Search size={20} /><strong>No matching action</strong><span>Try “merge”, “signature”, “pages”, or “export”.</span></div>}
        </div>
        <footer><span>PDF Forge command desk</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </div>,
    document.body,
  )

  return <>{homePortal}{editorPortal}{palettePortal}{dialogPortal}</>
}
