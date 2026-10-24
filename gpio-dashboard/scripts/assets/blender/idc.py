"""A 3M 891-series 2x20 IDC socket for 1.27 mm cable (SPEC 6.4, 10.4).

Modelled in the socket's own frame (mm, z up): the origin is the centre of the mating face, which
faces -z, so the socket plugs down onto upward pins. x runs across the two rows (the contacts sit
at x = -1.27 and +1.27), y along them. Pin 1 is the contact at (-1.27, +24.13): in the row beside
the polarization bump, at the +y end. The cable leaves through the -x wall, under the strain
relief, with conductor 1 at the +y edge.

The lower body (6.10 x 51.6 mm, the sheet's bottom view) is the plug: it goes down into a box
header's cavity, and the latch ears at the cover's two ends, PLUG mm above the mating face, rest on
the shroud's end walls. The polarization bump stands in the shroud's key slot.

Empties: `pin1` at contact 1, and `cable-a`, `cable-b` at the two ends of the line where the
ribbon leaves the socket (`cable-a` at the conductor-1 edge), at the cable's mid-plane.

The contact openings, cable slot, bump, strain relief and pin-1 triangle are geometry. A copy
carrying the cover's moulded ribs is the source of the normal map; AO is baked as well.

    blender -b --factory-startup --python-exit-code 1 -P idc.py -- --ribbon <ribbon.json>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import json
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import bake, export, materials, scene  # noqa: E402

args = scene.start(lambda p: (p.add_argument('--ribbon', required=True), p.add_argument('--texture', required=True)))
with open(args.ribbon) as f:
    R = json.load(f)
TEXTURE = [int(n) for n in args.texture.split('x')]

# Shape (mm). The 3M 891 sheet (TS-0449-L, 40 contacts; ADR-L-1) gives the body's 6.10 width and
# 51.6 length (B), the cover's 55.4 with its end ears (A), the 5.08 (0.200 in) lower body below the
# cover and the 10.7 assembled height; the rest reads like photo 3's sockets.
PITCH = 2.54
ROW_X = PITCH / 2  # the two rows sit this far either side of the axis
POSITIONS = R['conductors'] // 2  # contacts per row
LENGTH, WIDTH = 51.6, 6.10  # the body: B, and the width of the sheet's bottom view
EARS = 55.4  # A: the cover with the latch ears at its ends
PLUG = 5.08  # the lower body that goes into a header; the ears' underside is this high
BODY_H, COVER_H = 7.1, 3.6  # the cover is the strain relief's plate: 10.7 in all
COVER_END = 0.6  # the cover stops this far short of the body's ends
LIP = 1.0  # the strain relief overhangs the cable wall (-x) by this much
EDGE = 0.25  # rounding of the moulded edges
OPENING = (1.2, 0.9, 6.0)  # contact opening: (side at the face, side at its floor, depth): a Pi header's posts stand 6.0 mm over its base
CABLE = (R['widthMm'], R['thicknessMm'], 6.3)  # the cable's width, thickness, and mid-plane height
SLOT = (R['widthMm'] + 0.1, R['thicknessMm'] + 0.1, 0.6)  # the cable slot in the wall: (length, height, depth)
BUMP = (6.0, 1.2, 0.8, 5.5)  # polarization bump on the cable wall: (width, protrusion, bottom, top), clear of the key slot's floor
TRIANGLE = (2.4, 2.4, 0.25)  # pin-1 triangle on the cover: (base, height, relief)
RIBS = (0.6, 0.25, 0.7)  # the cover's moulded ribs, one between each pair of contacts: (width, relief, margin from its edges)
AO_DISTANCE = 3.0
GREY = materials.srgb(0.62, 0.64, 0.67)
BODY, CONTACT = range(2)  # material slots: the grey body, and the contact openings' metal

bm = bmesh.new()
Y1 = (POSITIONS - 1) / 2 * PITCH  # the +y end contact


def box(x0, x1, y0, y1, z0, z1, rounded=EDGE):
    cube = bmesh.ops.create_cube(bm, size=1.0)['verts']
    bmesh.ops.scale(bm, vec=(x1 - x0, y1 - y0, z1 - z0), verts=cube)
    bmesh.ops.translate(bm, vec=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), verts=cube)
    if rounded:
        bmesh.ops.bevel(bm, geom=list({e for v in cube for e in v.link_edges}), offset=rounded, segments=2, affect='EDGES')
    return cube


def faces_where(test):
    bm.normal_update()
    return [f for f in bm.faces if test(f.normal, f.calc_center_median())]


def cut(test, *planes):
    """Split the faces that pass test along (point, normal) planes."""
    for co, no in planes:
        faces = faces_where(test)
        geom = [*{v for f in faces for v in f.verts}, *{e for f in faces for e in f.edges}, *faces]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)


def sink(face, side, depth, slot=BODY):
    """Inset face to a square of the given side and push it `depth` into the body; the recess takes `slot`."""
    width = max(v.co.x for v in face.verts) - min(v.co.x for v in face.verts)
    normal = face.normal.copy()
    for wall in bmesh.ops.inset_individual(bm, faces=[face], thickness=max((width - side) / 2, 0.0), depth=0)['faces']:
        wall.material_index = slot
    face.material_index = slot
    bmesh.ops.translate(bm, vec=-depth * normal, verts=face.verts)


def build(ribs):
    """The socket's geometry; with ribs, also the cover's moulded ribs (the normal map's source)."""
    x0, x1 = -WIDTH / 2, WIDTH / 2
    y = LENGTH / 2
    box(x0, x1, -y, y, 0, BODY_H)
    box(x0 - LIP, x1 - 0.3, -(y - COVER_END), y - COVER_END, BODY_H, BODY_H + COVER_H)
    for s in (-1, 1):  # the latch ears, at the cover's ends
        box(x0, x1, *sorted((s * y, s * EARS / 2)), PLUG, BODY_H + COVER_H)
    box(x0 - BUMP[1], x0 + 0.5, -BUMP[0] / 2, BUMP[0] / 2, BUMP[2], BUMP[3], rounded=0.15)

    # Contact openings in the mating face.
    planes = [((x, 0, 0), (1, 0, 0)) for r in (-ROW_X, ROW_X) for x in (r - OPENING[0] / 2, r + OPENING[0] / 2)]
    for i in range(POSITIONS):
        for dy in (-OPENING[0] / 2, OPENING[0] / 2):
            planes.append(((0, i * PITCH - Y1 + dy, 0), (0, 1, 0)))
    cut(lambda n, c: n.z < -0.99 and abs(c.z) < 1e-3, *planes)
    for f in faces_where(lambda n, c: n.z < -0.99 and abs(c.z) < 1e-3):
        c = f.calc_center_median()
        if abs(abs(c.x) - ROW_X) < OPENING[0] / 2 and min(abs(c.y - (i * PITCH - Y1)) for i in range(POSITIONS)) < OPENING[0] / 2:
            sink(f, OPENING[1], OPENING[2], CONTACT)

    # The cable slot, under the strain relief.
    cut(lambda n, c: n.x < -0.99 and abs(c.x - x0) < 1e-3 and c.z < BODY_H,
        *[((x0, 0, CABLE[2] + s * SLOT[1] / 2), (0, 0, 1)) for s in (-1, 1)],
        *[((x0, s * SLOT[0] / 2, 0), (0, 1, 0)) for s in (-1, 1)])
    for f in faces_where(lambda n, c: n.x < -0.99 and abs(c.x - x0) < 1e-3):
        c = f.calc_center_median()
        if abs(c.y) < SLOT[0] / 2 and abs(c.z - CABLE[2]) < SLOT[1] / 2:
            sink(f, 0, SLOT[2])

    # Pin-1 triangle, on the cover above contact 1, pointing at the +y end.
    top = BODY_H + COVER_H
    tx, ty = -ROW_X, Y1
    base = [bm.verts.new((tx, ty + TRIANGLE[1] / 2, top)), bm.verts.new((tx + TRIANGLE[0] / 2, ty - TRIANGLE[1] / 2, top)),
            bm.verts.new((tx - TRIANGLE[0] / 2, ty - TRIANGLE[1] / 2, top))]
    raised = [bm.verts.new((v.co.x, v.co.y, top + TRIANGLE[2])) for v in base]
    for i in range(3):
        bm.faces.new((base[i], base[(i + 1) % 3], raised[(i + 1) % 3], raised[i]))
    bm.faces.new(raised[::-1])
    bm.faces.new(base)

    if ribs:
        for i in range(POSITIONS - 1):
            ry = (i + 0.5) * PITCH - Y1
            box(x0 + RIBS[2], x1 - 0.3 - RIBS[2], ry - RIBS[0] / 2, ry + RIBS[0] / 2, top, top + RIBS[1], rounded=0.08)


def mesh_of(name, ribs):
    bm.clear()
    build(ribs)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # Tangents (for the normal map) need triangles and quads.
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    return me


body_mesh = mesh_of('body', False)
high_mesh = mesh_of('high', True)
bm.free()

mat = materials.principled('idc-grey', GREY, Roughness=0.55)
contact_mat = materials.principled('idc-contact', materials.srgb(0.7, 0.7, 0.68), Metallic=1.0, Roughness=0.4)
body_mesh.materials.append(mat)
body_mesh.materials.append(contact_mat)
root = scene.link(bpy.data.objects.new('idc-socket', None))
body = scene.link(bpy.data.objects.new('body', body_mesh), root)
high = scene.link(bpy.data.objects.new('high', high_mesh))

bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0)
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(shape_method='AABB', rotate=True, margin_method='FRACTION', margin=0.002)
bpy.ops.object.mode_set(mode='OBJECT')

normal_img = bake.bake(body, 'NORMAL', bake.image('idc-normal', *TEXTURE, color=False), [high], extrusion=0.3, distance=0.6)
bpy.data.objects.remove(high)
bpy.context.scene.world.light_settings.distance = AO_DISTANCE
ao_img = bake.bake(body, 'AO', bake.image('idc-occlusion', *TEXTURE, color=False))
materials.normal_map(mat, normal_img)
for m in (mat, contact_mat):
    materials.occlusion(m, ao_img)

# --- Empties, export, colliders --------------------------------------------------------------------
for name, at in (
    ('pin1', (-ROW_X, Y1, 0)),
    ('cable-a', (-WIDTH / 2, CABLE[0] / 2, CABLE[2])),
    ('cable-b', (-WIDTH / 2, -CABLE[0] / 2, CABLE[2])),
):
    scene.link(bpy.data.objects.new(name, None), root).location = at
export.glb(args.out, root, tangents=True)
export.colliders(args.colliders, [
    {'name': 'body', 'min': [-WIDTH / 2 - BUMP[1], -LENGTH / 2, 0], 'max': [WIDTH / 2, LENGTH / 2, BODY_H]},
    {'name': 'strain-relief', 'min': [-WIDTH / 2 - LIP, -EARS / 2, PLUG],
     'max': [WIDTH / 2, EARS / 2, BODY_H + COVER_H + TRIANGLE[2]]},
])
print(f'idc-socket: {len(body_mesh.polygons)} faces')
