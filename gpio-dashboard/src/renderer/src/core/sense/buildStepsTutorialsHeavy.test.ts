// The two tutorials whose signatures take over a minute each (tutorialSteps.ts), on a full 26-pin
// probe. They are skipped unless FULL_PROBE=1:
//   FULL_PROBE=1 npx vitest run src/renderer/src/core/sense/buildStepsTutorialsHeavy.test.ts
import { describe } from 'vitest'
import { checkTutorials, HEAVY } from './tutorialSteps'

checkTutorials(HEAVY, describe.skipIf(!process.env.FULL_PROBE))
