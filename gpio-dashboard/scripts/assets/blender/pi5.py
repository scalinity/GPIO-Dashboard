"""The Raspberry Pi 5 from its official STEP (SPEC 6.2, 10.4).

step-to-glb.ts reads the STEP into an intermediate GLB, one object per STEP body with the STEP's
colours; this script takes it from there. The STEP is drawn in pi5-board.json's frame already
(origin at the PCB's bottom-left corner, +x toward the USB and Ethernet ports, +y toward the
header edge); the script checks that, then lifts the model so its lowest point is z = 0, the
table it rests on.

The header's 40 pins are removed (the studio instances them from pi5-header.json), after checking
that they stand on pi5-board.json's pin grid. The PCB and the header base are kept as modelled;
every other body is decimated to the triangle budget. One material per STEP colour, AO baked.

    blender -b --factory-startup --python-exit-code 1 -P pi5.py -- --step-glb <glb>
      --board <pi5-board.json> --triangles <n> --texture <w>x<h> --samples <n> --seed <n>
      --out <glb> --colliders <json>
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import bake, export, materials, scene  # noqa: E402

args = scene.start(
    lambda p: (
        p.add_argument('--step-glb', required=True),
        p.add_argument('--board', required=True),
        p.add_argument('--triangles', type=int, required=True),
        p.add_argument('--texture', required=True),
    )
)
with open(args.board) as f:
    PI = json.load(f)
TEXTURE = [int(n) for n in args.texture.split('x')]

TOLERANCE = 0.05  # mm, as assets:check
AO_DISTANCE = 3.0
SMOOTH_ANGLE = math.radians(30)
# The STEP's colours (sRGB hex) that are metal, with their roughness. Every other colour is
# plastic or ceramic, and the solder mask gets a clear coat.
METALS = {'9a9a9a': 0.35, '7f7f7f': 0.4, '6b7682': 0.35, 'dadada': 0.3, 'ffd43e': 0.25, 'deb87a': 0.3}
SOLDER_MASK = '004311'
PLASTIC_ROUGHNESS = 0.5
# Where the STEP's colour is not the board's look (ADR-L-2): its CAD green is the dark end of the
# mask, where the official photos' board is a bright green, and its yellow metal is the USB-A
# shells, which are nickel. The material keeps the STEP colour's name; only its albedo differs.
LOOK = {'004311': '0f7a3b', 'ffd43e': 'b8b8bc'}

bpy.ops.import_scene.gltf(filepath=args.step_glb)
bodies = [o for o in bpy.context.scene.objects if o.type == 'MESH']


def bounds(obj):
    co = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    return co.min(axis=0), co.max(axis=0)


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def colour(obj):
    return obj.material_slots[0].material.name.removeprefix('step-')


# --- Frame: the PCB spans the outline from the origin; the lowest point goes to z = 0 ------------
pcb = [o for o in bodies if colour(o) == SOLDER_MASK]
if len(pcb) != 1:
    raise RuntimeError(f'expected one solder-mask body, found {len(pcb)}')
pcb = pcb[0]
lo, hi = bounds(pcb)
outline = (PI['outline']['widthMm'], PI['outline']['depthMm'])
if max(abs(lo[0]), abs(lo[1]), abs(hi[0] - outline[0]), abs(hi[1] - outline[1])) > TOLERANCE:
    raise RuntimeError(f'the PCB spans {lo[:2]}..{hi[:2]}, not 0..{outline}: the STEP frame changed')
lift = -min(bounds(o)[0][2] for o in bodies)
for obj in bodies:
    obj.data.transform(Matrix.Translation((0, 0, lift)))
bpy.context.view_layer.update()
box = {obj: bounds(obj) for obj in bodies}

# --- The 40 header pins: on the grid, then removed ------------------------------------------------
pitch = PI['header']['pitchMm']
x1, y1 = PI['header']['pin1Mm']
# Odd pins on the row nearer the board's centre, even pins on the edge row (pi5-board.json).
grid = [(x1 + (p - 1) // 2 * pitch, y1 + (p - 1) % 2 * pitch) for p in range(1, 41)]
pins = {}
for obj in bodies:
    lo, hi = box[obj]
    if max(hi[:2] - lo[:2]) <= 1.0 and hi[2] - lo[2] >= 5.0:
        c = (lo[:2] + hi[:2]) / 2
        p = min(range(40), key=lambda i: math.dist(c, grid[i]))
        if math.dist(c, grid[p]) <= TOLERANCE and p not in pins:
            pins[p] = obj
if len(pins) != 40:
    raise RuntimeError(f'found {len(pins)} of the 40 header pins on the pi5-board.json grid')
pin_box = export.box('header-pins', pins.values())
for obj in pins.values():
    bodies.remove(obj)
    bpy.data.objects.remove(obj)
# The header base: the body other than the PCB around the pins' footprint.
base = [
    o for o in bodies
    if o is not pcb
    and all(box[o][0][i] <= pin_box['min'][i] and box[o][1][i] >= pin_box['max'][i] for i in (0, 1))
]
if len(base) != 1:
    raise RuntimeError(f'expected one header base around the pins, found {len(base)}')
base = base[0]

# Physics proxies: the PCB, the pin field, the header base, and every body 4 mm or more across.
boxes = [export.box('pcb', [pcb]), pin_box, export.box('header-base', [base])]
boxes += [
    export.box(o.name, [o]) for o in bodies
    if o not in (pcb, base) and max(box[o][1][:2] - box[o][0][:2]) >= 4.0
]

# --- Decimate everything but the PCB and the header base to the budget --------------------------


def join(objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def clean(obj):
    """Weld the faces the STEP reader left apart, and shade by angle instead of its normals."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=SMOOTH_ANGLE)


parts = join([o for o in bodies if o not in (pcb, base)])
for obj in (parts, pcb, base):
    clean(obj)
decimate = parts.modifiers.new('decimate', 'DECIMATE')
decimate.ratio = (args.triangles - triangles(pcb) - triangles(base)) / triangles(parts)
decimate.use_collapse_triangulate = True
bpy.context.view_layer.objects.active = parts
bpy.ops.object.modifier_apply(modifier='decimate')

board = join([pcb, base, parts])
board.name = board.data.name = 'board'

# --- Materials: one per STEP colour --------------------------------------------------------------
for slot in board.material_slots:
    old = slot.material
    hexa = old.name.removeprefix('step-')
    old.name = f'imported-{hexa}'  # frees the name for the material that replaces it
    look = LOOK.get(hexa, hexa)
    rgb = materials.srgb(*(int(look[i:i + 2], 16) / 255 for i in (0, 2, 4)))
    if hexa == SOLDER_MASK:
        # Nearly matt with a faint coat: a glossier mask reflects the studio's bright HDRI as a pink veil.
        mat = materials.principled('solder-mask', rgb, Roughness=0.9, Coat_Weight=0.15, Coat_Roughness=0.35)
    elif hexa in METALS:
        mat = materials.principled(f'step-{hexa}', rgb, Metallic=1.0, Roughness=METALS[hexa])
    else:
        mat = materials.principled(f'step-{hexa}', rgb, Roughness=PLASTIC_ROUGHNESS)
    slot.material = mat
    bpy.data.materials.remove(old)

# --- AO ------------------------------------------------------------------------------------------
bpy.context.view_layer.objects.active = board
board.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0)
# One texel density everywhere, then a tight pack: thousands of small islands waste the atlas
# under smart_project's own margins.
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(shape_method='AABB', rotate=True, margin_method='FRACTION', margin=0.0005)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.scene.world.light_settings.distance = AO_DISTANCE
ao_img = bake.bake(board, 'AO', bake.image('pi5-occlusion', *TEXTURE, color=False))
for slot in board.material_slots:
    materials.occlusion(slot.material, ao_img)

# --- Export: pi5 > board, and the header's centre on the PCB's top face --------------------------
root = scene.link(bpy.data.objects.new('pi5', None))
board.parent = root
header = scene.link(bpy.data.objects.new('header', None), root)
header.location = (*PI['header']['centerMm'], boxes[0]['max'][2])
export.glb(args.out, root)
export.colliders(args.colliders, boxes)
print(f'pi5: lifted {lift:.3f} mm; PCB top z = {boxes[0]["max"][2]:.3f}; header pins removed; '
      f'{triangles(board)} triangles')
