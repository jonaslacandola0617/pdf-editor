import { useEffect, useMemo, useState } from 'react'
import { Bookmark, ExternalLink, MessageSquareText, RefreshCw, Save, Trash2 } from 'lucide-react'
import {
  deleteNativeBookmark,
  deleteNativeComment,
  deleteNativeLink,
  listNativeBookmarks,
  listNativeComments,
  listNativeLinks,
  renameNativeBookmark,
  updateNativeComment,
  updateNativeLink,
  type NativeBookmarkInfo,
  type NativeCommentInfo,
  type NativeLinkInfo,
} from '../lib/native-objects'

type Props = {
  bytes: ArrayBuffer
  onBeforeMutate: () => void
  onApply: (next: ArrayBuffer, options?: { status?: string }) => void
  onStatus: (message: string) => void
}

type Tab = 'comments' | 'links' | 'bookmarks'

function keyForComment(item: NativeCommentInfo) { return `${item.pageIndex}:${item.annotationIndex}` }
function keyForLink(item: NativeLinkInfo) { return `${item.pageIndex}:${item.annotationIndex}` }
function keyForBookmark(item: NativeBookmarkInfo) { return item.path.join('.') }

export function NativeObjectManager({ bytes, onBeforeMutate, onApply, onStatus }: Props) {
  const [tab, setTab] = useState<Tab>('comments')
  const [comments, setComments] = useState<NativeCommentInfo[]>([])
  const [links, setLinks] = useState<NativeLinkInfo[]>([])
  const [bookmarks, setBookmarks] = useState<NativeBookmarkInfo[]>([])
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({})
  const [bookmarkDrafts, setBookmarkDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState('')

  const reload = async (source = bytes) => {
    setLoading(true)
    try {
      const [nextComments, nextLinks, nextBookmarks] = await Promise.all([
        listNativeComments(source),
        listNativeLinks(source),
        listNativeBookmarks(source),
      ])
      setComments(nextComments)
      setLinks(nextLinks)
      setBookmarks(nextBookmarks)
      setCommentDrafts(Object.fromEntries(nextComments.map((item) => [keyForComment(item), item.text])))
      setLinkDrafts(Object.fromEntries(nextLinks.map((item) => [keyForLink(item), item.url])))
      setBookmarkDrafts(Object.fromEntries(nextBookmarks.map((item) => [keyForBookmark(item), item.title])))
    } catch (error) {
      console.error(error)
      onStatus('Could not inspect native PDF objects in this document.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([listNativeComments(bytes), listNativeLinks(bytes), listNativeBookmarks(bytes)])
      .then(([nextComments, nextLinks, nextBookmarks]) => {
        if (cancelled) return
        setComments(nextComments)
        setLinks(nextLinks)
        setBookmarks(nextBookmarks)
        setCommentDrafts(Object.fromEntries(nextComments.map((item) => [keyForComment(item), item.text])))
        setLinkDrafts(Object.fromEntries(nextLinks.map((item) => [keyForLink(item), item.url])))
        setBookmarkDrafts(Object.fromEntries(nextBookmarks.map((item) => [keyForBookmark(item), item.title])))
      })
      .catch((error) => { if (!cancelled) { console.error(error); onStatus('Could not inspect native PDF objects in this document.') } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bytes, onStatus])

  const mutate = async (label: string, operation: () => Promise<ArrayBuffer>) => {
    if (busy) return
    setBusy(label)
    onBeforeMutate()
    onStatus(`${label}…`)
    try {
      const next = await operation()
      onApply(next, { status: `${label} complete` })
      await reload(next)
    } catch (error) {
      console.error(error)
      onStatus(error instanceof Error ? error.message : `${label} failed`)
    } finally {
      setBusy('')
    }
  }

  const counts = useMemo(() => ({ comments: comments.length, links: links.length, bookmarks: bookmarks.length }), [bookmarks.length, comments.length, links.length])

  return <section className="advanced-card native-object-manager">
    <h3><RefreshCw /> Existing PDF objects</h3>
    <p>Inspect and manage comments, web links and outline bookmarks already embedded in the PDF, including objects created by other editors.</p>
    <div className="native-object-tabs">
      <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}><MessageSquareText /> Comments <span>{counts.comments}</span></button>
      <button className={tab === 'links' ? 'active' : ''} onClick={() => setTab('links')}><ExternalLink /> Links <span>{counts.links}</span></button>
      <button className={tab === 'bookmarks' ? 'active' : ''} onClick={() => setTab('bookmarks')}><Bookmark /> Bookmarks <span>{counts.bookmarks}</span></button>
    </div>

    {loading && <div className="native-object-empty">Reading PDF objects…</div>}

    {!loading && tab === 'comments' && <div className="native-object-list">
      {comments.map((item) => {
        const key = keyForComment(item)
        return <div className="native-object-row" key={key}>
          <div className="native-object-meta"><MessageSquareText /><span>Page {item.pageIndex + 1} · {item.subtype}{item.author ? ` · ${item.author}` : ''}</span></div>
          <textarea aria-label={`Native comment page ${item.pageIndex + 1}`} rows={3} value={commentDrafts[key] ?? ''} onChange={(event) => setCommentDrafts((items) => ({ ...items, [key]: event.target.value }))} />
          <div className="native-object-actions">
            <button disabled={Boolean(busy)} onClick={() => void mutate('Updating native comment', () => updateNativeComment(bytes, item.pageIndex, item.annotationIndex, commentDrafts[key] ?? '', item.author))}><Save /> Save</button>
            <button className="danger-action" disabled={Boolean(busy)} onClick={() => void mutate('Deleting native comment', () => deleteNativeComment(bytes, item.pageIndex, item.annotationIndex))}><Trash2 /> Delete</button>
          </div>
        </div>
      })}
      {!comments.length && <div className="native-object-empty">No native sticky-note or free-text comments found.</div>}
    </div>}

    {!loading && tab === 'links' && <div className="native-object-list">
      {links.map((item) => {
        const key = keyForLink(item)
        return <div className="native-object-row" key={key}>
          <div className="native-object-meta"><ExternalLink /><span>Page {item.pageIndex + 1}</span></div>
          <input aria-label={`Native link page ${item.pageIndex + 1}`} value={linkDrafts[key] ?? ''} onChange={(event) => setLinkDrafts((items) => ({ ...items, [key]: event.target.value }))} />
          <div className="native-object-actions">
            <button disabled={Boolean(busy)} onClick={() => void mutate('Updating native link', () => updateNativeLink(bytes, item.pageIndex, item.annotationIndex, linkDrafts[key] ?? ''))}><Save /> Save</button>
            <button className="danger-action" disabled={Boolean(busy)} onClick={() => void mutate('Deleting native link', () => deleteNativeLink(bytes, item.pageIndex, item.annotationIndex))}><Trash2 /> Delete</button>
          </div>
        </div>
      })}
      {!links.length && <div className="native-object-empty">No URI link annotations found.</div>}
    </div>}

    {!loading && tab === 'bookmarks' && <div className="native-object-list">
      {bookmarks.map((item) => {
        const key = keyForBookmark(item)
        return <div className="native-object-row" key={key} style={{ marginLeft: `${Math.min(4, item.depth) * 12}px` }}>
          <div className="native-object-meta"><Bookmark /><span>Outline level {item.depth + 1}</span></div>
          <input aria-label={`Native bookmark ${key || 'root'}`} value={bookmarkDrafts[key] ?? ''} onChange={(event) => setBookmarkDrafts((items) => ({ ...items, [key]: event.target.value }))} />
          <div className="native-object-actions">
            <button disabled={Boolean(busy)} onClick={() => void mutate('Renaming bookmark', () => renameNativeBookmark(bytes, item.path, bookmarkDrafts[key] ?? ''))}><Save /> Rename</button>
            <button className="danger-action" disabled={Boolean(busy)} onClick={() => void mutate('Deleting bookmark', () => deleteNativeBookmark(bytes, item.path))}><Trash2 /> Delete</button>
          </div>
        </div>
      })}
      {!bookmarks.length && <div className="native-object-empty">No PDF outline bookmarks found.</div>}
    </div>}
  </section>
}
