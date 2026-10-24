// Shipped models (SPEC 10.4): /models/<defId>.glb for breadboards, /models/pi5.glb, the controller
// assets and /models/parts/*.glb, meshopt-compressed with KTX2 textures. 1 glTF unit is 1 mm and +Y
// is up, so a model sits in the scene as its core frame does: a breadboard's origin is its core
// origin (row-1 end, column-a edge, top surface), and the Pi's is its board outline's corner on the
// table.
import type { Group, Material, Mesh, Texture, WebGPURenderer } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { ColliderFile } from './cables'

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
/** Models that have settled: the scene, or null when it could not be loaded. */
const settled = new Map<string, Group | null>()
const arrivals = new Set<() => void>()

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
        scene.updateMatrixWorld(true)
        return scene
      },
      (error: unknown) => {
        console.warn(`[studio] ${url} did not load: ${String(error)}`)
        return null
      }
    )
    model.then((scene) => {
      settled.set(url, scene)
      arrivals.forEach((notify) => notify())
    })
    cache.set(url, model)
  }
  return model
}

/** The model if it has settled (null when it failed), else undefined while it loads. */
export function modelNow(url: string): Group | null | undefined {
  if (!cache.has(url)) void loadModel(url)
  return settled.get(url)
}

/** Calls `notify` whenever a model, texture or the parts index settles; returns the unsubscribe. */
export function onArrival(notify: () => void): () => void {
  arrivals.add(notify)
  return () => arrivals.delete(notify)
}

const textures = new Map<string, Texture | null>()
const requested = new Set<string>()

/** A KTX2 texture if it has settled (null when it failed), else undefined while it loads. */
export function textureNow(url: string): Texture | null | undefined {
  if (!requested.has(url)) {
    requested.add(url)
    ktx2
      .loadAsync(url)
      .then(
        (texture) => void textures.set(url, texture),
        (error: unknown) => {
          console.warn(`[studio] ${url} did not load: ${String(error)}`)
          textures.set(url, null)
        }
      )
      .finally(() => arrivals.forEach((notify) => notify()))
  }
  return textures.get(url)
}

const colliderFiles = new Map<string, ColliderFile | null>()
const collidersRequested = new Set<string>()

/** A model's colliders file (null when it could not be read), else undefined while it loads. */
export function collidersNow(url: string): ColliderFile | null | undefined {
  if (!collidersRequested.has(url)) {
    collidersRequested.add(url)
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<ColliderFile>) : null))
      .catch(() => null)
      .then((file) => {
        if (!file) console.warn(`[studio] ${url} did not load`)
        colliderFiles.set(url, file)
        arrivals.forEach((notify) => notify())
      })
  }
  return colliderFiles.get(url)
}

/** One entry of public/models/parts/index.json: a file, and the props that select it. */
export interface PartFile {
  file: string
  when?: Record<string, string>
}

let partIndex: Record<string, PartFile[]> | null | undefined
let indexRequested = false

/** The parts index (null when it could not be read), else undefined while it loads. */
export function partIndexNow(): Record<string, PartFile[]> | null | undefined {
  if (!indexRequested) {
    indexRequested = true
    fetch('/models/parts/index.json')
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, PartFile[]>>) : null))
      .catch(() => null)
      .then((index) => {
        if (!index) console.warn('[studio] /models/parts/index.json did not load')
        partIndex = index
        arrivals.forEach((notify) => notify())
      })
  }
  return partIndex
}

/**
 * Frees the GPU side of every loaded model and texture. The loaded objects stay cached, and the
 * renderer uploads them again if a later Studio draws them.
 */
export function disposeModels(): void {
  for (const scene of settled.values()) {
    scene?.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      for (const m of [mesh.material].flat() as Material[]) {
        for (const value of Object.values(m))
          if ((value as Texture)?.isTexture) (value as Texture).dispose()
        m.dispose()
      }
    })
  }
  for (const texture of textures.values()) texture?.dispose()
}
