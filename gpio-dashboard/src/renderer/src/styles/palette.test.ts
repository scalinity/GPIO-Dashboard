// The palette's contrast (SPEC 2.3, ADR-0142): every text shade and accent reads at WCAG AA (4.5:1)
// on the three surfaces the interface puts text on, and a selected segment's text reads at AAA.
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

type Ramp = Record<number, string>
const palette = createRequire(import.meta.url)('./palette.cjs') as {
  surface: Ramp
  text: Ramp
  ramp: (c: string) => Ramp
  onBg: string
  onText: string
  cyanLight: string
  coralLight: string
} & Record<'cyan' | 'amber' | 'coral' | 'violet' | 'green', string>

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const SURFACES = [950, 900, 800].map((k) => palette.surface[k]!)
const ACCENTS = ['cyan', 'amber', 'coral', 'violet', 'green'] as const

describe('palette contrast', () => {
  it('the text ramp, 100 to 600, reads at 4.5:1 on surface 950, 900 and 800', () => {
    for (const shade of [100, 200, 300, 400, 500, 600])
      for (const bg of SURFACES)
        expect(contrast(palette.text[shade]!, bg), `gray-${shade} on ${bg}`).toBeGreaterThan(4.5)
  })

  it('each accent, and its text shades 200 to 500, reads at 4.5:1 on the same surfaces', () => {
    for (const name of ACCENTS) {
      const ramp = palette.ramp(palette[name])
      const shades = [palette[name], ...[200, 300, 400, 500].map((k) => ramp[k]!)]
      for (const fg of shades)
        for (const bg of SURFACES)
          expect(contrast(fg, bg), `${name} ${fg} on ${bg}`).toBeGreaterThan(4.5)
    }
    for (const fg of [palette.cyanLight, palette.coralLight])
      for (const bg of SURFACES) expect(contrast(fg, bg)).toBeGreaterThan(4.5)
  })

  it("a selected segment's text reads at 7:1 on its ground", () => {
    expect(contrast(palette.onText, palette.onBg)).toBeGreaterThan(7)
  })
})
