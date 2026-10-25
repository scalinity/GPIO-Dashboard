// Behavioural models by sim model id.
import type { PartDef } from '../../model/types'
import type { BehaviorFactory } from '../behavior'
import { createActiveBuzzer } from './active-buzzer'
import { createAdc0834 } from './adc0834'
import { createAds1115 } from './ads1115'
import { createAds7830 } from './ads7830'
import { createDcMotor } from './dc-motor'
import { createDht11 } from './dht11'
import { createHcSr04 } from './hc-sr04'
import { createHcSr501 } from './hc-sr501'
import { createJoystick } from './joystick'
import { createKeypad4x4 } from './keypad-4x4'
import { createL293d } from './l293d'
import { createLcd1602I2c } from './lcd1602-i2c'
import { createRelayModule } from './relay-module'
import { createSg90 } from './sg90'
import { createShiftRegister595 } from './shift-register-595'

export const BEHAVIORS: Partial<Record<PartDef['sim']['model'], BehaviorFactory>> = {
  'active-buzzer': createActiveBuzzer,
  adc0834: createAdc0834,
  ads1115: createAds1115,
  ads7830: createAds7830,
  'dc-motor': createDcMotor,
  dht11: createDht11,
  'hc-sr04': createHcSr04,
  'hc-sr501': createHcSr501,
  joystick: createJoystick,
  'keypad-4x4': createKeypad4x4,
  l293d: createL293d,
  'lcd1602-i2c': createLcd1602I2c,
  'relay-module': createRelayModule,
  sg90: createSg90,
  'shift-register-595': createShiftRegister595
}
