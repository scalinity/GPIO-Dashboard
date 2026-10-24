// The Studio (SPEC 11.1, 11.2): the app's circuit document as a live 3D bench.
import { Box } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { circuit } from '../state/circuit'
import Studio from '../studio/Studio'

export default function StudioPage() {
  const doc = useSyncExternalStore(circuit.subscribe, circuit.getSnapshot)
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] shrink-0">
        <Box className="w-5 h-5 text-accent-light" />
        <h1 className="text-lg font-semibold text-gray-200">Studio</h1>
        <span className="text-sm text-gray-400">{doc.meta.name}</span>
      </div>
      <Studio doc={doc} />
    </div>
  )
}
