// Divergence badges on the stage (SPEC 11.5, 14.4, 14.5): a small button over the place where the
// real board stands apart from the document, positioned by the camera as the labels are. Unlike
// the labels, a badge is clickable (it opens its explanation), so its container sits outside the
// element the orbit controls listen on, which would take its pointer events.
import { type PerspectiveCamera, Vector3 } from 'three/webgpu'
import type { Badge } from '../state/badges'

export interface PlacedBadge {
  badge: Badge
  at: Vector3
}

/** The classes are written out so the stylesheet's content scan finds them. */
const SEVERITY_CLASS = {
  error: 'bg-red-400 text-on-text ring-red-200/40 shadow-glow-danger',
  warning: 'bg-amber-400 text-on-text ring-amber-200/40 shadow-glow-warn'
} as const

const SIDE_BY_SIDE_PX = 22

export class BadgeLayer {
  private items: { placed: PlacedBadge; el: HTMLButtonElement }[] = []
  private readonly p = new Vector3()

  constructor(
    private readonly container: HTMLElement,
    private readonly open: (id: string) => void
  ) {}

  /** The badges shown, for the tests. */
  ids(): { id: string; severity: Badge['severity'] }[] {
    return this.items.map(({ placed }) => ({
      id: placed.badge.id,
      severity: placed.badge.severity
    }))
  }

  /** Shows `placed` (replacing the buttons only where the badges differ). */
  set(placed: PlacedBadge[]): void {
    const key = (p: PlacedBadge) => `${p.badge.id}|${p.badge.title}|${p.badge.severity}`
    const same =
      placed.length === this.items.length &&
      placed.every((p, i) => key(p) === key(this.items[i]!.placed))
    if (same) {
      // The places may have moved with the document; the buttons stay.
      this.items.forEach((item, i) => (item.placed = placed[i]!))
      return
    }
    this.container.replaceChildren()
    this.items = placed.map((p) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = `pointer-events-auto absolute left-0 top-0 grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold leading-none ring-2 ${SEVERITY_CLASS[p.badge.severity]}`
      el.textContent = '!'
      el.title = p.badge.title
      el.setAttribute('aria-label', p.badge.title)
      el.dataset.badge = p.badge.id
      el.addEventListener('click', () => this.open(p.badge.id))
      this.container.append(el)
      return { placed: p, el }
    })
  }

  /** Puts each badge over its point as the camera sees it; badges on one pin stand side by side. */
  project(camera: PerspectiveCamera, width: number, height: number): void {
    const stacked = new Map<number, number>()
    for (const { placed, el } of this.items) {
      this.p.copy(placed.at).project(camera)
      el.hidden = this.p.z > 1
      const n = stacked.get(placed.badge.bcm) ?? 0
      stacked.set(placed.badge.bcm, n + 1)
      const x = ((this.p.x + 1) / 2) * width + n * SIDE_BY_SIDE_PX
      const y = ((1 - this.p.y) / 2) * height
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -160%)`
    }
  }

  /** Where each badge is, in pixels of the canvas (tests). */
  screen(
    camera: PerspectiveCamera,
    width: number,
    height: number
  ): { id: string; x: number; y: number }[] {
    return this.items.map(({ placed }) => {
      this.p.copy(placed.at).project(camera)
      return {
        id: placed.badge.id,
        x: ((this.p.x + 1) / 2) * width,
        y: ((1 - this.p.y) / 2) * height
      }
    })
  }
}
