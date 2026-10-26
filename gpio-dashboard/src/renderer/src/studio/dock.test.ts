// The side panels' room (ADR-0148): the visible region eases while the canvas holds the union of
// its two ends, and the lens shift keeps the picture centred in what is visible.
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { Dock, DOCK_MS, shiftLens } from './dock'

describe('Dock', () => {
  const docked = () => {
    const dock = new Dock()
    dock.aim({ left: 224, right: 256 }, 0, true)
    return dock
  }

  it('starts where it is first put, at rest', () => {
    const dock = docked()
    expect([dock.now, dock.span, dock.active, dock.shift]).toEqual([
      { left: 224, right: 256 },
      { left: 224, right: 256 },
      false,
      0
    ])
  })

  it('holds the canvas over both regions while a panel hides, the picture where it was', () => {
    const dock = docked()
    dock.aim({ left: 0, right: 256 }, 1000)
    expect(dock.span).toEqual({ left: 0, right: 256 })
    expect(dock.step(1000)).toBe(true)
    // The visible region has not moved yet: its centre is half the library right of the canvas's.
    expect(dock.shift).toBe(112)
    dock.step(1000 + DOCK_MS / 2)
    expect(dock.now.left).toBeGreaterThan(0)
    expect(dock.now.left).toBeLessThan(112)
    expect(dock.span).toEqual({ left: 0, right: 256 })
    expect(dock.step(1000 + DOCK_MS)).toBe(false)
    expect([dock.now, dock.span, dock.active, dock.shift]).toEqual([
      { left: 0, right: 256 },
      { left: 0, right: 256 },
      false,
      0
    ])
  })

  it('keeps the wider canvas until a showing panel has covered its side, then narrows it', () => {
    const dock = new Dock()
    dock.aim({ left: 0, right: 0 }, 0, true)
    dock.aim({ left: 0, right: 256 }, 0)
    dock.step(DOCK_MS - 1)
    expect(dock.span).toEqual({ left: 0, right: 0 })
    expect(dock.shift).toBeLessThan(-127)
    dock.step(DOCK_MS)
    expect(dock.span).toEqual({ left: 0, right: 256 })
    expect(dock.shift).toBe(0)
  })

  it('turns from where it is when aimed again on the way', () => {
    const dock = docked()
    dock.aim({ left: 0, right: 256 }, 0)
    dock.step(DOCK_MS / 2)
    const halfway = dock.now.left
    dock.aim({ left: 224, right: 256 }, DOCK_MS / 2)
    expect(dock.span.left).toBe(halfway)
    dock.step(DOCK_MS / 2)
    expect(dock.now.left).toBe(halfway)
    dock.step(DOCK_MS * 2)
    expect(dock.now).toEqual({ left: 224, right: 256 })
  })

  it('does nothing when aimed where it is going', () => {
    const dock = docked()
    dock.aim({ left: 224, right: 256 }, 0)
    expect(dock.active).toBe(false)
  })
})

describe('shiftLens', () => {
  it('puts the camera’s centre the given px right of the canvas’s, keeping the field of view', () => {
    const camera = new PerspectiveCamera(35, 2, 5, 20000)
    camera.position.set(0, 0, 100)
    camera.updateMatrixWorld()
    const ahead = new Vector3(0, 0, 0)
    const above = new Vector3(0, 10, 0)
    const before = above.clone().project(camera).y
    shiftLens(camera, 100, 800)
    expect(ahead.clone().project(camera).x).toBeCloseTo((2 * 100) / 800, 6)
    expect(above.clone().project(camera).y).toBeCloseTo(before, 6)
    shiftLens(camera, 0, 800)
    expect(camera.filmOffset).toBe(0)
    expect(ahead.clone().project(camera).x).toBeCloseTo(0, 6)
  })
})
