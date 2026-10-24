// Guards data/pins.js (the Pinout page's table) against its governing sources (docs/v2/AUDIT.md,
// "Pin data"). Nothing here is a second copy of the facts: each table below is transcribed from a
// cited document, and the test compares pins.js to it.
import { describe, expect, it } from 'vitest'
import header from '../content/controllers/pi5-header.json'
import { RP1 } from '../core/constants/rp1'

interface Pin {
  physical: number
  bcm: number | null
  wiringPi: number | null
  name: string
  type: string
  altFunctions: string[]
  description: string
}
interface PinsModule {
  PINS: Pin[]
  PIN_TYPES: Record<string, { label: string; color: string; bg: string }>
  ALL_PIN_TYPES: string[]
}

// data/pins.js is plain JavaScript, so the test loads it the way the content tests load JSON.
const loaded = import.meta.glob<PinsModule>('./pins.js', { eager: true })
const pinsModule = loaded['./pins.js']
if (!pinsModule) throw new Error('data/pins.js did not load')
const { PINS, PIN_TYPES, ALL_PIN_TYPES } = pinsModule

const OFFICIAL = header.pins

/**
 * WiringPi's BCM number for each WiringPi pin 0-31: `pinToGpioR2`, the table WiringPi selects on
 * every board except the two oldest, the Pi 5 included (`wiringPiSetup`). The numbering is the
 * library's own convention, not a hardware fact.
 * https://github.com/WiringPi/WiringPi/blob/31f49ecdf7865c10483a91994aa51f73a7c656aa/wiringPi/wiringPi.c
 */
// prettier-ignore
const WIRINGPI_TO_BCM = [
  17, 18, 27, 22, 23, 24, 25, 4, 2, 3, 8, 7, 10, 9, 11, 14, 15, 28, 29, 30, 31,
  5, 6, 13, 19, 26, 12, 16, 20, 21, 0, 1
]

/**
 * The RP1 GPIO function-select table (RP1 peripherals datasheet, Table 4, "GPIO function"), for
 * the named peripheral functions a0-a4 and a8 of GPIO 0-27, in that order. a5-a7 are SYS_RIO,
 * PROC_RIO and PIO on every GPIO and are not listed. A blank cell is reserved.
 * https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008370-DS-1-rp1-peripherals.pdf
 */
// prettier-ignore
const RP1_FUNCTIONS: Record<number, string[]> = {
  0: ['SPI0_SIO[3]', 'DPI_PCLK', 'UART1_TX', 'I2C0_SDA', '', 'SPI2_CSn[0]'],
  1: ['SPI0_SIO[2]', 'DPI_DE', 'UART1_RX', 'I2C0_SCL', '', 'SPI2_SIO[1]'],
  2: ['SPI0_CSn[3]', 'DPI_VSYNC', 'UART1_CTS', 'I2C1_SDA', 'UART0_IR_RX', 'SPI2_SIO[0]'],
  3: ['SPI0_CSn[2]', 'DPI_HSYNC', 'UART1_RTS', 'I2C1_SCL', 'UART0_IR_TX', 'SPI2_SCLK'],
  4: ['GPCLK[0]', 'DPI_D[0]', 'UART2_TX', 'I2C2_SDA', 'UART0_RI', 'SPI3_CSn[0]'],
  5: ['GPCLK[1]', 'DPI_D[1]', 'UART2_RX', 'I2C2_SCL', 'UART0_DTR', 'SPI3_SIO[1]'],
  6: ['GPCLK[2]', 'DPI_D[2]', 'UART2_CTS', 'I2C3_SDA', 'UART0_DCD', 'SPI3_SIO[0]'],
  7: ['SPI0_CSn[1]', 'DPI_D[3]', 'UART2_RTS', 'I2C3_SCL', 'UART0_DSR', 'SPI3_SCLK'],
  8: ['SPI0_CSn[0]', 'DPI_D[4]', 'UART3_TX', 'I2C0_SDA', '', 'SPI4_CSn[0]'],
  9: ['SPI0_SIO[1]', 'DPI_D[5]', 'UART3_RX', 'I2C0_SCL', '', 'SPI4_SIO[0]'],
  10: ['SPI0_SIO[0]', 'DPI_D[6]', 'UART3_CTS', 'I2C1_SDA', '', 'SPI4_SIO[1]'],
  11: ['SPI0_SCLK', 'DPI_D[7]', 'UART3_RTS', 'I2C1_SCL', '', 'SPI4_SCLK'],
  12: ['PWM0[0]', 'DPI_D[8]', 'UART4_TX', 'I2C2_SDA', 'AUDIO_OUT_L', 'SPI5_CSn[0]'],
  13: ['PWM0[1]', 'DPI_D[9]', 'UART4_RX', 'I2C2_SCL', 'AUDIO_OUT_R', 'SPI5_SIO[1]'],
  14: ['PWM0[2]', 'DPI_D[10]', 'UART4_CTS', 'I2C3_SDA', 'UART0_TX', 'SPI5_SIO[0]'],
  15: ['PWM0[3]', 'DPI_D[11]', 'UART4_RTS', 'I2C3_SCL', 'UART0_RX', 'SPI5_SCLK'],
  16: ['SPI1_CSn[2]', 'DPI_D[12]', 'MIPI0_DSI_TE', '', 'UART0_CTS', ''],
  17: ['SPI1_CSn[1]', 'DPI_D[13]', 'MIPI1_DSI_TE', '', 'UART0_RTS', ''],
  18: ['SPI1_CSn[0]', 'DPI_D[14]', 'I2S0_SCLK', 'PWM0[2]', 'I2S1_SCLK', 'GPCLK[1]'],
  19: ['SPI1_SIO[1]', 'DPI_D[15]', 'I2S0_WS', 'PWM0[3]', 'I2S1_WS', ''],
  20: ['SPI1_SIO[0]', 'DPI_D[16]', 'I2S0_SDI[0]', 'GPCLK[0]', 'I2S1_SDI[0]', ''],
  21: ['SPI1_SCLK', 'DPI_D[17]', 'I2S0_SDO[0]', 'GPCLK[1]', 'I2S1_SDO[0]', ''],
  22: ['SDIO0_CLK', 'DPI_D[18]', 'I2S0_SDI[1]', 'I2C3_SDA', 'I2S1_SDI[1]', ''],
  23: ['SDIO0_CMD', 'DPI_D[19]', 'I2S0_SDO[1]', 'I2C3_SCL', 'I2S1_SDO[1]', ''],
  24: ['SDIO0_DAT[0]', 'DPI_D[20]', 'I2S0_SDI[2]', '', 'I2S1_SDI[2]', 'SPI2_CSn[1]'],
  25: ['SDIO0_DAT[1]', 'DPI_D[21]', 'I2S0_SDO[2]', 'AUDIO_IN_CLK', 'I2S1_SDO[2]', 'SPI3_CSn[1]'],
  26: ['SDIO0_DAT[2]', 'DPI_D[22]', 'I2S0_SDI[3]', 'AUDIO_IN_DAT0', 'I2S1_SDI[3]', 'SPI5_CSn[1]'],
  27: ['SDIO0_DAT[3]', 'DPI_D[23]', 'I2S0_SDO[3]', 'AUDIO_IN_DAT1', 'I2S1_SDO[3]', 'SPI1_CSn[1]']
}

/**
 * Cells where the RP1 datasheet (a November 2023 draft) and the Compute Module 5 datasheet
 * (RP-008180-DS, Table 1, the document the official GPIO page points to for Pi 5 alternate
 * functions) disagree. pins.js lists none of them.
 *  - GPIO16 a2 and GPIO17 a2: MIPI0_DSI_TE / MIPI1_DSI_TE only in the RP1 draft.
 *  - GPIO9 a8 and GPIO10 a8: SPI4_SIO[0] / SPI4_SIO[1] in the RP1 draft, SPI4_MISO / SPI4_MOSI
 *    in the CM5 datasheet.
 */
const DISPUTED = new Set(['MIPI0_DSI_TE', 'MIPI1_DSI_TE', 'SPI4_SIO[0]', 'SPI4_SIO[1]'])

function expectedAltFunctions(bcm: number): string[] {
  const row = RP1_FUNCTIONS[bcm]
  if (!row) throw new Error(`no RP1 row for GPIO${bcm}`)
  return row.filter((f) => f !== '' && !DISPUTED.has(f))
}

/** The display name for an official pin: `GPn` is shown as `GPIOn`; pins 27/28 keep the HAT names. */
function expectedName(o: (typeof OFFICIAL)[number]): string {
  if (o.type !== 'GPIO') return o.name
  if (o.bcm === 0) return 'ID_SD'
  if (o.bcm === 1) return 'ID_SC'
  return `GPIO${o.bcm}`
}

/** The colour category: power and ground by name, a GPIO by the first protocol its official function names. */
function expectedType(o: (typeof OFFICIAL)[number]): string {
  if (o.type === 'Ground') return 'ground'
  if (o.type === 'Power') return o.name === '3V3' ? 'power3v3' : 'power5v'
  if (/identify a HAT/.test(o.function)) return 'eeprom'
  const protocol = /I2C|SPI|UART|PCM/.exec(o.function)?.[0]
  return protocol ? protocol.toLowerCase() : 'gpio'
}

/**
 * Every `<number><unit>` quantity a text quotes, without spaces: "1.8 kΩ" and "1.8kΩ" are one.
 * The official text spells the ohm with U+2126, which NFC folds into the Greek capital omega.
 */
function quantities(text: string): string[] {
  const found = text
    .normalize('NFC')
    .matchAll(/(\d+(?:\.\d+)?)\s*(mA|µA|A|MΩ|kΩ|Ω|V|W)(?![A-Za-z])/g)
  return Array.from(found, (m) => `${m[1]}${m[2]}`)
}

describe('data/pins.js against the official Raspberry Pi documentation', () => {
  it('models the 40 header pins, each physical number once', () => {
    expect(OFFICIAL).toHaveLength(40)
    expect(PINS.map((p) => p.physical)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
  })

  it('agrees with pi5-header.json on BCM number and name for every pin', () => {
    for (const o of OFFICIAL) {
      const pin = PINS[o.physical - 1]
      expect(pin?.bcm, `pin ${o.physical} BCM`).toBe(o.bcm)
      expect(pin?.name, `pin ${o.physical} name`).toBe(expectedName(o))
    }
  })

  it('gives each pin the colour category its official type and typical function imply', () => {
    for (const o of OFFICIAL) {
      expect(PINS[o.physical - 1]?.type, `pin ${o.physical} (${o.name})`).toBe(expectedType(o))
    }
  })

  it('has the official pin counts: 2 of 3V3, 2 of 5V, 8 of GND, 26 GPIO and the 2 ID pins', () => {
    const count = (type: string) => PINS.filter((p) => p.type === type).length
    expect([count('power3v3'), count('power5v'), count('ground')]).toEqual([2, 2, 8])
    expect(PINS.filter((p) => p.bcm !== null)).toHaveLength(28)
    expect(PINS.filter((p) => p.type === 'eeprom').map((p) => p.bcm)).toEqual([0, 1])
  })

  it('defines a label and colour for every pin type it uses', () => {
    expect(new Set(ALL_PIN_TYPES)).toEqual(new Set(PINS.map((p) => p.type)))
    for (const type of ALL_PIN_TYPES) expect(PIN_TYPES[type]?.label, type).toBeTruthy()
  })

  it("numbers the WiringPi column as WiringPi's own table does, and only for GPIO pins", () => {
    for (const pin of PINS) {
      if (pin.bcm === null) {
        expect(pin.wiringPi, `pin ${pin.physical}`).toBeNull()
      } else {
        expect(pin.wiringPi, `pin ${pin.physical} (BCM${pin.bcm})`).toBe(
          WIRINGPI_TO_BCM.indexOf(pin.bcm)
        )
      }
    }
  })

  it('lists, for each GPIO, the RP1 datasheet functions and no BCM283x-only function', () => {
    for (const pin of PINS) {
      if (pin.bcm === null) {
        expect(pin.altFunctions, `pin ${pin.physical}`).toEqual([])
      } else {
        expect(pin.altFunctions, `pin ${pin.physical} (BCM${pin.bcm})`).toEqual(
          expectedAltFunctions(pin.bcm)
        )
      }
    }
    // RP1 has no Secondary Memory Interface; the baseline listed "SMI ..." on 22 pins.
    expect(PINS.flatMap((p) => p.altFunctions).filter((f) => f.startsWith('SMI'))).toEqual([])
  })

  it('quotes in a description no current, voltage or resistance the official docs do not give', () => {
    // The docs give 16 mA for one GPIO and 50 mA for all together (RP1 constants cite them), the
    // 3.3 V / 5 V / 0 V of the "Pin types" table, and what each pin's own function text says.
    const documented = new Set([
      `${RP1.pinCurrentMaxA * 1000}mA`,
      `${RP1.totalGpioCurrentMaxA * 1000}mA`,
      '3.3V',
      '5V',
      '0V'
    ])
    for (const o of OFFICIAL) {
      const pin = PINS[o.physical - 1]
      const allowed = new Set([...documented, ...quantities(o.function)])
      for (const q of quantities(pin?.description ?? '')) {
        expect(allowed.has(q), `pin ${o.physical} description quotes ${q}`).toBe(true)
      }
    }
  })

  it('states no 3V3 current limit, which the docs do not give (ADR-0014)', () => {
    for (const pin of PINS.filter((p) => p.type === 'power3v3')) {
      expect(quantities(pin.description).filter((q) => /A$/.test(q))).toEqual([])
    }
  })

  it('makes no claim the docs contradict about the 5V pins or the serial console', () => {
    for (const pin of PINS.filter((p) => p.type === 'power5v')) {
      // The 5V pins output power or accept it to power the Pi; they are not a USB-C tap.
      expect(pin.description).not.toMatch(/USB-C/)
    }
    for (const pin of PINS.filter((p) => p.name === 'GPIO14' || p.name === 'GPIO15')) {
      // On a Pi 5 the default serial console is the debug header, and UART0 is disabled by default.
      expect(pin.description).not.toMatch(/console output by default|console input by default/)
    }
  })
})
