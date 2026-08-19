import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib'

export type PdfAttachmentInfo = {
  id: string
  name: string
  description: string
  size: number
}

type RawAttachment = {
  node: PDFDict
  names: PDFArray
  pairIndex: number
  name: string
  fileSpec: PDFDict
}

function textValue(value: unknown) {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return ''
}

function collectNameLeaves(pdf: PDFDocument, node: PDFDict, output: PDFDict[], seen = new Set<string>()) {
  const marker = node.toString()
  if (seen.has(marker)) return
  seen.add(marker)
  if (node.has(PDFName.of('Names'))) output.push(node)
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
  if (!kids) return
  for (let index = 0; index < kids.size(); index++) {
    const child = kids.lookup(index, PDFDict)
    if (child) collectNameLeaves(pdf, child, output, seen)
  }
}

function rawAttachments(pdf: PDFDocument): RawAttachment[] {
  const namesRoot = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const embedded = namesRoot?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
  if (!embedded) return []
  const leaves: PDFDict[] = []
  collectNameLeaves(pdf, embedded, leaves)
  const result: RawAttachment[] = []
  leaves.forEach((node) => {
    const names = node.lookupMaybe(PDFName.of('Names'), PDFArray)
    if (!names) return
    for (let pairIndex = 0; pairIndex + 1 < names.size(); pairIndex += 2) {
      const nameValue = names.lookup(pairIndex)
      const fileSpec = names.lookup(pairIndex + 1, PDFDict)
      if (!fileSpec) continue
      const name = textValue(nameValue) || textValue(fileSpec.lookup(PDFName.of('UF'))) || textValue(fileSpec.lookup(PDFName.of('F'))) || `attachment-${result.length + 1}`
      result.push({ node, names, pairIndex, name, fileSpec })
    }
  })
  return result
}

function attachmentData(fileSpec: PDFDict) {
  const ef = fileSpec.lookupMaybe(PDFName.of('EF'), PDFDict)
  if (!ef) return new Uint8Array()
  const stream = ef.lookup(PDFName.of('UF'), PDFStream) || ef.lookup(PDFName.of('F'), PDFStream)
  if (!(stream instanceof PDFRawStream)) return new Uint8Array()
  return decodePDFRawStream(stream).decode()
}

export async function listPdfAttachments(bytes: ArrayBuffer): Promise<PdfAttachmentInfo[]> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return rawAttachments(pdf).map((item, index) => ({
    id: `${index}:${item.name}`,
    name: item.name,
    description: textValue(item.fileSpec.lookup(PDFName.of('Desc'))),
    size: attachmentData(item.fileSpec).byteLength,
  }))
}

export async function addPdfAttachment(bytes: ArrayBuffer, file: File, description = '') {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const existing = new Set(rawAttachments(pdf).map((item) => item.name.toLocaleLowerCase()))
  let name = file.name || 'attachment.bin'
  if (existing.has(name.toLocaleLowerCase())) {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    let index = 2
    while (existing.has(`${stem} (${index})${ext}`.toLocaleLowerCase())) index++
    name = `${stem} (${index})${ext}`
  }
  await pdf.attach(await file.arrayBuffer(), name, {
    mimeType: file.type || undefined,
    description: description.trim() || undefined,
    creationDate: new Date(),
    modificationDate: file.lastModified ? new Date(file.lastModified) : new Date(),
  })
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function extractPdfAttachment(bytes: ArrayBuffer, id: string) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const items = rawAttachments(pdf)
  const index = Number(id.split(':', 1)[0])
  const item = Number.isFinite(index) ? items[index] : undefined
  if (!item) throw new Error('This attachment no longer exists.')
  const data = attachmentData(item.fileSpec)
  if (!data.byteLength) throw new Error('This attachment stream could not be decoded.')
  return { name: item.name, data }
}

export async function removePdfAttachment(bytes: ArrayBuffer, id: string) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const items = rawAttachments(pdf)
  const index = Number(id.split(':', 1)[0])
  const item = Number.isFinite(index) ? items[index] : undefined
  if (!item) throw new Error('This attachment no longer exists.')
  item.names.remove(item.pairIndex + 1)
  item.names.remove(item.pairIndex)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
