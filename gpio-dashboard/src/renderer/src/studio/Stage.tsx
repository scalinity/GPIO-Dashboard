// The studio stage (SPEC 10.2): a matte table on a soft cyclorama sweep, lit by a CC0 studio HDRI
// (Poly Haven studio_small_09, scripts/assets/sources.json) and one shadow-casting key light.
import { use, useState } from 'react'
import {
  BoxGeometry,
  type BufferGeometry,
  type DataTexture,
  EquirectangularReflectionMapping,
  MeshStandardNodeMaterial,
  PlaneGeometry
} from 'three/webgpu'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

let environment: Promise<DataTexture> | undefined

function loadEnvironment(): Promise<DataTexture> {
  environment ??= new HDRLoader().loadAsync('/env/studio_small_09_1k.hdr').then((texture) => {
    texture.mapping = EquirectangularReflectionMapping
    return texture
  })
  return environment
}

// The table is centred on the default bench (core/model/defaults: the board at the origin, the Pi
// 120 mm to its left); its top is the table plane, y = 0.
const TABLE = { width: 1000, depth: 700, thickness: 20, centre: [20, -30] as const }

// The sweep: a floor from the front, a curve, and a wall behind, in mm.
const SWEEP = { width: 5000, front: 1500, back: 700, radius: 600, height: 2500 }

function sweepGeometry(): BufferGeometry {
  const { width, front, back, radius, height } = SWEEP
  const floor = front + back
  const curve = (Math.PI / 2) * radius
  const length = floor + curve + (height - radius)
  const geometry = new PlaneGeometry(width, length, 1, 128)
  const position = geometry.attributes.position!
  const y0 = -TABLE.thickness
  for (let i = 0; i < position.count; i++) {
    const s = position.getY(i) + length / 2
    let y: number
    let z: number
    if (s <= floor) [z, y] = [front - s, y0]
    else if (s <= floor + curve) {
      const a = (s - floor) / radius
      ;[z, y] = [-back - radius * Math.sin(a), y0 + radius * (1 - Math.cos(a))]
    } else [z, y] = [-back - radius, y0 + radius + (s - floor - curve)]
    position.setXYZ(i, position.getX(i), y, z)
  }
  geometry.computeVertexNormals()
  return geometry
}

function Environment() {
  return <primitive object={use(loadEnvironment())} attach="environment" />
}

export default function Stage() {
  const [table] = useState(() => ({
    geometry: new BoxGeometry(TABLE.width, TABLE.thickness, TABLE.depth),
    material: new MeshStandardNodeMaterial({ color: '#505153', roughness: 0.9 })
  }))
  const [sweep] = useState(() => ({
    geometry: sweepGeometry(),
    material: new MeshStandardNodeMaterial({ color: '#6a6b6d', roughness: 1 })
  }))
  return (
    <>
      <color attach="background" args={['#24272c']} />
      <Environment />
      <mesh
        geometry={table.geometry}
        material={table.material}
        position={[TABLE.centre[0], -TABLE.thickness / 2, -TABLE.centre[1]]}
        receiveShadow
      />
      <mesh geometry={sweep.geometry} material={sweep.material} receiveShadow />
      {/* The key stands 64 degrees up, a little in front: the T-board's shroud then leaves its title
          out of its shadow. The neutral greys, the softer key and renderer.ts's grade are ADR-0067. */}
      <directionalLight
        position={[-120, 640, 220]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={4}
        shadow-bias={-0.0004}
        shadow-normalBias={0.3}
        shadow-camera-left={-450}
        shadow-camera-right={450}
        shadow-camera-top={450}
        shadow-camera-bottom={-450}
        shadow-camera-near={100}
        shadow-camera-far={1600}
      />
    </>
  )
}
