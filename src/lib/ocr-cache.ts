import { openDB } from 'idb'

const OCR_DB = 'pdf-forge-ocr'
const OCR_STORE = 'pages'

export type OcrWord = {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

export type OcrPageRecord = {
  id: string
  fingerprint: string
  pageNumber: number
  text: string
  words: OcrWord[]
  confidence: number
  updatedAt: number
}

const dbPromise = openDB(OCR_DB, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(OCR_STORE)) {
      db.createObjectStore(OCR_STORE, { keyPath: 'id' })
    }
  },
})

function recordId(fingerprint: string, pageNumber: number) {
  return `${fingerprint}:${pageNumber}`
}

export async function getOcrPage(fingerprint: string, pageNumber: number) {
  const db = await dbPromise
  return db.get(OCR_STORE, recordId(fingerprint, pageNumber)) as Promise<OcrPageRecord | undefined>
}

export async function saveOcrPage(record: Omit<OcrPageRecord, 'id'>) {
  const db = await dbPromise
  const value: OcrPageRecord = {
    ...record,
    id: recordId(record.fingerprint, record.pageNumber),
  }
  await db.put(OCR_STORE, value)
  return value
}

export async function clearOcrCache() {
  const db = await dbPromise
  await db.clear(OCR_STORE)
}
