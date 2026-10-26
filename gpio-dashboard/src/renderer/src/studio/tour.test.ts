// The opening tour (ADR-0147): every tutorial's shots stay inside the Lab's room, turn slowly
// enough to read, and are over in under 16 s; the veil is black only around the cuts.
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { TUTORIALS } from '../core/defs/tutorials'
import { clampToRoom } from './lab/bounds'
import { benchOf, DIP_MS, planShots, Tour } from './tour'

const camera = () => {
  const c = new PerspectiveCamera(35, 1168 / 734, 10, 20000)
  c.position.set(0, 400, 600)
  return c
}

describe('the opening tour', () => {
  it('stays inside the room on every tutorial, turns 1.6 to 3 degrees a second, and ends home', () => {
    for (const t of TUTORIALS) {
      const shots = planShots(benchOf(t.doc, camera()))
      expect(
        shots.reduce((n, s) => n + s.ms, 0),
        t.meta.id
      ).toBeLessThan(16_000)
      for (const shot of shots) {
        if (shot.name !== 'home') {
          const turn = Math.abs(shot.orbit[1].theta - shot.orbit[0].theta) * (180 / Math.PI)
          const rate = turn / (shot.ms / 1000)
          expect(rate, `${t.meta.id} ${shot.name}`).toBeGreaterThanOrEqual(1.6)
          expect(rate, `${t.meta.id} ${shot.name}`).toBeLessThanOrEqual(3)
        }
      }
      const tour = new Tour()
      const cam = camera()
      const target = new Vector3()
      tour.begin(shots, 0)
      for (let now = 0; now < 16_000; now += 250) {
        if (tour.step(now, cam, target) === null) break
        const [p, q] = [cam.position.clone(), target.clone()]
        expect(clampToRoom(p, q), `${t.meta.id} at ${now} ms`).toBe(false)
      }
      // It ends where the iso preset stands.
      const home = benchOf(t.doc, camera()).home
      expect(cam.position.distanceTo(home.position), t.meta.id).toBeLessThan(1)
      expect(tour.playing).toBe(false)
    }
  })

  it('dips the veil at each cut and lifts it after, and is clear in between', () => {
    const shots = planShots(benchOf(TUTORIALS[0]!.doc, camera()))
    const tour = new Tour()
    const [cam, target] = [camera(), new Vector3()]
    tour.begin(shots, 0)
    const veil = (now: number) => tour.step(now, cam, target)
    expect(veil(0)).toBe(1)
    expect(veil(2500)).toBe(0)
    expect(veil(shots[0]!.ms - 1)).toBeGreaterThan(0.9)
    expect(veil(shots[0]!.ms + 1)).toBeGreaterThan(0.9)
    expect(veil(shots[0]!.ms + DIP_MS + 1)).toBe(0)
    // No dip between the close-up and the move home.
    const close = shots[0]!.ms + shots[1]!.ms
    expect(veil(close + shots[2]!.ms - 1)).toBe(0)
  })
})
