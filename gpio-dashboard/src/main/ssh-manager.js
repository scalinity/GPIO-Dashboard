import { Client } from 'ssh2'
import { EventEmitter } from 'events'

class SSHManager extends EventEmitter {
  constructor() {
    super()
    this.client = null
    this.config = null
    this.status = 'disconnected'
    this.shells = new Map()
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.shouldReconnect = false
  }

  _setStatus(status, error) {
    this.status = status
    this.emit('status-change', { status, error: error?.message || null })
  }

  connect(config) {
    return new Promise((resolve, reject) => {
      if (this.client) {
        this.client.removeAllListeners()
        this.client.end()
      }

      this.config = config
      this.shouldReconnect = true
      this.reconnectAttempts = 0
      this._clearReconnect()
      this._setStatus('connecting')

      this.client = new Client()
      let settled = false

      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        this.client.removeAllListeners()
        this.client.end()
        const err = new Error('Connection timeout')
        this._setStatus('error', err)
        reject(err)
      }, 10000)

      this.client.on('ready', () => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.reconnectAttempts = 0
        this._setStatus('connected')
        resolve()
      })

      this.client.on('error', (err) => {
        clearTimeout(timeout)
        const isAuthError =
          err.level === 'client-authentication' ||
          err.message?.includes('authentication')

        if (isAuthError) {
          this.shouldReconnect = false
        }
        this._setStatus('error', err)

        if (!isAuthError && this.shouldReconnect) {
          this._scheduleReconnect()
        }

        if (!settled) {
          settled = true
          reject(err)
        }
      })

      this.client.on('close', () => {
        if (this.status !== 'error') {
          this._setStatus('disconnected')
        }
        if (this.shouldReconnect && settled) {
          this._scheduleReconnect()
        }
      })

      this.client.on('end', () => {
        if (this.status !== 'error') {
          this._setStatus('disconnected')
        }
      })

      this.client.connect({
        host: config.host,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        readyTimeout: 10000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3
      })
    })
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  _scheduleReconnect() {
    this._clearReconnect()
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    this._setStatus('connecting')
    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect && this.config) {
        this.connect(this.config).catch(() => {})
      }
    }, delay)
  }

  disconnect() {
    this.shouldReconnect = false
    this._clearReconnect()
    this.shells.forEach((shell) => shell.end())
    this.shells.clear()
    if (this.client) {
      this.client.removeAllListeners()
      this.client.end()
      this.client = null
    }
    this._setStatus('disconnected')
  }

  execute(cmd) {
    return new Promise((resolve, reject) => {
      if (!this.client || this.status !== 'connected') {
        return reject(new Error('Not connected'))
      }
      this.client.exec(cmd, (err, stream) => {
        if (err) return reject(err)
        let stdout = ''
        let stderr = ''
        stream.on('data', (data) => {
          stdout += data.toString()
        })
        stream.stderr.on('data', (data) => {
          stderr += data.toString()
        })
        stream.on('close', (code) => {
          resolve({ stdout, stderr, code })
        })
      })
    })
  }

  scpPut(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      if (!this.client || this.status !== 'connected') {
        return reject(new Error('Not connected'))
      }
      this.client.sftp((err, sftp) => {
        if (err) return reject(err)
        sftp.fastPut(localPath, remotePath, (err2) => {
          sftp.end()
          if (err2) return reject(err2)
          resolve()
        })
      })
    })
  }

  scpPutBuffer(buffer, remotePath) {
    return new Promise((resolve, reject) => {
      if (!this.client || this.status !== 'connected') {
        return reject(new Error('Not connected'))
      }
      this.client.sftp((err, sftp) => {
        if (err) return reject(err)
        const writeStream = sftp.createWriteStream(remotePath)
        writeStream.on('error', (err2) => {
          sftp.end()
          reject(err2)
        })
        writeStream.on('close', () => {
          sftp.end()
          resolve()
        })
        writeStream.end(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
      })
    })
  }

  createShell(sessionId) {
    return new Promise((resolve, reject) => {
      if (!this.client || this.status !== 'connected') {
        return reject(new Error('Not connected'))
      }
      this.client.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) return reject(err)
        this.shells.set(sessionId, stream)
        stream.on('data', (data) => {
          this.emit('shell-data', { sessionId, data: data.toString() })
        })
        stream.on('close', () => {
          this.shells.delete(sessionId)
        })
        resolve()
      })
    })
  }

  writeToShell(sessionId, data) {
    const shell = this.shells.get(sessionId)
    if (shell) {
      shell.write(data)
    }
  }

  resizeShell(sessionId, cols, rows) {
    const shell = this.shells.get(sessionId)
    if (shell) {
      shell.setWindow(rows, cols, 0, 0)
    }
  }

  destroyShell(sessionId) {
    const shell = this.shells.get(sessionId)
    if (shell) {
      shell.end()
      this.shells.delete(sessionId)
    }
  }
}

export default SSHManager
