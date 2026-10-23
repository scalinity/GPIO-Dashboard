// Exposes the `window.api` bridge the renderer uses, backed by Tauri commands
// (src-tauri/src/commands.rs) and events. Skipped outside Tauri, so the UI can
// still be previewed in a plain browser with `npm run web:dev`.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export function createApi({ invoke, listen }) {
  // `listen` is async, but callers expect a synchronous unsubscribe function. Events that
  // arrive before the real unlisten completes are dropped.
  const on = (event, callback) => {
    let unlisten = null
    let cancelled = false
    listen(event, (e) => {
      if (!cancelled) callback(e.payload)
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
      unlisten = null
    }
  }

  // The commands report failures as `{ success: false, error }`. A rejection from Tauri
  // itself (rejected arguments, an unknown command) gets the same shape.
  const structured = (command, args) =>
    invoke(command, args).catch((e) => ({ success: false, error: String(e) }))

  // Tauri runs async commands concurrently, so keystrokes are sent one at a time to
  // keep them in order.
  let terminalWrites = Promise.resolve()
  const queueTerminalWrite = (sessionId, data) => {
    terminalWrites = terminalWrites
      .then(() => invoke('terminal_write', { sessionId, data }))
      .catch(() => {})
  }

  return {
    ssh: {
      connect: (config) => structured('ssh_connect', { config }),
      selectKeyFile: () => invoke('ssh_select_key_file'),
      disconnect: () => invoke('ssh_disconnect'),
      runTutorialScript: (filename) => structured('ssh_run_tutorial_script', { filename }),
      killProcess: (filename) => structured('ssh_kill_process', { filename }),
      gpioCleanup: () => structured('ssh_gpio_cleanup'),
      scpBuffer: (content, remotePath) => structured('ssh_scp_buffer', { content, remotePath }),
      getStatus: () => invoke('ssh_get_status'),
      onStatusChange: (callback) => on('ssh:status-change', callback),
      onTutorialOutput: (callback) => on('tutorial:output', callback)
    },

    gpio: {
      connect: (host, authToken) => invoke('gpio_connect', { host, authToken }),
      disconnect: () => invoke('gpio_disconnect'),
      onState: (callback) => on('gpio:state', callback),
      onSystemInfo: (callback) => on('gpio:system-info', callback)
    },

    terminal: {
      create: (sessionId) => structured('terminal_create', { sessionId }),
      write: (sessionId, data) => queueTerminalWrite(sessionId, data),
      resize: (sessionId, cols, rows) => invoke('terminal_resize', { sessionId, cols, rows }),
      onData: (sessionId, callback) => on(`terminal:data:${sessionId}`, callback),
      destroy: (sessionId) => invoke('terminal_destroy', { sessionId })
    },

    agent: {
      deploy: () => structured('agent_deploy'),
      install: () => structured('agent_install'),
      start: () => structured('agent_start'),
      stop: () => structured('agent_stop'),
      getStatus: () =>
        invoke('agent_get_status').catch((e) => ({ running: false, error: String(e) })),
      onLog: (callback) => on('agent:log', callback),
      onStatus: (callback) => on('agent:status', callback)
    },

    settings: {
      get: (key) => invoke('settings_get', { key }),
      set: (key, value) => structured('settings_set', { key, value }),
      setPassword: (value) => structured('settings_set_password', { value }),
      getAll: () => invoke('settings_get_all')
    },

    ai: {
      // Fire-and-forget: results and failures come back as events.
      generate: (params) => {
        invoke('ai_generate', { params }).catch(() => {})
      },
      abort: () => invoke('ai_abort'),
      onChunk: (callback) => on('ai:chunk', callback),
      onDone: (callback) => on('ai:done', callback),
      onError: (callback) => on('ai:error', callback),
      setApiKey: (value) => structured('settings_set_api_key', { value }),
      hasApiKey: () => invoke('settings_has_api_key')
    }
  }
}

// The webview would navigate itself (or ignore the click) for external links, so
// hand http(s) URLs to the system browser.
function installExternalLinkHandler(invoke) {
  const isWebUrl = (url) => /^https?:\/\//i.test(url)
  const open = (url) => {
    invoke('open_external', { url }).catch(() => {})
  }

  document.addEventListener(
    'click',
    (e) => {
      const anchor = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (anchor && isWebUrl(anchor.href)) {
        e.preventDefault()
        open(anchor.href)
      }
    },
    true
  )

  window.open = (url) => {
    if (typeof url === 'string' && isWebUrl(url)) open(url)
    return null
  }
}

if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
  window.api = createApi({ invoke, listen })
  installExternalLinkHandler(invoke)
}
