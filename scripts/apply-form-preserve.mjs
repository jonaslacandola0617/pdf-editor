import fs from 'node:fs'

function patch(path, transforms) {
  let source = fs.readFileSync(path, 'utf8')
  for (const { label, from, to } of transforms) {
    const next = source.replace(from, to)
    if (next === source) throw new Error(`${path}: patch failed: ${label}`)
    source = next
  }
  fs.writeFileSync(path, source)
}

patch('src/lib/pdf.ts', [
  {
    label: 'preserve form fields in standard export',
    from: /\n  try \{\n    pdf\.getForm\(\)\.flatten\(\)\n  \} catch \{\n    \/\/ Some PDFs contain malformed form structures; annotations can still export\.\n  \}\n\n  return await pdf\.save\(\{ useObjectStreams: true \}\)/,
    to: `
  return await pdf.save({ useObjectStreams: true })`,
  },
  {
    label: 'explicit form flatten helper',
    from: /\nexport async function readMetadata/,
    to: `
export async function flattenFormFields(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  pdf.getForm().flatten()
  return (await pdf.save({ useObjectStreams: true })).buffer as ArrayBuffer
}

export async function readMetadata`,
  },
])

patch('src/components/AdvancedTools.tsx', [
  {
    label: 'flatten helper import',
    from: "  addHeaderFooter, addImageToPage, addWatermark, cropPage, downloadBytes, flattenAnnotations,",
    to: "  addHeaderFooter, addImageToPage, addWatermark, cropPage, downloadBytes, flattenAnnotations, flattenFormFields,",
  },
  {
    label: 'flatten form action',
    from: "  const createLink = () => mutate('Adding PDF link'",
    to: "  const flattenForm = () => mutate('Flattening form fields', () => flattenFormFields(bytes))\n  const createLink = () => mutate('Adding PDF link'",
  },
  {
    label: 'flatten form button',
    from: "<button onClick={createFormField}>Add form field</button></section>",
    to: "<div className=\"advanced-row\"><button onClick={createFormField}>Add form field</button><button onClick={flattenForm}>Flatten form fields</button></div></section>",
  },
])

console.log('Interactive form preservation applied.')
