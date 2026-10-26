// The Lab look's set (SPEC 10.2, 10.7; ADR-0144): "a Pi breadboard bench in an electronics
// workroom at dusk". Four walls of plaster over a dark wainscot, a tiled floor with a rug under
// the bench, a ceiling, and something on every side so each orbit angle has a piece to read:
//  - north, behind the first views: the dusk window between amber light bars, a credenza under
//    it, a plant in the corner;
//  - west: a pegboard of pliers, cutters and wire spools over a wall bench with a desk lamp, an
//    oscilloscope and a power supply on it;
//  - east: a parts-drawer cabinet, a shelf lit from below by an amber strip, a soldering station;
//  - south: the door, a stool, and a faint framed GPIO pinout (the background echo);
//  - ceiling: two dim pendants over the bench; under the bench, its legs, apron and lower shelf.
// Each side is a few merged meshes on the three room materials, so it can be cut away whole, and
// nothing in the room casts or takes a shadow: the key's shadow map covers the bench.
import { BoxGeometry, Color, Group, Mesh, PlaneGeometry, type Vector3 } from 'three/webgpu'
import { Batch } from './bake'
import { cutSides, ROOM, type Side, SIDES } from './bounds'
import { roomMaterials } from './materials'
import {
  benchFrame,
  Builder,
  credenza,
  deskLamp,
  door,
  drawerCabinet,
  duskWindow,
  FINISH,
  lightBar,
  pegboard,
  pendant,
  pinoutPoster,
  plant,
  powerSupply,
  scope,
  seeded,
  shelf,
  solderingStation,
  stool,
  wallBench
} from './pieces'

export interface Room {
  group: Group
  sides: Record<Side, Group>
  /** What stands on each side and on the floor, by name (tests). */
  furnished: Record<Side | 'floor', string[]>
  /** The brightest emitter and glow card drawn, linear. */
  peaks: { emit: number; glow: number }
  /** Hides each side the camera at `position` stands behind or near; returns them. */
  cutaway(position: Vector3): Set<Side>
}

const HEIGHT = ROOM.ceiling - ROOM.floor
const MID_Z = (ROOM.north + ROOM.south) / 2

/** A wall `length` long: plaster over a wainscot, with a chair rail and a baseboard. */
function wall(b: Builder, length: number): void {
  const surface = 'wall'
  b.solid(
    new BoxGeometry(length, HEIGHT, 60, 12, 6, 1),
    FINISH.plaster,
    [0, HEIGHT / 2, -30],
    undefined,
    surface
  )
  b.solid(
    new BoxGeometry(length, 900, 24, 12, 2, 1),
    FINISH.wainscot,
    [0, 450, 12],
    undefined,
    surface
  )
  b.solid(new BoxGeometry(length, 40, 36, 12, 1, 1), FINISH.trim, [0, 905, 18], undefined, surface)
  b.solid(new BoxGeometry(length, 110, 32, 12, 1, 1), FINISH.trim, [0, 55, 16], undefined, surface)
}

export function buildRoom(): Room {
  const rng = seeded(7)
  const materials = roomMaterials()
  const group = new Group()
  group.name = 'lab-room'
  const sides = {} as Record<Side, Group>
  const furnished = {} as Record<Side | 'floor', string[]>
  const peaks = { emit: 0, glow: 0 }

  /** Builds one side's pieces into its batches and turns them into meshes in `into`. */
  const side = (name: Side | 'floor', build: (b: Builder) => string[]): Group => {
    const batches = { lit: new Batch('lit'), emit: new Batch('emit'), glow: new Batch('glow') }
    furnished[name] = build(new Builder(batches))
    const into = new Group()
    into.name = `lab-room-${name}`
    for (const kind of ['lit', 'emit', 'glow'] as const) {
      const batch = batches[kind]
      if (batch.empty) continue
      if (kind !== 'lit') peaks[kind] = Math.max(peaks[kind], batch.peak)
      const mesh = new Mesh(batch.merge(), materials[kind])
      mesh.name = `${into.name}-${kind}`
      mesh.castShadow = mesh.receiveShadow = false
      // Light cards draw after the room's surfaces.
      if (kind === 'glow') mesh.renderOrder = 1
      into.add(mesh)
    }
    group.add(into)
    return into
  }

  const width = ROOM.east - ROOM.west
  const depth = ROOM.south - ROOM.north
  const floor = ROOM.floor

  // The floor and what stands in the middle of it: the bench's frame on a rug.
  side('floor', (b) => {
    b.at(0, floor, 0)
    b.solid(
      new PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
      FINISH.grout,
      [0, -4, MID_Z],
      undefined,
      'floor'
    )
    const tile = 600
    for (let x = ROOM.west; x < ROOM.east; x += tile)
      for (let z = ROOM.north; z < ROOM.south; z += tile) {
        const [w, d] = [Math.min(tile, ROOM.east - x) - 8, Math.min(tile, ROOM.south - z) - 8]
        const shade = new Color(FINISH.tile.color).multiplyScalar(0.85 + rng() * 0.2)
        const tint = { ...FINISH.tile, color: `#${shade.getHexString()}` }
        b.solid(
          new BoxGeometry(w, 8, d),
          tint,
          [x + w / 2 + 4, -4, z + d / 2 + 4],
          undefined,
          'floor'
        )
      }
    b.solid(new BoxGeometry(2700, 6, 2050), FINISH.rugBorder, [20, 3, 30], undefined, 'floor')
    b.solid(new BoxGeometry(2500, 7, 1850), FINISH.rug, [20, 4, 30], undefined, 'floor')
    b.at(0, 0, 0)
    benchFrame(b, floor)
    b.glow(700, 520, '#ffb878', 0.06, [20, 0.6, 20], [-Math.PI / 2, 0, 0])
    return [
      'tiles',
      'rug',
      'bench legs, apron, lower shelf and front strip',
      'warm pool on the mat'
    ]
  })

  sides.north = side('north', (b) => {
    b.at(0, floor, ROOM.north)
    wall(b, width + 120)
    const windowX = 300
    b.at(windowX, -300, ROOM.north)
    duskWindow(b, 1300, 1350, -300)
    for (const x of [windowX - 950, windowX + 950]) {
      b.at(x, floor + 350, ROOM.north)
      lightBar(b, 1500)
    }
    b.at(windowX, floor, ROOM.north + 240)
    credenza(b, rng, 1800)
    b.at(ROOM.west + 380, floor, ROOM.north + 330)
    plant(b, rng, 1500)
    return ['dusk window', 'amber light bars', 'credenza', 'plant']
  })

  sides.west = side('west', (b) => {
    b.at(ROOM.west, floor, MID_Z, Math.PI / 2)
    wall(b, depth + 120)
    b.at(ROOM.west + 300, floor, 100, Math.PI / 2)
    wallBench(b, 2000, 600)
    b.at(ROOM.west, 100, 100, Math.PI / 2)
    pegboard(b, rng, 1800, 800)
    b.at(ROOM.west + 230, 0, 820, Math.PI / 2)
    deskLamp(b)
    b.at(ROOM.west + 300, 0, 0, Math.PI / 2)
    scope(b)
    b.at(ROOM.west + 290, 0, -480, Math.PI / 2)
    powerSupply(b)
    return [
      'wall bench',
      'pegboard of pliers, cutters and spools',
      'desk lamp',
      'oscilloscope',
      'power supply'
    ]
  })

  sides.east = side('east', (b) => {
    b.at(ROOM.east, floor, MID_Z, -Math.PI / 2)
    wall(b, depth + 120)
    b.at(ROOM.east - 165, floor, -900, -Math.PI / 2)
    drawerCabinet(b, 5, 14)
    b.at(ROOM.east, floor, 650, -Math.PI / 2)
    shelf(b, rng, 1700, [1250, 1650])
    b.at(ROOM.east - 260, floor, 650, -Math.PI / 2)
    solderingStation(b)
    return ['parts-drawer cabinet', 'shelf with an amber strip', 'soldering station']
  })

  sides.south = side('south', (b) => {
    b.at(0, floor, ROOM.south, Math.PI)
    wall(b, width + 120)
    b.at(-1300, floor, ROOM.south, Math.PI)
    door(b)
    b.at(900, floor + 1500, ROOM.south, Math.PI)
    pinoutPoster(b)
    b.at(300, floor, ROOM.south - 520, 0.4)
    stool(b)
    return ['door with light under it', 'GPIO pinout poster', 'stool']
  })

  sides.ceiling = side('ceiling', (b) => {
    b.at(0, ROOM.ceiling, MID_Z)
    b.solid(
      new PlaneGeometry(width, depth, 8, 8).rotateX(Math.PI / 2),
      FINISH.ceiling,
      [0, 0, 0],
      undefined,
      'ceiling'
    )
    for (const x of [-300, 340]) {
      b.at(x, ROOM.ceiling, 30)
      pendant(b, 650)
    }
    return ['two pendants']
  })

  return {
    group,
    sides,
    furnished,
    peaks,
    cutaway(position) {
      const cut = cutSides(position)
      for (const s of SIDES) sides[s].visible = !cut.has(s)
      return cut
    }
  }
}
