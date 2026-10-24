// The Pi's pins painted on the bench (SPEC 11.5, 14.4 "Live Pi state"): each header pin, and the
// holes of the T-board strip it reaches, take a colour from the pin's level, direction and
// function. Read only. A change asks for a frame; a telemetry frame that changes nothing does not.
import { Color } from 'three/webgpu'
import { boardDef } from '../core/defs/boards'
import { PI_HEADER } from '../core/defs/controllers'
import { stripKey } from '../core/geometry/breadboard'
import { tboardPinHole } from '../core/geometry/tboard'
import type { CircuitDoc } from '../core/model/types'
import type { LivePin } from '../state/liveStore'
import { endpointInScene } from './coords'
import type { Marker, Markers } from './markers'
import { stripIndex } from './nets'

/**
 * The legend (also drawn in the Inspect panel): an output is saturated and an input pale; warm is
 * high, cool is low; an alternate function (I2C, SPI, UART) is violet whatever its level.
 */
export const LIVE_LEGEND = [
  { key: 'out-high', label: 'Output, high', color: '#F97316' },
  { key: 'out-low', label: 'Output, low', color: '#2563EB' },
  { key: 'in-high', label: 'Input, reads high', color: '#FDE68A' },
  { key: 'in-low', label: 'Input, reads low', color: '#93C5FD' },
  { key: 'alt', label: 'Alternate function', color: '#A78BFA' }
] as const

const COLOR = Object.fromEntries(LIVE_LEGEND.map((l) => [l.key, l.color]))

/** The legend entry a pin shows as; null for a pin pinctrl reports with no function. */
export function liveKey(pin: LivePin): (typeof LIVE_LEGEND)[number]['key'] | null {
  if (pin.direction === 'alt') return 'alt'
  if (pin.direction === 'out') return pin.level === 'high' ? 'out-high' : 'out-low'
  if (pin.direction === 'in') return pin.level === 'high' ? 'in-high' : 'in-low'
  return null
}

/** What the Pi reports of a pin, in words: "output, high", "alternate SDA1, high", "input, low, pull-up". */
export function liveText(pin: LivePin): string {
  const what =
    pin.direction === 'alt'
      ? `alternate ${pin.function ?? 'function'}`
      : pin.direction === 'none'
        ? 'no function'
        : pin.direction === 'out'
          ? 'output'
          : 'input'
  const pull = pin.direction === 'in' && pin.pull !== 'none' ? `, pull-${pin.pull}` : ''
  return `${what}, ${pin.level}${pull}`
}

/** Smaller than Board Sense's tint (2 mm), so the two read together on one strip. */
const STRIP_MARK_MM = 1.4
const GPIO_PINS = PI_HEADER.filter((p) => p.bcm !== null)

/** What the painter drew, read back for tests: hex colour by BCM number, and the strip marks. */
export interface LivePinsReport {
  header: Record<number, string>
  strips: number
}

export class LivePins {
  private key = ''
  private header: Record<number, string> = {}
  private strips = 0

  constructor(
    private readonly marks: Markers,
    private readonly setPiPin: (physical: number, color: Color | null) => void,
    private readonly invalidate: () => void
  ) {}

  /** Paints `pins` (null: nothing is painted and the bench is as it was). */
  sync(doc: CircuitDoc, pins: Record<number, LivePin> | null): void {
    const keys = new Map<number, string>()
    for (const pin of Object.values(pins ?? {})) {
      const key = liveKey(pin)
      if (key) keys.set(pin.bcm, key)
    }
    const key = JSON.stringify([
      [...keys],
      doc.controller.tboard,
      doc.boards.map((b) => [b.id, b.transform])
    ])
    if (key === this.key) return
    this.key = key
    this.header = {}
    for (const p of GPIO_PINS) {
      const key = keys.get(p.bcm!)
      this.setPiPin(p.physical, key ? new Color(COLOR[key]) : null)
      if (key) this.header[p.bcm!] = COLOR[key]!
    }
    const markers: Marker[] = []
    const board = doc.boards.find((b) => b.id === doc.controller.tboard.board)
    if (board) {
      const def = boardDef(board.defId)
      const index = stripIndex(doc)
      for (const p of GPIO_PINS) {
        const hex = COLOR[keys.get(p.bcm!) ?? '']
        if (!hex) continue
        const strip = stripKey(def, tboardPinHole(doc.controller.tboard, p.physical))
        for (const hole of index.get(strip) ?? []) {
          const at = endpointInScene(doc, { hole })
          if (at)
            markers.push({ at: at.at, turn: at.turn, size: STRIP_MARK_MM, color: new Color(hex) })
        }
      }
    }
    this.strips = markers.length
    this.marks.set(markers)
    this.invalidate()
  }

  report(): LivePinsReport {
    return { header: { ...this.header }, strips: this.strips }
  }
}
