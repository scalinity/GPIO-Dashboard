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
