// Uniform-grid spatial hash over axis-aligned boxes (Muller, Ten Minute Physics 11, "Spatial
// Hashing"). Boxes are inserted into every cell they overlap, in a counting-sort layout built once
// per frame; a query returns the ids stored in the cells its box overlaps, each at most once.
/** Most cells a box covers along one axis; a box longer than this only claims its start. */
const MAX_SPAN = 16

export class SpatialHash {
  private readonly inv: number
  private mask = 1023
  private starts = new Int32Array(1025)
  private cursor = new Int32Array(1024)
  private entries = new Int32Array(1024)
  private stamp = new Int32Array(0)
  private serial = 0
  /** Ids found by the last query. */
  result = new Int32Array(256)

  constructor(cell: number) {
    this.inv = 1 / cell
  }

  private cellHash(ix: number, iy: number, iz: number) {
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & this.mask
  }

  /** `boxes` holds lox, loy, loz, hix, hiy, hiz for each of the first `count` ids. */
  build(boxes: Float64Array, count: number) {
    let size = 1024
    while (size < count * 4) size *= 2
    if (size - 1 !== this.mask) {
      this.mask = size - 1
      this.starts = new Int32Array(size + 1)
      this.cursor = new Int32Array(size)
    } else {
      this.starts.fill(0)
    }
    if (this.stamp.length < count) this.stamp = new Int32Array(count * 2)
    const inv = this.inv
    let total = 0
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) {
        for (let h = 0; h < size; h++) this.starts[h + 1]! += this.starts[h]!
        this.cursor.set(this.starts.subarray(0, size))
        if (this.entries.length < total) this.entries = new Int32Array(total * 2)
      }
      for (let id = 0; id < count; id++) {
        const o = id * 6
        const x0 = Math.floor(boxes[o]! * inv),
          x1 = Math.min(Math.floor(boxes[o + 3]! * inv), x0 + MAX_SPAN)
        const y0 = Math.floor(boxes[o + 1]! * inv),
          y1 = Math.min(Math.floor(boxes[o + 4]! * inv), y0 + MAX_SPAN)
        const z0 = Math.floor(boxes[o + 2]! * inv),
          z1 = Math.min(Math.floor(boxes[o + 5]! * inv), z0 + MAX_SPAN)
        for (let ix = x0; ix <= x1; ix++) {
          for (let iy = y0; iy <= y1; iy++) {
            for (let iz = z0; iz <= z1; iz++) {
              const h = this.cellHash(ix, iy, iz)
              if (pass === 0) {
                this.starts[h + 1]!++
                total++
              } else {
                this.entries[this.cursor[h]!++] = id
              }
            }
          }
        }
      }
    }
  }

  /** Ids of boxes sharing a cell with the query box; returns how many, in `result`. */
  query(lox: number, loy: number, loz: number, hix: number, hiy: number, hiz: number): number {
    const inv = this.inv
    const x0 = Math.floor(lox * inv),
      x1 = Math.min(Math.floor(hix * inv), x0 + MAX_SPAN)
    const y0 = Math.floor(loy * inv),
      y1 = Math.min(Math.floor(hiy * inv), y0 + MAX_SPAN)
    const z0 = Math.floor(loz * inv),
      z1 = Math.min(Math.floor(hiz * inv), z0 + MAX_SPAN)
    const tag = ++this.serial
    let n = 0
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const h = this.cellHash(ix, iy, iz)
          for (let e = this.starts[h]!; e < this.starts[h + 1]!; e++) {
            const id = this.entries[e]!
            if (this.stamp[id] === tag) continue
            this.stamp[id] = tag
            if (n === this.result.length) {
              const bigger = new Int32Array(n * 2)
              bigger.set(this.result)
              this.result = bigger
            }
            this.result[n++] = id
          }
        }
      }
    }
    return n
  }
}
