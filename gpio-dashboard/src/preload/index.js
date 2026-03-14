import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  ssh: {
    connect: (config) => ipcRenderer.invoke('ssh:connect', config),
    disconnect: () => ipcRenderer.invoke('ssh:disconnect'),
    runTutorialScript: (filename) => ipcRenderer.invoke('ssh:runTutorialScript', filename),
    killProcess: (filename) => ipcRenderer.invoke('ssh:killProcess', filename),
    gpioCleanup: () => ipcRenderer.invoke('ssh:gpioCleanup'),
    scpBuffer: (content, remotePath) => ipcRenderer.invoke('ssh:scpBuffer', content, remotePath),
    getStatus: () => ipcRenderer.invoke('ssh:getStatus'),
    onStatusChange: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('ssh:status-change', handler)
      return () => ipcRenderer.removeListener('ssh:status-change', handler)
    }
  },

  gpio: {
    connect: (host, authToken) => ipcRenderer.invoke('gpio:connect', host, authToken),
    disconnect: () => ipcRenderer.invoke('gpio:disconnect'),
    onState: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('gpio:state', handler)
      return () => ipcRenderer.removeListener('gpio:state', handler)
    },
    onSystemInfo: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('gpio:system-info', handler)
      return () => ipcRenderer.removeListener('gpio:system-info', handler)
    }
  },

  terminal: {
    create: (sessionId) => ipcRenderer.invoke('terminal:create', sessionId),
    write: (sessionId, data) => ipcRenderer.send('terminal:write', sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    onData: (sessionId, callback) => {
      const channel = `terminal:data:${sessionId}`
      const handler = (_e, data) => callback(data)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    destroy: (sessionId) => ipcRenderer.invoke('terminal:destroy', sessionId)
  },

  agent: {
    deploy: () => ipcRenderer.invoke('agent:deploy'),
    install: () => ipcRenderer.invoke('agent:install'),
    start: () => ipcRenderer.invoke('agent:start'),
    stop: () => ipcRenderer.invoke('agent:stop'),
    getStatus: () => ipcRenderer.invoke('agent:getStatus'),
    onLog: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('agent:log', handler)
      return () => ipcRenderer.removeListener('agent:log', handler)
    },
    onStatus: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('agent:status', handler)
      return () => ipcRenderer.removeListener('agent:status', handler)
    }
  },

  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setPassword: (value) => ipcRenderer.invoke('settings:setPassword', value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  },

  ai: {
    generate: (params) => ipcRenderer.send('ai:generate', params),
    abort: () => ipcRenderer.invoke('ai:abort'),
    onChunk: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('ai:chunk', handler)
      return () => ipcRenderer.removeListener('ai:chunk', handler)
    },
    onDone: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('ai:done', handler)
      return () => ipcRenderer.removeListener('ai:done', handler)
    },
    onError: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('ai:error', handler)
      return () => ipcRenderer.removeListener('ai:error', handler)
    },
    setApiKey: (value) => ipcRenderer.invoke('settings:setApiKey', value),
    hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error('Failed to expose electron API:', error)
  }
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose api:', error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
