import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, ChevronRight, FileHeart, Star, X } from 'lucide-react'
import { pdfjsLib, type PDFDocumentProxy } from '../lib/pdfjs'
import { listDocuments } from '../lib/storage'
import type { LibraryDocument } from '../types'

type OutlineItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>> extends (infer Item)[] | null ? Item : never

type FlatBookmark = {
  id: string
  title: string
  depth: number
  dest: OutlineItem extends { dest: infer D } ? D : unknown
}

const FAVORITES_KEY = 'pdf-forge-favorites'

function readFavoriteIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
    return new Set<string>(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

function flattenOutline(items: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>, depth = 0, prefix = 'b'): FlatBookmark[] {
  if (!items?.length) return []
  const output: FlatBookmark[] = []
  items.forEach((item, index) => {
    const id = `${prefix}-${index}`
    output.push({ id, title: item.title || `Bookmark ${index + 1}`, depth, dest: item.dest })
    if (item.items?.length) output.push(...flattenOutline(item.items, depth + 1, id))
  })
  return output
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function navigateEditorToPage(pageIndex: number) {
  const input = document.querySelector<HTMLInputElement>('.floating-nav input')
  if (!input) return
  setReactInputValue(input, String(pageIndex + 1))
}

function clickLibraryDocument(name: string) {
  const library = Array.from(document.querySelectorAll<HTMLButtonElement>('.library-item > button:first-child'))
    .find((button) => button.textContent?.includes(name))
  if (library) {
    library.click()
    return true
  }
  document.querySelector<HTMLButtonElement>('.rail button[title="Library"]')?.click()
  window.setTimeout(() => {
    Array.from(document.querySelectorAll<HTMLButtonElement>('.library-item > button:first-child'))
      .find((button) => button.textContent?.includes(name))?.click()
  }, 60)
  return false
}

export function NavigationExtras() {
  const [railHost, setRailHost] = useState<HTMLElement | null>(null)
  const [editorVisible, setEditorVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [documentName, setDocumentName] = useState('')
  const [documents, setDocuments] = useState<LibraryDocument[]>([])
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavoriteIds())
  const [bookmarks, setBookmarks] = useState<FlatBookmark[]>([])
  const [bookmarkDocument, setBookmarkDocument] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const sync = () => {
      const shell = document.querySelector('.app-shell')
      setEditorVisible(Boolean(shell))
      setRailHost(document.querySelector<HTMLElement>('.rail'))
      const nextName = document.querySelector<HTMLInputElement>('.doc-title input')?.value || ''
      setDocumentName(nextName)
      if (!shell) setOpen(false)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    document.addEventListener('input', sync, true)
    return () => { observer.disconnect(); document.removeEventListener('input', sync, true) }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let task: ReturnType<typeof pdfjsLib.getDocument> | null = null
    setLoading(true)
    void listDocuments().then(async (items) => {
      if (cancelled) return
      setDocuments(items)
      const active = items.find((item) => item.name === documentName) || items[0]
      if (!active) { setBookmarks([]); return }
      task = pdfjsLib.getDocument({ data: new Uint8Array(active.bytes.slice(0)) })
      const doc = await task.promise
      if (cancelled) return
      setBookmarkDocument(doc)
      setBookmarks(flattenOutline(await doc.getOutline()))
    }).catch((error) => {
      console.error('Bookmark loading failed', error)
      if (!cancelled) setBookmarks([])
    }).finally(() => { if (!cancelled) setLoading(false) })

    return () => {
      cancelled = true
      setBookmarkDocument(null)
      if (task) void task.destroy().catch(() => undefined)
    }
  }, [documentName, open])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  const favoriteDocuments = useMemo(() => documents.filter((doc) => favorites.has(doc.id)), [documents, favorites])
  const activeDocument = useMemo(() => documents.find((doc) => doc.name === documentName) || null, [documentName, documents])

  const toggleFavorite = () => {
    if (!activeDocument) return
    const next = new Set(favorites)
    next.has(activeDocument.id) ? next.delete(activeDocument.id) : next.add(activeDocument.id)
    setFavorites(next)
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
  }

  const openBookmark = async (bookmark: FlatBookmark) => {
    if (!bookmarkDocument || !bookmark.dest) return
    try {
      const destination = typeof bookmark.dest === 'string'
        ? await bookmarkDocument.getDestination(bookmark.dest)
        : bookmark.dest
      if (!Array.isArray(destination) || !destination.length) return
      const target = destination[0]
      let pageIndex: number | null = null
      if (typeof target === 'number') pageIndex = target
      else if (target && typeof target === 'object') pageIndex = await bookmarkDocument.getPageIndex(target)
      if (pageIndex !== null && pageIndex >= 0) {
        navigateEditorToPage(pageIndex)
        setOpen(false)
      }
    } catch (error) {
      console.error('Could not navigate to bookmark', error)
    }
  }

  if (!editorVisible || !railHost) return null

  return <>
    {createPortal(
      <button className={`nav-extras-launcher ${open ? 'active' : ''}`} type="button" title="Bookmarks & favorites" aria-label="Bookmarks & favorites" onClick={() => setOpen((value) => !value)}>
        <Bookmark size={18} />
      </button>,
      railHost,
    )}

    {open && <div className="nav-extras-layer">
      <button className="nav-extras-backdrop" aria-label="Close bookmarks" onClick={() => setOpen(false)} />
      <aside className="nav-extras-drawer" aria-label="Bookmarks and favorites">
        <header>
          <div><span className="eyebrow">NAVIGATE</span><h2>Bookmarks & favorites</h2></div>
          <button className="icon-btn" title="Close bookmarks" onClick={() => setOpen(false)}><X /></button>
        </header>

        <section className="nav-extra-section">
          <div className="nav-extra-title">
            <div><Bookmark size={16} /><strong>PDF bookmarks</strong></div>
            {activeDocument && <button className={`favorite-current ${favorites.has(activeDocument.id) ? 'active' : ''}`} onClick={toggleFavorite} title="Favorite this document"><Star size={16} fill={favorites.has(activeDocument.id) ? 'currentColor' : 'none'} /></button>}
          </div>
          {loading ? <p className="nav-empty">Loading document outline…</p>
            : bookmarks.length ? <div className="bookmark-list">{bookmarks.map((bookmark) => <button key={bookmark.id} style={{ paddingLeft: `${12 + bookmark.depth * 16}px` }} onClick={() => void openBookmark(bookmark)}><Bookmark size={13} /><span>{bookmark.title}</span><ChevronRight size={13} /></button>)}</div>
              : <p className="nav-empty">This PDF has no embedded bookmarks.</p>}
        </section>

        <section className="nav-extra-section">
          <div className="nav-extra-title"><div><FileHeart size={16} /><strong>Favorite local PDFs</strong></div><span>{favoriteDocuments.length}</span></div>
          {favoriteDocuments.length ? <div className="favorite-doc-list">{favoriteDocuments.map((doc) => <button key={doc.id} onClick={() => { clickLibraryDocument(doc.name); setOpen(false) }}><span className="pdf-file-icon">PDF</span><span><strong>{doc.name}</strong><small>{doc.pageCount} pages</small></span><ChevronRight size={14} /></button>)}</div> : <p className="nav-empty">Star an open PDF to keep it handy on this device.</p>}
        </section>
      </aside>
    </div>}
  </>
}
