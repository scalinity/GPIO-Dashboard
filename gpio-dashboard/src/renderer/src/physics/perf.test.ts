// Step time of the heaviest tutorial scene (SPEC 10.8: at most 4 ms a frame in the worker): 40
// leads of 200 mm (165 mm of wire between their housings, ADR-0042) plus the ribbon on one
// breadboard. Reported by phase, not asserted, because a loaded machine moves it by half again; set
// PHYSICS_BUDGET=1 to assert the 4 ms mean on a quiet one.
import { describe, expect, it } from 'vitest'
import { wireLengthMm } from '../core/reach/reach'
import { rng } from './math'
import { BOARD, BOARD_TOP, FLIP, TABLE, at, boxShape } from './testkit'
import { CableWorld, PHASES } from './world'

const BUDGET_MS = 4

interface Stats {
  frames: number
  mean: number
  p95: number
  phases: { name: string; mean: number; p95: number }[]
}

function summarise(total: number[], phases: number[][]): Stats {
  const stat = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y)
    return {
      mean: s.length ? s.reduce((x, y) => x + y, 0) / s.length : 0,
      p95: s[Math.floor(s.length * 0.95)] ?? 0
    }
  }
  return {
    frames: total.length,
    ...stat(total),
    phases: PHASES.map((name, i) => ({ name, ...stat(phases[i]!) }))
  }
}

const line = (label: string, s: Stats) =>
  `${label}: ${s.frames} frames, mean ${s.mean.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms | ` +
  s.phases.map((p) => `${p.name} ${p.mean.toFixed(2)}/${p.p95.toFixed(2)}`).join(' ')

describe('timing', () => {
  it('reports ms per frame, by phase, for 40 leads plus the ribbon', { timeout: 120000 }, () => {
    const rand = rng(11)
    const world = new CableWorld({ profile: true })
    for (const b of [TABLE, BOARD]) world.addCollider(boxShape(b), at(...b.c))
    const pitch = 2.54
    const wireMm = wireLengthMm(200, 'dupont-mm')
    const lead = (k: number) => {
      // Leads span nearby holes, a few rows apart, as a tutorial's would.
      const row = -70 + (k % 20) * 7
      const from = at(row, -20 + (k < 20 ? 0 : 40) + (rand() - 0.5) * pitch, BOARD_TOP)
      const to = at(
        row + (3 + rand() * 12) * pitch,
        -20 + (k < 20 ? 8 : 28) * (1 + rand() * 0.2),
        BOARD_TOP
      )
      return world.addLead({ a: from, b: to, wireMm })
    }
    const leads = Array.from({ length: 40 }, (_, k) => lead(k))
    const ribbon = world.addRibbon({ a: at(-150, -10, 14), b: at(-100, 0, 22, FLIP) })
    // Frames that did work (something was awake) are timed; a sleeping world costs nothing.
    const timed = (frames: number, each: (f: number) => void): Stats => {
      const total: number[] = []
      const phases: number[][] = PHASES.map(() => [])
      for (let f = 0; f < frames; f++) {
        each(f)
        const awake = !world.allAsleep()
        const t0 = performance.now()
        world.step()
        const ms = performance.now() - t0
        if (!awake) continue
        total.push(ms)
        const p = world.phaseTimes()!
        PHASES.forEach((_, i) => phases[i]!.push(p[i]!))
      }
      return summarise(total, phases)
    }
    const opening = timed(200, () => {})
    for (let f = 0; f < 150; f++) world.step()
    const asleep = [...leads, ribbon].every((id) => world.isAsleep(id))
    const socket = (f: number) => at(-100 + 15 * Math.sin(f / 15), 0, 22, FLIP)
    const dragRibbon = timed(120, (f) => world.setAnchor(ribbon, 1, socket(f)))
    const wholeBoard = timed(120, (f) => {
      world.setAnchor(ribbon, 1, socket(f))
      leads.forEach((id, k) =>
        world.setAnchor(
          id,
          0,
          at(-70 + (k % 20) * 7 + 4 * Math.sin(f / 12), -20 + (k < 20 ? 0 : 40), BOARD_TOP)
        )
      )
    })
    console.info(line('opening, settling from the design curves', opening))
    console.info(`everything asleep after 5 s: ${asleep}`)
    console.info(line('dragging the T-board socket', dragRibbon))
    console.info(line('moving the whole board (all 41 bodies awake)', wholeBoard))
    for (const id of [...leads, ribbon]) {
      expect(Array.from(world.positions(id)).every(Number.isFinite)).toBe(true)
    }
    expect(asleep).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((globalThis as any).process?.env?.PHYSICS_BUDGET) {
      expect(dragRibbon.mean).toBeLessThanOrEqual(BUDGET_MS)
      expect(wholeBoard.mean).toBeLessThanOrEqual(BUDGET_MS)
    }
  })
})
