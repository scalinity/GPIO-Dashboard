// Exposes the `window.api` bridge the renderer uses, backed by Tauri commands
// (src-tauri/src/commands.rs) and events. Skipped outside Tauri, so the UI can
// still be previewed in a plain browser with `npm run web:dev`.
import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export function createApi({ invoke, listen, Channel }) {
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
      gpioCleanup: (pins) => structured('ssh_gpio_cleanup', { pins }),
      scpBuffer: (content, remotePath) => structured('ssh_scp_buffer', { content, remotePath }),
      getStatus: () => invoke('ssh_get_status'),
      i2cScan: (bus) => structured('ssh_i2c_scan', { bus }),
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

    // The key goes to the Keychain through Rust; no command ever returns it.
    anthropic: {
      // Streams one API request through the Rust proxy, which adds the key. `onMessage`
      // receives { status, headers }, then ArrayBuffer body chunks, then { end: true } or
      // { error: { code, message } }.
      request: (req, onMessage) =>
        invoke('anthropic_request', { req, channel: new Channel(onMessage) }),
      abort: (id) => invoke('anthropic_abort', { id }),
      setKey: (value) => structured('settings_set_anthropic_key', { value }),
      hasKey: () => invoke('settings_has_anthropic_key'),
      clearKey: () => structured('settings_clear_anthropic_key')
    },

    // Board Sense (SPEC 14.5): only the Board tab's handlers call these.
    sense: {
      start: (pins, settleUs, periodMs) => structured('sense_start', { pins, settleUs, periodMs }),
      stop: () => structured('sense_stop'),
      pause: () => structured('sense_pause'),
      resume: () => structured('sense_resume'),
      onSweep: (callback) => on('gpio:sense', callback),
      onEvent: (callback) => on('gpio:sense-event', callback)
    },
    projects: {
      list: () => structured('projects_list'),
      read: (id) => structured('projects_read', { id }),
      write: (id, doc) => structured('projects_write', { id, doc }),
      delete: (id) => structured('projects_delete', { id }),
      export: (doc) => structured('projects_export', { doc }),
      import: () => structured('projects_import')
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
  window.api = createApi({ invoke, listen, Channel })
  installExternalLinkHandler(invoke)
}
