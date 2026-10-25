// Live Pi state's store (SPEC 11.5): the telemetry as the Studio reads it, only while the Pi is there.
import { beforeEach, describe, expect, it } from 'vitest'
import useConnectionStore from '../store/connectionStore'
import useGpioStore, { type PinTelemetry } from '../store/gpioStore'
import { livePinOf, useLive } from './liveStore'

const frame = (...pins: Partial<PinTelemetry>[]): Record<string, PinTelemetry> =>
  Object.fromEntries(
    pins.map((p) => [
      String(p.bcm),
      {
        bcm: 0,
        state: 'LOW',
        direction: 'IN',
        pull: 'DOWN',
        function: 'GPIO',
        ...p
      } as PinTelemetry
    ])
  )

const update = (pins: Record<string, PinTelemetry>) => useGpioStore.getState().updatePinStates(pins)
const connect = () => useConnectionStore.setState({ status: 'connected', agentStatus: 'running' })

beforeEach(() => {
  useConnectionStore.setState({ status: 'disconnected', agentStatus: 'unknown' })
  useGpioStore.getState().clearPins()
})

describe('a pin as the Pi reports it', () => {
  it('reads level, direction, pull and the alternate function pinctrl names', () => {
    expect(
      livePinOf({ bcm: 17, state: 'HIGH', direction: 'OUT', pull: 'NONE', function: 'GPIO' })
    ).toEqual({
      bcm: 17,
      level: 'high',
      direction: 'out',
      pull: 'none',
      function: null,
      consumer: null
    })
    expect(
      livePinOf({
        bcm: 2,
        state: 'HIGH',
        direction: 'ALT',
        pull: 'UP',
        function: 'SDA1',
        consumer: 'i2c'
      })
    ).toEqual({
      bcm: 2,
      level: 'high',
      direction: 'alt',
      pull: 'up',
      function: 'SDA1',
      consumer: 'i2c'
    })
  })

  it('treats a function pinctrl does not set as none', () => {
    expect(livePinOf({ bcm: 5, state: 'LOW', direction: 'NONE' }).direction).toBe('none')
  })
})

describe('the store', () => {
  it('shows nothing until the Pi is connected and its agent runs', () => {
    update(frame({ bcm: 17, state: 'HIGH' }))
    expect(useLive.getState()).toMatchObject({ online: false, pins: {} })
    useConnectionStore.setState({ status: 'connected' })
    expect(useLive.getState().online).toBe(false)
    connect()
    expect(useLive.getState().online).toBe(true)
  })

  it('follows the telemetry once online, and keeps the pins that did not change', () => {
    connect()
    update(frame({ bcm: 17, state: 'LOW' }, { bcm: 18, state: 'LOW' }))
    const first = useLive.getState().pins
    expect(Object.keys(first)).toEqual(['17', '18'])
    update(frame({ bcm: 17, state: 'HIGH' }, { bcm: 18, state: 'LOW' }))
    const next = useLive.getState().pins
    expect(next[17]!.level).toBe('high')
    expect(next[18]).toBe(first[18])
    expect(next[17]).not.toBe(first[17])
  })

  it('does not publish a frame that changes nothing', () => {
    connect()
    update(frame({ bcm: 17 }))
    let published = 0
    const stop = useLive.subscribe(() => (published += 1))
    update(frame({ bcm: 17 }))
    stop()
    expect(published).toBe(0)
  })

  it('sees a pull or an alternate function change, though the level and direction did not', () => {
    connect()
    update(frame({ bcm: 2, state: 'HIGH', pull: 'DOWN' }))
    update(frame({ bcm: 2, state: 'HIGH', pull: 'UP' }))
    expect(useLive.getState().pins[2]!.pull).toBe('up')
    update(frame({ bcm: 2, state: 'HIGH', pull: 'UP', direction: 'ALT', function: 'SDA1' }))
    expect(useLive.getState().pins[2]).toMatchObject({ direction: 'alt', function: 'SDA1' })
  })

  it('forgets the pins when the connection goes, so a new one starts from fresh telemetry', () => {
    connect()
    update(frame({ bcm: 17, state: 'HIGH' }))
    useConnectionStore.setState({ status: 'disconnected' })
    expect(useLive.getState()).toMatchObject({
      online: false,
      pins: {},
      sim: null,
      divergences: []
    })
    expect(useGpioStore.getState().pins).toEqual({})
    connect()
    expect(useLive.getState().pins).toEqual({})
  })
})
