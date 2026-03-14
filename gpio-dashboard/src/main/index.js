import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import SSHManager from './ssh-manager'
import WSClient from './ws-client'
import PiAgentDeployer from './pi-agent-deployer'
import store from './store'

const sshManager = new SSHManager()
const wsClient = new WSClient()
const deployer = new PiAgentDeployer()

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0F172A',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Disable Electron's built-in pinch-to-zoom so gestures reach the renderer
  mainWindow.webContents.on('zoom-changed', (e) => {
    e.preventDefault()
  })
  mainWindow.webContents.setZoomFactor(1)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

// --- SSH IPC Handlers ---

ipcMain.handle('ssh:connect', async (_e, config) => {
  try {
    await sshManager.connect(config)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh:disconnect', async () => {
  sshManager.disconnect()
  return { success: true }
})

ipcMain.handle('ssh:execute', async (_e, cmd) => {
  try {
    const result = await sshManager.execute(cmd)
    return result
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('ssh:scp', async (_e, localPath, remotePath) => {
  try {
    await sshManager.scpPut(localPath, remotePath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh:scpBuffer', async (_e, content, remotePath) => {
  try {
    await sshManager.scpPutBuffer(content, remotePath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('ssh:getStatus', () => {
  return { status: sshManager.status }
})

sshManager.on('status-change', (data) => {
  sendToRenderer('ssh:status-change', data)
})

// --- GPIO / WebSocket IPC Handlers ---

ipcMain.handle('gpio:connect', async (_e, host) => {
  try {
    wsClient.connect(host)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('gpio:disconnect', async () => {
  wsClient.disconnect()
  return { success: true }
})

wsClient.on('gpio_state', (data) => {
  sendToRenderer('gpio:state', data)
})

wsClient.on('system_info', (data) => {
  sendToRenderer('gpio:system-info', data)
})

// --- Terminal IPC Handlers ---

ipcMain.handle('terminal:create', async (_e, sessionId) => {
  try {
    await sshManager.createShell(sessionId)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.on('terminal:write', (_e, sessionId, data) => {
  sshManager.writeToShell(sessionId, data)
})

ipcMain.handle('terminal:resize', async (_e, sessionId, cols, rows) => {
  sshManager.resizeShell(sessionId, cols, rows)
  return { success: true }
})

ipcMain.handle('terminal:destroy', async (_e, sessionId) => {
  sshManager.destroyShell(sessionId)
  return { success: true }
})

sshManager.on('shell-data', ({ sessionId, data }) => {
  sendToRenderer(`terminal:data:${sessionId}`, data)
})

// --- Agent IPC Handlers ---

ipcMain.handle('agent:deploy', async () => {
  try {
    const result = await deployer.deploy(sshManager)
    return result
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('agent:install', async () => {
  try {
    const result = await deployer.install(sshManager)
    return result
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('agent:start', async () => {
  try {
    const result = await deployer.start(sshManager)
    return result
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('agent:stop', async () => {
  try {
    const result = await deployer.stop(sshManager)
    return result
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('agent:getStatus', async () => {
  try {
    const result = await deployer.getStatus(sshManager)
    return result
  } catch (err) {
    return { running: false, error: err.message }
  }
})

wsClient.on('output', (data) => {
  sendToRenderer('agent:log', data)
})

wsClient.on('agent_status', (data) => {
  sendToRenderer('agent:status', data)
})

// --- Settings IPC Handlers ---

ipcMain.handle('settings:get', (_e, key) => {
  return store.get(key)
})

ipcMain.handle('settings:set', (_e, key, value) => {
  store.set(key, value)
  return { success: true }
})

ipcMain.handle('settings:getAll', () => {
  return store.store
})

// --- App Lifecycle ---

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.gpio-dashboard')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  sshManager.disconnect()
  wsClient.disconnect()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
