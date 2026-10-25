// Device models for the MNA solver (SPEC 9). Each stamps its linearization about the previous
// Newton iterate. Equations follow SPICE so results compare with ngspice: Shockley diodes with
// pnjlim junction limiting, and Ebers–Moll transport BJTs (Gummel–Poon with IS, BF, BR only).
import type { Device, LoadContext, System } from './solver'

/** Thermal voltage at 27 °C, as ngspice uses by default (TNOM = 27 °C). */
export const VT = (1.380649e-23 * 300.15) / 1.602176634e-19

abstract class Base implements Device {
  branchCount = 0
  branchBase = 0
  nonlinear = false
  abstract load(sys: System, ctx: LoadContext): void
}

export class Resistor extends Base {
  constructor(
    readonly p: number,
    readonly n: number,
    public ohms: number
  ) {
    super()
    if (!(ohms > 0)) throw new Error(`Resistance must be positive, got ${ohms}`)
  }
  load(sys: System) {
    sys.conductance(this.p, this.n, 1 / this.ohms)
  }
}

/** An ideal voltage source; its current is a branch unknown (positive into the + terminal). */
export class VoltageSource extends Base {
  override branchCount = 1
  constructor(
    readonly p: number,
    readonly n: number,
    public volts: number
  ) {
    super()
  }
  load(sys: System) {
    sys.voltageSource(this.p, this.n, this.volts, this.branchBase)
  }
}

/** A source behind a resistance (a driven GPIO): stamped as its Norton equivalent. */
export class TheveninSource extends Base {
  constructor(
    readonly p: number,
    readonly n: number,
    public volts: number,
    public ohms: number
  ) {
    super()
  }
  load(sys: System) {
    const g = 1 / this.ohms
    sys.conductance(this.p, this.n, g)
    sys.current(this.p, this.n, -this.volts * g)
  }
}

export class Switch extends Base {
  constructor(
    readonly p: number,
    readonly n: number,
    public closed: boolean,
    readonly onOhms = 0.1,
    readonly offOhms = 1e9
  ) {
    super()
  }
  load(sys: System) {
    sys.conductance(this.p, this.n, 1 / (this.closed ? this.onOhms : this.offOhms))
  }
}

/** SPICE pnjlim: limits a junction voltage step so the exponential stays tractable. */
export function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit
    }
    return vt * Math.log(vnew / vt)
  }
  return vnew
}

const vcritOf = (is: number, nvt: number) => nvt * Math.log(nvt / (Math.SQRT2 * is))

/** Shockley diode from anode a to cathode k (series resistance is a separate Resistor). */
export class Diode extends Base {
  override nonlinear = true
  private vLast = 0
  readonly nvt: number
  constructor(
    readonly a: number,
    readonly k: number,
    readonly is: number,
    readonly n: number
  ) {
    super()
    this.nvt = n * VT
  }
  load(sys: System, ctx: LoadContext) {
    const raw = ctx.v(this.a) - ctx.v(this.k)
    const vd = pnjlim(raw, this.vLast, this.nvt, vcritOf(this.is, this.nvt))
    this.vLast = vd
    const e = Math.exp(vd / this.nvt)
    const id = this.is * (e - 1)
    const gd = (this.is / this.nvt) * e
    // gmin is a real conductance across the junction, as in SPICE.
    sys.conductance(this.a, this.k, gd + ctx.gmin)
    sys.current(this.a, this.k, id - gd * vd)
  }
  init(ctx: LoadContext) {
    this.vLast = ctx.v(this.a) - ctx.v(this.k)
  }
}

/**
 * Ebers–Moll transport BJT. `polarity` is +1 for NPN and -1 for PNP. Terminal currents are taken
 * into the device; each junction is limited with pnjlim.
 */
export class Bjt extends Base {
  override nonlinear = true
  private vbeLast = 0
  private vbcLast = 0
  constructor(
    readonly c: number,
    readonly b: number,
    readonly e: number,
    readonly is: number,
    readonly bf: number,
    readonly br: number,
    readonly polarity: 1 | -1
  ) {
    super()
  }
  load(sys: System, ctx: LoadContext) {
    const s = this.polarity
    const vcrit = vcritOf(this.is, VT)
    const vbe = pnjlim(s * (ctx.v(this.b) - ctx.v(this.e)), this.vbeLast, VT, vcrit)
    const vbc = pnjlim(s * (ctx.v(this.b) - ctx.v(this.c)), this.vbcLast, VT, vcrit)
    this.vbeLast = vbe
    this.vbcLast = vbc
    const ef = Math.exp(vbe / VT)
    const er = Math.exp(vbc / VT)
    const { is, bf, br } = this
    // Currents into C and B (in the device's own polarity).
    const ic = is * (ef - er) - (is / br) * (er - 1)
    const ib = (is / bf) * (ef - 1) + (is / br) * (er - 1)
    const gef = (is / VT) * ef
    const ger = (is / VT) * er
    const dIc = { be: gef, bc: -ger - ger / br }
    const dIb = { be: gef / bf, bc: ger / br }
    // I_node ≈ s·i + s·(dbe·ΔVbe + dbc·ΔVbc), linearized about the limited junction voltages.
    // With Vbe = s(Vb - Ve) and Vbc = s(Vb - Vc), s² = 1 leaves the conductances sign-free.
    const stampTerminal = (node: number, i: number, dbe: number, dbc: number) => {
      addRow(sys, node, this.b, dbe + dbc)
      addRow(sys, node, this.e, -dbe)
      addRow(sys, node, this.c, -dbc)
      sys.current(node, 0, s * (i - dbe * vbe - dbc * vbc))
    }
    stampTerminal(this.c, ic, dIc.be, dIc.bc)
    stampTerminal(this.b, ib, dIb.be, dIb.bc)
    // Emitter carries the rest: Ie = -(Ic + Ib).
    stampTerminal(this.e, -(ic + ib), -(dIc.be + dIb.be), -(dIc.bc + dIb.bc))
    // Junction gmin, as SPICE adds across each junction.
    sys.conductance(this.b, this.e, ctx.gmin)
    sys.conductance(this.b, this.c, ctx.gmin)
  }
  init(ctx: LoadContext) {
    this.vbeLast = this.polarity * (ctx.v(this.b) - ctx.v(this.e))
    this.vbcLast = this.polarity * (ctx.v(this.b) - ctx.v(this.c))
  }
}

/** Adds conductance g to A[row][col] (a dependence of row's current on col's voltage). */
function addRow(sys: System, row: number, col: number, g: number) {
  sys.addA(row === 0 ? null : row - 1, col === 0 ? null : col - 1, g)
}

/** Capacitor with backward-Euler / trapezoidal companion; open circuit in DC. */
export class Capacitor extends Base {
  private vPrev = 0
  private iPrev = 0
  constructor(
    readonly p: number,
    readonly n: number,
    public farads: number
  ) {
    super()
  }
  load(sys: System, ctx: LoadContext) {
    if (!ctx.step) return
    const { h, method } = ctx.step
    const g = (method === 'trap' ? 2 : 1) * (this.farads / h)
    const i0 = method === 'trap' ? -g * this.vPrev - this.iPrev : -g * this.vPrev
    sys.conductance(this.p, this.n, g)
    sys.current(this.p, this.n, i0)
  }
  init(ctx: LoadContext) {
    this.vPrev = ctx.v(this.p) - ctx.v(this.n)
    this.iPrev = 0
  }
  accept(ctx: LoadContext) {
    if (!ctx.step) return
    const { h, method } = ctx.step
    const v = ctx.v(this.p) - ctx.v(this.n)
    const g = (method === 'trap' ? 2 : 1) * (this.farads / h)
    this.iPrev = method === 'trap' ? g * (v - this.vPrev) - this.iPrev : g * (v - this.vPrev)
    this.vPrev = v
  }
}

/** Inductor with its current as a branch unknown; a short circuit in DC. */
export class Inductor extends Base {
  override branchCount = 1
  private iPrev = 0
  private vPrev = 0
  constructor(
    readonly p: number,
    readonly n: number,
    public henries: number
  ) {
    super()
  }
  load(sys: System, ctx: LoadContext) {
    const row = sys.branch(this.branchBase)
    const ip = this.p === 0 ? null : this.p - 1
    const jn = this.n === 0 ? null : this.n - 1
    sys.addA(ip, row, 1)
    sys.addA(jn, row, -1)
    sys.addA(row, ip, 1)
    sys.addA(row, jn, -1)
    if (!ctx.step) return // V(p) - V(n) = 0
    const { h, method } = ctx.step
    const r = (method === 'trap' ? 2 : 1) * (this.henries / h)
    sys.addA(row, row, -r)
    sys.b[row]! += method === 'trap' ? -r * this.iPrev - this.vPrev : -r * this.iPrev
  }
  init(ctx: LoadContext) {
    this.iPrev = ctx.i(this.branchBase)
    this.vPrev = 0
  }
  accept(ctx: LoadContext) {
    this.iPrev = ctx.i(this.branchBase)
    this.vPrev = ctx.v(this.p) - ctx.v(this.n)
  }
}
