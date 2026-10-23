// Exposes the `window.api` bridge the renderer uses, backed by Tauri commands
// (src-tauri/src/commands.rs) and events. Skipped outside Tauri, so the UI can
// still be previewed in a plain browser with `npm run web:dev`.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// `listen` is async, but callers expect a synchronous unsubscribe function. Events that
// arrive before the real unlisten completes are dropped.
function on(event, callback) {
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

// Fire-and-forget: rejections have nowhere useful to go.
const send = (command, args) => {
  invoke(command, args).catch(() => {})
}

// Tauri runs async commands concurrently, so keystrokes are sent one at a time to
// keep them in order.
let terminalWrites = Promise.resolve()
const queueTerminalWrite = (sessionId, data) => {
  terminalWrites = terminalWrites
    .then(() => invoke('terminal_write', { sessionId, data }))
    .catch(() => {})
}

const api = {
  ssh: {
    connect: (config) => invoke('ssh_connect', { config }),
    selectKeyFile: () => invoke('ssh_select_key_file'),
    disconnect: () => invoke('ssh_disconnect'),
    runTutorialScript: (filename) => invoke('ssh_run_tutorial_script', { filename }),
    killProcess: (filename) => invoke('ssh_kill_process', { filename }),
    gpioCleanup: () => invoke('ssh_gpio_cleanup'),
    scpBuffer: (content, remotePath) => invoke('ssh_scp_buffer', { content, remotePath }),
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
    create: (sessionId) => invoke('terminal_create', { sessionId }),
    write: (sessionId, data) => queueTerminalWrite(sessionId, data),
    resize: (sessionId, cols, rows) => invoke('terminal_resize', { sessionId, cols, rows }),
    onData: (sessionId, callback) => on(`terminal:data:${sessionId}`, callback),
    destroy: (sessionId) => invoke('terminal_destroy', { sessionId })
  },

  agent: {
    deploy: () => invoke('agent_deploy'),
    install: () => invoke('agent_install'),
    start: () => invoke('agent_start'),
    stop: () => invoke('agent_stop'),
    getStatus: () => invoke('agent_get_status'),
    onLog: (callback) => on('agent:log', callback),
    onStatus: (callback) => on('agent:status', callback)
  },

  settings: {
    get: (key) => invoke('settings_get', { key }),
    set: (key, value) => invoke('settings_set', { key, value }),
    setPassword: (value) => invoke('settings_set_password', { value }),
    getAll: () => invoke('settings_get_all')
  },

  ai: {
    generate: (params) => send('ai_generate', { params }),
    abort: () => invoke('ai_abort'),
    onChunk: (callback) => on('ai:chunk', callback),
    onDone: (callback) => on('ai:done', callback),
    onError: (callback) => on('ai:error', callback),
    setApiKey: (value) => invoke('settings_set_api_key', { value }),
    hasApiKey: () => invoke('settings_has_api_key')
  }
}

// The webview would navigate itself (or ignore the click) for external links, so
// hand http(s) URLs to the system browser.
function installExternalLinkHandler() {
  const isWebUrl = (url) => /^https?:\/\//i.test(url)
  const open = (url) => send('open_external', { url })

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

if (window.__TAURI_INTERNALS__) {
  window.api = api
  installExternalLinkHandler()
}
