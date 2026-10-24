"""The 130-size DC motor from Adafruit's own STEP (product 711, MIT licence), SPEC 7, 10.4.

step-to-glb.ts has read the STEP into an intermediate GLB: two bodies, the can with its shaft
(z 0 to 30 in the STEP's frame) and the end cap with its two solder lugs (z -8 to 0). This script
turns the motor onto the table, splits what the studio animates or lights from the rest, and adds
what the STEP leaves out: the two leads, red and black, each ending in a one-pin Dupont-style
housing with its male pin sticking out (the part definition's pins, 2.54 mm apart).

Frame (off-board module): the shaft's axis is along x, shaft toward +x, the can's flat side on the
table, and the model's lowest corner (the leads' ends, the can's underside) is the origin. "rotor"
is a pivot on the shaft's axis that the studio turns about its own x axis; it carries the shaft.

    blender -b --factory-startup --python-exit-code 1 -P motor.py -- --part <part.json>
      --name dc-motor --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
      --step-glb <glb> [--preview <dir>]
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402

args, part = kit.start(lambda p: p.add_argument('--step-glb', required=True))
G = part['geometry']['params']

LEAD_LENGTH = 100.0  # the STEP has no leads; the kit's run about this long (modelling choice)
LEAD_R = 0.6
HOUSING = (2.54, 8.0, 2.54)  # a one-pin Dupont-style housing: across, long, tall
PIN_OUT = 6.0  # how far the male pin sticks out of the housing
SHAFT_FROM = 21.8  # the shaft's base, just inside the bearing boss (the STEP's z, which becomes x)
AXIS_Z = 7.5  # the can is 15 mm thick; its axis is at half that above the table

# STEP frame -> model frame: the STEP's axis (z) becomes x, its y flips to -y, and its x (the can's
# thin direction) becomes z, with the can's underside on the table.
TURN = Matrix(((0, 0, 1, 0), (0, -1, 0, 0), (1, 0, 0, AXIS_Z), (0, 0, 0, 1)))

bodies = kit.import_step(args.step_glb)
for obj in bodies:
    obj.data.transform(TURN)
can = next(o for o in bodies if o.data.materials[0].name == 'step-5a5a5a')
cap = next(o for o in bodies if o.data.materials[0].name == 'step-737373')


def split(obj, pick, name):
    """Move the faces pick(face) selects out of obj into a new mesh object of the same materials."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    chosen = [f for f in bm.faces if pick(f)]
    out = bmesh.new()
    seen = {}
    for f in chosen:
        verts = [seen.setdefault(v.index, out.verts.new(v.co)) for v in f.verts]
        out.faces.new(verts).material_index = f.material_index
    bmesh.ops.delete(bm, geom=chosen, context='FACES')
    bm.to_mesh(obj.data)
    bm.free()
    mesh = bpy.data.meshes.new(name)
    out.to_mesh(mesh)
    out.free()
    for m in obj.data.materials:
        mesh.materials.append(m)
    return bpy.data.objects.new(name, mesh)


# The shaft: the faces beyond the boss that lie within its 1 mm radius of the axis.
shaft = split(
    can,
    lambda f: all(v.co.x >= SHAFT_FROM - 0.01 and math.hypot(v.co.y, v.co.z - AXIS_Z) <= 1.05 for v in f.verts),
    'rotor-mesh',
)
# The terminals: the faces of the lugs, which stand out of the cap's side above the can's top (15 mm).
lugs = split(cap, lambda f: any(v.co.z > 15.05 for v in f.verts), 'terminals')

steel = kit.material('motor-can', '9fa4aa', Metallic=1.0, Roughness=0.4)
plastic = kit.material('motor-cap', '1d1d20', Roughness=0.5)
shaft_steel = kit.material('motor-shaft', 'b4b8bd', Metallic=1.0, Roughness=0.3)
tin = kit.material('motor-terminal', 'c4c6c8', Metallic=1.0, Roughness=0.32)
for obj, table in ((can, {'step-5a5a5a': steel}), (cap, {'step-737373': plastic}), (shaft, {'step-5a5a5a': shaft_steel}), (lugs, {'step-737373': tin})):
    for i, m in enumerate(list(obj.data.materials)):
        obj.data.materials[i] = table[m.name]

root = kit.root(args)
body = kit.join([can, cap], 'body')
body.parent = root
bpy.context.scene.collection.objects.link(shaft)
bpy.context.scene.collection.objects.link(lugs)
lugs.parent = root
for obj in (body, lugs, shaft):
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=math.radians(35))

pivot = kit.node(root, 'rotor', (SHAFT_FROM, 0, AXIS_Z))
shaft.parent = pivot
shaft.location = (0, 0, 0)
shaft.data.transform(Matrix.Translation((-SHAFT_FROM, 0, -AXIS_Z)))

# The leads: from each lug's top, over the can, down to the table and out along -y, each to a one-pin
# housing. Red leaves the +y lug, black the -y lug; their housings sit 2.54 mm apart along x.
pins = part['pins']
by_id = {p['id']: p for p in pins}
lug_y = {'red': 6.2, 'black': -6.2}
lug_top = 15.0 + 2.0
cable = kit.Mesh()
housing = kit.Mesh()
red = kit.material('lead-red', 'c1272d', Roughness=0.5)
black = kit.material('lead-black', '1a1a1c', Roughness=0.5)
black_plastic = kit.material('housing-black', '17181a', Roughness=0.5)
gold = kit.material('motor-pin', 'd6b25c', Metallic=1.0, Roughness=0.3)
back = -LEAD_LENGTH  # where each housing's back face is
x_first = -3.81  # the first pin's lug position along the axis; pins follow at +2.54 mm
for pid, mat in (('red', red), ('black', black)):
    x = x_first + by_id[pid]['offsetPitch'][0] * kit.PITCH
    y = lug_y[pid]
    path = [
        (x, y, lug_top - 0.3),
        (x, y, lug_top + 1.4),
        (x, -12.0, lug_top + 1.4),
        (x, -16.0, HOUSING[2] / 2),
        (x, back, HOUSING[2] / 2),
    ]
    cable.sweep(path, LEAD_R, mat, segs=8)
    housing.box((x - HOUSING[0] / 2, back - HOUSING[1], 0.0), (x + HOUSING[0] / 2, back, HOUSING[2]), black_plastic)
    tip = back - HOUSING[1] - PIN_OUT
    housing.box(
        (x - kit.LEG / 2, tip, HOUSING[2] / 2 - kit.LEG / 2),
        (x + kit.LEG / 2, back - HOUSING[1], HOUSING[2] / 2 + kit.LEG / 2),
        gold,
    )
    kit.pin_empty(root, pid, (x, tip, HOUSING[2] / 2), (0, -1, 0))
wires = cable.to_object('cable', root)
plugs = housing.to_object('connector', root)

kit.recentre(root)
kit.finish(
    args,
    root,
    [
        kit.box_of('body', body),
        kit.box_of('rotor', pivot),
        kit.box_of('terminals', lugs),
        kit.box_of('cable', wires),
        kit.box_of('connector', plugs),
    ],
)
print(f"{part['id']}: {kit.triangles(root)} triangles")
