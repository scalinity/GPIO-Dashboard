// Public surface of the cable solver (SPEC 10.5). The worker drives a CableWorld.
export { CableWorld, DEFAULT_SUBSTEPS, FRAME_DT, GRAVITY } from './world'
export type {
  BodyId,
  BodyInfo,
  BodyKind,
  ColliderId,
  ColliderShape,
  JumperDef,
  LeadDef,
  Pose,
  Quat,
  RibbonDef,
  Vec3,
  WorldOptions
} from './types'
