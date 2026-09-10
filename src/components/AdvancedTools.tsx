import { useState, type ComponentProps } from 'react'
import { FileArchive, FileText, Layers3, MessageSquareText, Shapes, SlidersHorizontal, View, X } from 'lucide-react'
import { AdvancedTools as BaseAdvancedTools } from './AdvancedToolsBase'
import { AttachmentManager } from './AttachmentManager'
import { DocumentViewManager } from './DocumentViewManager'
import { FormFieldPropertyManager } from './FormFieldPropertyManager'
import { AdvancedFormWidgetManager } from './AdvancedFormWidgetManager'
import '../advanced-form-widget-manager.css'
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
type ObjectTool = 'page-content' | 'links' | 'comment-details' | 'markup' | 'shapes' | 'extended' | 'form-properties' | 'form-layout' | 'attachments' | 'signatures' | 'document-view'

type ToolMeta = { id: ObjectTool; label: string; description: string }
type SectionMeta = { id: ObjectSection; label: string; description: string; icon: React.ComponentType<{ size?: number }>; tools: ToolMeta[] }

const sections: SectionMeta[] = [
  { id: 'content', label: 'Content', description: 'Underlying page text and imagery.', icon: FileText, tools: [
    { id: 'page-content', label: 'Page content', description: 'Inspect and edit native text and images on the current page.' },
  ] },
  { id: 'comments', label: 'Comments & links', description: 'Review and navigation objects.', icon: MessageSquareText, tools: [
    { id: 'links', label: 'Links & bookmarks', description: 'Inspect native links, bookmarks, destinations, and related objects.' },
    { id: 'comment-details', label: 'Comment details', description: 'Inspect and edit detailed native comment metadata.' },
  ] },
  { id: 'annotations', label: 'Annotations', description: 'Native markup and drawing objects.', icon: Shapes, tools: [
    { id: 'markup', label: 'Markup', description: 'Manage highlights, underlines, strikeouts, and text markup.' },
    { id: 'shapes', label: 'Shapes', description: 'Manage native line, square, circle, and polygon annotations.' },
    { id: 'extended', label: 'Extended annotations', description: 'Manage stamps, carets, ink, and other extended annotation types.' },
  ] },
  { id: 'forms', label: 'Forms', description: 'Existing AcroForm fields and widgets.', icon: SlidersHorizontal, tools: [
    { id: 'form-properties', label: 'Field properties', description: 'Edit existing form field behavior and values.' },
    { id: 'form-layout', label: 'Widget layout', description: 'Inspect and adjust widget geometry on the current page.' },
  ] },
  { id: 'files', label: 'Files & signatures', description: 'Embedded files and reusable signatures.', icon: FileArchive, tools: [
    { id: 'attachments', label: 'Attachments', description: 'Inspect, add, download, or remove embedded files.' },
    { id: 'signatures', label: 'Image signatures', description: 'Manage locally reusable image-based signatures.' },
  ] },
  { id: 'view', label: 'View & navigation', description: 'Opening behavior and page output.', icon: View, tools: [
    { id: 'document-view', label: 'Document view', description: 'Manage page labels, opening behavior, and page-image export.' },
  ] },
]

export function AdvancedTools(props: Props) {
  const [objectsOpen, setObjectsOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<ObjectSection>('content')
  const [activeTool, setActiveTool] = useState<ObjectTool>('page-content')

  const chooseSection = (id: ObjectSection) => {
    setActiveSection(id)
    const first = sections.find((section) => section.id === id)?.tools[0]
    if (first) setActiveTool(first.id)
  }

  const section = sections.find((item) => item.id === activeSection) || sections[0]
  const tool = section.tools.find((item) => item.id === activeTool) || section.tools[0]

  const toolContent = () => {
    const common = { bytes: props.bytes, onBeforeMutate: props.onBeforeMutate, onApply: props.onApply, onStatus: props.onStatus }
    switch (activeTool) {
      case 'page-content': return <NativePageContentManager {...common} currentPage={props.currentPage} />
      case 'links': return <NativeObjectManager {...common} />
      case 'comment-details': return <NativeCommentDetailManager {...common} />
      case 'markup': return <NativeMarkupManager {...common} />
      case 'shapes': return <NativeShapeManager {...common} />
      case 'extended': return <NativeExtendedAnnotationManager {...common} />
      case 'form-properties': return <FormFieldPropertyManager {...common} />
      case 'form-layout': return <AdvancedFormWidgetManager {...common} currentPage={props.currentPage} />
      case 'attachments': return <AttachmentManager {...common} />
      case 'signatures': return <ImageSignatureManager {...common} currentPage={props.currentPage} />
      case 'document-view': return <DocumentViewManager {...common} name={props.name} pageCount={props.pageCount} currentPage={props.currentPage} />
    }
  }

  return <>
    <BaseAdvancedTools {...props} />
    <button className="soft-btn native-objects-button" title="Embedded PDF objects" onClick={() => { setActiveSection('content'); setActiveTool('page-content'); setObjectsOpen(true) }}>
      <Layers3 /><span>Objects</span>
    </button>
    {objectsOpen && <div className="modal-backdrop native-object-backdrop" onMouseDown={() => setObjectsOpen(false)}>
      <section className="native-object-modal object-focus-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="Embedded PDF objects">
        <header>
          <div><span className="eyebrow">PDF STRUCTURE</span><h2>PDF objects</h2><p>Choose an object family, then one tool. Only that manager stays visible.</p></div>
          <button className="icon-btn" title="Close embedded objects" onClick={() => setObjectsOpen(false)}><X /></button>
        </header>

        <div className="object-focus-layout">
          <nav className="object-category-rail" aria-label="PDF object categories">
            {sections.map((item, index) => {
              const Icon = item.icon
              return <button key={item.id} className={activeSection === item.id ? 'active' : ''} onClick={() => chooseSection(item.id)}>
                <i>{String(index + 1).padStart(2, '0')}</i><Icon size={17} /><span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            })}
          </nav>

          <nav className="object-tool-rail" aria-label={`${section.label} tools`}>
            <div><span>TOOLS</span><strong>{section.label}</strong></div>
            {section.tools.map((item) => <button key={item.id} className={activeTool === item.id ? 'active' : ''} onClick={() => setActiveTool(item.id)}><span>{item.label}</span></button>)}
          </nav>

          <main className="object-tool-pane">
            <header><span className="eyebrow">{section.label}</span><h3>{tool.label}</h3><p>{tool.description}</p></header>
            <div className="object-tool-content">{toolContent()}</div>
          </main>
        </div>
      </section>
    </div>}
  </>
}
