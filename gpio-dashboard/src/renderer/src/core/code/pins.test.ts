import { describe, expect, it } from 'vitest'
import { codePins } from './pins'

const uses = (src: string) => codePins(src).uses.map(({ bcm, mode, pull }) => ({ bcm, mode, pull }))

describe('codePins', () => {
  it('reads RPi.GPIO setup with constants, pulls and PWM', () => {
    const src = `import RPi.GPIO as GPIO
LedPin = 17
BtnPin = 18
GPIO.setmode(GPIO.BCM)
GPIO.setup(LedPin, GPIO.OUT)
GPIO.setup(BtnPin, GPIO.IN, pull_up_down=GPIO.PUD_UP)
p = GPIO.PWM(LedPin, 1000)`
    expect(uses(src)).toEqual([
      { bcm: 17, mode: 'out', pull: undefined },
      { bcm: 18, mode: 'in', pull: 'up' },
      { bcm: 17, mode: 'pwm', pull: undefined }
    ])
  })

  it('expands lists and for-loops over them', () => {
    const src = `pins = [17, 18, 27]
for pin in pins:
    GPIO.setup(pin, GPIO.OUT)
GPIO.setup([5, 6], GPIO.OUT)`
    expect(uses(src).map((u) => u.bcm)).toEqual([17, 18, 27, 5, 6])
  })

  it('maps BOARD numbering to BCM through the official header table', () => {
    expect(uses('GPIO.setmode(GPIO.BOARD)\nGPIO.setup(11, GPIO.OUT)')).toEqual([
      { bcm: 17, mode: 'out', pull: undefined }
    ])
  })

  it('reads gpiozero devices, their pulls and the distance sensor pins', () => {
    const src = `from gpiozero import LED, Button, PWMLED, DistanceSensor
led = LED(17)
b = Button(18, pull_up=False)
pw = PWMLED("GPIO12")
s = DistanceSensor(echo=24, trigger=23)`
    expect(uses(src)).toEqual([
      { bcm: 17, mode: 'out', pull: undefined },
      { bcm: 18, mode: 'in', pull: 'down' },
      { bcm: 12, mode: 'pwm', pull: undefined },
      { bcm: 24, mode: 'in', pull: 'none' },
      { bcm: 23, mode: 'out', pull: undefined }
    ])
  })

  it('reports what it cannot resolve instead of guessing', () => {
    const r = codePins('GPIO.setup(get_pin(), GPIO.OUT)')
    expect(r.uses).toEqual([])
    expect(r.unresolved).toEqual([{ expression: 'get_pin()', line: 1 }])
  })

  it('ignores commented-out setup', () => {
    expect(uses('# GPIO.setup(17, GPIO.OUT)')).toEqual([])
  })

  it('reads smbus bus 1 as GPIO2 and GPIO3 in I2C use, and flags any other bus', () => {
    const r = codePins(`import smbus\nbus = smbus.SMBus(1)\nother = SMBus(0)\n`)
    expect(r.uses).toEqual([
      { bcm: 2, mode: 'i2c', line: 2 },
      { bcm: 3, mode: 'i2c', line: 2 }
    ])
    expect(r.unresolved).toEqual([{ expression: 'SMBus(0)', line: 3 }])
    const named = codePins(`from smbus2 import SMBus\nBUS = 1\nwith SMBus(BUS) as b:\n    pass\n`)
    expect(named.uses.map((u) => u.bcm)).toEqual([2, 3])
  })
})
