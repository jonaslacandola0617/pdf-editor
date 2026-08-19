import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib'

export type NativeCommentInfo = {
  pageIndex: number
  annotationIndex: number
  subtype: 'Text' | 'FreeText'
  text: string
  author: string
}

export type NativeLinkInfo = {
  pageIndex: number
  annotationIndex: number
  url: string
}

export type NativeBookmarkInfo = {
  path: number[]
  title: string
  depth: number
}

function textValue(value: unknown) {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return ''
}

function pageAnnotations(pdf: PDFDocument, pageIndex: number) {
  const page = pdf.getPage(pageIndex)
  return page.node.lookupMaybe(PDFName.of('Annots'), PDFArray) || null
}

function annotationDict(pdf: PDFDocument, annots: PDFArray, index: number) {
  const raw = annots.get(index)
  if (!raw) return null
  try {
    const resolved = raw instanceof PDFRef ? pdf.context.lookup(raw) : raw
    return resolved instanceof PDFDict ? resolved : null
  } catch {
    return null
  }
}

export async function listNativeComments(bytes: ArrayBuffer): Promise<NativeCommentInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const result: NativeCommentInfo[] = []
  pdf.getPages().forEach((_, pageIndex) => {
    const annots = pageAnnotations(pdf, pageIndex)
    if (!annots) return
    for (let annotationIndex = 0; annotationIndex < annots.size(); annotationIndex++) {
      const dict = annotationDict(pdf, annots, annotationIndex)
      if (!dict) continue
      const subtype = dict.get(PDFName.of('Subtype'))?.toString()
      if (subtype !== '/Text' && subtype !== '/FreeText') continue
      result.push({
        pageIndex,
        annotationIndex,
        subtype: subtype === '/FreeText' ? 'FreeText' : 'Text',
        text: textValue(dict.lookup(PDFName.of('Contents'))),
        author: textValue(dict.lookup(PDFName.of('T'))),
      })
    }
  })
  return result
}

export async function updateNativeComment(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number, text: string, author?: string) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const annots = pageAnnotations(pdf, pageIndex)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) throw new Error('This comment no longer exists.')
  const dict = annotationDict(pdf, annots, annotationIndex)
  const subtype = dict?.get(PDFName.of('Subtype'))?.toString()
  if (!dict || (subtype !== '/Text' && subtype !== '/FreeText')) throw new Error('This annotation is not an editable comment.')
  dict.set(PDFName.of('Contents'), PDFHexString.fromText(text))
  if (author !== undefined) dict.set(PDFName.of('T'), PDFHexString.fromText(author))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function deleteNativeComment(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const annots = pageAnnotations(pdf, pageIndex)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) throw new Error('This comment no longer exists.')
  const dict = annotationDict(pdf, annots, annotationIndex)
  const subtype = dict?.get(PDFName.of('Subtype'))?.toString()
  if (!dict || (subtype !== '/Text' && subtype !== '/FreeText')) throw new Error('This annotation is not a comment.')
  annots.remove(annotationIndex)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

function uriFromLink(dict: PDFDict) {
  const action = dict.lookupMaybe(PDFName.of('A'), PDFDict)
  if (action?.get(PDFName.of('S'))?.toString() !== '/URI') return ''
  return textValue(action.lookup(PDFName.of('URI')))
}

export async function listNativeLinks(bytes: ArrayBuffer): Promise<NativeLinkInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const result: NativeLinkInfo[] = []
  pdf.getPages().forEach((_, pageIndex) => {
    const annots = pageAnnotations(pdf, pageIndex)
    if (!annots) return
    for (let annotationIndex = 0; annotationIndex < annots.size(); annotationIndex++) {
      const dict = annotationDict(pdf, annots, annotationIndex)
      if (!dict || dict.get(PDFName.of('Subtype'))?.toString() !== '/Link') continue
      const url = uriFromLink(dict)
      if (url) result.push({ pageIndex, annotationIndex, url })
    }
  })
  return result
}

export async function updateNativeLink(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number, url: string) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const annots = pageAnnotations(pdf, pageIndex)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) throw new Error('This link no longer exists.')
  const dict = annotationDict(pdf, annots, annotationIndex)
  if (!dict || dict.get(PDFName.of('Subtype'))?.toString() !== '/Link') throw new Error('This annotation is not a link.')
  const raw = url.trim()
  if (!raw) throw new Error('Enter a URL for this link.')
  const normalized = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let action = dict.lookupMaybe(PDFName.of('A'), PDFDict)
  if (!action) {
    action = pdf.context.obj({ Type: 'Action', S: 'URI' }) as PDFDict
    dict.set(PDFName.of('A'), action)
  }
  action.set(PDFName.of('S'), PDFName.of('URI'))
  action.set(PDFName.of('URI'), PDFString.of(normalized))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function deleteNativeLink(bytes: ArrayBuffer, pageIndex: number, annotationIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const annots = pageAnnotations(pdf, pageIndex)
  if (!annots || annotationIndex < 0 || annotationIndex >= annots.size()) throw new Error('This link no longer exists.')
  const dict = annotationDict(pdf, annots, annotationIndex)
  if (!dict || dict.get(PDFName.of('Subtype'))?.toString() !== '/Link') throw new Error('This annotation is not a link.')
  annots.remove(annotationIndex)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

type LocatedBookmark = {
  dict: PDFDict
  ref: PDFRef
  parent: PDFDict
}

function outlineRoot(pdf: PDFDocument) {
  const raw = pdf.catalog.get(PDFName.of('Outlines'))
  if (raw instanceof PDFRef) return pdf.context.lookup(raw, PDFDict) || null
  if (raw instanceof PDFDict) return raw
  return null
}

function siblingRefAt(pdf: PDFDocument, parent: PDFDict, index: number) {
  let raw = parent.get(PDFName.of('First'))
  let cursor = 0
  const seen = new Set<string>()
  while (raw instanceof PDFRef) {
    const key = raw.toString()
    if (seen.has(key)) return null
    seen.add(key)
    if (cursor === index) return raw
    const dict = pdf.context.lookup(raw, PDFDict)
    if (!dict) return null
    raw = dict.get(PDFName.of('Next'))
    cursor++
  }
  return null
}

function locateBookmark(pdf: PDFDocument, path: number[]): LocatedBookmark | null {
  if (!path.length) return null
  let parent = outlineRoot(pdf)
  if (!parent) return null
  let located: LocatedBookmark | null = null
  for (let depth = 0; depth < path.length; depth++) {
    const ref = siblingRefAt(pdf, parent, path[depth])
    if (!ref) return null
    const dict = pdf.context.lookup(ref, PDFDict)
    if (!dict) return null
    located = { dict, ref, parent }
    if (depth < path.length - 1) parent = dict
  }
  return located
}

function collectBookmarks(pdf: PDFDocument, parent: PDFDict, pathPrefix: number[], depth: number, output: NativeBookmarkInfo[]) {
  let raw = parent.get(PDFName.of('First'))
  let index = 0
  const seen = new Set<string>()
  while (raw instanceof PDFRef) {
    const key = raw.toString()
    if (seen.has(key)) break
    seen.add(key)
    const dict = pdf.context.lookup(raw, PDFDict)
    if (!dict) break
    const path = [...pathPrefix, index]
    output.push({ path, title: textValue(dict.lookup(PDFName.of('Title'))) || `Bookmark ${output.length + 1}`, depth })
    if (dict.get(PDFName.of('First')) instanceof PDFRef) collectBookmarks(pdf, dict, path, depth + 1, output)
    raw = dict.get(PDFName.of('Next'))
    index++
  }
}

export async function listNativeBookmarks(bytes: ArrayBuffer): Promise<NativeBookmarkInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const root = outlineRoot(pdf)
  if (!root) return []
  const output: NativeBookmarkInfo[] = []
  collectBookmarks(pdf, root, [], 0, output)
  return output
}

function countDescendants(pdf: PDFDocument, parent: PDFDict): number {
  let total = 0
  let raw = parent.get(PDFName.of('First'))
  const seen = new Set<string>()
  while (raw instanceof PDFRef) {
    const key = raw.toString()
    if (seen.has(key)) break
    seen.add(key)
    const child = pdf.context.lookup(raw, PDFDict)
    if (!child) break
    total += 1 + countDescendants(pdf, child)
    raw = child.get(PDFName.of('Next'))
  }
  return total
}

function refreshOutlineCounts(pdf: PDFDocument, parent: PDFDict) {
  let raw = parent.get(PDFName.of('First'))
  const seen = new Set<string>()
  while (raw instanceof PDFRef) {
    const key = raw.toString()
    if (seen.has(key)) break
    seen.add(key)
    const child = pdf.context.lookup(raw, PDFDict)
    if (!child) break
    const childCount = countDescendants(pdf, child)
    if (childCount) child.set(PDFName.of('Count'), PDFNumber.of(childCount))
    else child.delete(PDFName.of('Count'))
    refreshOutlineCounts(pdf, child)
    raw = child.get(PDFName.of('Next'))
  }
  const total = countDescendants(pdf, parent)
  if (total) parent.set(PDFName.of('Count'), PDFNumber.of(total))
  else parent.delete(PDFName.of('Count'))
}

export async function renameNativeBookmark(bytes: ArrayBuffer, path: number[], title: string) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = locateBookmark(pdf, path)
  if (!located) throw new Error('This bookmark no longer exists.')
  located.dict.set(PDFName.of('Title'), PDFHexString.fromText(title.trim() || 'Bookmark'))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function deleteNativeBookmark(bytes: ArrayBuffer, path: number[]) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const located = locateBookmark(pdf, path)
  if (!located) throw new Error('This bookmark no longer exists.')
  const previous = located.dict.get(PDFName.of('Prev'))
  const next = located.dict.get(PDFName.of('Next'))

  if (previous instanceof PDFRef) {
    const previousDict = pdf.context.lookup(previous, PDFDict)
    if (previousDict) {
      if (next instanceof PDFRef) previousDict.set(PDFName.of('Next'), next)
      else previousDict.delete(PDFName.of('Next'))
    }
  } else if (next instanceof PDFRef) located.parent.set(PDFName.of('First'), next)
  else located.parent.delete(PDFName.of('First'))

  if (next instanceof PDFRef) {
    const nextDict = pdf.context.lookup(next, PDFDict)
    if (nextDict) {
      if (previous instanceof PDFRef) nextDict.set(PDFName.of('Prev'), previous)
      else nextDict.delete(PDFName.of('Prev'))
    }
  } else if (previous instanceof PDFRef) located.parent.set(PDFName.of('Last'), previous)
  else located.parent.delete(PDFName.of('Last'))

  located.dict.delete(PDFName.of('Parent'))
  located.dict.delete(PDFName.of('Prev'))
  located.dict.delete(PDFName.of('Next'))

  const root = outlineRoot(pdf)
  if (root) refreshOutlineCounts(pdf, root)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
