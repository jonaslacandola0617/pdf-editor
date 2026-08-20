import { useState, type ComponentProps } from 'react'
import { Layers3, X } from 'lucide-react'
import { AdvancedTools as BaseAdvancedTools } from './AdvancedToolsBase'
import { AttachmentManager } from './AttachmentManager'
import { DocumentViewManager } from './DocumentViewManager'
import { FormFieldPropertyManager } from './FormFieldPropertyManager'
import { ImageSignatureManager } from './ImageSignatureManager'
import { NativeExtendedAnnotationManager } from './NativeExtendedAnnotationManager'
import { NativeMarkupManager } from './NativeMarkupManager'
import { NativeObjectManager } from './NativeObjectManager'
import { NativeShapeManager } from './NativeShapeManager'
import '../native-object-manager.css'
import '../native-markup-manager.css'
import '../native-shape-manager.css'
import '../native-extended-manager.css'
import '../object-extras.css'
import '../document-view-manager.css'
import '../form-field-manager.css'

type Props = ComponentProps<typeof BaseAdvancedTools>

export function AdvancedTools(props: Props) {
  const [objectsOpen, setObjectsOpen] = useState(false)

  return <>
    <BaseAdvancedTools {...props} />
    <button className="soft-btn native-objects-button" title="Embedded PDF objects" onClick={() => setObjectsOpen(true)}>
      <Layers3 /><span>Objects</span>
    </button>
    {objectsOpen && <div className="modal-backdrop native-object-backdrop" onMouseDown={() => setObjectsOpen(false)}>
      <section className="native-object-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="Embedded PDF objects">
        <header>
          <div><span className="eyebrow">PDF STRUCTURE & LOCAL ASSETS</span><h2>Objects, navigation & signatures</h2><p>Manage native PDF objects, markups, shapes and extended annotations, interactive form properties, reusable signatures, page labels, initial-view preferences and local page-image exports.</p></div>
          <button className="icon-btn" title="Close embedded objects" onClick={() => setObjectsOpen(false)}><X /></button>
        </header>
        <NativeObjectManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <NativeMarkupManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <NativeShapeManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <NativeExtendedAnnotationManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <FormFieldPropertyManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <AttachmentManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <ImageSignatureManager bytes={props.bytes} currentPage={props.currentPage} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <DocumentViewManager bytes={props.bytes} name={props.name} pageCount={props.pageCount} currentPage={props.currentPage} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
      </section>
    </div>}
  </>
}
