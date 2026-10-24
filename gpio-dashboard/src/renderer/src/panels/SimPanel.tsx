// Sim/Probes (SPEC 11.1, 11.5): drive GPIOs and part inputs, read the simulated circuit, and
// predict what Board Sense would read from each GPIO.
import { Radar } from 'lucide-react'
import { partDef } from '../core/defs/parts'
import type { CircuitDoc, PartInstance } from '../core/model/types'
import { netlist } from '../core/netlist/netlist'
import type { GpioState } from '../core/sim/circuit'
import { USER_GPIOS, useWorkbench } from '../state/workbenchStore'
import { INPUT_PROPS } from './inputs'

/** GPIOs whose nets reach anything besides the header. */
function usedGpios(doc: CircuitDoc): number[] {
  const nets = netlist(doc, partDef).nets
  return USER_GPIOS.filter((bcm) =>
    nets.some((n) => n.names.includes(`GPIO${bcm}`) && n.members.some((m) => m.kind !== 'header'))
  )
}

type Mode = 'in-off' | 'in-up' | 'in-down' | 'out-low' | 'out-high' | 'pwm'

const modeOf = (s: GpioState | undefined): Mode =>
  !s
    ? 'in-off'
    : s.mode === 'in'
      ? (`in-${s.pull}` as Mode)
      : s.pwm
        ? 'pwm'
        : s.level
          ? 'out-high'
          : 'out-low'

const stateOf = (mode: Mode, duty: number): GpioState =>
  mode === 'pwm'
    ? { mode: 'out', level: false, pwm: { frequencyHz: 1000, duty, startS: 0 } }
    : mode.startsWith('in-')
      ? { mode: 'in', pull: mode.slice(3) as 'off' | 'up' | 'down' }
      : { mode: 'out', level: mode === 'out-high' }

const fmt = (v: number, unit: string) =>
  Math.abs(v) < 1e-3 && unit === 'A'
    ? `${(v * 1e6).toFixed(1)} µA`
    : unit === 'A'
      ? `${(v * 1e3).toFixed(2)} mA`
      : `${v.toFixed(3)} V`

function GpioControl({ bcm }: { bcm: number }) {
  const state = useWorkbench((s) => s.gpio[bcm])
  const reading = useWorkbench((s) => s.sim?.reads[bcm])
  const pin = useWorkbench((s) => s.sim?.snapshot.gpio[bcm])
  const setGpio = useWorkbench((s) => s.setGpio)
  const mode = modeOf(state)
  const duty = state?.mode === 'out' && state.pwm ? state.pwm.duty : 0.5
  return (
    <tr className="border-t border-white/[0.04]">
      <td className="py-1.5 pr-3 font-mono text-gray-200">GPIO{bcm}</td>
      <td className="pr-3">
        <select
          aria-label={`GPIO${bcm} mode`}
          className="bg-surface-800 text-gray-200 text-xs rounded px-1.5 py-1"
          value={mode}
          onChange={(e) => setGpio(bcm, stateOf(e.target.value as Mode, duty))}
        >
          <option value="in-off">input, no pull</option>
          <option value="in-up">input, pull-up</option>
          <option value="in-down">input, pull-down</option>
          <option value="out-low">output LOW</option>
          <option value="out-high">output HIGH</option>
          <option value="pwm">PWM 1 kHz</option>
        </select>
      </td>
      <td className="pr-3 w-32">
        {mode === 'pwm' && (
          <input
            aria-label={`GPIO${bcm} duty`}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={duty}
            onChange={(e) => setGpio(bcm, stateOf('pwm', Number(e.target.value)))}
          />
        )}
      </td>
      <td className="pr-3 font-mono text-xs text-gray-400">{pin ? fmt(pin.volts, 'V') : ''}</td>
      <td className="pr-3 font-mono text-xs text-gray-400">
        {pin && state?.mode === 'out' ? fmt(pin.currentA, 'A') : ''}
      </td>
      <td className="font-mono text-xs text-accent-light">{reading ?? ''}</td>
    </tr>
  )
}

function PartInputs({ part }: { part: PartInstance }) {
  const def = partDef(part.defId)
  const env = useWorkbench((s) => s.env[part.id])
  const setInput = useWorkbench((s) => s.setInput)
  const keys = Object.entries(def.properties).filter(([key]) => INPUT_PROPS.has(key))
  const isButton = def.sim.model === 'tact-switch'
  if (!keys.length && !isButton) return null
  const value = (key: string) => env?.[key] ?? part.props[key] ?? def.properties[key]?.default
  return (
    <div className="card py-3">
      <div className="text-xs font-mono text-gray-400 mb-2">
        {part.id} · {def.name}
      </div>
      {isButton && (
        <button
          className="btn-secondary text-xs"
          onPointerDown={() => setInput(part.id, 'pressed', true)}
          onPointerUp={() => setInput(part.id, 'pressed', false)}
          onPointerLeave={() => env?.pressed && setInput(part.id, 'pressed', false)}
        >
          {env?.pressed ? 'Pressed' : 'Hold to press'}
        </button>
      )}
      {keys.map(([key, schema]) => (
        <label key={key} className="flex items-center gap-3 text-xs text-gray-300 mt-1">
          <span className="w-40">{schema.label}</span>
          {schema.type === 'boolean' ? (
            <input
              type="checkbox"
              checked={value(key) === true}
              onChange={(e) => setInput(part.id, key, e.target.checked)}
            />
          ) : schema.type === 'number' ? (
            <>
              <input
                type="range"
                min={schema.min ?? 0}
                max={schema.max ?? 100}
                step={((schema.max ?? 100) - (schema.min ?? 0)) / 200}
                value={Number(value(key))}
                onChange={(e) => setInput(part.id, key, Number(e.target.value))}
              />
              <span className="font-mono w-16">
                {Number(value(key)).toFixed(1)} {schema.unit ?? ''}
              </span>
            </>
          ) : null}
        </label>
      ))}
    </div>
  )
}

export default function SimPanel({ doc }: { doc: CircuitDoc }) {
  const gpios = usedGpios(doc)
  const sim = useWorkbench((s) => s.sim)
  const probe = useWorkbench((s) => s.probe)
  const advance = useWorkbench((s) => s.advance)
  const runProbe = useWorkbench((s) => s.runProbe)
  const snap = sim?.snapshot
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-300">GPIOs in this circuit</h2>
        <table className="text-sm">
          <tbody>
            {gpios.map((bcm) => (
              <GpioControl key={bcm} bcm={bcm} />
            ))}
          </tbody>
        </table>
        <h2 className="text-sm font-semibold text-gray-300 pt-2">Inputs</h2>
        {doc.parts.map((p) => (
          <PartInputs key={p.id} part={p} />
        ))}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>t = {(snap?.t ?? 0).toFixed(3)} s</span>
          {[0.01, 0.1, 1].map((dt) => (
            <button key={dt} className="btn-ghost text-xs" onClick={() => advance(dt)}>
              +{dt * 1000} ms
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-300">Simulated</h2>
        {snap?.error && <p className="text-sm text-red-400">Simulation error: {snap.error}</p>}
        {snap && (
          <div className="card py-3 space-y-1 text-xs">
            {Object.entries(snap.dies).map(([key, d]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-24 font-mono text-gray-300">{key}</span>
                <div className="flex-1 h-2 rounded bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full bg-amber-400"
                    style={{ width: `${Math.min(d.brightness, 1) * 100}%` }}
                  />
                </div>
                <span className="w-20 font-mono text-gray-400 text-right">
                  {fmt(d.currentA, 'A')}
                </span>
              </div>
            ))}
            <div className="pt-2 text-gray-400 font-mono">
              3V3 draws {fmt(snap.rails['3V3'], 'A')} · 5V draws {fmt(snap.rails['5V'], 'A')}
              {snap.approximate && ' · averaged (more than 4 PWM pins)'}
            </div>
            {Object.entries(snap.parts).map(([part, view]) => (
              <div key={part} className="font-mono text-gray-400">
                {part}: {JSON.stringify(view)}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <h2 className="text-sm font-semibold text-gray-300">Board Sense prediction</h2>
          <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={runProbe}>
            <Radar className="w-3.5 h-3.5" /> Predict probe signature
          </button>
        </div>
        {probe && (
          <div className="card py-3 text-xs space-y-1">
            {probe.probed
              .filter((b) => gpios.includes(b) || probe.observable[b])
              .map((b) => (
                <div key={b} className="flex gap-3 font-mono">
                  <span className="w-16 text-gray-300">GPIO{b}</span>
                  <span className="w-28 text-gray-400">{probe.bias[b]!.class}</span>
                  <span className={probe.observable[b] ? 'text-emerald-400' : 'text-gray-500'}>
                    {probe.observable[b] ? 'observable' : 'unobserved'}
                  </span>
                </div>
              ))}
            {probe.skipped.map((s) => (
              <div key={s.bcm} className="font-mono text-gray-500">
                GPIO{s.bcm} skipped: {s.reason}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
