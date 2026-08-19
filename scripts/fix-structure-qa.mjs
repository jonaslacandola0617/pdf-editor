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

patch('src/lib/structure-tools.ts', [
  {
    label: 'select default option list value',
    from: "    field.setOptions(values.length ? values : ['Option 1', 'Option 2'])\n    if (options.required) field.enableRequired()\n    field.addToPage(page, appearance)\n  } else {",
    to: "    const choices = values.length ? values : ['Option 1', 'Option 2']\n    field.setOptions(choices)\n    field.select(choices[0])\n    if (options.required) field.enableRequired()\n    field.addToPage(page, appearance)\n  } else {",
  },
  {
    label: 'select default radio value',
    from: "    choices.forEach((choice, index) => {\n      field.addOptionToPage(choice, page, {\n        x: rect.x,\n        y: rect.y + rect.height - size * (index + 1),\n        width: size,\n        height: size,\n        borderColor: rgb(0.45, 0.45, 0.5),\n        backgroundColor: rgb(1, 1, 1),\n        borderWidth: 1,\n      })\n    })\n  }",
    to: "    choices.forEach((choice, index) => {\n      field.addOptionToPage(choice, page, {\n        x: rect.x,\n        y: rect.y + rect.height - size * (index + 1),\n        width: size,\n        height: size,\n        borderColor: rgb(0.45, 0.45, 0.5),\n        backgroundColor: rgb(1, 1, 1),\n        borderWidth: 1,\n      })\n    })\n    field.select(choices[0])\n  }",
  },
])

patch('src/components/AllTools.tsx', [
  {
    label: 'avoid form fields label collision',
    from: "{ label: 'Create form fields', description: 'Author text, checkbox, dropdown, list, or radio AcroForm fields.', icon: FormInput, run: () => activateTitle('Document tools') },",
    to: "{ label: 'Create PDF widgets', description: 'Author text, checkbox, dropdown, list, or radio AcroForm fields.', icon: FormInput, run: () => activateTitle('Document tools') },",
  },
])

console.log('Structure QA fixes applied.')
