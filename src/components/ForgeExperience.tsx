import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
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
  Highlighter,
  Library,
  List,
  Menu,
  MoreHorizontal,
  PenLine,
  Plus,
  ScanLine,
  Search,
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

type ProductView = 'desk' | 'library' | 'tools'
type EditorMode = 'edit' | 'review' | 'sign' | 'pages'
type ToolIntent =
  | 'edit'
  | 'review'
  | 'merge'
  | 'optimize'
  | 'redact'
  | 'sign'
  | 'organize'
  | 'protect'
  | 'document'
  | 'objects'
  | 'forms'
  | 'imageToPdf'
  | null

type DocumentDialog = { type: 'rename' | 'remove'; document: LibraryDocument } | null

type ToolDefinition = {
  name: string
  description: string
  group: 'Write & Edit' | 'Pages' | 'Build & Convert' | 'Finish & Protect'
  icon: ComponentType<{ size?: number }>
  intent: Exclude<ToolIntent, null>
}

const FAVORITES_KEY = 'pdf-forge-favorites'

const toolDefinitions: ToolDefinition[] = [
  { name: 'Edit PDF', description: 'Change existing text or place new content directly on a page.', group: 'Write & Edit', icon: PenLine, intent: 'edit' },
  { name: 'Add images', description: 'Place PNG or JPG artwork into the current document.', group: 'Write & Edit', icon: Upload, intent: 'document' },
  { name: 'Comments & markup', description: 'Highlight, draw, add notes, and review document details.', group: 'Write & Edit', icon: Highlighter, intent: 'review' },
  { name: 'Organize pages', description: 'Reorder, rotate, duplicate, extract, or remove pages visually.', group: 'Pages', icon: Files, intent: 'organize' },
  { name: 'Extract pages', description: 'Create a clean PDF from only the pages you choose.', group: 'Pages', icon: Split, intent: 'organize' },
  { name: 'Merge documents', description: 'Append PDFs or images into one ordered document.', group: 'Pages', icon: FileInput, intent: 'merge' },
  { name: 'Image to PDF', description: 'Turn PNG and JPG files into PDF pages locally.', group: 'Build & Convert', icon: FileInput, intent: 'imageToPdf' },
  { name: 'Export pages as images', description: 'Render PDF pages into high-quality local image files.', group: 'Build & Convert', icon: Download, intent: 'objects' },
  { name: 'Make searchable', description: 'Use local OCR to add searchable text to scanned pages.', group: 'Build & Convert', icon: Search, intent: 'document' },
  { name: 'Compress & optimize', description: 'Reduce document overhead while preserving useful quality.', group: 'Finish & Protect', icon: Archive, intent: 'optimize' },
  { name: 'Fill & sign', description: 'Complete form fields and place signatures into the document.', group: 'Finish & Protect', icon: FormInput, intent: 'sign' },
  { name: 'Create form fields', description: 'Prepare and arrange interactive fields on document pages.', group: 'Finish & Protect', icon: FormInput, intent: 'forms' },
  { name: 'Redact content', description: 'Permanently remove sensitive visual content before sharing.', group: 'Finish & Protect', icon: ScanLine, intent: 'redact' },
  { name: 'Protect PDF', description: 'Apply password protection and document security controls.', group: 'Finish & Protect', icon: Bookmark, intent: 'protect' },
  { name: 'Remove private data', description: 'Clear metadata, scripts, attachments, and unsafe active content.', group: 'Finish & Protect', icon: Trash2, intent: 'document' },
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

function openStoredDocument(id: string) {
  window.dispatchEvent(new CustomEvent('pdf-forge:open-document', { detail: id }))
}

function activateEditorMode(mode: EditorMode) {
  document.body.dataset.forgeMode = mode
  if (mode === 'pages') findButtonByTitle('Pages')?.click()
}

function runEditorIntent(intent: Exclude<ToolIntent, null>) {
  switch (intent) {
    case 'edit':
      activateEditorMode('edit')
      findButtonByTitle('Edit existing text')?.click()
      break
    case 'review':
      activateEditorMode('review')
      findButtonByTitle('Highlight')?.click()
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
      activateEditorMode('review')
      findButtonByTitle('Redact')?.click()
      break
    case 'sign':
      activateEditorMode('sign')
      findButtonByTitle('Signature')?.click()
      break
    case 'organize':
      activateEditorMode('pages')
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
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value)
}

function ForgeBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`forge-brand ${compact ? 'compact' : ''}`}>
      <span className="forge-brand-mark" aria-hidden="true"><i>P</i><i>F</i></span>
      <span className="forge-brand-copy"><strong>PDF Forge</strong><small>Document atelier</small></span>
    </div>
  )
}

export function ForgeExperience() {
  const [welcomeHost, setWelcomeHost] = useState<HTMLElement | null>(null)
  const [topbarHost, setTopbarHost] = useState<HTMLElement | null>(null)
  const [editorVisible, setEditorVisible] = useState(false)
  const [view, setView] = useState<ProductView>('desk')
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
      document.body.classList.toggle('forge-home-active', Boolean(welcome))
      document.body.classList.toggle('forge-editor-active', Boolean(shell))
      if (shell && !document.body.dataset.forgeMode) document.body.dataset.forgeMode = 'edit'
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      document.body.classList.remove('forge-home-active', 'forge-editor-active')
      delete document.body.dataset.forgeMode
    }
  }, [])

  useEffect(() => {
    if (welcomeHost) void refreshDocuments()
  }, [welcomeHost])

  useEffect(() => {
    if (!editorVisible || !pendingIntent.current) return
    const intent = pendingIntent.current
    pendingIntent.current = null
    window.setTimeout(() => runEditorIntent(intent), 140)
  }, [editorVisible])

  useEffect(() => {
    if (!editorVisible || window.innerWidth > 760) return
    const fitMobileDocument = () => findButtonByTitle('Fit width')?.click()
    const timer = window.setTimeout(fitMobileDocument, 220)
    return () => window.clearTimeout(timer)
  }, [editorVisible])

  useEffect(() => {
    const observeMode = (event: Event) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest<HTMLButtonElement>('.editor-toolbar button, .rail button')
      if (!button) return
      const title = button.title
      if (['Edit existing text', 'Add text', 'Select'].includes(title)) setMode('edit')
      if (['Sticky note', 'Highlight', 'Rectangle', 'Draw', 'Redact'].includes(title)) setMode('review')
      if (['Signature', 'Form fields'].includes(title)) setMode('sign')
      if (title === 'Pages' && document.body.dataset.forgeMode === 'pages') setMode('pages')
    }
    document.addEventListener('click', observeMode, true)
    return () => document.removeEventListener('click', observeMode, true)
  }, [])

  const setEditorMode = (next: EditorMode) => {
    setMode(next)
    activateEditorMode(next)
    if (next === 'edit') findButtonByTitle('Select')?.click()
    if (next === 'review') findButtonByTitle('Highlight')?.click()
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
    return documents
      .filter((document, index) => {
        if (documentFilter === 'favorites' && !favorites.has(document.id)) return false
        if (documentFilter === 'recent' && index > 9) return false
        return !query || document.name.toLocaleLowerCase().includes(query)
      })
      .sort((a, b) =>
        documentSort === 'name'
          ? a.name.localeCompare(b.name)
          : documentSort === 'pages'
            ? b.pageCount - a.pageCount
            : b.updatedAt - a.updatedAt,
      )
  }, [documentFilter, documentQuery, documentSort, documents, favorites])

  const paletteCommands = useMemo(() => [
    { label: 'Edit existing text', hint: 'Change text already embedded in this PDF', run: () => runEditorIntent('edit') },
    { label: 'Add text', hint: 'Place new text on the current page', run: () => { activateEditorMode('edit'); findButtonByTitle('Add text')?.click() } },
    { label: 'Highlight', hint: 'Mark content for review', run: () => { activateEditorMode('review'); findButtonByTitle('Highlight')?.click() } },
    { label: 'Add sticky note', hint: 'Place a document comment', run: () => { activateEditorMode('review'); findButtonByTitle('Sticky note')?.click() } },
    { label: 'Add signature', hint: 'Draw or place a signature', run: () => runEditorIntent('sign') },
    { label: 'Organize pages', hint: 'Reorder, rotate, extract, or remove pages', run: () => runEditorIntent('organize') },
    { label: 'Merge documents', hint: 'Append PDFs or images', run: () => findButtonByText('Merge')?.click() },
    { label: 'Extract pages', hint: 'Create a PDF from selected pages', run: () => findButtonByText('Extract')?.click() },
    { label: 'Document tools', hint: 'OCR, optimize, secure, redact, and more', run: () => findButtonByTitle('Document tools')?.click() },
    { label: 'Export PDF', hint: 'Download the finished document', run: () => findButtonByText('Export PDF')?.click() },
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

  const recent = documents.slice(0, 5)
  const quickTools = toolDefinitions.filter((item) =>
    ['Edit PDF', 'Organize pages', 'Merge documents', 'Make searchable', 'Fill & sign', 'Protect PDF'].includes(item.name),
  )

  const homePortal = welcomeHost && createPortal(
    <div className="forge-home">
      <aside className="forge-home-rail">
        <button className="forge-home-brand-button" type="button" onClick={() => setView('desk')} aria-label="PDF Forge home">
          <ForgeBrand compact />
        </button>
        <nav className="forge-home-nav" aria-label="PDF Forge sections">
          <button className={view === 'desk' ? 'active' : ''} onClick={() => setView('desk')}><Clock3 size={17} /><span>Desk</span></button>
          <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}><Library size={17} /><span>Library</span></button>
          <button className={view === 'tools' ? 'active' : ''} onClick={() => setView('tools')}><Menu size={17} /><span>Tools</span></button>
        </nav>
        <div className="forge-home-rail-foot">
          <span className="forge-local-seal"><Check size={13} /> Local</span>
          <small>Files stay in this browser.</small>
        </div>
      </aside>

      <main className="forge-home-main">
        <header className="forge-home-topline">
          <div><span>PDF FORGE / PRIVATE WORKROOM</span><i>01</i></div>
          <button className="forge-key-button" onClick={() => { setPaletteOpen(true); setPaletteQuery('') }}><Search size={14} /> Quick actions <kbd>⌘K</kbd></button>
        </header>

        {view === 'desk' && (
          <>
            <section className="forge-opening">
              <div className="forge-opening-copy">
                <span className="forge-kicker">DOCUMENT WORK, DISTILLED</span>
                <h1>Work the document.<br /><em>Not the software.</em></h1>
                <p>Open, edit, organize, sign, and finish PDFs in one private workspace designed to keep the next action obvious.</p>
                <div className="forge-opening-actions">
                  <button className="forge-primary" onClick={openFilePicker}><Upload size={17} /> Open document</button>
                  <button className="forge-text-action" onClick={() => setView('tools')}>Browse every tool <ChevronRight size={14} /></button>
                </div>
              </div>

              <button className="forge-drop-surface" onClick={openFilePicker}>
                <span className="forge-drop-index">DROP / OPEN</span>
                <span className="forge-drop-glyph"><Upload size={24} /></span>
                <strong>Bring a document to the desk</strong>
                <small>PDF, PNG, or JPG. Nothing is uploaded to a server.</small>
                <span className="forge-drop-line"><i /> Choose a file <i /></span>
              </button>
            </section>

            <section className="forge-workbench">
              <div className="forge-ledger forge-ledger-main">
                <header className="forge-ledger-heading">
                  <div><span className="forge-kicker">CONTINUE</span><h2>{documents.length ? 'Recent documents' : 'Your desk is clear'}</h2></div>
                  {documents.length > 5 && <button onClick={() => setView('library')}>Open library <ChevronRight size={13} /></button>}
                </header>
                {recent.length ? (
                  <div className="forge-recent-list">
                    {recent.map((document, index) => (
                      <button key={document.id} className="forge-recent-row" onClick={() => openStoredDocument(document.id)}>
                        <span className="forge-row-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="forge-file-stamp">PDF</span>
                        <span className="forge-row-copy"><strong>{document.name}</strong><small>{document.pageCount} pages · {fileSize(document.size)}</small></span>
                        <span className="forge-row-time">{formatUpdatedAt(document.updatedAt)}</span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <button className="forge-empty-ledger" onClick={openFilePicker}>
                    <Plus size={18} />
                    <span><strong>Open your first document</strong><small>It will stay available here for quick return.</small></span>
                    <ChevronRight size={15} />
                  </button>
                )}
              </div>

              <aside className="forge-ledger forge-action-ledger">
                <header className="forge-ledger-heading"><div><span className="forge-kicker">START</span><h2>Common work</h2></div></header>
                <div className="forge-action-list">
                  {quickTools.map((item, index) => {
                    const Icon = item.icon
                    return (
                      <button key={item.name} onClick={() => startIntent(item.intent)}>
                        <span className="forge-action-number">{String(index + 1).padStart(2, '0')}</span>
                        <Icon size={17} />
                        <span><strong>{item.name}</strong><small>{item.description}</small></span>
                        <ChevronRight size={14} />
                      </button>
                    )
                  })}
                </div>
              </aside>
            </section>
          </>
        )}

        {view === 'library' && (
          <section className="forge-page">
            <header className="forge-page-header">
              <div><span className="forge-kicker">LOCAL ARCHIVE</span><h1>Document library</h1><p>Every PDF you keep in PDF Forge, organized without leaving your browser.</p></div>
              <button className="forge-primary" onClick={openFilePicker}><Upload size={16} /> Open document</button>
            </header>

            <div className="forge-library-controls">
              <label className="forge-search"><Search size={15} /><input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="Search by document name" /></label>
              <div className="forge-filter-set">
                <button className={documentFilter === 'all' ? 'active' : ''} onClick={() => setDocumentFilter('all')}>All</button>
                <button className={documentFilter === 'recent' ? 'active' : ''} onClick={() => setDocumentFilter('recent')}>Recent</button>
                <button className={documentFilter === 'favorites' ? 'active' : ''} onClick={() => setDocumentFilter('favorites')}>Favorites</button>
              </div>
              <label className="forge-sort">Sort<select value={documentSort} onChange={(event) => setDocumentSort(event.target.value as typeof documentSort)}><option value="updated">Last edited</option><option value="name">Name</option><option value="pages">Page count</option></select></label>
              <div className="forge-view-toggle">
                <button className={libraryLayout === 'list' ? 'active' : ''} aria-label="List view" onClick={() => setLibraryLayout('list')}><List size={15} /></button>
                <button className={libraryLayout === 'grid' ? 'active' : ''} aria-label="Grid view" onClick={() => setLibraryLayout('grid')}><Grid2X2 size={15} /></button>
              </div>
            </div>

            {filteredDocuments.length ? (
              <div className={`forge-document-table ${libraryLayout}`}>
                <div className="forge-document-table-head"><span>Name</span><span>Pages</span><span>Size</span><span>Edited</span><span /></div>
                {filteredDocuments.map((document) => (
                  <div className="forge-document-entry" key={document.id}>
                    <button className="forge-document-open" onClick={() => openStoredDocument(document.id)}>
                      <span className="forge-file-stamp">PDF</span><strong>{document.name}</strong>
                    </button>
                    <span>{document.pageCount}</span>
                    <span>{fileSize(document.size)}</span>
                    <span>{formatUpdatedAt(document.updatedAt)}</span>
                    <div className="forge-document-actions">
                      <button className={favorites.has(document.id) ? 'active' : ''} aria-label={favorites.has(document.id) ? 'Remove favorite' : 'Add favorite'} onClick={() => toggleFavorite(document.id)}><Star size={15} fill={favorites.has(document.id) ? 'currentColor' : 'none'} /></button>
                      <div className="forge-menu-wrap">
                        <button aria-label={`More actions for ${document.name}`} onClick={() => setMenuDocumentId((id) => id === document.id ? null : document.id)}><MoreHorizontal size={16} /></button>
                        {menuDocumentId === document.id && (
                          <div className="forge-menu">
                            <button onClick={() => openStoredDocument(document.id)}>Open</button>
                            <button onClick={() => { setRenameDraft(document.name); setDocumentDialog({ type: 'rename', document }); setMenuDocumentId(null) }}>Rename</button>
                            <button onClick={() => void duplicateStoredDocument(document)}>Duplicate</button>
                            <button className="danger" onClick={() => { setDocumentDialog({ type: 'remove', document }); setMenuDocumentId(null) }}><Trash2 size={13} /> Remove from library</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="forge-page-empty">
                <Search size={22} />
                <strong>{documents.length ? 'Nothing matches that search' : 'No documents in the library yet'}</strong>
                <p>{documents.length ? 'Clear the search or switch the current filter.' : 'Open a PDF and PDF Forge will keep it here locally.'}</p>
                <button onClick={documents.length ? () => { setDocumentQuery(''); setDocumentFilter('all') } : openFilePicker}>{documents.length ? 'Clear filters' : 'Open document'}</button>
              </div>
            )}
          </section>
        )}

        {view === 'tools' && (
          <section className="forge-page">
            <header className="forge-page-header">
              <div><span className="forge-kicker">TOOL INDEX</span><h1>Everything PDF Forge can do</h1><p>Grouped by the result you need, not by technical terminology.</p></div>
              <button className="forge-primary" onClick={openFilePicker}><Upload size={16} /> Open document</button>
            </header>
            <div className="forge-tool-index">
              {(['Write & Edit', 'Pages', 'Build & Convert', 'Finish & Protect'] as const).map((group, groupIndex) => (
                <section key={group}>
                  <header><span>{String(groupIndex + 1).padStart(2, '0')}</span><h2>{group}</h2></header>
                  <div>
                    {toolDefinitions.filter((item) => item.group === group).map((item) => {
                      const Icon = item.icon
                      return (
                        <button key={item.name} onClick={() => startIntent(item.intent)}>
                          <Icon size={17} />
                          <span><strong>{item.name}</strong><small>{item.description}</small></span>
                          <ChevronRight size={14} />
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
            <div className="forge-capability-note"><Check size={14} /><span>Only capabilities backed by the current PDF Forge codebase are shown here.</span></div>
          </section>
        )}
      </main>
    </div>,
    welcomeHost,
  )

  const editorPortal = topbarHost && createPortal(
    <div className="forge-mode-switch" role="navigation" aria-label="Work modes">
      <button className={mode === 'edit' ? 'active' : ''} onClick={() => setEditorMode('edit')}><PenLine size={14} /><span>Edit</span></button>
      <button className={mode === 'review' ? 'active' : ''} onClick={() => setEditorMode('review')}><Highlighter size={14} /><span>Review</span></button>
      <button className={mode === 'sign' ? 'active' : ''} onClick={() => setEditorMode('sign')}><FormInput size={14} /><span>Fill & Sign</span></button>
      <button className={mode === 'pages' ? 'active' : ''} onClick={() => setEditorMode('pages')}><Files size={14} /><span>Pages</span></button>
      <button className="forge-mode-command" title="Quick actions · Ctrl/Cmd + K" onClick={() => { setPaletteOpen(true); setPaletteQuery('') }}><Search size={14} /><kbd>⌘K</kbd></button>
    </div>,
    topbarHost,
  )

  const dialogPortal = documentDialog && createPortal(
    <div className="forge-dialog-layer" onMouseDown={() => setDocumentDialog(null)}>
      <section className={`forge-dialog ${documentDialog.type === 'remove' ? 'destructive' : ''}`} role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span>{documentDialog.type === 'remove' ? <Trash2 size={18} /> : <Type size={18} />}</span>
          <div><h2>{documentDialog.type === 'remove' ? 'Remove this document?' : 'Rename document'}</h2><p>{documentDialog.type === 'remove' ? `${documentDialog.document.name} will be removed from this local library. The original file on your computer stays untouched.` : 'Choose a name that will be easy to recognize later.'}</p></div>
        </header>
        {documentDialog.type === 'rename' && <label>Document name<input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameStoredDocument(documentDialog.document, renameDraft) }} /></label>}
        <footer>
          <button className="forge-secondary" onClick={() => setDocumentDialog(null)}>Cancel</button>
          {documentDialog.type === 'remove'
            ? <button className="forge-danger" onClick={() => void removeStoredDocument(documentDialog.document)}>Remove document</button>
            : <button className="forge-primary" disabled={!renameDraft.trim()} onClick={() => void renameStoredDocument(documentDialog.document, renameDraft)}>Save name</button>}
        </footer>
      </section>
    </div>,
    document.body,
  )

  const palettePortal = paletteOpen && createPortal(
    <div className="forge-command-layer" onMouseDown={() => setPaletteOpen(false)}>
      <section className="forge-command" role="dialog" aria-modal="true" aria-label="Quick actions" onMouseDown={(event) => event.stopPropagation()}>
        <header><Search size={17} /><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Type an action…" /><button aria-label="Close" onClick={() => setPaletteOpen(false)}><X size={15} /></button></header>
        <div className="forge-command-list">
          {filteredCommands.map((command, index) => (
            <button key={command.label} onClick={() => { command.run(); setPaletteOpen(false) }}>
              <span className="forge-command-index">{String(index + 1).padStart(2, '0')}</span>
              <span><strong>{command.label}</strong><small>{command.hint}</small></span>
              <ChevronRight size={14} />
            </button>
          ))}
          {!filteredCommands.length && <div className="forge-command-empty"><Search size={19} /><strong>No matching action</strong><span>Try “merge”, “signature”, “pages”, or “export”.</span></div>}
        </div>
        <footer><span>PDF Forge command desk</span><span><kbd>Esc</kbd> Close</span></footer>
      </section>
    </div>,
    document.body,
  )

  return <>{homePortal}{editorPortal}{dialogPortal}{palettePortal}</>
}
