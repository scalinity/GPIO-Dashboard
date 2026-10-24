// The document's boards and the Pi, each from its shipped model, placed with the same Transform2D
// the hole positions use (SPEC 10.4, 4.5). A model that isn't built yet draws nothing.
import { Suspense, use, useState } from 'react'
import { boardDef } from '../core/defs/boards'
import type { CircuitDoc, Transform2D } from '../core/model/types'
import { tablePose } from './coords'
import { loadModel } from './loaders'

function Model({ url, transform, z }: { url: string; transform: Transform2D; z: number }) {
  const scene = use(loadModel(url))
  // Each placement gets its own node tree; geometry, materials and textures stay shared.
  const [copy] = useState(() => scene?.clone())
  return copy ? <primitive object={copy} {...tablePose(transform, z)} /> : null
}

export default function Models({ doc }: { doc: CircuitDoc }) {
  return (
    <Suspense fallback={null}>
      {doc.boards.map((board) => (
        // A board's model origin is its top surface, which stands its body height off the table.
        <Model
          key={`${board.id}:${board.defId}`}
          url={`/models/${board.defId}.glb`}
          transform={board.transform}
          z={boardDef(board.defId).body.heightMm}
        />
      ))}
      <Model url="/models/pi5.glb" transform={doc.controller.pi.transform} z={0} />
    </Suspense>
  )
}
