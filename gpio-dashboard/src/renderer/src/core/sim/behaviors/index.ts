// Behavioural models by sim model id.
import type { PartDef } from '../../model/types'
import type { BehaviorFactory } from '../behavior'
import { createActiveBuzzer } from './active-buzzer'
import { createDcMotor } from './dc-motor'

export const BEHAVIORS: Partial<Record<PartDef['sim']['model'], BehaviorFactory>> = {
  'active-buzzer': createActiveBuzzer,
  'dc-motor': createDcMotor
}
