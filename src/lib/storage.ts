import { openDB } from 'idb'
import type { LibraryDocument } from '../types'

const DB_NAME = 'pdf-forge'
const STORE = 'documents'

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id' })
    }
  },
})

export async function listDocuments(): Promise<LibraryDocument[]> {
  const db = await dbPromise
  const docs = await db.getAll(STORE)
  return docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveDocument(doc: LibraryDocument) {
  const db = await dbPromise
  await db.put(STORE, doc)
}

export async function deleteDocument(id: string) {
  const db = await dbPromise
  await db.delete(STORE, id)
}

export async function clearDocuments() {
  const db = await dbPromise
  await db.clear(STORE)
}
