import { useState, type ComponentProps } from 'react'
import { ImagePlus, Layers3, X } from 'lucide-react'
import { AdvancedTools as BaseAdvancedTools } from './AdvancedToolsBase'
import { AttachmentManager } from './AttachmentManager'
import { ImageSignatureManager } from './ImageSignatureManager'
import { NativeObjectManager } from './NativeObjectManager'
import '../native-object-manager.css'
import '../object-extras.css'

type Props = ComponentProps<typeof BaseAdvancedTools>

export function AdvancedTools(props: Props) {
  const [objectsOpen, setObjectsOpen] = useState(false)
  const [imageSignatureOpen, setImageSignatureOpen] = useState(false)

  return <>
    <BaseAdvancedTools {...props} />
    <button className="soft-btn native-objects-button" title="Embedded PDF objects" onClick={() => setObjectsOpen(true)}>
      <Layers3 /><span>Objects</span>
    </button>
    <button className="soft-btn image-signature-button" title="Image signatures" onClick={() => setImageSignatureOpen(true)}>
      <ImagePlus /><span>Image sign</span>
    </button>

    {objectsOpen && <div className="modal-backdrop native-object-backdrop" onMouseDown={() => setObjectsOpen(false)}>
      <section className="native-object-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="Embedded PDF objects">
        <header>
          <div><span className="eyebrow">NATIVE PDF STRUCTURE</span><h2>Embedded objects</h2><p>Edit comments, links, bookmarks and file attachments already stored inside this PDF.</p></div>
          <button className="icon-btn" title="Close embedded objects" onClick={() => setObjectsOpen(false)}><X /></button>
        </header>
        <NativeObjectManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
        <AttachmentManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
      </section>
    </div>}

    {imageSignatureOpen && <div className="modal-backdrop native-object-backdrop" onMouseDown={() => setImageSignatureOpen(false)}>
      <section className="native-object-modal image-signature-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="Image signatures">
        <header>
          <div><span className="eyebrow">VISUAL SIGNING</span><h2>Image signatures</h2><p>Import reusable PNG/JPG signatures locally and place them permanently on the current PDF page.</p></div>
          <button className="icon-btn" title="Close image signatures" onClick={() => setImageSignatureOpen(false)}><X /></button>
        </header>
        <ImageSignatureManager bytes={props.bytes} currentPage={props.currentPage} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
      </section>
    </div>}
  </>
}
