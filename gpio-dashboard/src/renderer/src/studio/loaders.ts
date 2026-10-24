// Shipped models (SPEC 10.4): /models/<defId>.glb for breadboards and /models/pi5.glb, meshopt-
// compressed with KTX2 textures. 1 glTF unit is 1 mm and +Y is up, so a model sits in the scene as
// its core frame does: a breadboard's origin is its core origin (row-1 end, column-a edge, top
// surface), and the Pi's is its board outline's corner on the table.
import type { Group, WebGPURenderer } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'

const ktx2 = new KTX2Loader().setTranscoderPath('/basis/')
const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2)

/** KTX2 transcodes to a format the device supports, so it must ask the renderer first. */
export function configureModels(renderer: WebGPURenderer): void {
  ktx2.detectSupport(renderer)
  const config = (ktx2 as unknown as { workerConfig: Record<string, boolean> }).workerConfig
  const formats = Object.entries(config).flatMap(([name, ok]) => (ok ? [name] : []))
  console.info(`[studio] KTX2 transcode targets: ${formats.join(', ') || 'none (RGBA32)'}`)
}

const cache = new Map<string, Promise<Group | null>>()

/**
 * A model's scene, loaded once per URL and shared. Null when it can't be loaded (the asset isn't
 * built yet, or is broken): nothing stands in for it.
 */
export function loadModel(url: string): Promise<Group | null> {
  let model = cache.get(url)
  if (!model) {
    model = gltf.loadAsync(url).then(
      ({ scene }) => {
        scene.traverse((o) => {
          o.castShadow = true
          o.receiveShadow = true
        })
        return scene
      },
      (error: unknown) => {
        console.warn(`[studio] ${url} did not load: ${String(error)}`)
        return null
      }
    )
    cache.set(url, model)
  }
  return model
}
