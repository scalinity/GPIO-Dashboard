// Behavioural models by sim model id.
import type { PartDef } from '../../model/types'
import type { BehaviorFactory } from '../behavior'
import { createActiveBuzzer } from './active-buzzer'
import { createAdc0834 } from './adc0834'
import { createDcMotor } from './dc-motor'
import { createHcSr501 } from './hc-sr501'
import { createJoystick } from './joystick'
import { createKeypad4x4 } from './keypad-4x4'
import { createL293d } from './l293d'
import { createRelayModule } from './relay-module'
import { createShiftRegister595 } from './shift-register-595'

export const BEHAVIORS: Partial<Record<PartDef['sim']['model'], BehaviorFactory>> = {
  'active-buzzer': createActiveBuzzer,
  adc0834: createAdc0834,
  'dc-motor': createDcMotor,
  'hc-sr501': createHcSr501,
  joystick: createJoystick,
  'keypad-4x4': createKeypad4x4,
  l293d: createL293d,
  'relay-module': createRelayModule,
  'shift-register-595': createShiftRegister595
}
