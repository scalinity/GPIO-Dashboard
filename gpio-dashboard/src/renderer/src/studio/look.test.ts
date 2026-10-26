// The two looks (ADR-0143): the Studio look holds ADR-0067's calibrated values, and a switch
// moves no light and swaps no object the materials depend on.
import { Color } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { LAB, LOOKS, STUDIO } from './look'
import { BLOOM_THRESHOLD, GRADE } from './renderer'
import { StageRig } from './rig'

describe('the looks', () => {
  it("the Studio look is ADR-0067's", () => {
    expect(STUDIO).toMatchObject({
      background: '#24272c',
      fog: { density: 0 },
      environment: { kind: 'hdri', intensity: 0.6 },
      key: { color: '#ffffff', intensity: 2.2 },
      hemisphere: { intensity: 0 },
      rim: { intensity: 0 },
      tone: { mapping: 'agx', exposure: 1.7, stretch: 1.2 },
      grain: 0,
      bloom: { strength: 0.35, radius: 0.4 },
      vignette: 0,
      table: '#505153',
      sweep: '#6a6b6d',
      maxDistance: 3000
    })
    expect(GRADE).toEqual({ exposure: 1.7, saturation: 1.2 })
    expect(BLOOM_THRESHOLD).toBe(2)
  })

  it('the Lab look is the house night lab, with no grain or bloom past what it states', () => {
    expect(LAB).toMatchObject({
      background: '#0b0f1a',
      fog: { color: '#3a3d62', density: 2.2e-4 },
      environment: { kind: 'dusk', intensity: 0.7 },
      key: { color: '#ffc98f', intensity: 2.1 },
      hemisphere: { sky: '#8fa6d8', ground: '#3a3026', intensity: 0.5 },
      tone: { mapping: 'aces', exposure: 1.3, saturation: 1.35 },
      grain: 0.03,
      bloom: { strength: 0.45, radius: 0.55 },
      vignette: 1,
      table: '#26303b',
      sweep: null,
      maxDistance: 2200
    })
    expect(LOOKS).toEqual({ lab: LAB, studio: STUDIO })
  })

  it('a switch changes values, never the lights, the fog or the background objects', () => {
    const rig = new StageRig()
    const lights = rig.group.children.filter((o) => 'isLight' in o)
    const [fog, background, key] = [rig.fog, rig.background, rig.key.position.clone()]
    rig.apply(LAB)
    expect(rig.group.children.filter((o) => 'isLight' in o)).toEqual(lights)
    expect([rig.fog, rig.background]).toEqual([fog, background])
    expect(rig.fog.density).toBe(LAB.fog.density)
    expect(rig.background.equals(new Color(LAB.background))).toBe(true)
    expect(rig.key.intensity).toBe(2.1)
    expect(rig.rim.intensity).toBe(LAB.rim.intensity)
    rig.apply(STUDIO)
    // The key keeps its place: it stands 64 degrees up, a little in front (ADR-0067).
    expect(rig.key.position.toArray()).toEqual([-120, 640, 220])
    expect(rig.key.position.equals(key)).toBe(true)
    expect([rig.hemisphere.intensity, rig.rim.intensity, rig.fog.density]).toEqual([0, 0, 0])
  })
})
