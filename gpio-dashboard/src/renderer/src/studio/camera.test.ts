// Camera presets frame the bench and arrive within 600 ms (SPEC 10.7).
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { newDoc } from '../core/model/defaults'
import { CameraTween, PRESET_MS, presetView } from './camera'

const doc = newDoc('t', '2026-10-24T00:00:00.000Z')

describe('camera presets', () => {
  it('Top looks straight down with rows left to right and column j up', () => {
    const camera = new PerspectiveCamera(35, 16 / 9, 5, 20000)
    const view = presetView('top', doc, camera, new Vector3())
    camera.position.copy(view.position)
    camera.lookAt(view.target)
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    expect(right.x).toBeCloseTo(1)
    expect(up.z).toBeCloseTo(-1) // three −z is core +y, toward column j
  })

  it('a preset move ends on the preset view within 600 ms', () => {
    expect(PRESET_MS).toBeLessThanOrEqual(600)
    const camera = new PerspectiveCamera(35, 16 / 9, 5, 20000)
    const target = new Vector3()
    const start = presetView('front', doc, camera, target)
    camera.position.copy(start.position)
    target.copy(start.target)
    const end = presetView('iso', doc, camera, target)
    const tween = new CameraTween()
    tween.begin(0, start, end)
    expect(tween.step(PRESET_MS / 2, camera, target)).toBe(true)
    expect(tween.step(PRESET_MS, camera, target)).toBe(false)
    expect(camera.position.distanceTo(end.position)).toBeLessThan(1e-6)
    expect(target.distanceTo(end.target)).toBeLessThan(1e-6)
  })
})
