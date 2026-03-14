import WebSocket from 'ws'
import { EventEmitter } from 'events'

const MAX_RECONNECT_DELAY_MS = 30000

class WSClient extends EventEmitter {
  constructor() {
    super()
    this.ws = null
    this.host = null
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.shouldReconnect = false
    this.prevGpioState = null
  }

  connect(host, port = 8765, authToken = null) {
    this.host = host
    this.port = port
    this.authToken = authToken
    this.shouldReconnect = true
    this.reconnectAttempts = 0
    this._clearReconnect()
    this._doConnect()
  }

  _doConnect() {
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.terminate()
    }

    const url = `ws://${this.host}:${this.port}`
    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      this.reconnectAttempts = 0
      if (this.authToken) {
        this.ws.send(JSON.stringify({ type: 'auth', token: this.authToken }))
      }
      this.emit('connected')
    })

    this.ws.on('message', (raw) => {
      try {
        const rawStr = raw.toString()
        // Fast path: skip full parse for gpio_state if unchanged
        if (rawStr.startsWith('{"type":"gpio_state"')) {
          if (rawStr === this.prevGpioState) return
          this.prevGpioState = rawStr
        }
        const msg = JSON.parse(rawStr)
        const type = msg.type
        if (type === 'gpio_state') {
          this.emit('gpio_state', msg.pins || msg.data)
        } else if (type === 'system_info') {
          this.emit('system_info', msg.data)
        } else if (type === 'output') {
          this.emit('output', msg.data)
        } else if (type === 'agent_status') {
          this.emit('agent_status', msg.data)
        }
      } catch {
        // ignore malformed messages
      }
    })

    this.ws.on('close', () => {
      this.emit('disconnected')
      if (this.shouldReconnect) {
        this._scheduleReconnect()
      }
    })

    this.ws.on('error', (error) => {
      console.error('[WSClient] WebSocket error:', error)
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
    if (this.reconnectAttempts >= 10) {
      this.shouldReconnect = false
      this.emit('reconnect_failed')
      return
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), MAX_RECONNECT_DELAY_MS)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect && this.host) {
        this._doConnect()
      }
    }, delay)
  }

  disconnect() {
    this.shouldReconnect = false
    this._clearReconnect()
    this.prevGpioState = null
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.terminate()
      this.ws = null
    }
    this.emit('disconnected')
  }

}

export default WSClient
