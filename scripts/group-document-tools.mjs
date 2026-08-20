import fs from 'node:fs'
const path = 'src/components/AdvancedToolsBase.tsx'
let src = fs.readFileSync(path, 'utf8')

const replacements = [
  [
    '<div className="advanced-grid">',
    `<nav className="advanced-category-nav" aria-label="Document tool categories"><button onClick={() => document.getElementById('advanced-pages-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Pages & content</button><button onClick={() => document.getElementById('advanced-forms-navigation')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Forms & navigation</button><button onClick={() => document.getElementById('advanced-security')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Security & privacy</button><button onClick={() => document.getElementById('advanced-output')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Output & optimize</button></nav><div className="advanced-grid"><div className="advanced-category-marker" id="advanced-pages-content"><span>01</span><div><strong>Pages & content</strong><small>Build pages and add visible document content.</small></div></div>`
  ],
  [
    '<section className="advanced-card structure-card"><h3><Type /> Create form field</h3>',
    '<div className="advanced-category-marker" id="advanced-forms-navigation"><span>02</span><div><strong>Forms & navigation</strong><small>Interactive fields, links, bookmarks and document identifiers.</small></div></div><section className="advanced-card structure-card"><h3><Type /> Create form field</h3>'
  ],
  [
    '<section className="advanced-card danger-card"><h3><ShieldCheck /> Privacy cleanup</h3>',
    '<div className="advanced-category-marker" id="advanced-security"><span>03</span><div><strong>Security & privacy</strong><small>Remove sensitive information and apply irreversible changes deliberately.</small></div></div><section className="advanced-card danger-card"><h3><ShieldCheck /> Privacy cleanup</h3>'
  ],
  [
    '<section className="advanced-card"><h3><FileSearch /> OCR searchable PDF</h3>',
    '<div className="advanced-category-marker" id="advanced-output"><span>04</span><div><strong>Output & optimize</strong><small>Searchability, compression, protection and printing.</small></div></div><section className="advanced-card"><h3><FileSearch /> OCR searchable PDF</h3>'
  ],
]

for (const [from, to] of replacements) {
  if (!src.includes(from)) throw new Error(`Document Tools patch target not found: ${from.slice(0, 80)}`)
  src = src.replace(from, to)
}
fs.writeFileSync(path, src)
// audit patch trigger
