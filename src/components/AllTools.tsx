import { useEffect, useState } from 'react'
import {
  Copy, Download, FileInput, Files, FormInput, Highlighter, Info, Library, Menu,
  Bookmark, MousePointer2, PenLine, RotateCcw, RotateCw, Save, ScanLine, Search, Shapes, Split,
  StickyNote, Trash2, Type, Upload, WandSparkles, X,
} from 'lucide-react'

type ToolAction = {
  label: string
  description: string
  icon: React.ComponentType<{ size?: number }>
  run: () => void
}

function findButtonByTitle(title: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[title]'))
    .find((button) => button.title === title)
}

function findButtonByText(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.app-shell button'))
    .find((button) => button.textContent?.trim() === label)
}

export function AllTools() {
  const [editorVisible, setEditorVisible] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const sync = () => {
      const visible = Boolean(document.querySelector('.app-shell'))
      setEditorVisible(visible)
      if (!visible) setOpen(false)
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  if (!editorVisible) return null

  const activateTitle = (title: string) => {
    findButtonByTitle(title)?.click()
    setOpen(false)
  }

  const activateText = (label: string) => {
    findButtonByText(label)?.click()
    setOpen(false)
  }

  const openFiles = () => {
    document.querySelector<HTMLInputElement>('.app-shell input[type="file"]')?.click()
    setOpen(false)
  }

  const focusSearch = () => {
    setOpen(false)
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Find in document"]')
      input?.focus()
      input?.select()
    }, 40)
  }

  const sections: Array<{ title: string; subtitle: string; actions: ToolAction[] }> = [
    {
      title: 'Edit & annotate',
      subtitle: 'Edit real PDF text or add markup.',
      actions: [
        { label: 'Select', description: 'Select, move and resize annotations.', icon: MousePointer2, run: () => activateTitle('Select') },
        { label: 'Edit existing text', description: 'Change text already embedded in the PDF.', icon: PenLine, run: () => activateTitle('Edit existing text') },
        { label: 'Add text', description: 'Place a new editable text annotation.', icon: Type, run: () => activateTitle('Add text') },
        { label: 'Sticky note', description: 'Add a standard PDF comment at a page location.', icon: StickyNote, run: () => activateTitle('Sticky note') },
        { label: 'Highlight', description: 'Mark an area with color.', icon: Highlighter, run: () => activateTitle('Highlight') },
        { label: 'Rectangle', description: 'Draw an outlined box.', icon: Shapes, run: () => activateTitle('Rectangle') },
        { label: 'Redact', description: 'Mark sensitive areas for destructive redaction.', icon: ScanLine, run: () => activateTitle('Redact') },
        { label: 'Draw', description: 'Add freehand ink.', icon: PenLine, run: () => activateTitle('Draw') },
        { label: 'Signature', description: 'Draw a handwritten signature.', icon: PenLine, run: () => activateTitle('Signature') },
      ],
    },
    {
      title: 'Organize pages',
      subtitle: 'Rearrange or build the document.',
      actions: [
        { label: 'Pages', description: 'Open thumbnails and reorder pages.', icon: Files, run: () => activateTitle('Pages') },
        { label: 'Rotate left', description: 'Rotate the current page left.', icon: RotateCcw, run: () => activateTitle('Rotate left') },
        { label: 'Rotate right', description: 'Rotate the current page right.', icon: RotateCw, run: () => activateTitle('Rotate right') },
        { label: 'Duplicate', description: 'Copy the current page.', icon: Copy, run: () => activateText('Duplicate') },
        { label: 'Delete page', description: 'Remove the current page.', icon: Trash2, run: () => activateText('Delete') },
        { label: 'Merge files', description: 'Append PDFs or images.', icon: FileInput, run: () => activateText('Merge') },
        { label: 'Extract pages', description: 'Save selected pages as a PDF.', icon: Split, run: () => activateText('Extract') },
        { label: 'More page tools', description: 'Insert, replace, crop and add images.', icon: WandSparkles, run: () => activateTitle('Document tools') },
      ],
    },
    {
      title: 'Document & security',
      subtitle: 'Permanent local PDF operations.',
      actions: [
        { label: 'Document tools', description: 'Watermarks, page numbers, OCR export, optimize, protect and print.', icon: WandSparkles, run: () => activateTitle('Document tools') },
        { label: 'Create PDF widgets', description: 'Author text, checkbox, dropdown, list, or radio AcroForm fields.', icon: FormInput, run: () => activateTitle('Document tools') },
        { label: 'Add links & bookmarks', description: 'Add native URI links and PDF outline bookmarks.', icon: FileInput, run: () => activateTitle('Document tools') },
        { label: 'Bates numbering', description: 'Apply document-control identifiers across pages.', icon: Type, run: () => activateTitle('Document tools') },
        { label: 'Privacy cleanup', description: 'Remove metadata, embedded-file references, and unsafe active actions.', icon: Info, run: () => activateTitle('Document tools') },
        { label: 'Bookmarks & favorites', description: 'Navigate the PDF outline and favorite local documents.', icon: Bookmark, run: () => activateTitle('Bookmarks & favorites') },
        { label: 'Search / OCR', description: 'Find text; scans use local OCR.', icon: Search, run: focusSearch },
        { label: 'Form fields', description: 'Fill detected AcroForm fields.', icon: FormInput, run: () => activateTitle('Form fields') },
        { label: 'Document info', description: 'Edit title, author and keywords.', icon: Info, run: () => activateTitle('Document info') },
      ],
    },
    {
      title: 'File',
      subtitle: 'Open, keep, and export documents.',
      actions: [
        { label: 'Open files', description: 'Open PDF, PNG, or JPG files.', icon: Upload, run: openFiles },
        { label: 'Local library', description: 'View PDFs stored in this browser.', icon: Library, run: () => activateTitle('Library') },
        { label: 'Save locally', description: 'Save editor state to IndexedDB.', icon: Save, run: () => activateText('Save') },
        { label: 'Export PDF', description: 'Download the finished PDF.', icon: Download, run: () => activateText('Export PDF') },
      ],
    },
  ]

  return (
    <>
      <button className={`all-tools-launcher ${open ? 'active' : ''}`} type="button" title="All Tools" aria-label="All Tools" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Menu size={18} /><span>Tools</span>
      </button>

      {open && (
        <div className="all-tools-layer" role="presentation">
          <button className="all-tools-backdrop" aria-label="Close All Tools" onClick={() => setOpen(false)} />
          <aside className="all-tools-drawer" aria-label="All Tools">
            <header className="all-tools-header">
              <div><span className="all-tools-eyebrow">PDF FORGE</span><h2>All Tools</h2><p>Everything available in the editor, in one place.</p></div>
              <button className="all-tools-close" type="button" title="Close All Tools" onClick={() => setOpen(false)}><X size={18} /></button>
            </header>

            <div className="all-tools-content">
              {sections.map((section) => (
                <section className="all-tools-section" key={section.title}>
                  <div className="all-tools-section-title"><h3>{section.title}</h3><p>{section.subtitle}</p></div>
                  <div className="all-tools-grid">
                    {section.actions.map((action) => {
                      const Icon = action.icon
                      return <button className="all-tools-action" type="button" key={action.label} onClick={action.run}>
                        <span className="all-tools-action-icon"><Icon size={19} /></span>
                        <span><strong>{action.label}</strong><small>{action.description}</small></span>
                      </button>
                    })}
                  </div>
                </section>
              ))}
            </div>

            <footer className="all-tools-footer"><span className="all-tools-local-dot" />PDFs, OCR and security tools stay on this device.</footer>
          </aside>
        </div>
      )}
    </>
  )
}
