// The studio stage (SPEC 10.2): StageRig's table, cyclorama and lights, lit by a CC0 studio HDRI
// (Poly Haven studio_small_09, scripts/assets/sources.json). The stage shows once the HDRI loads.
import { use } from 'react'
import { type DataTexture, EquirectangularReflectionMapping } from 'three/webgpu'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import type { StageRig } from './rig'

let environment: Promise<DataTexture> | undefined

function loadEnvironment(): Promise<DataTexture> {
  environment ??= new HDRLoader().loadAsync('/env/studio_small_09_1k.hdr').then((texture) => {
    texture.mapping = EquirectangularReflectionMapping
    return texture
  })
  return environment
}

export default function Stage({ rig }: { rig: StageRig }) {
  // The rig keeps the first texture it is given; a render that repeats this changes nothing.
  rig.setHdri(use(loadEnvironment()))
  return <primitive object={rig.group} />
}
