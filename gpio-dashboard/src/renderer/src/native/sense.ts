// Typed Board Sense commands (src-tauri/src/commands.rs; SPEC 14.5).
import type { Sweep } from '../core/sense/sense'
import { bridge, unwrap } from './bridge'

/** The sweep settings the app uses: 100 µs settle (ADR-0013), a sweep every 250 ms. */
export const SENSE_TIMING = { settleUs: 100, periodMs: 250 }

export async function startSensing(pins: number[]): Promise<void> {
  unwrap(await bridge().sense.start(pins, SENSE_TIMING.settleUs, SENSE_TIMING.periodMs))
}

export async function stopSensing(): Promise<void> {
  unwrap(await bridge().sense.stop())
}

/** Whether the agent confirmed, within a second, that every line is released. */
export async function pauseSensing(): Promise<boolean> {
  return unwrap(await bridge().sense.pause()).paused
}

export async function resumeSensing(): Promise<void> {
  unwrap(await bridge().sense.resume())
}

export function onSweep(f: (sweep: Sweep) => void): () => void {
  return bridge().sense.onSweep((s) => f(s as Sweep))
}

export function onSenseEvent(f: (event: { kind: string; message: string }) => void): () => void {
  return bridge().sense.onEvent((e) => f(e as { kind: string; message: string }))
}
