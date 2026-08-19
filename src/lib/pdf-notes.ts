import { PDFArray, PDFDocument, PDFHexString, PDFName } from 'pdf-lib'
import type { Annotation } from '../types'

/** Add PDF Forge note annotations as standard PDF /Text annotations. */
export async function embedNativeNotes(bytes: ArrayBuffer, notes: Annotation[]) {
  if (!notes.length) return bytes.slice(0)
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })

  for (const note of notes) {
    if (note.type !== 'note' || note.page < 0 || note.page >= pdf.getPageCount()) continue
    const page = pdf.getPage(note.page)
    const width = page.getWidth()
    const height = page.getHeight()
    const x = Math.max(0, Math.min(width - 22, note.x * width))
    const y = Math.max(0, Math.min(height - 22, height - note.y * height - 22))

    let annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) {
      annots = pdf.context.obj([]) as PDFArray
      page.node.set(PDFName.of('Annots'), annots)
    }

    const annotation = pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [x, y, x + 22, y + 22],
      Contents: PDFHexString.fromText(note.text || 'Note'),
      Name: 'Comment',
      C: [1, 0.82, 0.18],
      T: PDFHexString.fromText('PDF Forge'),
      M: PDFHexString.fromText(`D:${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}Z`),
      Open: false,
    })
    annots.push(pdf.context.register(annotation))
  }

  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
