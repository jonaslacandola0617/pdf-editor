import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from 'pdf-lib'

export type PageLabelStyle = 'decimal' | 'roman-upper' | 'roman-lower' | 'letters-upper' | 'letters-lower' | 'none'

export type PageLabelRule = {
  startPage: number
  style: PageLabelStyle
  prefix: string
  startNumber: number
}

export type InitialViewOptions = {
  pageIndex: number
  magnification: 'fit-page' | 'fit-width' | 'actual-size'
  pageMode: 'none' | 'outlines' | 'thumbnails' | 'fullscreen' | 'attachments'
  pageLayout: 'single' | 'one-column' | 'two-column-left' | 'two-column-right' | 'two-page-left' | 'two-page-right'
}

const STYLE_TO_NAME: Record<Exclude<PageLabelStyle, 'none'>, string> = {
  decimal: 'D',
  'roman-upper': 'R',
  'roman-lower': 'r',
  'letters-upper': 'A',
  'letters-lower': 'a',
}

const NAME_TO_STYLE: Record<string, PageLabelStyle> = {
  '/D': 'decimal',
  '/R': 'roman-upper',
  '/r': 'roman-lower',
  '/A': 'letters-upper',
  '/a': 'letters-lower',
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function textValue(value: unknown) {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText()
  return ''
}

function pageLabelsDict(pdf: PDFDocument) {
  return pdf.catalog.lookupMaybe(PDFName.of('PageLabels'), PDFDict) || null
}

function collectNumberTreeRules(node: PDFDict, output: PageLabelRule[], seen = new Set<PDFDict>()) {
  if (seen.has(node)) return
  seen.add(node)

  const nums = node.lookupMaybe(PDFName.of('Nums'), PDFArray)
  if (nums) {
    for (let index = 0; index + 1 < nums.size(); index += 2) {
      const pageNumber = nums.lookup(index, PDFNumber)?.asNumber()
      const dict = nums.lookup(index + 1, PDFDict)
      if (typeof pageNumber !== 'number' || !dict) continue
      const styleName = dict.get(PDFName.of('S'))?.toString() || ''
      const prefix = textValue(dict.lookup(PDFName.of('P')))
      const startNumber = dict.lookupMaybe(PDFName.of('St'), PDFNumber)?.asNumber() || 1
      output.push({ startPage: pageNumber, style: NAME_TO_STYLE[styleName] || 'none', prefix, startNumber })
    }
  }

  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray)
  if (!kids) return
  for (let index = 0; index < kids.size(); index++) {
    const child = kids.lookup(index, PDFDict)
    if (child) collectNumberTreeRules(child, output, seen)
  }
}

function directRules(pdf: PDFDocument): PageLabelRule[] {
  const root = pageLabelsDict(pdf)
  if (!root) return []
  const rules: PageLabelRule[] = []
  collectNumberTreeRules(root, rules)
  const deduped = new Map<number, PageLabelRule>()
  rules.forEach((rule) => deduped.set(rule.startPage, rule))
  return [...deduped.values()].sort((a, b) => a.startPage - b.startPage)
}

function writeRules(pdf: PDFDocument, rules: PageLabelRule[]) {
  const normalized = [...rules]
    .filter((rule) => rule.startPage >= 0 && rule.startPage < pdf.getPageCount())
    .sort((a, b) => a.startPage - b.startPage)
  if (!normalized.length) {
    pdf.catalog.delete(PDFName.of('PageLabels'))
    return
  }

  const nums = pdf.context.obj([]) as PDFArray
  normalized.forEach((rule) => {
    const dict = pdf.context.obj({}) as PDFDict
    if (rule.style !== 'none') dict.set(PDFName.of('S'), PDFName.of(STYLE_TO_NAME[rule.style]))
    if (rule.prefix) dict.set(PDFName.of('P'), PDFHexString.fromText(rule.prefix))
    if (rule.startNumber !== 1 && rule.style !== 'none') dict.set(PDFName.of('St'), PDFNumber.of(Math.max(1, Math.floor(rule.startNumber))))
    nums.push(PDFNumber.of(rule.startPage))
    nums.push(dict)
  })
  const root = pdf.context.obj({}) as PDFDict
  root.set(PDFName.of('Nums'), nums)
  pdf.catalog.set(PDFName.of('PageLabels'), root)
}

export async function listPageLabelRules(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return directRules(pdf)
}

export async function upsertPageLabelRule(bytes: ArrayBuffer, rule: PageLabelRule) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const startPage = clamp(Math.floor(rule.startPage), 0, Math.max(0, pdf.getPageCount() - 1))
  const rules = directRules(pdf).filter((item) => item.startPage !== startPage)
  rules.push({ ...rule, startPage, startNumber: Math.max(1, Math.floor(rule.startNumber || 1)) })
  writeRules(pdf, rules)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function removePageLabelRule(bytes: ArrayBuffer, startPage: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  writeRules(pdf, directRules(pdf).filter((rule) => rule.startPage !== startPage))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function clearPageLabels(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  pdf.catalog.delete(PDFName.of('PageLabels'))
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

const PAGE_MODE_TO_NAME: Record<InitialViewOptions['pageMode'], string> = {
  none: 'UseNone',
  outlines: 'UseOutlines',
  thumbnails: 'UseThumbs',
  fullscreen: 'FullScreen',
  attachments: 'UseAttachments',
}

const PAGE_LAYOUT_TO_NAME: Record<InitialViewOptions['pageLayout'], string> = {
  single: 'SinglePage',
  'one-column': 'OneColumn',
  'two-column-left': 'TwoColumnLeft',
  'two-column-right': 'TwoColumnRight',
  'two-page-left': 'TwoPageLeft',
  'two-page-right': 'TwoPageRight',
}

export async function setInitialView(bytes: ArrayBuffer, options: InitialViewOptions) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const index = clamp(Math.floor(options.pageIndex), 0, Math.max(0, pdf.getPageCount() - 1))
  const page = pdf.getPage(index)
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of(PAGE_MODE_TO_NAME[options.pageMode]))
  pdf.catalog.set(PDFName.of('PageLayout'), PDFName.of(PAGE_LAYOUT_TO_NAME[options.pageLayout]))
  const destination = options.magnification === 'fit-width'
    ? pdf.context.obj([page.ref, PDFName.of('FitH'), null])
    : options.magnification === 'actual-size'
      ? pdf.context.obj([page.ref, PDFName.of('XYZ'), null, null, 1])
      : pdf.context.obj([page.ref, PDFName.of('Fit')])
  pdf.catalog.set(PDFName.of('OpenAction'), destination)
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}
