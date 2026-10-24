// The pulsing marks of a Build Mode step (SPEC 11.7): a ring over each hole or pin the step puts
// something in. They are DOM elements over the canvas, positioned by the camera like the labels, so
// they pulse (a CSS animation, which draws no frame of the scene) for as long as the step is in
// hand, and stay in sight over the ghost that hovers above its holes.
import { type PerspectiveCamera, Vector3 } from 'three/webgpu'

/** The ring's colour says how the step stands: to do, confirmed, or done differently. */
export type Tone = 'step' | 'cause'

export interface Mark {
  at: Vector3
  tone: Tone
}

export class StepMarks {
  private marks: { mark: Mark; el: HTMLElement }[] = []
  private readonly p = new Vector3()

  constructor(private readonly container: HTMLElement) {}

  get count(): number {
    return this.marks.length
  }

  /** Replaces the rings. */
  set(marks: Mark[]): void {
    this.container.replaceChildren()
    this.marks = marks.map((mark) => {
      const el = document.createElement('div')
      el.className = 'absolute left-0 top-0'
      const ring = document.createElement('span')
      ring.className = `step-mark step-mark-${mark.tone}`
      el.append(ring)
      this.container.append(el)
      return { mark, el }
    })
  }

  /** Puts each ring over its point as the camera sees it; hidden behind the camera. */
  project(camera: PerspectiveCamera, width: number, height: number): void {
    for (const { mark, el } of this.marks) {
      this.p.copy(mark.at).project(camera)
      el.hidden = this.p.z > 1
      const x = ((this.p.x + 1) / 2) * width
      const y = ((1 - this.p.y) / 2) * height
      el.style.transform = `translate(${x}px, ${y}px)`
    }
  }

  /** Where each ring is, in pixels of the canvas, for the tests. */
  screen(
    camera: PerspectiveCamera,
    width: number,
    height: number
  ): { x: number; y: number; tone: Tone }[] {
    return this.marks.map(({ mark }) => {
      this.p.copy(mark.at).project(camera)
      return {
        x: ((this.p.x + 1) / 2) * width,
        y: ((1 - this.p.y) / 2) * height,
        tone: mark.tone
      }
    })
  }
}
