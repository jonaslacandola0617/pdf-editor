import { useState, type ComponentProps } from 'react'
import { Layers3, X } from 'lucide-react'
import { AdvancedTools as BaseAdvancedTools } from './AdvancedToolsBase'
import { AttachmentManager } from './AttachmentManager'
import { ImageSignatureManager } from './ImageSignatureManager'
import { NativeObjectManager } from './NativeObjectManager'
import '../native-object-manager.css'
import '../object-extras.css'

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
          <div><span className="eyebrow">PDF OBJECTS & LOCAL ASSETS</span><h2>Objects & signatures</h2><p>Edit comments, links, bookmarks and attachments stored inside the PDF, plus reuse local PNG/JPG visual signatures.</p></div>
          <button className="icon-btn" title="Close embedded objects" onClick={() => setObjectsOpen(false)}><X /></button>
        </header>
        <NativeObjectManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <AttachmentManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <ImageSignatureManager bytes={props.bytes} currentPage={props.currentPage} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
      </section>
    </div>}
  </>
}
