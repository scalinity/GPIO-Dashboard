import type { PartDef } from '../../model/types'

/** The id of the pin a datasheet calls `label`; ids on a DIP are package pin numbers. */
export function pinId(def: PartDef, label: string): string {
  const pin = def.pins.find((p) => p.label === label)
  if (!pin) throw new Error(`${def.id}: no pin is labelled ${label}`)
  return pin.id
}
