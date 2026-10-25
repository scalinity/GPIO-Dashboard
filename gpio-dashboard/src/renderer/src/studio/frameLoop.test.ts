// Render on demand (SPEC 10.2): frames while moving, then at most SETTLE_FRAMES, then none.
import { describe, expect, it } from 'vitest'
import { FrameLoop, SETTLE_FRAMES } from './frameLoop'

let now = 0
const tick = (loop: FrameLoop, moving: boolean) => loop.tick(moving, (now += 16))

/** Runs frames while the loop asks for them; returns how many ran. */
function settle(loop: FrameLoop): number {
  let n = 1
  while (tick(loop, false)) n += 1
  return n
}

describe('FrameLoop', () => {
  it('renders SETTLE_FRAMES after the last moving frame, then stops', () => {
    const loop = new FrameLoop()
    for (let i = 0; i < 10; i++) expect(tick(loop, true)).toBe(true)
    expect(settle(loop)).toBe(SETTLE_FRAMES)
    expect(loop.frames).toBe(10 + SETTLE_FRAMES)
  })

  it('settles a change in SETTLE_FRAMES frames, whether requested or not', () => {
    const requested = new FrameLoop()
    requested.changed()
    expect(settle(requested)).toBe(SETTLE_FRAMES)
    // A frame nobody scheduled (a resize, say) is a change too.
    const unscheduled = new FrameLoop()
    expect(settle(unscheduled)).toBe(SETTLE_FRAMES)
  })

  it('starts settling again when something moves mid-settle', () => {
    const loop = new FrameLoop()
    loop.changed()
    for (let i = 0; i < 5; i++) tick(loop, false)
    tick(loop, true)
    expect(settle(loop)).toBe(SETTLE_FRAMES)
  })

  it('measures the frame rate of a run of consecutive frames', () => {
    const loop = new FrameLoop()
    let t = 0
    for (let i = 0; i < 61; i++) loop.tick(true, (t += 1000 / 120))
    expect(loop.fps).toBeCloseTo(120)
    // A pause starts a new run, too short to measure yet.
    loop.tick(true, t + 500)
    expect(loop.fps).toBeNull()
  })
})
