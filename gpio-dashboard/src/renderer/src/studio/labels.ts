// Labels (SPEC 11.5): DOM tags over the canvas for each placed pin ("Anode (+)", "E B C"…), the
// T-board's pin names, and row and column guides on every board. Positions come from core
// geometry; a frame that moved the camera re-projects them.
import { type PerspectiveCamera, Vector3 } from 'three/webgpu'
import { boardDef } from '../core/defs/boards'
import { TBOARD } from '../core/defs/controllers'
import { columnY, rowX } from '../core/geometry/breadboard'
import { tboardPinHole } from '../core/geometry/tboard'
import type { CircuitDoc } from '../core/model/types'
import { MAIN_COLUMNS } from '../core/model/types'
import { toTable } from '../core/reach/reach'
import { defOf, holeInScene, modulePinInScene, toThree } from './coords'

type Kind = 'pin' | 'tboard' | 'guide' | 'volt' | 'sense' | 'halo'

export interface Label {
  text: string
  at: Vector3
  kind: Kind
}

const STYLE: Record<Kind, string> = {
  pin: 'bg-surface-900/85 text-amber-200',
  tboard: 'bg-red-950/80 text-gray-100',
  guide: 'text-gray-400',
  volt: 'bg-surface-900/85 text-sky-200',
  sense: 'bg-red-950/85 text-red-200 whitespace-pre',
  halo: 'bg-amber-950/85 text-amber-200'
}

/** Where a tag stands against its point: pin tags above it, net tags below it, the rest on it. */
const SHIFT: Record<Kind, string> = {
  pin: '-130%',
  halo: '-130%',
  volt: '40%',
  sense: '40%',
  tboard: '-50%',
  guide: '-50%'
}

/** Every label the document shows. */
export function labelsOf(doc: CircuitDoc): Label[] {
  const labels: Label[] = []
  for (const board of doc.boards) {
    const def = boardDef(board.defId)
    const z = def.body.heightMm
    const at = (x: number, y: number) => toThree(toTable(board.transform, [x, y]), z)
    // Row numbers beside column a, as printed (1, 5, 10…); column letters past both ends.
    for (let row = 1; row <= def.rows; row++) {
      if (row === 1 || row % 5 === 0)
        labels.push({
          text: `${row}`,
          at: at(rowX(def, row), columnY(def, 'a') - 3),
          kind: 'guide'
        })
    }
    for (const col of MAIN_COLUMNS) {
      for (const row of [0, def.rows + 1])
        labels.push({ text: col, at: at(rowX(def, row), columnY(def, col)), kind: 'guide' })
    }
  }
  const tb = doc.controller.tboard
  const tbBoard = doc.boards.find((b) => b.id === tb.board)
  if (tbBoard) {
    for (const { pin, label } of TBOARD.pins) {
      labels.push({ text: label, at: holeInScene(tbBoard, tboardPinHole(tb, pin)), kind: 'tboard' })
    }
  }
  for (const part of doc.parts) {
    for (const pin of defOf(doc, part.defId).pins) {
      const hole = part.placement.pins[pin.id]
      const board = hole && doc.boards.find((b) => b.id === hole.board)
      const at = board ? holeInScene(board, hole) : modulePinInScene(doc, part, pin.id)
      if (at) labels.push({ text: pin.label, at, kind: 'pin' })
    }
  }
  return labels
}

export class LabelLayer {
  private labels: { label: Label; el: HTMLElement }[] = []
  private readonly p = new Vector3()

  constructor(private readonly container: HTMLElement) {}

  /** Replaces the labels with the document's, or none. */
  set(labels: Label[]): void {
    this.container.replaceChildren()
    this.labels = labels.map((label) => {
      const el = document.createElement('div')
      el.className = `absolute left-0 top-0 whitespace-nowrap rounded px-1 font-mono text-[10px] leading-4 ${STYLE[label.kind]}`
      el.textContent = label.text
      this.container.append(el)
      return { label, el }
    })
  }

  /** The labels' texts, in order (tests). */
  texts(): string[] {
    return this.labels.map(({ el }) => el.textContent ?? '')
  }

  /** Changes the texts of labels whose places stay (a voltage tag following the simulation). */
  retext(texts: string[]): void {
    this.labels.forEach(({ label, el }, i) => {
      if (label.text !== texts[i]) {
        label.text = texts[i]!
        el.textContent = texts[i]!
      }
    })
  }

  /** Puts each label over its point as the camera sees it; hidden behind the camera. */
  project(camera: PerspectiveCamera, width: number, height: number): void {
    for (const { label, el } of this.labels) {
      this.p.copy(label.at).project(camera)
      el.hidden = this.p.z > 1
      const x = ((this.p.x + 1) / 2) * width
      const y = ((1 - this.p.y) / 2) * height
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, ${SHIFT[label.kind]})`
    }
  }
}
