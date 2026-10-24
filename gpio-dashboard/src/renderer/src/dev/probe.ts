// Platform facts the Studio depends on, read from the real webview (SPEC 10.2, 13.2, 18).

export type WebGpuProbe =
  | { available: false; reason: string }
  | {
      available: true
      vendor: string
      architecture: string
      device: string
      description: string
      features: string[]
      maxBufferSize: number
      maxStorageBufferBindingSize: number
    }

export interface PlatformProbe {
  origin: string
  isSecureContext: boolean
  crossOriginIsolated: boolean
  sharedArrayBuffer: boolean
  /** A read-only command round trip: proves the IPC ACL admits this origin. */
  ipc: string
  webgpu: WebGpuProbe
  userAgent: string
}

async function probeWebGpu(): Promise<WebGpuProbe> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    return { available: false, reason: 'navigator.gpu is undefined' }
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return { available: false, reason: 'requestAdapter() returned null' }
    const { vendor, architecture, device, description } = adapter.info
    return {
      available: true,
      vendor,
      architecture,
      device,
      description,
      features: [...adapter.features].sort(),
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize
    }
  } catch (error) {
    return { available: false, reason: `requestAdapter() threw: ${String(error)}` }
  }
}

async function probeIpc(): Promise<string> {
  const api = (window as { api?: { ssh?: { getStatus?: () => Promise<unknown> } } }).api
  if (!api?.ssh?.getStatus) return 'window.api unavailable'
  try {
    return `ok ${JSON.stringify(await api.ssh.getStatus())}`
  } catch (error) {
    return `failed: ${String(error)}`
  }
}

let probe: Promise<PlatformProbe> | undefined

/** Runs once per page load; later calls share the result. */
export function probePlatform(): Promise<PlatformProbe> {
  probe ??= Promise.all([probeWebGpu(), probeIpc()]).then(([webgpu, ipc]) => {
    const result: PlatformProbe = {
      origin: location.origin,
      isSecureContext: globalThis.isSecureContext === true,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
      ipc,
      webgpu,
      userAgent: navigator.userAgent
    }
    console.info('[platform]', JSON.stringify(result))
    return result
  })
  return probe
}
