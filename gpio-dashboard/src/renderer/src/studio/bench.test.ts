// The heights the bench draws the Pi's header and socket to are the Pi model's own.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PI_PIN_TIPS_ABOVE_TABLE_MM } from '../core/reach/reach'
import { PI_HEADER_BASE_TOP_MM, PI_PCB_TOP_MM, PI_PIN_BOTTOM_MM } from './bench'

type Box = { name: string; min: number[]; max: number[] }
const { boxes } = JSON.parse(
  readFileSync(resolve('src/renderer/public/models/pi5.colliders.json'), 'utf8')
) as { boxes: Box[] }
const box = (name: string) => boxes.find((b) => b.name === name)!

describe('Pi heights (pi5.colliders.json)', () => {
  it('header pins run from below the PCB to their tips', () => {
    expect(box('header-pins').min[2]).toBeCloseTo(PI_PIN_BOTTOM_MM, 3)
    expect(box('header-pins').max[2]).toBeCloseTo(PI_PIN_TIPS_ABOVE_TABLE_MM, 3)
  })

  it('a socket rests on the header base, over the PCB', () => {
    expect(box('header-base').max[2]).toBeCloseTo(PI_HEADER_BASE_TOP_MM, 3)
    expect(box('pcb').max[2]).toBeCloseTo(PI_PCB_TOP_MM, 3)
  })
})
