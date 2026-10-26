// The Studio's title column (SPEC 11.2): three live readouts and one sentence on what the bench is
// doing, from the snapshot the bench shows. Pure, so the HUD renders it and tests read it.
import { RP1 } from '../core/constants/rp1'
import type { Issue } from '../core/erc/erc'
import type { Snapshot } from '../core/sim/session'

/** A readout's colour, as the HUD uses them: the headline in cyan, limits in coral (ADR-0142). */
export type Tone = 'hot' | 'plain' | 'coral' | 'amber' | 'green'

export interface Readout {
  label: string
  value: string
  unit: string
  tone: Tone
}

/** A current as the HUD shows it: whole µA below 1 mA, mA to one decimal, then A. */
export function amps(a: number): { value: string; unit: string } {
  const abs = Math.abs(a)
  if (abs < 1e-3) return { value: (abs * 1e6).toFixed(0), unit: 'µA' }
  if (abs < 1) return { value: (abs * 1e3).toFixed(1), unit: 'mA' }
  return { value: abs.toFixed(2), unit: 'A' }
}

const NONE = { value: '—', unit: '' }

/** The GPIO carrying the most current, by magnitude, or null when none carries any. */
export function busiestPin(snapshot: Snapshot): { bcm: number; currentA: number } | null {
  let best: { bcm: number; currentA: number } | null = null
  for (const [bcm, { currentA }] of Object.entries(snapshot.gpio))
    if (Math.abs(currentA) >= 1e-6 && (!best || Math.abs(currentA) > best.currentA))
      best = { bcm: Number(bcm), currentA: Math.abs(currentA) }
  return best
}

/**
 * GPIO DRAW (every GPIO's current together, the headline), PEAK (the busiest pin) and CHECKS (the
 * document's and the simulation's issues). A total or a pin over the Pi's limits turns coral.
 */
export function readoutsOf(
  snapshot: Snapshot | null,
  issues: Issue[]
): [Readout, Readout, Readout] {
  if (!snapshot)
    return [
      { label: 'GPIO draw', ...NONE, tone: 'hot' },
      { label: 'Peak', ...NONE, tone: 'plain' },
      { label: 'Checks', ...NONE, tone: 'plain' }
    ]
  const total = Object.values(snapshot.gpio).reduce((sum, g) => sum + Math.abs(g.currentA), 0)
  const peak = busiestPin(snapshot)
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  return [
    {
      label: 'GPIO draw',
      ...amps(total),
      tone: total > RP1.totalGpioCurrentMaxA ? 'coral' : 'hot'
    },
    {
      // Without a separator, to fit the tile: "Peak · GPIO17" would cut the pin's name.
      label: peak ? `Peak GPIO${peak.bcm}` : 'Peak',
      ...amps(peak?.currentA ?? 0),
      tone: peak && peak.currentA > RP1.pinCurrentMaxA ? 'coral' : 'plain'
    },
    errors
      ? {
          label: 'Checks',
          value: String(errors),
          unit: errors === 1 ? 'error' : 'errors',
          tone: 'coral'
        }
      : warnings
        ? {
            label: 'Checks',
            value: String(warnings),
            unit: warnings === 1 ? 'warning' : 'warnings',
            tone: 'amber'
          }
        : { label: 'Checks', value: 'OK', unit: '', tone: 'green' }
  ]
}

/** A run of the caption: plain, bold (a named control or quantity), or coloured like the scene. */
export interface Segment {
  text: string
  tone?: 'b' | 'cyan' | 'coral'
}

export interface CaptionState {
  parts: number
  /** The step in hand while a build is played part of the way; null otherwise. */
  build: { step: number; of: number } | null
  snapshot: Snapshot | null
  issues: Issue[]
  /** The bench follows the Pi's real pins (Live Pi state on, Pi online). */
  live: boolean
  onPi: boolean
  simulating: boolean
}

/**
 * One sentence on what the bench is doing. It names things rather than quoting live numbers (the
 * readouts carry those), so it changes only when the bench's state does and a screen reader hears
 * it once.
 */
export function captionOf(s: CaptionState): Segment[] {
  if (!s.parts)
    return [{ text: 'Drag a part from the library onto the breadboard to start a circuit.' }]
  if (s.build)
    return [
      { text: 'Step ' },
      { text: `${s.build.step} of ${s.build.of}`, tone: 'b' },
      { text: ': the bench lights up once it is built.' }
    ]
  if (s.snapshot?.error)
    return [{ text: 'The simulation stopped: ' }, { text: s.snapshot.error, tone: 'coral' }]
  const pin = s.issues.find((i) => i.code === 'PIN_OVERCURRENT')
  if (pin)
    return [
      { text: pin.refs[0] ?? 'A GPIO', tone: 'b' },
      { text: ' carries more than its ' },
      { text: '16 mA', tone: 'coral' },
      { text: ' limit; raise its resistor.' }
    ]
  if (s.issues.some((i) => i.code === 'RAIL_BUDGET'))
    return [
      { text: 'The GPIOs together carry more than their ' },
      { text: '50 mA', tone: 'coral' },
      { text: ' limit.' }
    ]
  const errors = s.issues.filter((i) => i.severity === 'error').length
  if (errors)
    return [
      { text: `${errors} ${errors === 1 ? 'error' : 'errors'}`, tone: 'coral' },
      { text: ' to fix before ' },
      { text: 'Run on Pi', tone: 'b' },
      { text: '; the ERC tab lists them.' }
    ]
  if (s.live)
    return [
      { text: 'The bench follows the Pi’s real pins (' },
      { text: 'Live Pi state', tone: 'b' },
      { text: ').' }
    ]
  if (s.onPi) return [{ text: 'The program is running on the Pi.' }]
  if (s.simulating) {
    const busiest = s.snapshot && busiestPin(s.snapshot)
    return busiest
      ? [
          { text: 'The program runs in simulation; ' },
          { text: `GPIO${busiest.bcm}`, tone: 'cyan' },
          { text: ' draws the most current.' }
        ]
      : [{ text: 'The program runs in simulation; no GPIO draws current yet.' }]
  }
  return [
    { text: 'Press ' },
    { text: 'Simulate', tone: 'b' },
    { text: ' to run the program on this bench.' }
  ]
}
