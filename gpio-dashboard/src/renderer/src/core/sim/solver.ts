// Modified Nodal Analysis with a dense LU solve, Newton–Raphson with junction limiting and
// damping, gmin stepping as the fallback, and backward-Euler/trapezoidal transient (SPEC 9).
// Non-convergence is an error the caller shows; there is no silent fallback.

/** Node 0 is ground. Branch unknowns (voltage sources, inductors) follow the node voltages. */
export class System {
  readonly size: number
  readonly a: Float64Array
  readonly b: Float64Array

  constructor(
    readonly nodes: number,
    readonly branches: number
  ) {
    this.size = nodes - 1 + branches
    this.a = new Float64Array(this.size * this.size)
    this.b = new Float64Array(this.size)
  }

  clear() {
    this.a.fill(0)
    this.b.fill(0)
  }

  /** Row/column of a node (null for ground). */
  private idx(node: number): number | null {
    return node === 0 ? null : node - 1
  }

  /** Row/column of branch k. */
  branch(k: number): number {
    return this.nodes - 1 + k
  }

  addA(r: number | null, c: number | null, v: number) {
    if (r !== null && c !== null) this.a[r * this.size + c]! += v
  }

  /** A conductance g between nodes p and n. */
  conductance(p: number, n: number, g: number) {
    const i = this.idx(p)
    const j = this.idx(n)
    this.addA(i, i, g)
    this.addA(j, j, g)
    this.addA(i, j, -g)
    this.addA(j, i, -g)
  }

  /** A current i flowing from node p, through the element, into node n. */
  current(p: number, n: number, i: number) {
    const ip = this.idx(p)
    const jn = this.idx(n)
    if (ip !== null) this.b[ip]! -= i
    if (jn !== null) this.b[jn]! += i
  }

  /** An ideal voltage source V(p) - V(n) = v, with its current as branch unknown k. */
  voltageSource(p: number, n: number, v: number, k: number) {
    const row = this.branch(k)
    const ip = this.idx(p)
    const jn = this.idx(n)
    this.addA(ip, row, 1)
    this.addA(jn, row, -1)
    this.addA(row, ip, 1)
    this.addA(row, jn, -1)
    this.b[row]! += v
  }
}

export class SingularMatrixError extends Error {}

/** Solves A x = b by LU with partial pivoting. A and b are copied, not modified. */
export function solveDense(size: number, aIn: Float64Array, bIn: Float64Array): Float64Array {
  const a = Float64Array.from(aIn)
  const x = Float64Array.from(bIn)
  for (let k = 0; k < size; k++) {
    let pivot = k
    let max = Math.abs(a[k * size + k]!)
    for (let r = k + 1; r < size; r++) {
      const v = Math.abs(a[r * size + k]!)
      if (v > max) {
        max = v
        pivot = r
      }
    }
    if (max < 1e-300) throw new SingularMatrixError(`Singular circuit matrix at unknown ${k}`)
    if (pivot !== k) {
      for (let c = 0; c < size; c++) {
        const t = a[k * size + c]!
        a[k * size + c] = a[pivot * size + c]!
        a[pivot * size + c] = t
      }
      const t = x[k]!
      x[k] = x[pivot]!
      x[pivot] = t
    }
    const d = a[k * size + k]!
    for (let r = k + 1; r < size; r++) {
      const f = a[r * size + k]! / d
      if (f === 0) continue
      a[r * size + k] = f
      for (let c = k + 1; c < size; c++) a[r * size + c]! -= f * a[k * size + c]!
      x[r]! -= f * x[k]!
    }
  }
  for (let r = size - 1; r >= 0; r--) {
    let s = x[r]!
    for (let c = r + 1; c < size; c++) s -= a[r * size + c]! * x[c]!
    x[r] = s / a[r * size + r]!
  }
  return x
}

/** What a device sees while it stamps: the iteration's previous solution and the time step. */
export interface LoadContext {
  /** Node voltage from the previous Newton iterate (0 for ground). */
  v(node: number): number
  /** Branch current from the previous Newton iterate. */
  i(branch: number): number
  /** Transient: step size and method; null during DC analysis. */
  step: { h: number; method: 'be' | 'trap' } | null
  gmin: number
}

export interface Device {
  /** Number of branch unknowns this device adds. */
  readonly branchCount: number
  /** Assigned by the circuit: index of the first branch. */
  branchBase: number
  /** Stamps the device, linearized about the previous iterate. */
  load(sys: System, ctx: LoadContext): void
  /** Nonlinear devices limit their junction steps; returns true if it limited anything. */
  readonly nonlinear: boolean
  /** Called after each accepted time point, to roll history (capacitor and inductor state). */
  accept?(ctx: LoadContext): void
  /** Called once before a transient run, from the DC operating point. */
  init?(ctx: LoadContext): void
}

export class ConvergenceError extends Error {}

export interface SolveOptions {
  maxIterations?: number
  reltol?: number
  vntol?: number
  abstol?: number
  /** Damping: the largest node-voltage change one Newton step may make (volts). */
  maxStep?: number
}

const DEFAULTS = { maxIterations: 150, reltol: 1e-6, vntol: 1e-9, abstol: 1e-15, maxStep: 1 }

/** One Newton solve at a fixed gmin and time step; returns the solution or throws. */
function newton(
  nodes: number,
  devices: Device[],
  branches: number,
  guess: Float64Array,
  step: LoadContext['step'],
  gmin: number,
  options: Required<SolveOptions>
): Float64Array {
  const sys = new System(nodes, branches)
  let x = guess
  const nonlinear = devices.some((d) => d.nonlinear)
  for (let it = 0; it < options.maxIterations; it++) {
    const prev = x
    const ctx: LoadContext = {
      v: (n) => (n === 0 ? 0 : prev[n - 1]!),
      i: (k) => prev[nodes - 1 + k]!,
      step,
      gmin
    }
    sys.clear()
    for (let n = 1; n < nodes; n++) sys.conductance(n, 0, gmin)
    for (const d of devices) d.load(sys, ctx)
    const next = solveDense(sys.size, sys.a, sys.b)
    if (!nonlinear) return next
    damp(next, prev, nodes - 1, options.maxStep)
    let converged = it > 0
    for (let k = 0; k < sys.size; k++) {
      const tol =
        options.reltol * Math.max(Math.abs(next[k]!), Math.abs(prev[k]!)) +
        (k < nodes - 1 ? options.vntol : options.abstol)
      if (Math.abs(next[k]! - prev[k]!) > tol) converged = false
    }
    x = next
    if (converged) return x
  }
  throw new ConvergenceError(`No convergence in ${options.maxIterations} Newton iterations`)
}

/** Scales the whole Newton step down so no node voltage moves more than maxStep. */
function damp(next: Float64Array, prev: Float64Array, nodeCount: number, maxStep: number) {
  let worst = 0
  for (let k = 0; k < nodeCount; k++) worst = Math.max(worst, Math.abs(next[k]! - prev[k]!))
  if (worst <= maxStep) return
  const f = maxStep / worst
  for (let k = 0; k < next.length; k++) next[k] = prev[k]! + f * (next[k]! - prev[k]!)
}

/** DC operating point, falling back to gmin stepping when plain Newton does not converge. */
export function solveDc(
  nodes: number,
  devices: Device[],
  options: SolveOptions = {},
  guess?: Float64Array,
  step: LoadContext['step'] = null
): Float64Array {
  const opts = { ...DEFAULTS, ...options }
  const branches = assignBranches(devices)
  const start = guess ?? new Float64Array(nodes - 1 + branches)
  try {
    return newton(nodes, devices, branches, start, step, 1e-12, opts)
  } catch (e) {
    if (!(e instanceof ConvergenceError)) throw e
  }
  let x = start
  for (let gmin = 1e-2; gmin >= 1e-12; gmin /= 10) {
    try {
      x = newton(nodes, devices, branches, x, step, gmin, opts)
    } catch (e) {
      if (e instanceof ConvergenceError) {
        throw new ConvergenceError(
          `No convergence: gmin stepping stalled at gmin = ${gmin.toExponential(0)}`
        )
      }
      throw e
    }
  }
  return newton(nodes, devices, branches, x, step, 1e-12, opts)
}

export function assignBranches(devices: Device[]): number {
  let k = 0
  for (const d of devices) {
    d.branchBase = k
    k += d.branchCount
  }
  return k
}

export interface TransientResult {
  times: number[]
  /** Solution vectors at each time point. */
  solutions: Float64Array[]
}

/**
 * Fixed-step transient from the DC operating point: backward Euler for the first step,
 * trapezoidal after (SPEC 9).
 */
export function solveTransient(
  nodes: number,
  devices: Device[],
  stopTime: number,
  stepTime: number,
  options: SolveOptions = {},
  initial?: Float64Array
): TransientResult {
  assignBranches(devices)
  let x = initial ?? solveDc(nodes, devices, options)
  const ctx0 = contextFor(x, nodes, null)
  for (const d of devices) d.init?.(ctx0)
  const times = [0]
  const solutions = [x]
  const steps = Math.round(stopTime / stepTime)
  for (let s = 1; s <= steps; s++) {
    const step = { h: stepTime, method: s === 1 ? ('be' as const) : ('trap' as const) }
    x = solveDc(nodes, devices, options, x, step)
    const ctx = contextFor(x, nodes, step)
    for (const d of devices) d.accept?.(ctx)
    times.push(s * stepTime)
    solutions.push(x)
  }
  return { times, solutions }
}

function contextFor(x: Float64Array, nodes: number, step: LoadContext['step']): LoadContext {
  return { v: (n) => (n === 0 ? 0 : x[n - 1]!), i: (k) => x[nodes - 1 + k]!, step, gmin: 1e-12 }
}
