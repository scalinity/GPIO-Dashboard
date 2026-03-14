import Store from 'electron-store'
import { safeStorage } from 'electron'

const schema = {
  connection: {
    type: 'object',
    properties: {
      host: { type: 'string', default: '' },
      port: { type: 'number', default: 22 },
      username: { type: 'string', default: 'pi' },
      password: { type: 'string', default: '' }
    },
    default: {}
  },
  ui: {
    type: 'object',
    properties: {
      lastTab: { type: 'string', default: 'gpio' },
      terminalHeight: { type: 'number', default: 300 },
      completedTutorials: { type: 'array', items: { type: 'string' }, default: [] }
    },
    default: {}
  }
}

const defaults = {
  connection: {
    host: '',
    port: 22,
    username: 'pi',
    password: ''
  },
  ui: {
    lastTab: 'gpio',
    terminalHeight: 300,
    completedTutorials: []
  }
}

const store = new Store({ schema, defaults })

store.setSecure = function (key, value) {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(value)
    this.set(key, encrypted.toString('base64'))
  } else {
    this.set(key, value)
  }
}

store.getSecure = function (key) {
  const value = this.get(key)
  if (!value) return ''
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const buffer = Buffer.from(value, 'base64')
      return safeStorage.decryptString(buffer)
    } catch {
      return value
    }
  }
  return value
}

export default store
