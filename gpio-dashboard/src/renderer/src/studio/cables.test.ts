// The solver's scene in its own frame (core, z up): a model placed in the three.js scene (y up)
// comes out as the same pose in core axes, its collider boxes and capsules land where its model
// does, a box that would hold a clamped lead exit is left out, and a housing stops short of its
// own wire.
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { corePose, fromCore, placeColliders, toCore } from './cables'
import { poseMatrix } from './coords'

const close = (a: readonly number[], b: readonly number[]) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9))

describe('core and scene frames', () => {
  it('maps points both ways: core (x, y, z) is three (x, z, -y)', () => {
    close(toCore(new Vector3(1, 2, 3)), [1, -3, 2])
    close(fromCore([1, -3, 2], 0).toArray(), [1, 2, 3])
  })

  it('gives a table placement its pose: turned about core z, at its core position', () => {
    const pose = corePose(poseMatrix({ position: [10, 20], rotationDeg: 90 }, 8.5))
    close(pose.position, [10, 20, 8.5])
    // A quarter turn about z, up to the quaternion's sign.
    const q = pose.rotation[3] < 0 ? pose.rotation.map((v) => -v) : pose.rotation
    close(q, [0, 0, Math.SQRT1_2, Math.SQRT1_2])
  })
})

describe('placeColliders', () => {
  const board = { boxes: [{ name: 'body', min: [0, 0, -8.5], max: [165.1, 54.6, 0] }] }
  const turned = poseMatrix({ position: [10, 20], rotationDeg: 90 }, 8.5)

  it("puts a model's box where the model is, in core axes", () => {
    const [c] = placeColliders({ key: 'bb1', url: '', pose: turned }, board, [])
    expect(c!.key).toBe('bb1/0')
    close(c!.shape.kind === 'box' ? c!.shape.halfExtents : [], [82.55, 27.3, 4.25])
    // The box's centre (82.55, 27.3, -4.25) turned a quarter about z, then moved to (10, 20, 8.5).
    close(c!.pose.position, [10 - 27.3, 20 + 82.55, 8.5 - 4.25])
  })

  it("lays a capsule along its model's axis", () => {
    const pin = {
      boxes: [],
      capsules: [{ name: 'pin', a: [0, 0, 0.32], b: [0, 0, 5.5], radius: 0.32 }]
    }
    // A model turned on its side: its z points along core x.
    const side = new Matrix4().makeRotationZ(-Math.PI / 2).setPosition(5, 1, 0)
    const [c] = placeColliders({ key: 'W1:a', url: '', pose: side }, pin, [])
    expect(c!.shape).toEqual({ kind: 'capsule', radius: 0.32, halfLength: (5.5 - 0.32) / 2 })
    const axis = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...c!.pose.rotation))
    close(axis.toArray(), [1, 0, 0])
    close(c!.pose.position, [5 + (5.5 + 0.32) / 2, 0, 1])
  })

  it('leaves out a box that holds a lead exit, and trims a housing short of its own wire', () => {
    const at = new Matrix4()
    const module = { boxes: [{ name: 'body', min: [0, 0, 0], max: [34, 26, 32] }] }
    expect(
      placeColliders({ key: 'J1', url: '', pose: at }, module, [new Vector3(12, 16, -2)])
    ).toEqual([])
    expect(
      placeColliders({ key: 'J1', url: '', pose: at }, module, [new Vector3(12, 40, -2)])
    ).toHaveLength(1)
    const housing = {
      boxes: [{ name: 'housing', min: [-1.27, -1.27, 5.5], max: [1.27, 1.27, 17.5] }]
    }
    const exit = new Vector3(0, 17.5, 0)
    const [c] = placeColliders({ key: 'W1:a', url: '', pose: at, trimTopMm: 0.75 }, housing, [exit])
    close(c!.shape.kind === 'box' ? c!.shape.halfExtents : [], [
      1.27,
      1.27,
      (17.5 - 0.75 - 5.5) / 2
    ])
  })
})
