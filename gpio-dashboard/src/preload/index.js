import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  ssh: {
    connect: (config) => ipcRenderer.invoke('ssh:connect', config),
    disconnect: () => ipcRenderer.invoke('ssh:disconnect'),
    execute: (cmd) => ipcRenderer.invoke('ssh:execute', cmd),
    scp: (localPath, remotePath) => ipcRenderer.invoke('ssh:scp', localPath, remotePath),
    scpBuffer: (content, remotePath) => ipcRenderer.invoke('ssh:scpBuffer', content, remotePath),
    getStatus: () => ipcRenderer.invoke('ssh:getStatus'),
    onStatusChange: (callback) => {
      const handler = (_e, data) => callback(data)
      ipcRenderer.on('ssh:status-change', handler)
      return () => ipcRenderer.removeListener('ssh:status-change', handler)
    }
  },

  gpio: {
    connect: (host) => ipcRenderer.invoke('gpio:connect', host),
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
    }
  },

  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
