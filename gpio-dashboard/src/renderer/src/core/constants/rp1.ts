// Electrical facts of the Raspberry Pi 5's RP1 GPIO pads (ADR-0009). Every value cites its source.

export const SOURCES = {
  gpioDoc:
    'https://github.com/raspberrypi/documentation/blob/1bf32ac6915c1df0d7c68911599ad03080ebd4b4/documentation/asciidoc/computers/raspberry-pi/gpio-on-raspberry-pi.adoc',
  rp1Peripherals:
    'https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008370-DS-1-rp1-peripherals.pdf',
  jesd8c: 'https://www.jedec.org/sites/default/files/docs/jesd8c-01.pdf'
} as const

/** GPIO doc, "Voltage specifications > RP1 products" (Raspberry Pi 5, 500, 500+). */
export const RP1 = {
  vddioV: 3.3,
  /** Input low voltage, max (also JESD8C.01's LVTTL/LVCMOS 3.3 V VIL). */
  vilMaxV: 0.8,
  /** Input high voltage, min (also JESD8C.01's VIH). */
  vihMinV: 2.0,
  vihMaxV: 3.3,
  inputLeakageMaxA: 3e-6,
  volMaxV: 0.4,
  vohMinV: 2.9,
  /** Pull resistances: min / typical / max. */
  pullUpOhm: { min: 37e3, typ: 55e3, max: 86e3 },
  pullDownOhm: { min: 35e3, typ: 55e3, max: 98e3 },
  /** Output current (mA) at each drive-strength setting: [min, typ, max]. */
  iolMa: {
    2: [6.1, 9.6, 13.5],
    4: [9.2, 14.3, 20.2],
    8: [15.3, 23.9, 33.7],
    12: [18.4, 28.7, 40.5]
  },
  iohMa: { 2: [4.5, 6.3, 8.4], 4: [6.8, 9.5, 12.6], 8: [11.4, 15.8, 21], 12: [13.6, 19, 25.2] },
  /** RP1 peripherals datasheet, Table 21 (pad control): DRIVE resets to 0x1 = 4 mA. */
  defaultDriveMa: 4,
  /** GPIO doc, "Inputs"/"Outputs": not 5 V tolerant; 16 mA per pin, 50 mA for all pins together. */
  fiveVoltTolerant: false,
  pinCurrentMaxA: 16e-3,
  totalGpioCurrentMaxA: 50e-3,
  /** GPIO doc, "Inputs": GP2 (SDA) and GP3 (SCL) have fixed 1.8 kΩ pull-ups to 3.3 V. */
  i2cBoardPullupOhm: 1.8e3,
  i2cBoardPullupPins: [2, 3]
} as const

export type DriveMa = keyof typeof RP1.iohMa

/**
 * A driven output as a Thévenin source. The table gives the current at which the output still
 * meets VOH (or VOL), so the typical output resistance is that voltage margin over that current.
 */
export function outputResistanceOhm(
  level: 'high' | 'low',
  driveMa: DriveMa = RP1.defaultDriveMa
): number {
  const [, typ] = level === 'high' ? RP1.iohMa[driveMa] : RP1.iolMa[driveMa]
  const margin = level === 'high' ? RP1.vddioV - RP1.vohMinV : RP1.volMaxV
  return margin / (typ / 1000)
}
