"""The SunFounder GPIO Extension Board (T-board) from content/controllers/tboard.json (SPEC 6.3, 10.4).

Modelled in tboard.json's frame (mm, z up): pin 1 at the origin, +x along the stem toward pin 39,
+y toward the even-pin row. z = 0 is the breadboard's top surface the yellow spacers rest on; the
stem's pins reach below it. The PCB sits on the spacers, the shrouded box header on the PCB at
negative x (the bar), its key slot in the long wall at -x, away from the stem.

Nodes: `tboard` (root) with `pcb`, `header`, `pins`, `pads`, `spacers`, and the empty `socket` in
the box header's middle, SOCKET_SEAT below its rim: the IDC socket's origin goes there, with the
same axes as the header's pins, and its plug stands in the cavity. The header's pin 1 is the +y end
of its key-side row (the underside photo puts the square pad there).

Textures: each PCB face takes one planar map set. The top's colour (mask, traces, white silkscreen
from the pin table, the title), the traces' relief as a tangent-space normal map, and AO are baked
in Blender; so are the underside's. The header gets a normal map for its moulded edges, and AO.

    blender -b --factory-startup --python-exit-code 1 -P tboard.py -- --tboard <tboard.json>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import bake, export, materials, scene  # noqa: E402

args = scene.start(lambda p: (p.add_argument('--tboard', required=True), p.add_argument('--texture', required=True)))
with open(args.tboard) as f:
    T = json.load(f)
TEXTURE = [int(n) for n in args.texture.split('x')]

# --- Data: tboard.json -----------------------------------------------------------------------------
P = T['pitchMm']
ROW = T['rowSpacingPitches'] * P  # across the stem, between the two pin rows
STEM, BAR = T['outline']['stem'], T['outline']['topBar']
CORNER = T['outline']['cornerRadiusMm']
THICK = T['outline']['pcbThicknessMm']
HDR = T['header']
HOLES = T['mountingHoles']
LABELS = {p['pin']: p['label'] for p in T['pins']}
TITLE = 'GPIO Extension Board'


def stem_pin(n):
    """Where pin n (1-40) stands: odd pins on y = 0, even pins one row spacing across."""
    return ((n - 1) // 2 * P, (n - 1) % 2 * ROW)


# --- Shape (mm). tboard.json gives the outline, header and holes; ADR-0037 records the rest. ------
SPACER_H = 2.5  # a 0.1" header's body
PIN = 0.64
PIN_BELOW = 6.0  # the stem's pins below the spacers' underside (z = 0)
TAIL_ABOVE = 1.4  # and above the PCB's top face
HDR_TAIL_BELOW = 1.2  # the box header's pin tails below the PCB
HOLE_D, PAD_D, MOUNT_PAD_D, VIA_D = 1.0, 1.6764, 4.1, 0.7  # drill and pad: Adafruit T-Cobbler Plus; the mounting ring: photo 5
PAD_Z = 0.03  # pads stand this far proud of the mask
TRACE_W, TRACE_RELIEF = 0.2, 0.05
WALL = (1.2, 2.95)  # shroud walls: the long ones, and the ends; the cavity (6.4 x 52.6) takes the socket's 6.10 x 51.6 plug (ADR-0065)
SOCKET_SEAT = 5.08  # the socket's mating face sits this far below the rim (idc.py's PLUG: its ears rest on the end walls)
BASE = 2.0  # shroud floor
KEY = (6.5, 4.5)  # key slot in the long wall at -x: (width, depth from the rim)
PIN_DEPTH = 2.0  # header pins end this far below the rim
BEVEL = 0.1  # rounding of the shroud's edges, baked into its normal map
AO_DISTANCE = 6.0
FLAT_SAMPLES = 16  # colour and normal bakes only need anti-aliasing; AO uses --samples
LABEL = (1.5, 5.6)  # silkscreen label: font size, widest label (mm)
SILK_Z = 0.002

Z_B = SPACER_H
Z_T = Z_B + THICK
Z_H = Z_T + HDR['heightMm']
CX, CY = HDR['centerXMm'], HDR['centerYMm']
HX, HY = HDR['widthAlongXMm'] / 2, HDR['lengthAlongYMm'] / 2
HEADER_ROWS = (CX - P / 2, CX + P / 2)  # the key-side row (odd pins), the inner row (even pins)


def header_pin(n):
    """Header pin n: odd pins in the key-side row, pin 1 at the +y end."""
    return (HEADER_ROWS[(n - 1) % 2], CY + (9.5 - (n - 1) // 2) * P)


# sRGB colours.
RED = materials.srgb(0.75, 0.07, 0.08)
TRACE_RED = materials.srgb(0.56, 0.04, 0.05)  # under the mask on the underside
TRACE_RED_TOP = materials.srgb(0.67, 0.06, 0.07)  # fainter on the top, where the labels run over them
WHITE = materials.srgb(0.93, 0.93, 0.9)
INK = materials.srgb(0.04, 0.04, 0.05)
GREY = materials.srgb(0.62, 0.64, 0.67)
TIN = materials.srgb(0.84, 0.84, 0.86)  # the pins' nickel
SOLDER = materials.srgb(0.70, 0.70, 0.72)  # pads and solder cones: tin that has dulled, as the photos show (ADR-0066)
YELLOW = materials.srgb(1.0, 0.76, 0.0)
FR4 = materials.srgb(0.82, 0.74, 0.52)

bm = bmesh.new()


def commit(name, mats, parent=None):
    """The bmesh as a linked object named `name` with materials `mats`; empties the bmesh."""
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4], ngon_method='EAR_CLIP')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.clear()
    for m in mats:
        me.materials.append(m)
    return scene.link(bpy.data.objects.new(name, me), parent)


# --- Geometry helpers -------------------------------------------------------------------------------
def circle(cx, cy, z, r, n=16, square=False):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        rr = r / max(abs(math.cos(a)), abs(math.sin(a))) if square else r
        pts.append(bm.verts.new((cx + rr * math.cos(a), cy + rr * math.sin(a), z)))
    return pts


def band(a, b, flip=False):
    """Quads between two rings of equal length that run counter-clockwise seen from above, facing
    outward when a is below b (with flip, inward)."""
    for i in range(len(a)):
        j = (i + 1) % len(a)
        bm.faces.new((a[i], a[j], b[j], b[i]) if not flip else (a[i], b[i], b[j], a[j]))


def annulus(cx, cy, z, r_in, r_out, up, square=False):
    inner, outer = circle(cx, cy, z, r_in), circle(cx, cy, z, r_out, square=square)
    for i in range(len(inner)):
        j = (i + 1) % len(inner)
        quad = (outer[i], outer[j], inner[j], inner[i])
        bm.faces.new(quad if up else quad[::-1])


def disc(cx, cy, z, r, up, n=8):
    ring = circle(cx, cy, z, r, n)
    bm.faces.new(ring if up else ring[::-1])


def tube(cx, cy, z0, z1, r):
    """A plated hole's wall, facing the axis."""
    band(circle(cx, cy, z0, r), circle(cx, cy, z1, r), flip=True)


def cone(cx, cy, z0, z1, r0, r1, n=8):
    """A solder fillet: wide at z0, narrowing to a capped z1."""
    a, b = circle(cx, cy, z0, r0, n), circle(cx, cy, z1, r1, n)
    start = len(bm.faces)
    if z1 > z0:
        band(a, b)
        bm.faces.new(b)
    else:
        band(b, a)
        bm.faces.new(b[::-1])
    bm.faces.ensure_lookup_table()
    for f in bm.faces[start:]:  # a fillet is rounded: smooth shading, not an octagon's facets
        f.smooth = True


def post(cx, cy, levels):
    """A square pin through (side, z) levels, bottom to top, capped at both ends."""
    rings = [[bm.verts.new((cx + sx * s / 2, cy + sy * s / 2, z)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))] for s, z in levels]
    for a, b in zip(rings, rings[1:]):
        band(a, b)
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])


def rounded(points, r, steps=6):
    """The polygon of right-angle corners with each corner rounded to radius r."""
    out = []
    for i, p in enumerate(points):
        a = (Vector(points[i - 1]) - Vector(p)).normalized()
        b = (Vector(points[(i + 1) % len(points)]) - Vector(p)).normalized()
        centre = Vector(p) + (a + b) * r
        for k in range(steps + 1):
            t = k * math.pi / 2 / steps
            v = -b * math.cos(t) - a * math.sin(t)
            out.append((centre.x + r * v.x, centre.y + r * v.y))
    return out


X0, X1 = BAR['xMin'], STEM['xMax']
Y0, Y1 = BAR['yMin'], BAR['yMax']
# The T, counter-clockwise from the bar's far corner.
OUTLINE = rounded([
    (BAR['xMin'], BAR['yMin']), (BAR['xMax'], BAR['yMin']), (STEM['xMin'], STEM['yMin']), (STEM['xMax'], STEM['yMin']),
    (STEM['xMax'], STEM['yMax']), (STEM['xMin'], STEM['yMax']), (BAR['xMax'], BAR['yMax']), (BAR['xMin'], BAR['yMax']),
], CORNER)

# --- The traces, routed by one rule (ADR-0037: stylised, not copied from the photos) ------------------
# Header pin n goes to stem pin n. On the underside each leaves its pad (the key-side row's pads step
# half a pitch to pass between the inner row's), runs toward the stem, and fans in parallel at 70
# degrees from the stem's axis, so none cross, into its own lane between the two pin rows. The lanes
# keep the header's order along y, LANE_PITCH apart. At the lane's end (under the stem pad's x) a via
# takes the trace to the top face, where it crosses to the pad; vias are tented, so only the
# underside shows them.
FAN = math.tan(math.radians(70))
LANE_PITCH = 0.34
FAN_STEP = 0.35  # lanes' fans end this much further from the stem, one lane at a time
bottom_traces, top_traces = [], []
for n in range(1, 41):
    hx, hy = header_pin(n)
    k = 2 * ((n - 1) // 2) + (0 if n % 2 == 0 else 1)  # position along the header's y, 0 the +y-most
    y = CY + 9.5 * P - P / 2 * k  # the trace's y once past the header's pads
    lane = ROW - PAD_D / 2 - LANE_PITCH * k
    sx, sy = stem_pin(n)
    past_pads = HEADER_ROWS[1] + PAD_D / 2 + 0.26
    fan_end = -1.0 - FAN_STEP * (k if y > lane else 39 - k)
    path = [(hx, hy)]
    if n % 2:
        path.append((hx + P / 2, hy - P / 2))
    path += [(past_pads, y), (fan_end - abs(y - lane) / FAN, y), (fan_end, lane), (sx, lane)]
    bottom_traces.append(path)
    top_traces.append([(sx, lane), (sx, sy)])
vias = [path[-1] for path in bottom_traces]

# --- PCB: outline, 82 holes, two faces and the edge ---------------------------------------------------
HOLE_AT = [stem_pin(n) for n in range(1, 41)] + [header_pin(n) for n in range(1, 41)]
TW = int(round(TEXTURE[1] * (Y1 - Y0) / (X1 - X0) / 4)) * 4  # texture width, at the height's density
TH = TEXTURE[1]


def face_uv(top):
    """The planar map: u across y, v down x, as the face reads from outside with the header up."""
    unit = lambda v: min(max(v, 0.0), 1.0)  # noqa: E731 (float noise at the edges would leave [0, 1])
    return lambda x, y: (unit(((y - Y0) if top else (Y1 - y)) / (Y1 - Y0)), unit(1 - (x - X0) / (X1 - X0)))


def pcb_face(z, top):
    outer = [bm.verts.new((x, y, z)) for x, y in OUTLINE]
    loops = [outer]
    for cx, cy in HOLE_AT:
        loops.append(circle(cx, cy, z, HOLE_D / 2))
    for h in HOLES:
        loops.append(circle(h['xMm'], h['yMm'], z, h['diameterMm'] / 2, 24))
    edges = [bm.edges.get((loop[i - 1], loop[i])) or bm.edges.new((loop[i - 1], loop[i])) for loop in loops for i in range(len(loop))]
    filled = bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    bm.normal_update()
    for f in filled['geom']:
        if isinstance(f, bmesh.types.BMFace) and (f.normal.z > 0) != top:
            f.normal_flip()
    uv = bm.loops.layers.uv.new('UVMap')
    place = face_uv(top)
    for f in bm.faces:
        for loop in f.loops:
            loop[uv].uv = place(loop.vert.co.x, loop.vert.co.y)


# Soldermask is a semi-gloss: the studio's bright HDRI, reflected off a smoother mask, washes the red
# to pink at a low camera angle, so the base is nearly matt and the coat a faint sheen (ADR-0066).
mask_top = materials.principled('mask-top', RED, Roughness=0.9, Coat_Weight=0.06, Coat_Roughness=0.2)
mask_bottom = materials.principled('mask-bottom', RED, Roughness=0.9, Coat_Weight=0.06, Coat_Roughness=0.2)
fr4 = materials.principled('fr4', FR4, Roughness=0.7)
tin = materials.principled('tin', SOLDER, Metallic=1.0, Roughness=0.55)
pin_mat = materials.principled('pin', TIN, Metallic=1.0, Roughness=0.3)
shroud_mat = materials.principled('shroud', GREY, Roughness=0.55)
spacer_mat = materials.principled('spacer', YELLOW, Roughness=0.45)

root = scene.link(bpy.data.objects.new('tboard', None))
pcb_face(Z_T, True)
pcb_top = commit('pcb-top', [mask_top])
pcb_face(Z_B, False)
pcb_bottom = commit('pcb-bottom', [mask_bottom])
bm.loops.layers.uv.new('UVMap')
for i, a in enumerate(OUTLINE):  # the cut edge; its UVs collapse to a point, as it takes no texture
    b = OUTLINE[(i + 1) % len(OUTLINE)]
    bm.faces.new([bm.verts.new((a[0], a[1], Z_B)), bm.verts.new((b[0], b[1], Z_B)), bm.verts.new((b[0], b[1], Z_T)), bm.verts.new((a[0], a[1], Z_T))])
pcb_edge = commit('pcb-edge', [fr4])
bm.free()
bm = bmesh.new()  # the rest carries no UVs

# --- Pads, plated holes, vias and solder (tin) -----------------------------------------------------
for n in range(1, 41):
    x, y = stem_pin(n)
    annulus(x, y, Z_T + PAD_Z, HOLE_D / 2, PAD_D / 2, True)
    tube(x, y, Z_B, Z_T, HOLE_D / 2)
    cone(x, y, Z_T + PAD_Z, Z_T + 1.1, 0.8, 0.38)
    x, y = header_pin(n)
    annulus(x, y, Z_B - PAD_Z, HOLE_D / 2, PAD_D / 2, False, square=(n == 1))
    tube(x, y, Z_B, Z_T, HOLE_D / 2)
    cone(x, y, Z_B - PAD_Z, Z_B - HDR_TAIL_BELOW + 0.3, 0.8, 0.38)
for h in HOLES:
    r = h['diameterMm'] / 2
    annulus(h['xMm'], h['yMm'], Z_T + PAD_Z, r, MOUNT_PAD_D / 2, True)
    annulus(h['xMm'], h['yMm'], Z_B - PAD_Z, r, MOUNT_PAD_D / 2, False)
    band(circle(h['xMm'], h['yMm'], Z_B, r, 24), circle(h['xMm'], h['yMm'], Z_T, r, 24), flip=True)
for x, y in vias:  # tented on the top face, so only the underside shows them
    disc(x, y, Z_B - PAD_Z, VIA_D / 2, False)
commit('pads', [tin], root)

# --- Pins: the stem's 40 and the header's 40 ---------------------------------------------------------
TIP = (0.26, 0.4)
for n in range(1, 41):
    x, y = stem_pin(n)
    post(x, y, [(TIP[0], -PIN_BELOW), (PIN, -PIN_BELOW + TIP[1]), (PIN, Z_T + TAIL_ABOVE - 0.5), (0.4, Z_T + TAIL_ABOVE)])
    x, y = header_pin(n)
    post(x, y, [(PIN, Z_B - HDR_TAIL_BELOW), (PIN, Z_H - PIN_DEPTH - 0.4), (TIP[0], Z_H - PIN_DEPTH)])
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
commit('pins', [pin_mat], root)

# --- Spacers: two 1x20 strips of yellow plastic, a notch between each pair of pins -------------------
for y_c in (0.0, ROW):
    sides = []
    for s in (-1, 1):
        edge = [(-P / 2, y_c + s * P / 2)]
        for i in range(19):
            xb = (i + 0.5) * P
            edge += [(xb - 0.25, y_c + s * P / 2), (xb, y_c + s * (P / 2 - 0.35)), (xb + 0.25, y_c + s * P / 2)]
        edge.append((19.5 * P, y_c + s * P / 2))
        sides.append(edge)
    loop = sides[0] + sides[1][::-1]
    low = [bm.verts.new((x, y, 0)) for x, y in loop]
    high = [bm.verts.new((x, y, SPACER_H)) for x, y in loop]
    band(low, high)
    bm.faces.new(low[::-1])
    bm.faces.new(high)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
commit('spacers', [spacer_mat], root)

# --- Header: one closed shroud with the key slot in its -x wall ------------------------------------
x0, x1, y0, y1 = CX - HX, CX + HX, CY - HY, CY + HY
ix0, ix1, iy0, iy1 = x0 + WALL[0], x1 - WALL[0], y0 + WALL[1], y1 - WALL[1]
z_key = Z_H - KEY[1]
ya, yb = CY - KEY[0] / 2, CY + KEY[0] / 2
floor = Z_T + BASE


def rim(xk, xo, ys):
    """A loop at the rim, counter-clockwise from above, dipping to the key slot's floor along x = xk."""
    return [bm.verts.new(c) for c in (
        (xk, ys[0], Z_H), (xo, ys[0], Z_H), (xo, ys[1], Z_H), (xk, ys[1], Z_H),
        (xk, yb, Z_H), (xk, yb, z_key), (xk, ya, z_key), (xk, ya, Z_H))]


outer, inner = rim(x0, x1, (y0, y1)), rim(ix0, ix1, (iy0, iy1))
foot = [bm.verts.new((x, y, Z_T)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
well = [bm.verts.new((x, y, floor)) for x, y in ((ix0, iy0), (ix1, iy0), (ix1, iy1), (ix0, iy1))]
bm.faces.new((foot[1], foot[2], outer[2], outer[1]))  # +x wall
bm.faces.new((foot[0], foot[1], outer[1], outer[0]))  # y0 end
bm.faces.new((foot[2], foot[3], outer[3], outer[2]))  # y1 end
bm.faces.new((foot[3], foot[0], outer[0], outer[7], outer[6], outer[5], outer[4], outer[3]))  # -x wall, with the slot
bm.faces.new(foot[::-1])
for i in range(8):  # the rim, slot included
    j = (i + 1) % 8
    bm.faces.new((outer[i], outer[j], inner[j], inner[i]))
bm.faces.new((inner[1], inner[2], well[2], well[1]))
bm.faces.new((inner[0], inner[1], well[1], well[0]))
bm.faces.new((inner[2], inner[3], well[3], well[2]))
bm.faces.new((inner[3], inner[4], inner[5], inner[6], inner[7], inner[0], well[0], well[3]))
bm.faces.new(well[::-1])
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
header = commit('header', [shroud_mat], root)

# --- Silkscreen, traces and the title: flat sources for the colour bake ---------------------------------


def flat_quad(name, x0_, y0_, x1_, y1_, z, mat, up=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0_, y0_, z), (x1_, y0_, z), (x1_, y1_, z), (x0_, y1_, z)], [], [(0, 1, 2, 3) if up else (3, 2, 1, 0)])
    me.materials.append(mat)
    return scene.link(bpy.data.objects.new(name, me))


def strips(name, paths, width, z, mat):
    """Flat strips of the given width along each polyline, their ends squared off past the points."""
    quads = []
    for path in paths:
        for a, b in zip(path, path[1:]):
            d = (Vector(b) - Vector(a)).normalized()
            n = Vector((-d.y, d.x)) * width / 2
            p, q = Vector(a) - d * width / 2, Vector(b) + d * width / 2
            quads.append([(p.x + n.x, p.y + n.y, z), (q.x + n.x, q.y + n.y, z), (q.x - n.x, q.y - n.y, z), (p.x - n.x, p.y - n.y, z)])
    me = bpy.data.meshes.new(name)
    me.from_pydata([v for q in quads for v in q], [], [tuple(range(4 * i, 4 * i + 4)) for i in range(len(quads))])
    me.materials.append(mat)
    return scene.link(bpy.data.objects.new(name, me))


def tubes(name, paths, z, top):
    """The traces' relief as a mesh: round-section ridges that stand TRACE_RELIEF proud of a face."""
    r = (TRACE_W ** 2 / 4 + TRACE_RELIEF ** 2) / (2 * TRACE_RELIEF)
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = r
    curve.bevel_resolution = 3
    curve.use_fill_caps = True
    for path in paths:
        spline = curve.splines.new('POLY')
        spline.points.add(len(path) - 1)
        for pt, (x, y) in zip(spline.points, path):
            pt.co = (x, y, z + (TRACE_RELIEF - r) * (1 if top else -1), 1)
    obj = scene.link(bpy.data.objects.new(name, curve))
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(obj)
    return scene.link(bpy.data.objects.new(name, me))


def text(body, x, y, size, mat, align, z=Z_T + 1.5 * SILK_Z):
    """Text reading along +y with its top toward -x, as the top face reads with the header up."""
    curve = bpy.data.curves.new(body, 'FONT')
    curve.body = body
    curve.size = size
    curve.align_x = align
    curve.align_y = 'CENTER'
    curve.materials.append(mat)
    obj = scene.link(bpy.data.objects.new(body, curve))
    obj.location = (x, y, z)
    obj.rotation_euler.z = math.pi / 2
    return obj


def bake_face(target, name, flats, tube_paths, top, z):
    """Colour, then normal map, baked onto a PCB face (the flat sources are consumed)."""
    bpy.context.scene.cycles.samples = FLAT_SAMPLES
    color = bake.bake(target, 'EMIT', bake.image(f'tboard-{name}-color', TW, TH), flats, extrusion=0.05, distance=0.1)
    for obj in flats:
        bpy.data.objects.remove(obj)
    ground = flat_quad('ground', X0, Y0, X1, Y1, z, materials.principled('ground', RED), up=top)
    ridges = tubes('traces', tube_paths, z, top)
    normal = bake.bake(target, 'NORMAL', bake.image(f'tboard-{name}-normal', TW, TH, color=False), [ground, ridges], extrusion=0.1, distance=0.3)
    bpy.data.objects.remove(ground)
    bpy.data.objects.remove(ridges)
    bpy.context.scene.cycles.samples = args.samples
    return color, normal


# Top face: mask, trace colour, labels, the title on its white box.
flats = [flat_quad('mask', X0, Y0, X1, Y1, Z_T + 0.001, materials.emission('mask', RED))]
flats.append(strips('traces', top_traces, TRACE_W, Z_T + SILK_Z, materials.emission('trace-top', TRACE_RED_TOP)))
white, ink = materials.emission('white', WHITE), materials.emission('ink', INK)
for n in range(1, 41):
    x, y = stem_pin(n)
    odd = n % 2 == 1
    label = text(LABELS[n], x, y + (1.6 if odd else -1.6), LABEL[0], white, 'LEFT' if odd else 'RIGHT')
    flats.append(label)
    bpy.context.view_layer.update()
    if label.dimensions.x > LABEL[1]:
        label.scale.x = LABEL[1] / label.dimensions.x
tx0, tx1, ty0, ty1 = BAR['xMax'] - 4.2, BAR['xMax'] - 0.7, CY - 16, CY + 16  # the title's white box
flats.append(flat_quad('title-box', tx0, ty0, tx1, ty1, Z_T + 0.0015, white))
title = text(TITLE, (tx0 + tx1) / 2, CY, 2.6, ink, 'CENTER')
bpy.context.view_layer.update()
title.scale.x = min(1.0, 29.5 / title.dimensions.x)
flats.append(title)
top_color, top_normal = bake_face(pcb_top, 'top', flats, top_traces, True, Z_T)

# Underside: mask and traces.
flats = [flat_quad('mask', X0, Y0, X1, Y1, Z_B - 0.001, materials.emission('mask', RED))]
flats.append(strips('traces', bottom_traces, TRACE_W, Z_B - SILK_Z, materials.emission('trace-bottom', TRACE_RED)))
bottom_color, bottom_normal = bake_face(pcb_bottom, 'bottom', flats, bottom_traces, False, Z_B)

# --- Header's normal map, then AO for every baked face --------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')  # the bakes leave their targets selected; only the header unwraps
bpy.context.view_layer.objects.active = header
header.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0)
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(shape_method='AABB', rotate=True, margin_method='FRACTION', margin=0.002)
bpy.ops.object.mode_set(mode='OBJECT')
rounded_copy = bpy.data.objects.new('high', header.data.copy())
scene.link(rounded_copy)
bevel = rounded_copy.modifiers.new('bevel', 'BEVEL')
bevel.width = BEVEL
bevel.segments = 2
bevel.limit_method = 'ANGLE'
bevel.angle_limit = math.radians(25)
bevel.harden_normals = True
rounded_copy.data.shade_smooth()
bpy.context.scene.cycles.samples = FLAT_SAMPLES
header_normal = bake.bake(header, 'NORMAL', bake.image('tboard-header-normal', *[n // 2 for n in TEXTURE], color=False), [rounded_copy], extrusion=0.05, distance=0.2)
bpy.context.scene.cycles.samples = args.samples
bpy.data.objects.remove(rounded_copy)

bpy.context.scene.world.light_settings.distance = AO_DISTANCE
half = [TW // 2, TH // 2]
top_ao = bake.bake(pcb_top, 'AO', bake.image('tboard-top-occlusion', *half, color=False))
bottom_ao = bake.bake(pcb_bottom, 'AO', bake.image('tboard-bottom-occlusion', *half, color=False))
header_ao = bake.bake(header, 'AO', bake.image('tboard-header-occlusion', *[n // 2 for n in TEXTURE], color=False))
for mat, color, normal, ao in ((mask_top, top_color, top_normal, top_ao), (mask_bottom, bottom_color, bottom_normal, bottom_ao)):
    materials.base_color(mat, color)
    materials.normal_map(mat, normal)
    materials.occlusion(mat, ao)
materials.normal_map(shroud_mat, header_normal)
materials.occlusion(shroud_mat, header_ao)

# --- One PCB mesh, the socket's empty, export -----------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for obj in (pcb_top, pcb_bottom, pcb_edge):
    obj.select_set(True)
bpy.context.view_layer.objects.active = pcb_top
bpy.ops.object.join()
pcb = bpy.context.view_layer.objects.active
pcb.name = pcb.data.name = 'pcb'
pcb.parent = root
socket = scene.link(bpy.data.objects.new('socket', None), root)
socket.location = (CX, CY, Z_H - SOCKET_SEAT)
export.glb(args.out, root, tangents=True)

boxes = [export.box('pcb', [pcb]), export.box('header', [header])]
for name, y in (('a', 0.0), ('b', ROW)):  # a is the odd pins' strip
    boxes.append({'name': f'spacer-{name}', 'min': [-P / 2, y - P / 2, 0.0], 'max': [19.5 * P, y + P / 2, SPACER_H]})
    boxes.append({'name': f'pins-{name}', 'min': [-PIN / 2, y - PIN / 2, -PIN_BELOW], 'max': [19 * P + PIN / 2, y + PIN / 2, 0.0]})
export.colliders(args.colliders, boxes)
print(f'tboard: {len(pcb.data.polygons)} PCB faces, texture {TW}x{TH}')
