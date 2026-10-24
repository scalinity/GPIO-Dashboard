// Theory text with its values taken from the circuit (SPEC 1.4, 13.1): {{value R1}} is R1's value,
// {{part R1}} its full description, {{net D1.K}} the net a pin is on (e.g. GPIO17).
import type { CircuitDoc } from '../model/types'
import { netlist, type PartDefs } from '../netlist/netlist'
import { ohmsText, faradsText, partText } from '../steps/steps'

export function renderTheory(markdown: string, doc: CircuitDoc, defs: PartDefs): string {
  const nl = netlist(doc, defs)
  return markdown
    .replace(/\{\{(value|part|net) ([A-Za-z0-9_.+-]+)\}\}/g, (match, kind: string, ref: string) => {
      if (kind === 'net') {
        const net = nl.netOfPin.get(ref)
        if (!net) throw new Error(`Theory template ${match}: no pin ${ref}`)
        return net
      }
      const part = doc.parts.find((p) => p.id === ref)
      if (!part) throw new Error(`Theory template ${match}: no part ${ref}`)
      const def = defs(part.defId)
      if (kind === 'part') return partText(part, def)
      const prop = (key: string) => part.props[key] ?? def.properties[key]?.default
      if (def.sim.model === 'resistor') return ohmsText(Number(prop('resistance')))
      if (def.sim.model === 'capacitor' || def.sim.model === 'electrolytic')
        return faradsText(Number(prop('capacitance')))
      throw new Error(`Theory template ${match}: ${def.id} has no single value`)
    })
    .replace(/\{\{[^}]*\}\}/g, (match) => {
      throw new Error(`Unknown theory template ${match}`)
    })
}
