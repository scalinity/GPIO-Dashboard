// Run with `npm test`. Exercises the bridge with fake invoke/listen functions.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApi } from './api.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

// A fake `listen` that registers asynchronously, like Tauri's.
function fakeListen() {
  const listeners = []
  const listen = (event, handler) =>
    new Promise((resolve) => {
      const entry = {
        event,
        handler,
        unlistened: 0,
        register: () => resolve(() => entry.unlistened++)
      }
      listeners.push(entry)
    })
  return { listen, listeners }
}

test('events that arrive before the unlisten completes are dropped', async () => {
  const { listen, listeners } = fakeListen()
  const api = createApi({ invoke: async () => {}, listen })
  const received = []
  const off = api.ssh.onStatusChange((payload) => received.push(payload))

  off() // unsubscribed before Tauri finished registering the listener
  listeners[0].handler({ payload: 'late' })
  assert.deepEqual(received, [])

  listeners[0].register()
  await tick()
  assert.equal(listeners[0].unlistened, 1)
})

test('a subscription delivers payloads until it is removed, and unlistens once', async () => {
  const { listen, listeners } = fakeListen()
  const api = createApi({ invoke: async () => {}, listen })
  const received = []
  const off = api.terminal.onData('global', (payload) => received.push(payload))
  assert.equal(listeners[0].event, 'terminal:data:global')

  listeners[0].register()
  await tick()
  listeners[0].handler({ payload: 'one' })
  off()
  off()
  listeners[0].handler({ payload: 'two' })
  assert.deepEqual(received, ['one'])
  assert.equal(listeners[0].unlistened, 1)
})

test('terminal writes are sent one at a time, in order', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const sent = []
  const invoke = async (command, args) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5))
    sent.push(args.data)
    inFlight--
  }
  const api = createApi({ invoke, listen: async () => () => {} })
  for (const ch of 'echo hi') api.terminal.write('global', ch)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(sent.join(''), 'echo hi')
  assert.equal(maxInFlight, 1)
})

test('a failed write does not stop later writes', async () => {
  const sent = []
  const invoke = async (command, args) => {
    if (args.data === 'b') throw new Error('boom')
    sent.push(args.data)
  }
  const api = createApi({ invoke, listen: async () => () => {} })
  for (const ch of 'abc') api.terminal.write('global', ch)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(sent, ['a', 'c'])
})

test('rejections from commands that report errors become { success: false, error }', async () => {
  const invoke = async () => {
    throw 'invalid args'
  }
  const api = createApi({ invoke, listen: async () => () => {} })
  assert.deepEqual(await api.ssh.connect({}), { success: false, error: 'invalid args' })
  assert.deepEqual(await api.ssh.scpBuffer('x', '/tmp/gpio_dashboard/x'), {
    success: false,
    error: 'invalid args'
  })
  assert.deepEqual(await api.settings.set('k', 1), { success: false, error: 'invalid args' })
  assert.deepEqual(await api.agent.getStatus(), { running: false, error: 'invalid args' })
  // Reads are not rewritten: a rejection still rejects.
  await assert.rejects(api.settings.get('k'))
})

test('calls map to the command names and argument keys the backend expects', async () => {
  const calls = []
  const invoke = async (command, args) => {
    calls.push([command, args])
    return {}
  }
  const api = createApi({ invoke, listen: async () => () => {} })
  await api.ssh.scpBuffer('code', '/tmp/gpio_dashboard/a.py')
  await api.gpio.connect('pi.local', 'tok')
  await api.terminal.resize('global', 80, 24)
  await api.settings.set('connection.host', 'pi.local')
  await api.ssh.i2cScan(1)
  await api.anthropic.setKey('sk')
  await api.anthropic.hasKey()
  await api.anthropic.clearKey()
  await api.projects.list()
  await api.projects.read('p1')
  await api.projects.write('p1', { schemaVersion: 1 })
  await api.projects.delete('p1')
  await api.projects.export({ schemaVersion: 1 })
  await api.projects.import()
  assert.deepEqual(calls, [
    ['ssh_scp_buffer', { content: 'code', remotePath: '/tmp/gpio_dashboard/a.py' }],
    ['gpio_connect', { host: 'pi.local', authToken: 'tok' }],
    ['terminal_resize', { sessionId: 'global', cols: 80, rows: 24 }],
    ['settings_set', { key: 'connection.host', value: 'pi.local' }],
    ['ssh_i2c_scan', { bus: 1 }],
    ['settings_set_anthropic_key', { value: 'sk' }],
    ['settings_has_anthropic_key', undefined],
    ['settings_clear_anthropic_key', undefined],
    ['projects_list', undefined],
    ['projects_read', { id: 'p1' }],
    ['projects_write', { id: 'p1', doc: { schemaVersion: 1 } }],
    ['projects_delete', { id: 'p1' }],
    ['projects_export', { doc: { schemaVersion: 1 } }],
    ['projects_import', undefined]
  ])
})
