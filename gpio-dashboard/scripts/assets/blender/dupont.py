"""A Dupont lead's end from content/leads/dupont.json (SPEC 6.5, 10.4): the male housing with its
pin, or the female housing. The studio instances them at the ends of the runtime wire.

Modelled in the lead end's own frame (mm, z up). Male: the pin's tip is the origin and points -z,
the housing above it. Female: the open mating face is the origin and faces -z, the housing above
it. The empty `wire` sits on the housing's axis where the wire leaves it, and points +z.

One mesh with AO baked into a small atlas. Housing detail is real geometry: rounded edges, a latch
window on each side and a recessed wire entry; the female's entry funnels into a metal-lined
cavity.

    blender -b --factory-startup --python-exit-code 1 -P dupont.py -- --dupont <dupont.json>
      --end male|female --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import json
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import bake, export, materials, scene  # noqa: E402

args = scene.start(
    lambda p: (
        p.add_argument('--dupont', required=True),
        p.add_argument('--end', choices=('male', 'female'), required=True),
        p.add_argument('--texture', required=True),
    )
)
with open(args.dupont) as f:
    D = json.load(f)
TEXTURE = [int(n) for n in args.texture.split('x')]
MALE = args.end == 'male'

# Shape (mm). dupont.json gives the housing, pin and wire; the rest reads like photo 3's bundles.
W, L = D['housing']['widthMm'], D['housing']['lengthMm']
PIN, EXPOSED = D['malePin']['sideMm'], D['malePin']['exposedMm']
EDGE = 0.1  # rounding of the housing's edges
TIP = (0.26, 0.4)  # the pin's tapered tip: (side at the tip, length)
PIN_IN = 3.0  # how far the pin runs up inside the housing
WINDOW = (1.2, 1.4, 0.5, 3.6)  # latch window on each side: (width, height, depth, centre's height above the mating face)
MOUTH, NECK, FUNNEL = 1.7, 1.0, 0.35  # female entry: square sides at the face and cavity, funnel depth
CAVITY_DEPTH = 6.5
POCKET = (1.5, 0.25)  # male: the recess round the pin: (square side, depth)
COLLAR = (1.8, 0.3)  # wire entry: (square recess side, depth)
WIRE_HOLE = (1.1, 2.0)  # and the hole inside it
AO_DISTANCE = 1.5

HOUSING, METAL = range(2)
bm = bmesh.new()
z0 = EXPOSED if MALE else 0.0  # the housing's mating face
z1 = z0 + L
zc = z0 + WINDOW[3]


def end_face(z):
    """The housing's flat end face at height z."""
    return next(f for f in bm.faces if abs(f.normal.z) > 0.99 and abs(f.calc_center_median().z - z) < 1e-3)


def sink(face, side, depth, slot=HOUSING):
    """Shrink a face to a square of the given side about its centre (0 keeps its outline) and push
    it `depth` into the body; the faces made take `slot`. Returns the inner face."""
    width = max(v.co.x for v in face.verts) - min(v.co.x for v in face.verts)
    normal = face.normal.copy()
    # The face itself becomes the inner one; the walls are new.
    for wall in bmesh.ops.inset_individual(bm, faces=[face], thickness=max((width - side) / 2, 0.0), depth=0)['faces']:
        wall.material_index = slot
    face.material_index = slot
    bmesh.ops.translate(bm, vec=-depth * normal, verts=face.verts)
    return face


# --- Housing: a rounded box, with the windows cut out by edge loops ------------------------------
box = bmesh.ops.create_cube(bm, size=1.0)['verts']
bmesh.ops.scale(bm, vec=(W, W, L), verts=box)
bmesh.ops.translate(bm, vec=(0, 0, (z0 + z1) / 2), verts=box)
bmesh.ops.bevel(bm, geom=list({e for v in box for e in v.link_edges}), offset=EDGE, segments=2, affect='EDGES')
bm.normal_update()

# The ends first, while each is one face.
rear = sink(end_face(z1), COLLAR[0], COLLAR[1])
sink(rear, WIRE_HOLE[0], WIRE_HOLE[1])
front = end_face(z0)
if MALE:
    sink(front, POCKET[0], POCKET[1])
else:
    neck = sink(front, MOUTH, 0.0)
    cavity = sink(neck, NECK, FUNNEL)
    sink(cavity, NECK, CAVITY_DEPTH - FUNNEL, METAL)

for co, no in (
    ((0, 0, zc - WINDOW[1] / 2), (0, 0, 1)), ((0, 0, zc + WINDOW[1] / 2), (0, 0, 1)),
    ((0, -WINDOW[0] / 2, 0), (0, 1, 0)), ((0, WINDOW[0] / 2, 0), (0, 1, 0)),
):
    sides = [f for f in bm.faces if abs(f.normal.x) > 0.99 and f.material_index == HOUSING and abs(f.calc_center_median().x) > W / 2 - 0.01]
    geom = [*{v for f in sides for v in f.verts}, *{e for f in sides for e in f.edges}, *sides]
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)
    bm.normal_update()
for f in [f for f in bm.faces if abs(f.normal.x) > 0.99 and abs(f.calc_center_median().x) > W / 2 - 0.01]:
    c = f.calc_center_median()
    if abs(c.y) < WINDOW[0] / 2 and abs(c.z - zc) < WINDOW[1] / 2:
        sink(f, 0, WINDOW[2])

# --- Pin: a square post with a tapered tip, from the tip up into the housing ---------------------
if MALE:
    rings = [
        [bm.verts.new((sx * s / 2, sy * s / 2, z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        for s, z in ((TIP[0], 0.0), (PIN, TIP[1]), (PIN, z0 + PIN_IN))
    ]
    for a, b in zip(rings, rings[1:]):
        for i in range(4):
            bm.faces.new((a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i])).material_index = METAL
    bm.faces.new(rings[0][::-1]).material_index = METAL
    bm.faces.new(rings[-1]).material_index = METAL

mesh = bpy.data.meshes.new('body')
bm.to_mesh(mesh)
bm.free()
housing_mat = materials.principled('housing', materials.srgb(0.035, 0.035, 0.04), Roughness=0.45)
metal_mat = materials.principled('metal', materials.srgb(0.82, 0.82, 0.8), Metallic=1.0, Roughness=0.3)
mesh.materials.append(housing_mat)
mesh.materials.append(metal_mat)
root = scene.link(bpy.data.objects.new(f'dupont-{args.end}', None))
body = scene.link(bpy.data.objects.new('body', mesh), root)
wire = scene.link(bpy.data.objects.new('wire', None), root)
wire.location = (0, 0, z1)

# --- AO, in a small atlas ------------------------------------------------------------------------
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0)
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(shape_method='AABB', rotate=True, margin_method='FRACTION', margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.scene.world.light_settings.distance = AO_DISTANCE
ao_img = bake.bake(body, 'AO', bake.image(f'dupont-{args.end}-occlusion', *TEXTURE, color=False))
for mat in (housing_mat, metal_mat):
    materials.occlusion(mat, ao_img)

export.glb(args.out, root)
boxes = [{'name': 'housing', 'min': [-W / 2, -W / 2, z0], 'max': [W / 2, W / 2, z1]}]
capsules = [{'name': 'pin', 'a': [0, 0, PIN / 2], 'b': [0, 0, z0], 'radius': PIN / 2}] if MALE else []
export.colliders(args.colliders, boxes, capsules)
print(f'dupont-{args.end}: {len(mesh.polygons)} faces')
