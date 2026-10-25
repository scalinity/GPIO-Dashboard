// Typed SSH-side helpers (src-tauri/src/commands.rs).
import { bridge, unwrap } from './bridge'

export interface I2cDevice {
  address: number
  /** Shown as `UU` by i2cdetect: a kernel driver holds the address. */
  claimed: boolean
}

/** Devices answering on an I2C bus of the connected Pi, by address. */
export async function i2cScan(bus = 1): Promise<I2cDevice[]> {
  return unwrap(await bridge().ssh.i2cScan(bus)).devices as I2cDevice[]
}

/** Where a project's script goes on the Pi (SPEC 14.3); ids are [a-zA-Z0-9_-] only. */
export function scriptName(projectId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error(`Invalid project id ${projectId}`)
  return `project_${projectId}.py`
}

export async function uploadScript(filename: string, source: string): Promise<void> {
  unwrap(await bridge().ssh.scpBuffer(source, `/tmp/gpio_dashboard/${filename}`))
}

/** Runs an uploaded script; resolves when it exits or is stopped. */
export async function runScript(filename: string): Promise<void> {
  const result = await bridge().ssh.runTutorialScript(filename)
  if (result.error) throw new Error(result.error)
}

/** Ends the script on the Pi, so the remote process cannot outlive the stream. */
export async function killScript(filename: string): Promise<void> {
  const result = await bridge().ssh.killProcess(filename)
  if (result.error) throw new Error(result.error)
}

/** Returns the pins a stopped program used to unpulled inputs (`pinctrl set … ip pn`). */
export async function cleanupPins(pins: number[]): Promise<void> {
  if (!pins.length) return
  const result = await bridge().ssh.gpioCleanup(pins)
  if (result.error) throw new Error(result.error)
}
