// SPEC 10.3 stage 4: dedupe, weld and prune; KTX2 textures resized to budget; meshopt compression.
import { dirname } from 'node:path'
import { type Document, Logger } from '@gltf-transform/core'
import { Mode, toktx } from '@gltf-transform/cli'
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

/** gltf-transform's KTX2 encoding runs `ktx`, which KTX-Software installs beside toktx; KTX_BIN
 * names toktx when it is not on PATH (ADR-0005). */
export function ktxOnPath() {
  if (process.env.KTX_BIN) process.env.PATH = `${dirname(process.env.KTX_BIN)}:${process.env.PATH}`
}

export async function optimize(doc: Document, texturePx: [number, number]) {
  doc.setLogger(new Logger(Logger.Verbosity.WARN))
  await doc.transform(
    dedup(),
    weld(),
    // Keep empty leaf nodes: they are markers the studio places things on (pi5's "header").
    prune({ keepLeaves: true }),
    // ETC1S for colour; UASTC for normal and ORM data, which ETC1S's shared endpoints would smear.
    toktx({ encoder: sharp, mode: Mode.ETC1S, slots: /^baseColor/, resize: texturePx }),
    toktx({
      encoder: sharp,
      mode: Mode.UASTC,
      slots: /^(normal|occlusion|metallicRoughness)/,
      resize: texturePx
    }),
    // Quantizes positions to 14 bits per mesh (about 0.01 mm on a 165 mm board).
    meshopt({ encoder: MeshoptEncoder })
  )
}
