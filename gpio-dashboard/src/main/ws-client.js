import WebSocket from 'ws'
import { EventEmitter } from 'events'

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

  connect(host) {
    this.host = host
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

    const url = `ws://${this.host}:8765`
    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      this.reconnectAttempts = 0
      this.emit('connected')
    })

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        const type = msg.type
        if (type === 'gpio_state') {
          const pins = msg.pins || msg.data
          const serialized = JSON.stringify(pins)
          if (serialized !== this.prevGpioState) {
            this.prevGpioState = serialized
            this.emit('gpio_state', pins)
          }
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

    this.ws.on('error', () => {
      // error is followed by close, reconnect handled there
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

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }
}

export default WSClient
