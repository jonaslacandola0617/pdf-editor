import { useState, type ComponentProps } from 'react'
import { Layers3, X } from 'lucide-react'
import { AdvancedTools as BaseAdvancedTools } from './AdvancedToolsBase'
import { NativeObjectManager } from './NativeObjectManager'
import '../native-object-manager.css'

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
          <div><span className="eyebrow">NATIVE PDF STRUCTURE</span><h2>Embedded objects</h2><p>Edit objects that already exist inside this PDF, including ones created by other editors.</p></div>
          <button className="icon-btn" title="Close embedded objects" onClick={() => setObjectsOpen(false)}><X /></button>
        </header>
        <NativeObjectManager bytes={props.bytes} onBeforeMutate={props.onBeforeMutate} onApply={props.onApply} onStatus={props.onStatus} />
      </section>
    </div>}
  </>
}
