// Dev overlay (SPEC 18 "Native window"): what the real webview reports about itself.
// Shown by default in dev builds; Cmd/Ctrl+Shift+D toggles it in any build.
import { Suspense, use, useSyncExternalStore } from 'react'
import { probePlatform, type PlatformProbe } from './probe'

let visible = import.meta.env.DEV
const listeners = new Set<() => void>()

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    visible = !visible
    listeners.forEach((notify) => notify())
  }
})

function subscribe(notify: () => void): () => void {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const tone = ok === undefined ? 'text-slate-300' : ok ? 'text-emerald-400' : 'text-rose-400'
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 w-36 shrink-0">{label}</span>
      <span className={tone}>{value}</span>
    </div>
  )
}

function ProbeRows({ probe }: { probe: Promise<PlatformProbe> }) {
  const p = use(probe)
  const gpu = p.webgpu
  return (
    <>
      <Row label="origin" value={p.origin} />
      <Row label="isSecureContext" value={String(p.isSecureContext)} ok={p.isSecureContext} />
      <Row
        label="crossOriginIsolated"
        value={String(p.crossOriginIsolated)}
        ok={p.crossOriginIsolated}
      />
      <Row label="SharedArrayBuffer" value={String(p.sharedArrayBuffer)} ok={p.sharedArrayBuffer} />
      <Row label="ipc" value={p.ipc} ok={p.ipc.startsWith('ok')} />
      <Row
        label="navigator.gpu"
        value={gpu.available ? 'adapter ok' : gpu.reason}
        ok={gpu.available}
      />
      {gpu.available && (
        <>
          <Row
            label="adapter"
            value={`${gpu.vendor} · ${gpu.architecture} · ${gpu.device || '—'}`}
          />
          <Row label="description" value={gpu.description || '—'} />
          <Row label="maxBufferSize" value={`${(gpu.maxBufferSize / 2 ** 20).toFixed(0)} MiB`} />
          <Row label="features" value={gpu.features.join(', ') || '—'} />
        </>
      )}
      <Row label="userAgent" value={p.userAgent} />
    </>
  )
}

export default function DevOverlay() {
  const shown = useSyncExternalStore(subscribe, () => visible)
  if (!shown) return null
  return (
    <div
      data-testid="dev-overlay"
      className="fixed bottom-3 right-3 z-50 max-w-xl rounded-lg border border-slate-700 bg-slate-950/90 p-3 font-mono text-[11px] leading-5 shadow-lg pointer-events-none"
    >
      <Suspense fallback={<Row label="platform" value="probing…" />}>
        <ProbeRows probe={probePlatform()} />
      </Suspense>
    </div>
  )
}
