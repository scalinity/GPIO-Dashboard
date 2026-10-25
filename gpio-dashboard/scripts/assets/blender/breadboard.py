"""A breadboard from its content/boards/<id>.board.json (SPEC 6.1, 10.4).

Modelled in the core frame of core/geometry/breadboard.ts: x from the row-1 end along the rows,
y from the a-side edge, z up with the top surface at z = 0 and the body below it. Hole centres use
breadboard.ts's formulas, so modelled and logical holes coincide; assets:check measures that from
the exported GLB.

The top of the body (chamfers, holes, grooves) is UV-mapped straight down, u = x / length and
v = y / width. Every recess wall has draft, so that projection never folds over. One texture set
serves it: the legend baked from the board data, a normal map of the molded edges, and AO.

    blender -b --factory-startup --python-exit-code 1 -P breadboard.py -- --board <board.json>
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

args = scene.start(
    lambda p: (p.add_argument('--board', required=True), p.add_argument('--texture', required=True))
)
with open(args.board) as f:
    B = json.load(f)
TEXTURE = [int(n) for n in args.texture.split('x')]

# Shape (mm). The datasheets give the outline and the hole grid; the rest reads like the
# reference photos.
TOP_CHAMFER = 0.5
CORNER_CHAMFER = 1.0
HOLE_TOP = 1.4  # side of the square opening
FUNNEL = (0.9, 0.45)  # (side, depth) where the molded funnel meets the shaft
SHAFT = (0.8, 2.2)  # (side, depth) at the contact
CONTACT_V = 0.2  # the contact's leaves dip this far below the shaft
TRENCH = (2.4, 2.0, 2.0)  # (top width, floor width, depth)
CHANNEL = (1.0, 0.7, 1.5)  # the grooves between the rails and the circuit area
GROOVE_END = 1.5  # grooves stop this far from the ends
LINE = (1.35, 0.35)  # rail line: offset from its rail's hole centres, width
GLYPH = 1.2  # legend glyph height
GLYPH_SIZE = GLYPH / 0.73  # font size whose digits stand GLYPH tall (Blender's built-in font)
BEVEL = 0.08  # rounding of the molded edges, baked into the normal map
AO_DISTANCE = 2.0

# sRGB colours. ABS also carries a faint sheen, standing in for its slight translucency.
ABS = materials.srgb(0.93, 0.93, 0.91)
INK = materials.srgb(0.24, 0.24, 0.26)
RED = materials.srgb(0.85, 0.12, 0.14)
BLUE = materials.srgb(0.10, 0.38, 0.82)
NICKEL = materials.srgb(0.78, 0.77, 0.74)
ABS_FINISH = dict(Roughness=0.45, IOR=1.53, Sheen_Weight=0.3, Sheen_Roughness=0.5)

# core/geometry/breadboard.ts, in Python.
P = B['pitchMm']
L, W, H = B['body']['lengthMm'], B['body']['widthMm'], B['body']['heightMm']
RAILS = B['rails']
COLS = 'abcdefghij'


def row_x(row):
    return B['layout']['row1FromEndMm'] + (row - 1) * P


def col_y(col):
    i = COLS.index(col)
    return B['layout']['columnAFromBottomEdgeMm'] + (i if i < 5 else i - 1 + B['trenchPitches']) * P


def rail_y(rail):
    side, sign = rail[:-1], rail[-1]
    inner = RAILS['polarity'][side]['inner'] == sign
    offset = RAILS['innerOffsetPitches'] if inner else RAILS['outerOffsetPitches']
    return col_y('j') + offset * P if side == 'top' else col_y('a') - offset * P


def rail_row(index):
    group, k = divmod(index, RAILS['groupSize'])
    return RAILS['firstRow'] + group * RAILS['groupStride'] + k + RAILS['rowOffsetPitches']


# Every hole: centre and the direction its strip runs (the contact's V follows it).
HOLES = [(row_x(r), col_y(c), 'y') for r in range(1, B['rows'] + 1) for c in COLS] + [
    (row_x(rail_row(i)), rail_y(rail), 'x')
    for rail in ('top+', 'top-', 'bottom+', 'bottom-')
    for i in range(RAILS['holesPerRail'])
]
INNER_RAIL_Y = {side: rail_y(side + RAILS['polarity'][side]['inner']) for side in ('bottom', 'top')}
TRENCH_Y = (col_y('e') + col_y('f')) / 2
CHANNEL_Y = {
    'bottom': (INNER_RAIL_Y['bottom'] + col_y('a')) / 2,
    'top': (col_y('j') + INNER_RAIL_Y['top']) / 2,
}

# --- Body -------------------------------------------------------------------------------------
ABS_SLOT, PLAIN_SLOT, NICKEL_SLOT = range(3)
bm = bmesh.new()


def ring(points, z):
    return [bm.verts.new((x, y, z)) for x, y in points]


def band(a, b, slot):
    """Quads between two rings that run counter-clockwise seen from above. band(lower, upper)
    faces out of the solid; band(upper, lower) faces into a recess."""
    for i in range(len(a)):
        j = (i + 1) % len(a)
        bm.faces.new((a[i], a[j], b[j], b[i])).material_index = slot


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def square(x, y, side):
    h = side / 2
    return rect(x - h, y - h, x + h, y + h)


def octagon(x0, y0, x1, y1, cut):
    return [
        (x0 + cut, y0), (x1 - cut, y0), (x1, y0 + cut), (x1, y1 - cut),
        (x1 - cut, y1), (x0 + cut, y1), (x0, y1 - cut), (x0, y0 + cut),
    ]


def groove(y, top, floor, depth):
    draft = (top - floor) / 2
    upper = ring(rect(GROOVE_END, y - top / 2, L - GROOVE_END, y + top / 2), 0)
    lower = ring(rect(GROOVE_END + draft, y - floor / 2, L - GROOVE_END - draft, y + floor / 2), -depth)
    band(upper, lower, ABS_SLOT)
    bm.faces.new(lower).material_index = ABS_SLOT
    return upper


def contact(c, x, y, axis):
    """The nickel contact at the bottom of a hole: two leaves meeting in a V along the strip."""
    z = -SHAFT[1] - CONTACT_V
    h = SHAFT[0] / 2
    c0, c1, c2, c3 = c
    if axis == 'y':
        m0, m1 = bm.verts.new((x, y - h, z)), bm.verts.new((x, y + h, z))
        faces = [(c0, m0, m1, c3), (m0, c1, c2, m1), (c0, c1, m0), (c2, c3, m1)]
    else:
        m0, m1 = bm.verts.new((x - h, y, z)), bm.verts.new((x + h, y, z))
        faces = [(c0, c1, m1, m0), (m0, m1, c2, c3), (c3, c0, m0), (c1, c2, m1)]
    for f in faces:
        bm.faces.new(f).material_index = NICKEL_SLOT


d = TOP_CHAMFER
outline = octagon(0, 0, L, W, CORNER_CHAMFER)
top_outline = ring(octagon(d, d, L - d, W - d, CORNER_CHAMFER - d * (2 - math.sqrt(2))), 0)
shoulder = ring(outline, -d)
bottom = ring(outline, -H)
band(shoulder, top_outline, ABS_SLOT)
band(bottom, shoulder, PLAIN_SLOT)
bm.faces.new(list(reversed(bottom))).material_index = PLAIN_SLOT

openings = [top_outline, groove(TRENCH_Y, *TRENCH)]
openings += [groove(y, *CHANNEL) for y in CHANNEL_Y.values()]
for x, y, axis in HOLES:
    top = ring(square(x, y, HOLE_TOP), 0)
    funnel = ring(square(x, y, FUNNEL[0]), -FUNNEL[1])
    shaft = ring(square(x, y, SHAFT[0]), -SHAFT[1])
    band(top, funnel, ABS_SLOT)
    band(funnel, shaft, ABS_SLOT)
    contact(shaft, x, y, axis)
    openings.append(top)

# The flat top: the outline with every opening left open.
edges = [bm.edges.get((loop[i - 1], loop[i])) for loop in openings for i in range(len(loop))]
filled = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
bm.normal_update()
for f in filled['geom']:
    if isinstance(f, bmesh.types.BMFace):
        f.material_index = ABS_SLOT
        if f.normal.z < 0:
            f.normal_flip()
# Tangents (for the normal map) need triangles and quads.
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])

# The sides and bottom take no texture; their UVs collapse to a point so the bottom, which would
# project onto the same texels as the top, bakes nothing over it.
uv = bm.loops.layers.uv.new('UVMap')
for f in bm.faces:
    for loop in f.loops:
        co = loop.vert.co
        loop[uv].uv = (0, 0) if f.material_index == PLAIN_SLOT else (co.x / L, co.y / W)

root = scene.link(bpy.data.objects.new(B['id'], None))
mesh = bpy.data.meshes.new('body')
bm.to_mesh(mesh)
bm.free()
body = scene.link(bpy.data.objects.new('body', mesh), root)
abs_mat = materials.principled('abs', ABS, **ABS_FINISH)
nickel_mat = materials.principled('nickel', NICKEL, Metallic=1.0, Roughness=0.3)
for mat in (abs_mat, materials.principled('abs_plain', ABS, **ABS_FINISH), nickel_mat):
    mesh.materials.append(mat)

# --- Legend: generated from the board data, baked into the colour texture -----------------------
LEGEND_Z = 0.002
END_X = (
    (TOP_CHAMFER + row_x(1) - HOLE_TOP / 2) / 2,
    (row_x(B['rows']) + HOLE_TOP / 2 + L - TOP_CHAMFER) / 2,
)
NUMBER_Y = (
    (CHANNEL_Y['bottom'] + CHANNEL[0] / 2 + col_y('a') - HOLE_TOP / 2) / 2,
    (col_y('j') + HOLE_TOP / 2 + CHANNEL_Y['top'] - CHANNEL[0] / 2) / 2,
)
legend = []


def flat(name, x0, y0, x1, y1, z, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [(0, 1, 2, 3)])
    me.materials.append(mat)
    return scene.link(bpy.data.objects.new(name, me))


def bar(x, y, along_x, along_y, mat):
    legend.append(flat('bar', x - along_x / 2, y - along_y / 2, x + along_x / 2, y + along_y / 2, LEGEND_Z, mat))


def text(body_text, x, y, mat):
    """Legend text reads along +y with its top toward row 1, as the reference photos print it."""
    curve = bpy.data.curves.new(body_text, 'FONT')
    curve.body = body_text
    curve.size = GLYPH_SIZE
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.materials.append(mat)
    obj = scene.link(bpy.data.objects.new(body_text, curve))
    obj.location = (x, y, LEGEND_Z)
    obj.rotation_euler.z = math.pi / 2
    legend.append(obj)


ink, red, blue = (materials.emission(n, c) for n, c in (('ink', INK), ('red', RED), ('blue', BLUE)))
for row in [1, *range(5, B['rows'] + 1, 5)]:
    for y in NUMBER_Y:
        text(str(row), row_x(row), y, ink)
for col in COLS:
    for x in END_X:
        text(col, x, col_y(col), ink)
for side, outward in (('bottom', -1), ('top', 1)):
    for sign, mat in (('+', red), ('-', blue)):
        rail = side + sign
        y = rail_y(rail)
        away = -outward if RAILS['polarity'][side]['inner'] == sign else outward
        line_y = y + away * LINE[0]
        legend.append(flat('line', END_X[0] + GLYPH, line_y - LINE[1] / 2, END_X[1] - GLYPH, line_y + LINE[1] / 2, LEGEND_Z, mat))
        for x in END_X:
            bar(x, y, LINE[1], GLYPH, mat)  # the minus, and the plus's crossbar
            if sign == '+':
                bar(x, y, GLYPH, LINE[1], mat)

backing = flat('backing', 0, 0, L, W, LEGEND_Z / 2, materials.emission('white', ABS))
target = flat('legend', 0, 0, L, W, 0, materials.principled('legend', ABS))
target.data.uv_layers.new(name='UVMap')
for loop in target.data.loops:
    co = target.data.vertices[loop.vertex_index].co
    target.data.uv_layers['UVMap'].data[loop.index].uv = (co.x / L, co.y / W)

color_img = bake.bake(
    target, 'EMIT', bake.image(f"{B['id']}-color", *TEXTURE), [backing, *legend], extrusion=0.05, distance=0.1
)
for obj in [backing, target, *legend]:
    bpy.data.objects.remove(obj)

# --- Normal map of the molded edges, then AO ----------------------------------------------------
high = scene.link(bpy.data.objects.new('high', mesh.copy()))
bevel = high.modifiers.new('bevel', 'BEVEL')
bevel.width = BEVEL
bevel.segments = 3
bevel.limit_method = 'ANGLE'
bevel.angle_limit = math.radians(25)
bevel.harden_normals = True  # flat faces keep flat normals; only the rounding shades smoothly
high.data.shade_smooth()
normal_img = bake.bake(
    body, 'NORMAL', bake.image(f"{B['id']}-normal", *TEXTURE, color=False), [high], extrusion=0.05, distance=0.2
)
bpy.data.objects.remove(high)

bpy.context.scene.world.light_settings.distance = AO_DISTANCE
ao_img = bake.bake(body, 'AO', bake.image(f"{B['id']}-occlusion", *TEXTURE, color=False))

materials.base_color(abs_mat, color_img)
materials.normal_map(abs_mat, normal_img)
for mat in (abs_mat, nickel_mat):
    materials.occlusion(mat, ao_img)

export.glb(args.out, root, tangents=True)
export.colliders(args.colliders, [export.box('body', [body])])
