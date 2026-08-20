import fs from 'node:fs'
const path = 'tests/native-annotation-completion.spec.ts'
let src = fs.readFileSync(path, 'utf8')
const from = "expect(freeDict.lookup(PDFName.of('Contents'))?.toString()).toContain('free text updated')"
const to = "expect((freeDict.lookup(PDFName.of('Contents')) as PDFString | PDFHexString).decodeText()).toBe('free text updated')"
if (!src.includes(from)) throw new Error('Expected FreeText assertion not found')
src = src.replace(from, to)
fs.writeFileSync(path, src)
