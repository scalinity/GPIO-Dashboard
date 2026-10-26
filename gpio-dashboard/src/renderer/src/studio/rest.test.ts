// An off-board module laid over a breadboard rests on its top (ADR-0139): the pointer lays it
// there, a still pointer leaves it there, and a lead on its pin ends where the pin is drawn.
import { Ray, Vector3 } from 'three/webgpu'
import { afterEach, describe, expect, it } from 'vitest'
import { SAMPLES } from '../core/defs/samples'
import type { CircuitDoc, PartInstance, Vec2 } from '../core/model/types'
import { togglePanels, useStudio } from '../state/studioStore'
import { endpointInScene, modulePinInScene, moduleRestMm, setModuleModel, toThree } from './coords'
import { type Gesture, propose } from './gestures'

// The sample's bb-830 lies at the table's origin: 165.1 by 54.6 mm, its top 8.5 mm up.
const doc = SAMPLES.find((s) => s.id === 'sample-blink')!.doc
const TOP = 8.5
const up = new Vector3(0, 1, 0)
const pins = (axis: Vector3, height: number) => ({
  GND: { at: new Vector3(0, height, 0), axis },
  VCC: { at: new Vector3(2.54, height, 0), axis }
})
setModuleModel('joystick-module', {
  pins: pins(up, 10),
  rect: { xMin: 0, xMax: 34, yMin: 0, yMax: 26 },
  rests: [{ xMin: 0, xMax: 34, yMin: 0, yMax: 26 }],
  top: 32
})
// A right-angle header lying flat, its pins 0.32 mm up: a 2.54 mm housing on them needs 0.95.
setModuleModel('hc-sr04', {
  pins: pins(new Vector3(0, 0, 1), 0.32),
  rect: { xMin: 0, xMax: 45, yMin: 0, yMax: 20 },
  rests: [{ xMin: 0, xMax: 45, yMin: 0, yMax: 20 }],
  top: 15
})
// A servo: its housing and its case at the two ends of a 250 mm cable along y.
setModuleModel('sg90', {
  pins: pins(new Vector3(0, 0, 1), 1.6),
  rect: { xMin: -4, xMax: 30, yMin: 0, yMax: 262 },
  rests: [
    { xMin: -4, xMax: 4, yMin: 0, yMax: 14 },
    { xMin: 0, xMax: 30, yMin: 238, yMax: 262 }
  ],
  top: 31
})

/** A pointer at the table point `at`, `height` mm up, from 45 degrees in front (toward -y). */
function pointer(at: Vec2, height: number) {
  const target = toThree(at, height)
  const origin = target.clone().addScaledVector(new Vector3(0, 1, 1).normalize(), 400)
  return { ray: new Ray(origin, target.clone().sub(origin).normalize()), hole: null, pin: null }
}

function placed(defId: string, at: Vec2, height: number): PartInstance {
  const g: Gesture = { kind: 'place', defId, rotation: 0 }
  const op = propose(g, pointer(at, height), doc)!.ops[0]!
  return (op as { part: PartInstance }).part
}

describe('laying an off-board module', () => {
  it('lays it under the pointer on the board top, and on the table beside it', () => {
    const on = placed('joystick-module', [60, 20], TOP)
    expect(on.placement.offboardPose!.position).toEqual([60, 20])
    expect(moduleRestMm(doc, on.defId, on.placement.offboardPose!)).toBe(TOP)
    const off = placed('joystick-module', [60, -40], 0)
    expect(off.placement.offboardPose!.position).toEqual([60, -40])
    expect(moduleRestMm(doc, off.defId, off.placement.offboardPose!)).toBe(0)
  })

  it('lifts a module with a flat header by its housing clearance, under the pointer', () => {
    const lift = 2.54 / 2 - 0.32
    const part = placed('hc-sr04', [60, -40], lift)
    expect(part.placement.offboardPose!.position).toEqual([60, -40])
    expect(moduleRestMm(doc, part.defId, part.placement.offboardPose!)).toBeCloseTo(lift, 6)
  })

  it('rests a cabled module by its case and housing, not by its cable crossing the board', () => {
    // As the Servo tutorial lays it: the housing in front of the board, the case beyond it.
    expect(moduleRestMm(doc, 'sg90', { position: [60, -60], rotationDeg: 0 })).toBe(0)
    expect(moduleRestMm(doc, 'sg90', { position: [60, 10], rotationDeg: 0 })).toBe(TOP)
  })

  it('leaves a module resting across the board edge where it is under a still pointer', () => {
    // Its near edge 4.6 mm inside the board's far edge: pushed back by the 8.5 mm parallax to the
    // table, it would lie off the board.
    const pose = { position: [50, 50] as Vec2, rotationDeg: 0 }
    expect(moduleRestMm(doc, 'joystick-module', pose)).toBe(TOP)
    const grab: Vec2 = [60, 52]
    const part = { ...placed('joystick-module', [50, 50], TOP), id: 'J1' }
    const g: Gesture = { kind: 'module', id: 'J1', from: grab, pose }
    const moved = propose(g, pointer(grab, TOP), { ...doc, parts: [...doc.parts, part] })!
    const op = moved.ops[0] as { placement: PartInstance['placement'] }
    expect(op.placement.offboardPose).toEqual(pose)
  })

  it("ends a lead on a module's pin where the pin is drawn", () => {
    const part = { ...placed('joystick-module', [60, 20], TOP), id: 'J1' }
    const bench: CircuitDoc = { ...doc, parts: [...doc.parts, part] }
    const end = endpointInScene(bench, { pin: { part: 'J1', pin: 'GND' } })!
    expect(end.at.toArray()).toEqual(modulePinInScene(bench, part, 'GND')!.toArray())
    expect(end.at.y).toBeCloseTo(TOP + 10, 6)
  })
})

describe('togglePanels', () => {
  afterEach(() => useStudio.setState({ library: true, properties: true }))

  it('shows both panels when either is hidden, and hides both when both are shown', () => {
    togglePanels('library')
    togglePanels('both')
    expect(useStudio.getState()).toMatchObject({ library: true, properties: true })
    togglePanels('both')
    expect(useStudio.getState()).toMatchObject({ library: false, properties: false })
  })
})
