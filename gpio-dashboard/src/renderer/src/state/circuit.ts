// The app's one circuit document (SPEC 4.1). The Studio renders it and the Workbench opens into
// it, so both pages show the same document. It starts as a new project on the bench layout.
import { newDoc } from '../core/model/defaults'
import { CircuitStore } from './circuitStore'

export const circuit = new CircuitStore(newDoc('Untitled', new Date().toISOString()))
