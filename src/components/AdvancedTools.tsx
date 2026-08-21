import { useState, type ComponentProps } from 'react'
import { FileArchive, FileText, Layers3, MessageSquareText, Shapes, SlidersHorizontal, View, X } from 'lucide-react'
import { AdvancedTools as BaseAdvancedTools } from './AdvancedToolsBase'
import { AttachmentManager } from './AttachmentManager'
import { DocumentViewManager } from './DocumentViewManager'
import { FormFieldPropertyManager } from './FormFieldPropertyManager'
import { ImageSignatureManager } from './ImageSignatureManager'
import { NativeCommentDetailManager } from './NativeCommentDetailManager'
import { NativeExtendedAnnotationManager } from './NativeExtendedAnnotationManager'
import { NativeMarkupManager } from './NativeMarkupManager'
import { NativeObjectManager } from './NativeObjectManager'
import { NativePageContentManager } from './NativePageContentManager'
import { NativeShapeManager } from './NativeShapeManager'
import '../native-object-manager.css'
import '../native-comment-detail-manager.css'
import '../native-markup-manager.css'
import '../native-shape-manager.css'
import '../native-extended-manager.css'
import '../native-page-content-manager.css'
import '../object-extras.css'
import '../document-view-manager.css'
import '../form-field-manager.css'

type Props = ComponentProps<typeof BaseAdvancedTools>

type ObjectSection = 'content' | 'comments' | 'annotations' | 'forms' | 'files' | 'view'

const sections: Array<{ id: ObjectSection; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'content', label: 'Content', icon: FileText },
  { id: 'comments', label: 'Comments & links', icon: MessageSquareText },
  { id: 'annotations', label: 'Annotations', icon: Shapes },
  { id: 'forms', label: 'Forms', icon: SlidersHorizontal },
  { id: 'files', label: 'Files & signatures', icon: FileArchive },
  { id: 'view', label: 'View & navigation', icon: View },
]

export function AdvancedTools(props: Props) {
  const [objectsOpen, setObjectsOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<ObjectSection>('content')

  const jumpTo = (id: ObjectSection) => {
    setActiveSection(id)
    document.getElementById(`pdf-object-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return <>
    <BaseAdvancedTools {...props} />
    <button className="soft-btn native-objects-button" title="Embedded PDF objects" onClick={() => { setActiveSection('content'); setObjectsOpen(true) }}>
      <Layers3 /><span>Objects</span>
    </button>
    {objectsOpen && <div className="modal-backdrop native-object-backdrop" onMouseDown={() => setObjectsOpen(false)}>
      <section className="native-object-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="Embedded PDF objects">
        <header>
          <div><span className="eyebrow">PDF STRUCTURE</span><h2>PDF objects</h2><p>Inspect and manage what is actually embedded in the document. Tools are grouped by what you are trying to change.</p></div>
          <button className="icon-btn" title="Close embedded objects" onClick={() => setObjectsOpen(false)}><X /></button>
        </header>

        <nav className="object-section-nav" aria-label="PDF object sections">
          {sections.map((section) => {
            const Icon = section.icon
            return <button key={section.id} className={activeSection === section.id ? 'active' : ''} onClick={() => jumpTo(section.id)}>
              <Icon size={15} /><span>{section.label}</span>
            </button>
          })}
        </nav>

        <div className="object-section" id="pdf-object-content">
          <div className="object-section-heading"><span>01</span><div><strong>Page content</strong><small>Edit or inspect underlying text and images.</small></div></div>
          <NativePageContentManager bytes={props.bytes} currentPage={props.currentPage} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        </div>

        <div className="object-section" id="pdf-object-comments">
          <div className="object-section-heading"><span>02</span><div><strong>Comments, links & bookmarks</strong><small>Review and navigation objects from PDF Forge or other editors.</small></div></div>
          <NativeObjectManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
          <NativeCommentDetailManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        </div>

        <div className="object-section" id="pdf-object-annotations">
          <div className="object-section-heading"><span>03</span><div><strong>Native annotations</strong><small>Highlights, shapes, ink, stamps, carets and page attachments.</small></div></div>
          <NativeMarkupManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
          <NativeShapeManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
          <NativeExtendedAnnotationManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        </div>

        <div className="object-section" id="pdf-object-forms">
          <div className="object-section-heading"><span>04</span><div><strong>Interactive forms</strong><small>Manage existing AcroForm field properties and behavior.</small></div></div>
          <FormFieldPropertyManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        </div>

        <div className="object-section" id="pdf-object-files">
          <div className="object-section-heading"><span>05</span><div><strong>Files & signatures</strong><small>Embedded attachments and locally reusable image signatures.</small></div></div>
          <AttachmentManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
          <ImageSignatureManager bytes={props.bytes} currentPage={props.currentPage} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        </div>

        <div className="object-section" id="pdf-object-view">
          <div className="object-section-heading"><span>06</span><div><strong>View & navigation</strong><small>Page labels, opening behavior and local page-image export.</small></div></div>
          <DocumentViewManager bytes={props.bytes} name={props.name} pageCount={props.pageCount} currentPage={props.currentPage} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        </div>
      </section>
    </div>}
  </>
}
