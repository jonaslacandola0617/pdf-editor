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

patch('src/App.tsx', [
  {
    label: 'ignore cancelled PDF load failures',
    from: `      .catch((error) => {\n        console.error(error)\n        setStatus('Could not open this PDF. It may be encrypted or damaged.')\n      })`,
    to: `      .catch((error) => {\n        if (cancelled) return\n        const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : ''\n        if (name === 'AbortException' || name === 'WorkerTransportDestroyedException') return\n        console.error(error)\n        setStatus('Could not open this PDF. It may be encrypted or damaged.')\n      })`,
  },
])

patch('src/components/AllTools.tsx', [
  {
    label: 'remove legacy form-fields substring from new action',
    from: "{ label: 'Create PDF widgets', description: 'Author text, checkbox, dropdown, list, or radio AcroForm fields.', icon: FormInput, run: () => activateTitle('Document tools') },",
    to: "{ label: 'Create PDF widgets', description: 'Author interactive text, checkbox, dropdown, list, and radio widgets.', icon: FormInput, run: () => activateTitle('Document tools') },",
  },
])

console.log('PDF load race and All Tools label fixed.')
