// The hardware checkpoints of the step in hand (SPEC 11.7, 14.4): an I2C scan, "press the button",
// "toggle the LED". Each is a card with one button, and nothing runs until that button is clicked.
// The scan and the toggle need the SSH session; the press watch needs the Pi's telemetry.
import type { CircuitDoc } from '../core/model/types'
import type { Checkpoint } from '../state/checkpoints'
import { PRESS_TIMEOUT_MS, checkpointKey, useCheckpoints } from '../state/checkpointStore'
import { useLive } from '../state/liveStore'
import useConnectionStore from '../store/connectionStore'

const hex = (a: number) => `0x${a.toString(16).padStart(2, '0')}`

const TITLE: Record<Checkpoint['kind'], string> = {
  'i2c-scan': 'I2C scan',
  press: 'Press the button',
  'toggle-led': 'Toggle the LED'
}

function Card({ doc, checkpoint }: { doc: CircuitDoc; checkpoint: Checkpoint }) {
  const key = checkpointKey(checkpoint)
  const run = useCheckpoints((s) => s.runs[key]) ?? { phase: 'idle', message: '', causes: [] }
  const connected = useConnectionStore((s) => s.status === 'connected')
  const telemetry = useLive((s) => s.online)
  const { scan, watchPress, toggle, answer, cancel } = useCheckpoints.getState()
  const busy = run.phase === 'working' || run.phase === 'waiting' || run.phase === 'asking'
  const watching =
    checkpoint.kind === 'press' && (run.phase === 'working' || run.phase === 'waiting')

  let blurb: string
  let label: string
  let ready: boolean
  let needs: string
  let start: () => void
  switch (checkpoint.kind) {
    case 'i2c-scan':
      blurb = `Checks that the module answers at ${checkpoint.addresses.map(hex).join(' or ')} on the Pi's I2C bus. It only reads the bus.`
      label = 'Scan the I2C bus'
      ready = connected
      needs = 'Connect to the Pi first.'
      start = () => void scan(checkpoint)
      break
    case 'press':
      blurb = `Press ${checkpoint.part} while this watches GPIO${checkpoint.gpio} for its level to change. It only reads the pin.`
      label = `Watch GPIO${checkpoint.gpio}`
      ready = telemetry
      needs = 'Connect to the Pi and start its agent first.'
      start = () => void watchPress(checkpoint, doc)
      break
    case 'toggle-led':
      blurb = `Drives GPIO${checkpoint.gpio} as an output for about 6 s, so ${checkpoint.part} should light three times. It runs a short generated program on the Pi, after the same ERC check as Run on Pi.`
      label = `Toggle ${checkpoint.part} on GPIO${checkpoint.gpio}`
      ready = connected
      needs = 'Connect to the Pi first.'
      start = () => void toggle(checkpoint, doc)
      break
  }

  return (
    <section
      aria-label={`Checkpoint: ${TITLE[checkpoint.kind]}`}
      className="space-y-1.5 rounded-btn border border-white/[0.08] bg-white/[0.02] p-2"
    >
      <h3 className="text-xs font-semibold text-gray-200">Checkpoint · {TITLE[checkpoint.kind]}</h3>
      <p className="text-xs text-gray-400">{blurb}</p>
      {watching ? (
        <button className="btn-secondary px-2 py-1 text-xs" onClick={() => cancel(key)}>
          Stop watching
        </button>
      ) : (
        <button
          className="btn-secondary px-2 py-1 text-xs"
          disabled={!ready || busy}
          onClick={start}
        >
          {run.phase === 'passed' || run.phase === 'failed' || run.phase === 'error'
            ? `${label} again`
            : label}
        </button>
      )}
      {!ready && run.phase === 'idle' && <p className="text-xs text-gray-500">{needs}</p>}
      {watching && (
        <p className="text-xs text-gray-500">Gives up after {PRESS_TIMEOUT_MS / 1000} s.</p>
      )}
      {run.message && (
        <p
          role="status"
          className={
            run.phase === 'passed'
              ? 'text-xs text-emerald-400'
              : run.phase === 'failed' || run.phase === 'error'
                ? 'text-xs text-red-300'
                : 'text-xs text-amber-300'
          }
        >
          {run.message}
        </p>
      )}
      {run.phase === 'asking' && checkpoint.kind === 'toggle-led' && (
        <div className="flex gap-1.5">
          <button
            className="btn-success px-2 py-1 text-xs"
            onClick={() => answer(checkpoint, doc, true)}
          >
            Yes, it lit
          </button>
          <button
            className="btn-secondary px-2 py-1 text-xs"
            onClick={() => answer(checkpoint, doc, false)}
          >
            No
          </button>
        </div>
      )}
      {run.causes.length > 0 && (
        <ul aria-label="Likely causes" className="list-disc space-y-0.5 pl-4 text-xs text-gray-300">
          {run.causes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function Checkpoints({
  doc,
  checkpoints
}: {
  doc: CircuitDoc
  checkpoints: Checkpoint[]
}) {
  if (!checkpoints.length) return null
  return (
    <div className="space-y-2" data-testid="checkpoints">
      {checkpoints.map((c) => (
        <Card key={checkpointKey(c)} doc={doc} checkpoint={c} />
      ))}
    </div>
  )
}
