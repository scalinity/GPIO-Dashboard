"""Sensor modules: the DHT11 (3-pin breakout and the bare 4-pin sensor), HC-SR04 and HC-SR501.
Each build() draws one variant into root and returns [(collider name, [objects])].

Each is drawn after its board as the photographs show it (the sources are in each definition), the
board starting at x = y = 0 before module.py moves the model's lowest corner to the origin. A
module's header row runs along +x with pin 1 first, the way the definition's offsetPitch has it.

- The HC-SR04 lies on its back, cans up. Its right-angle header is on the back face at the -y edge,
  its pins along -y out of the board's edge; the module rests on the pins' bends.
- The DHT11 breakout lies with the sensor on its back on the board, grille up, its top end past the
  far edge. Its right-angle header is on the top face at the -y edge, pins along -y.
- The HC-SR501 lies lens up, every part on the side the board has it. Its real header is a straight
  3-pin strip on the component side, pointing away from the lens; the model stands it on the lens
  side at one end instead, pins up, so a female housing can reach it from above.
- The bare DHT11 stands in a board on its legs (the runtime's), the grille facing -y.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402
import modparts as mp  # noqa: E402
from lib import bake, materials, scene  # noqa: E402

PITCH = kit.PITCH
SILK = kit.SILK
TIN = 'c9ccd0'  # solder pads and tinned holes in the legends


# --- Legends: a decal with its items stacked, and boards that carry one ---------------------------


def _flat(name, x0, y0, x1, y1, z, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [(0, 1, 2, 3)])
    me.materials.append(mat)
    return scene.link(bpy.data.objects.new(name, me))


def decal(name, rect, px, base_hex, items):
    """devicekit.decal with each item a little above the one before, so that later items cover
    earlier ones (a mesh over its cavity, a pad over a trace), and rounder rings. Items are
      ('text', string, x, y, height_mm, hex, rotation_deg, align)
      ('box', x0, y0, x1, y1, hex)
      ('ring', cx, cy, r_outer, r_inner, hex)   (r_inner 0 is a disc)
    and the image maps u = (x - x0) / (x1 - x0), v = (y - y0) / (y1 - y0)."""
    x0, y0, x1, y1 = rect
    made = [_flat('backing', x0, y0, x1, y1, 0.001, kit.emissive(f'{name}-base', base_hex))]
    for k, item in enumerate(items):
        z = 0.002 + 0.0001 * k
        ink = item[5] if item[0] == 'text' else item[-1]
        mat = kit.emissive(f'ink-{ink}', ink)
        if item[0] == 'text':
            _, body, x, y, h, _hex, rot, align = item
            curve = bpy.data.curves.new(f'{name}-t{k}', 'FONT')
            curve.body = body
            curve.size = h / 0.73  # Blender's built-in font: digits stand 0.73 of the size tall
            curve.align_x = align
            curve.align_y = 'CENTER'
            curve.materials.append(mat)
            obj = scene.link(bpy.data.objects.new(f'{name}-t{k}', curve))
            obj.location = (x, y, z)
            obj.rotation_euler.z = math.radians(rot)
            made.append(obj)
        elif item[0] == 'box':
            made.append(_flat(f'{name}-b{k}', item[1], item[2], item[3], item[4], z, mat))
        elif item[0] == 'ring':
            _, cx, cy, ro, ri, _hex = item
            n = 48
            me = bpy.data.meshes.new(f'{name}-r{k}')
            ring = lambda r: [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z)
                              for i in range(n)]
            if ri > 0:
                me.from_pydata(ring(ro) + ring(ri), [], [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)])
            else:
                me.from_pydata(ring(ro), [], [tuple(range(n))])
            me.materials.append(mat)
            made.append(scene.link(bpy.data.objects.new(f'{name}-r{k}', me)))
    target = _flat(f'{name}-target', x0, y0, x1, y1, 0, materials.principled(f'{name}-target', (1, 1, 1)))
    uv = target.data.uv_layers.new(name='UVMap')
    for loop in target.data.loops:
        co = target.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))
    img = bake.bake(target, 'EMIT', bake.image(name, *px), made, extrusion=0.05, distance=0.1)
    for obj in [target, *made]:
        bpy.data.objects.remove(obj)
    return img


def board(root, rect, z0, thickness, mask_hex, px, items, holes=(), radius=0.5, rough=0.4):
    """devicekit.board with this file's stacked decal: a slab with rounded corners and drilled
    holes ((cx, cy, diameter)), its top carrying the legend. Returns (object, top z, legend image)."""
    x0, y0, x1, y1 = rect
    top = z0 + thickness
    m = kit.Mesh()
    m.slab(
        kit.rounded_rect(x0, y0, x1, y1, radius),
        [kit.circle(cx, cy, d / 2, 16) for cx, cy, d in holes],
        z0,
        top,
        kit.material('pcb-edge', kit.FR4, Roughness=0.6),
        top_mat=kit.material('pcb-mask', mask_hex, Roughness=rough),
    )
    obj = m.to_object('pcb', root)
    img = decal('pcb-legend', rect, px, mask_hex, list(items))
    legend = kit.material('pcb-legend', mask_hex, Roughness=rough)
    kit.textured(legend, img)
    kit.mark_top(obj, rect, top, legend)
    return obj, top, img


def planar(obj, rect, mat, pick):
    """Give obj's faces for which pick(face) holds the material mat and UVs that run over rect seen
    from above, as decal() maps it; the other faces keep theirs. A part's top can so show what the
    board's legend draws under it (the resistor's code, the transducers' mesh)."""
    me = obj.data
    if mat not in list(me.materials):
        me.materials.append(mat)
    slot = list(me.materials).index(mat)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    uv = bm.loops.layers.uv.verify()
    x0, y0, x1, y1 = rect
    for f in bm.faces:
        if not pick(f):
            continue
        f.material_index = slot
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))
    bm.to_mesh(me)
    bm.free()


def outline(x0, y0, x1, y1, w, ink=SILK):
    """A silkscreen rectangle's four strokes, w wide, as decal boxes."""
    return [
        ('box', x0, y0, x1, y0 + w, ink),
        ('box', x0, y1 - w, x1, y1, ink),
        ('box', x0, y0, x0 + w, y1, ink),
        ('box', x1 - w, y0, x1, y1, ink),
    ]


def place(m, rotation, offset):
    """Turn everything built in m so far by the 3x3 rotation, then move it by offset."""
    m.transform(rotation)
    bmesh.ops.translate(m.bm, vec=Vector(offset), verts=m.bm.verts)


# --- Shared parts ----------------------------------------------------------------------------------


def right_angle_header(root, pins, hole_y, board_z, thickness, face, tip_y):
    """A right-angle male header at the -y edge of a board. pins is [(pin id, x)]. The black base sits
    on the board's `face` ('top' or 'bottom') centred on the holes at hole_y; each pin stands through
    it, bends over its far side and runs along -y to tip_y, and its other end pokes out of the
    opposite face. Makes the object "pins" and an empty at each tip pointing along -y, where a female
    housing slides on."""
    m = kit.Mesh()
    top = board_z + thickness
    up = 1 if face == 'top' else -1
    base0 = top if up > 0 else board_z
    base1 = base0 + up * mp.BASE_H
    xs = [x for _, x in pins]
    z_lo, z_hi = sorted((base0, base1))
    m.box((min(xs) - PITCH / 2, hole_y - 1.25, z_lo), (max(xs) + PITCH / 2, hole_y + 1.25, z_hi), mp.black_plastic())
    h = kit.LEG / 2
    axis = base1 + up * (h + 0.1)  # the bent pin rests just clear of the base
    metal = mp.tin()
    for pid, x in pins:
        if up > 0:
            a, b = board_z - mp.TAIL, axis + h
        else:
            a, b = axis - h, top + 0.5
            # The tail's solder fillet on the front.
            m.disc((x, hole_y), 0.75, top, top + 0.55, metal, n=10, r_top=0.32)
        m.box((x - h, hole_y - h, a), (x + h, hole_y + h, b), metal)
        m.box((x - h, tip_y, axis - h), (x + h, hole_y + h, axis + h), metal)
        kit.pin_empty(root, pid, (x, tip_y, axis), (0, -1, 0))
    return m.to_object('pins', root)


def straight_header(root, pins, board_top):
    """A straight male header standing on a board's top, tinned pins up: pins is [(pin id, (x, y))]
    in a row along x. Makes "pins" and an empty at each tip, +z up."""
    m = kit.Mesh()
    tips = kit.header(m, root, pins, mp.black_plastic(), mp.tin(), board_top, base_h=mp.BASE_H,
                      above=mp.ABOVE, tail=mp.TAIL)
    for pid, at in tips:
        kit.pin_empty(root, pid, at, (0, 0, 1))
    return m.to_object('pins', root)


def chip_under(m, cx, cy, z, bx, by, h, n, pitch, along='x'):
    """A small-outline chip hanging under a board whose underside is at z: body bx by by (bx along
    `along`), h deep, with n gull-wing leads on each long side against the board."""
    lx, ly = (bx, by) if along == 'x' else (by, bx)
    m.box((cx - lx / 2, cy - ly / 2, z - h), (cx + lx / 2, cy + ly / 2, z), mp.epoxy())
    for side in (-1, 1):
        for i in range(n):
            t = (i - (n - 1) / 2) * pitch
            if along == 'x':
                e = cy + side * ly / 2
                a, b = sorted((e - side * 0.1, e + side * 0.75))
                m.box((cx + t - 0.2, a, z - 0.22), (cx + t + 0.2, b, z), mp.tin())
            else:
                e = cx + side * lx / 2
                a, b = sorted((e - side * 0.1, e + side * 0.75))
                m.box((a, cy + t - 0.2, z - 0.22), (b, cy + t + 0.2, z), mp.tin())


def passive_under(m, cx, cy, z, kind, along='x', size=(1.6, 0.8, 0.5)):
    """A chip resistor ('r', black) or ceramic capacitor ('c', tan) under a board whose underside is
    at z, with tinned end caps."""
    body = (kit.material('smd-resistor', '1c1c1d', Roughness=0.6) if kind == 'r'
            else kit.material('smd-ceramic', 'a8916a', Roughness=0.55))
    length, width, height = size
    lx, ly = (length, width) if along == 'x' else (width, length)
    m.box((cx - lx / 2, cy - ly / 2, z - height), (cx + lx / 2, cy + ly / 2, z), body)
    cap = length * 0.2
    for s in (-1, 1):
        if along == 'x':
            a, b = sorted((cx + s * lx / 2, cx + s * (lx / 2 - cap)))
            m.box((a - 0.01 * s, cy - ly / 2 - 0.01, z - height - 0.01), (b, cy + ly / 2 + 0.01, z), mp.tin())
        else:
            a, b = sorted((cy + s * ly / 2, cy + s * (ly / 2 - cap)))
            m.box((cx - lx / 2 - 0.01, a - 0.01 * s, z - height - 0.01), (cx + lx / 2 + 0.01, b, z), mp.tin())


def joint(m, x, y, z):
    """A soldered lead's end on a board face at z: a small tinned cone."""
    m.disc((x, y), 0.55, z, z + 0.5, mp.tin(), n=8, r_top=0.2)


# --- DHT11 -------------------------------------------------------------------------------------------

DHT_BLUE = '3aa6da'
# The housing's vents, read off SunFounder's photo of the module (sensor 15.5 x 12 mm): measured
# standing up, z from the leg end and x across the face from its middle.
DHT_HOLES_X = (-2.2, 0.0, 2.2)  # three columns of square vents, 1.1 mm square
DHT_HOLES_Z = (2.7, 5.2, 7.6, 9.95, 12.4)  # five rows
DHT_SIDE_Z = (2.7, 7.6, 9.95)  # slots open to both sides, 1.0 wide and 1.8 deep
DHT_TOP_X = (-2.2, 0.0, 2.2)  # notches in the top end, 1.0 wide and 1.3 deep
DHT_PLATE = 1.0  # the grille's thickness


def dht_sensor(w, t, h, rotation, offset):
    """The DHT11 housing, built standing (x across its 12 mm face, the grille facing -y, z up from
    the leg end, centred on x = y = 0) and then turned by rotation and moved by offset. Returns
    (case mesh, grille mesh): the grille is the perforated front plate, the case the body behind it,
    dark where the vents show through, with the two slots in its back."""
    blue = kit.material('dht-blue', DHT_BLUE, Roughness=0.55)
    dark = kit.material('dht-cavity', '23272b', Roughness=0.8)
    yf = -t / 2

    # The plate, drawn on its face (X across, Y up the face, Z out of it) and stood up.
    ring = [(-w / 2, 0), (w / 2, 0)]
    for zc in DHT_SIDE_Z:
        ring += [(w / 2, zc - 0.5), (w / 2 - 1.8, zc - 0.5), (w / 2 - 1.8, zc + 0.5), (w / 2, zc + 0.5)]
    ring.append((w / 2, h))
    for xc in reversed(DHT_TOP_X):
        ring += [(xc + 0.5, h), (xc + 0.5, h - 1.3), (xc - 0.5, h - 1.3), (xc - 0.5, h)]
    ring.append((-w / 2, h))
    for zc in reversed(DHT_SIDE_Z):
        ring += [(-w / 2, zc + 0.5), (-w / 2 + 1.8, zc + 0.5), (-w / 2 + 1.8, zc - 0.5), (-w / 2, zc - 0.5)]
    s = 0.55
    holes = [kit.rounded_rect(x - s, z - s, x + s, z + s, 0) for x in DHT_HOLES_X for z in DHT_HOLES_Z]
    grille = kit.Mesh()
    grille.slab(ring, holes, 0, DHT_PLATE, blue)
    # Face frame (X, Y, Z) to standing (x, y, z) = (X, yf + plate - Z, Y).
    place(grille, Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0))), (0, yf + DHT_PLATE, 0))
    place(grille, rotation, offset)

    case = kit.Mesh()
    case.box((-w / 2, yf + DHT_PLATE, 0), (w / 2, t / 2, h), blue)
    # Behind the vents: the sensing board, dark, just inside the plate.
    yd = yf + DHT_PLATE - 0.04
    case.quad((-w / 2 + 0.3, yd, 0.3), (w / 2 - 0.3, yd, 0.3), (w / 2 - 0.3, yd, h - 0.3), (-w / 2 + 0.3, yd, h - 0.3), dark)
    # The back's two long slots (Aosong drawing, rear view).
    for xc in (-1.6, 1.6):
        yb = t / 2 + 0.01
        case.quad((xc + 0.6, yb, 3.5), (xc - 0.6, yb, 3.5), (xc - 0.6, yb, 12.0), (xc + 0.6, yb, 12.0), dark)
    place(case, rotation, offset)
    return case, grille


def dht11_module(root, part, args):
    """The kit's breakout (SunFounder photo): a black board, the sensor lying on it grille up with its
    top end past the far edge and its legs bent down into the board, R1 (10 k, "103") beside them,
    two mounting holes under the sensor's corners, and a right-angle header with S and - printed at
    its ends."""
    G = part['geometry']['params']
    L, W = G['boardLengthApproxMm'], G['boardWidthApproxMm']
    over = G['sensorOverhangApproxMm']
    sw, st, sl = G['sensorWidthMm'], G['sensorThicknessMm'], G['sensorLengthMm']
    z0, thick = mp.TAIL, 1.6
    top = z0 + thick
    cx = L / 2
    hole_y = 1.1  # the header's row of holes
    pad_y = 4.5  # where the sensor's legs go into the board
    end_y = W + over - sl  # the sensor's leg end
    legs = [cx + (i - 1.5) * PITCH for i in range(4)]
    r1 = (1.6, 4.0)  # R1, along y
    items = [
        *outline(legs[0] - 1.5, pad_y - 1.2, legs[-1] + 1.5, pad_y + 1.0, 0.18),
        *[('ring', x, pad_y, 0.75, 0, TIN) for x in legs],
        *outline(r1[0] - 0.95, r1[1] - 1.35, r1[0] + 0.95, r1[1] + 1.35, 0.15),
        ('box', r1[0] - 0.62, r1[1] - 0.6, r1[0] + 0.62, r1[1] + 0.6, '1c1c1d'),
        ('text', '103', r1[0], r1[1], 0.55, 'e8e8e8', 90, 'CENTER'),
        kit.label('R1', r1[0], r1[1] + 2.3, 0.9, 90),
        kit.label('S', 2.3, 1.0, 1.3),
        ('box', L - 2.9, 0.88, L - 1.7, 1.12, SILK),  # "-"
    ]
    holes = [(1.6, W - 2.0, 2.4), (L - 1.6, W - 2.0, 2.4)]
    pcb, top, img = board(root, (0, 0, L, W), z0, thick, '131417', args.px, items, holes=holes, radius=0.3, rough=0.35)

    gap = 0.2  # the sensor's back above the board
    lying = Matrix.Rotation(-math.pi / 2, 3, 'X')  # standing (x, y, z) to lying (x, z, -y)
    case, grille = dht_sensor(sw, st, sl, lying, (cx, end_y, top + gap + st / 2))
    sensor = case.to_object('sensor', root)
    vents = grille.to_object('grille', root)

    c = kit.Mesh()
    # The legs: out of the sensor's end at mid-thickness, down through the board.
    lz = top + gap + st / 2
    for x in legs:
        c.box((x - 0.25, pad_y - 0.25, z0 - 1.0), (x + 0.25, pad_y + 0.25, lz + 0.2), mp.tin())
        c.box((x - 0.25, pad_y - 0.25, lz - 0.2), (x + 0.25, end_y + 0.3, lz + 0.2), mp.tin())
        joint(c, x, pad_y, top)
    mp.resistor(c, r1[0], r1[1], top, size=(2.0, 1.25, 0.5), along='y')
    smd = c.to_object('smd', root)
    marking = kit.material('r1-code', '1c1c1d', Roughness=0.5)
    kit.textured(marking, img)
    planar(smd, (0, 0, L, W), marking,
           lambda f: f.normal.z > 0.99 and abs(f.calc_center_median().z - (top + 0.5)) < 1e-4
           and abs(f.calc_center_median().x - r1[0]) < 0.7)

    pins = [(p['id'], cx + (p['offsetPitch'][0] - 1) * PITCH) for p in part['pins']]
    pin_obj = right_angle_header(root, pins, hole_y, z0, thick, 'top', hole_y - 1.25 - 6.0)
    return [('body', [pcb, sensor, vents, smd]), ('pins', [pin_obj])]


def dht11_bare(root, part, args):
    """The bare 4-pin sensor (Aosong drawing), standing on its legs 2.0 mm above the board: origin at
    pin VDD's hole, the grille facing -y. The legs are the runtime's."""
    G = part['geometry']['params']
    w, t, h = G['bodyWidthMm'], G['bodyThicknessMm'], G['bodyHeightMm']
    pins = part['pins']
    px = [p['offsetPitch'][0] * PITCH for p in pins]
    cx = (min(px) + max(px)) / 2
    z0 = 2.0  # the housing's underside above the board
    case, grille = dht_sensor(w, t, h, Matrix.Identity(3), (cx, 0, z0))
    body = case.to_object('case', root)
    vents = grille.to_object('grille', root)
    for pin, x in zip(pins, px):
        kit.pin_empty(root, pin['id'], (x, 0, z0), (0, 0, -1))
    return [('body', [body, vents])]


# --- HC-SR04 ------------------------------------------------------------------------------------------


def hc_sr04(root, part, args):
    """The Elecfreaks module (datasheet, Cytron manual drawing, Adafruit's photos): a blue board with
    two aluminium transducer cans whose mesh fronts face up, the 4 MHz HC-49/S crystal between them
    at the top edge, the legend (HC-SR04, T, R, the pin names), and on the back the three
    small-outline chips, their passives and a right-angle header whose pins leave the bottom edge."""
    G = part['geometry']['params']
    L, W, height = G['boardLengthMm'], G['boardWidthMm'], G['heightMm']
    d, spacing = G['transducerDiameterApproxMm'], G['transducerCentreSpacingApproxMm']
    thick = 1.6
    # The module rests on the header's pins, bent under its base on the back.
    z0 = mp.BASE_H + 0.1 + kit.LEG
    top = z0 + thick
    cx = L / 2
    can_y = 8.3  # the cans' centres, from the header's edge (Adafruit photo)
    can_h = height - 1.55 - thick  # from the board to the rims: the chips under it make up the rest
    r_open = d / 2 - 1.4  # the mesh's opening inside the rolled rim
    hole_y = 1.05
    pin_x = [cx + (p['offsetPitch'][0] - 1.5) * PITCH for p in part['pins']]
    holes = [(x, y, 1.0) for x in (1.4, L - 1.4) for y in (1.6, W - 1.6)]
    trace = '2e7bd0'

    items = [
        # Copper under the mask, as it shows in the photos.
        ('box', cx - 0.15, 4.6, cx + 0.15, 11.6, trace),
        ('box', cx - 6.0, 15.9, cx - 3.2, 16.2, trace),
        ('box', cx + 3.2, 15.9, cx + 6.0, 16.2, trace),
        ('box', pin_x[0] - 0.15, 1.8, pin_x[0] + 0.15, 2.6, trace),
        ('box', pin_x[3] - 0.15, 1.8, pin_x[3] + 0.15, 2.6, trace),
        ('box', cx + 5.5, 1.2, cx + 7.5, 1.5, trace),
        *[('ring', x, y, 1.0, 0, TIN) for x, y, _ in holes],
        *[('ring', x, hole_y, 0.8, 0, TIN) for x in pin_x],
        kit.label('HC-SR04', cx, 12.9, 1.55),
        kit.label('T', 1.8, 4.6, 1.7),
        kit.label('R', L - 1.8, 4.6, 1.7),
        *[kit.label(p['label'], x, 2.2, 0.95, 90, 'LEFT') for p, x in zip(part['pins'], pin_x)],
    ]
    # Each can's front: the dark cavity, its paler cone and the woven mesh over them.
    for sx in (-1, 1):
        c = (cx + sx * spacing / 2, can_y)
        items += [
            ('ring', *c, r_open + 0.05, 0, '222427'),
            ('ring', *c, 4.4, 2.3, '3a3e42'),
            ('ring', *c, 1.3, 0, '585d62'),
        ]
        pitch, wire = 0.45, 0.13
        k = 0
        while (off := (k + 0.5) * pitch) < r_open:
            half = math.sqrt(r_open * r_open - off * off)
            for o in (-off, off):
                items.append(('box', c[0] + o - wire / 2, c[1] - half, c[0] + o + wire / 2, c[1] + half, '767c82'))
                items.append(('box', c[0] - half, c[1] + o - wire / 2, c[0] + half, c[1] + o + wire / 2, '767c82'))
            k += 1
    pcb, top, img = board(root, (0, 0, L, W), z0, thick, '2470c4', args.px, items, holes=holes, radius=0.5)

    m = kit.Mesh()
    metal = kit.material('can-metal', 'd2d5d8', Metallic=1.0, Roughness=0.36)
    inner = kit.material('can-inner', '8a8e93', Metallic=1.0, Roughness=0.5)
    R, H = d / 2, can_h
    profile = [(R, 0), (R, H - 0.5), (R - 0.12, H - 0.15), (R - 0.4, H), (r_open + 0.35, H),
               (r_open + 0.1, H - 0.15), (r_open, H - 0.7), (0, H - 0.7)]
    for sx in (-1, 1):
        m.lathe(profile, [metal, metal, metal, metal, metal, inner, metal], segs=40,
                at=(cx + sx * spacing / 2, can_y, top))
    # Y1, an HC-49/S crystal: a flat nickel can on its base flange.
    xy = (cx, W - 3.0)
    m.extrude(kit.rounded_rect(xy[0] - 5.52, xy[1] - 2.32, xy[0] + 5.52, xy[1] + 2.32, 2.3, 6), top, top + 0.35,
              kit.material('crystal', 'd3d6d9', Metallic=1.0, Roughness=0.34))
    m.extrude(kit.rounded_rect(xy[0] - 5.25, xy[1] - 2.0, xy[0] + 5.25, xy[1] + 2.0, 1.98, 6), top + 0.35, top + 3.5,
              kit.material('crystal', 'd3d6d9', Metallic=1.0, Roughness=0.34))
    cans = m.to_object('transducers', root)
    mesh = kit.material('can-mesh', '2a2d31', Metallic=0.6, Roughness=0.55)
    kit.textured(mesh, img)
    planar(cans, (0, 0, L, W), mesh,
           lambda f: f.normal.z > 0.99 and abs(f.calc_center_median().z - (top + H - 0.7)) < 1e-4)

    # The back: U1 and U2 (14 leads), U3 (16, across), and the passives around them (Adafruit photo,
    # seen from the back, so mirrored in x).
    b = kit.Mesh()
    chip_under(b, 40.4, 10.0, z0, 8.65, 3.9, 1.5, 7, 1.27)
    chip_under(b, 22.5, 10.0, z0, 8.65, 3.9, 1.5, 7, 1.27)
    chip_under(b, 4.5, 10.2, z0, 9.9, 3.9, 1.5, 8, 1.27, along='y')
    for i, y in enumerate((16.2, 14.6, 13.0, 11.4, 9.8, 8.2, 6.6)):
        passive_under(b, 30.0, y, z0, 'rc'[i % 2])
        passive_under(b, 15.0, y, z0, 'cr'[i % 2])
    for x, y, kind in ((42.0, 17.5, 'r'), (38.5, 17.5, 'r'), (35.0, 17.5, 'c'), (42.5, 4.0, 'r'),
                       (39.0, 3.5, 'c'), (35.5, 3.5, 'r'), (8.5, 17.5, 'r'), (8.5, 3.0, 'r'), (5.0, 3.0, 'c')):
        passive_under(b, x, y, z0, kind)
    back = b.to_object('back', root)

    pins = [(p['id'], x) for p, x in zip(part['pins'], pin_x)]
    pin_obj = right_angle_header(root, pins, hole_y, z0, thick, 'bottom', hole_y - 1.25 - 6.0)
    return [('body', [pcb, cans, back]), ('pins', [pin_obj])]


# --- HC-SR501 -----------------------------------------------------------------------------------------


def fresnel_dome(m, c, z0, r, mat, spacing=5.6, bulge=0.5, gap=0.07):
    """The lens's dome on z0: a smooth half-sphere just inside, and over it the Fresnel facets, a
    honeycomb of hexagons laid over the sphere (their centres spacing mm of arc apart, from the top),
    each a shallow cushion with a groove round it."""
    kit.dome(m, c, r - 0.12, r - 0.12, r - 0.12, z0, mat, n=36, rings=9)
    s = spacing / math.sqrt(3)  # a hexagon's circumradius
    reach = r * math.pi / 2  # arc length from the top to the rim

    def on_dome(px, py, lift=0.0):
        rho = math.hypot(px, py)
        theta = min(rho / r, math.pi / 2)
        phi = math.atan2(py, px)
        rr = r + lift
        return (c[0] + rr * math.sin(theta) * math.cos(phi), c[1] + rr * math.sin(theta) * math.sin(phi),
                z0 + rr * math.cos(theta))

    n = int(reach / spacing) + 2
    for q in range(-n, n + 1):
        for k in range(-n, n + 1):
            hx = spacing * (q + k / 2)
            hy = spacing * k * math.sqrt(3) / 2
            if math.hypot(hx, hy) > reach - 0.6:
                continue
            centre = m._verts([on_dome(hx, hy, bulge)])[0]
            ring = m._verts([
                on_dome(hx + (s - gap) * math.cos(math.radians(30 + 60 * j)),
                        hy + (s - gap) * math.sin(math.radians(30 + 60 * j)))
                for j in range(6)
            ])
            for j in range(6):
                m._face([centre, ring[j], ring[(j + 1) % 6]], mat)


def hc_sr501(root, part, args):
    """The module as SunFounder and AZ-Delivery photograph it: a blue board, lens up. On the lens
    side the white Fresnel dome on its square base, and at the ends the mounting holes and the
    soldered leads of what is underneath. On the component side the two side-adjust trimmers (delay
    and distance, orange rotors facing out of the long edge), the H/L jumper with its yellow cap, the
    BISS0001, the regulator, the electrolytic capacitors hanging at the corners and the passives.
    The 32 mm runs along y here, so that the header (moved to the lens side) has a free end to
    stand on: its pins run along x, at the end beside a mounting hole."""
    G = part['geometry']['params']
    L, W = G['boardLengthMm'], G['boardWidthMm']  # 32 along y, 24 along x
    lens_r = G['lensDiameterMm'] / 2
    thick = 1.6
    below = 6.5  # what hangs under the board: the capacitors and the jumper
    z0 = below
    top = z0 + thick
    holes = [(W / 2, (L - G['mountingHoleSpacingMm']) / 2, 2.2), (W / 2, (L + G['mountingHoleSpacingMm']) / 2, 2.2)]
    pin_y = 2.0
    pin_x = [14.6 + PITCH * p['offsetPitch'][0] for p in part['pins']]  # clear of the hole and a lead

    # Where the component side's leaded parts come through to the lens side (x, y).
    caps = [(W - 2.1, 2.1), (W - 2.1, L - 2.1), (2.1, 7.5), (2.1, L - 2.1)]
    jumper = [(2.1 + PITCH * i - 0.54, 2.1) for i in range(3)]
    through = [*jumper, *[(x, y + s * 0.75) for x, y in caps for s in (-1, 1)]]
    items = [
        *[('ring', x, y, 1.8, 0, TIN) for x, y, _ in holes],
        *[('ring', x, y, 0.8, 0, TIN) for x, y in through],
    ]
    pcb, top, _ = board(root, (0, 0, W, L), z0, thick, '1f3f97', args.px, items, holes=holes, radius=0.8)

    # The lens: a square base (the board's width) and the dome on it.
    white = kit.material('lens', 'e8edee', Roughness=0.32)
    base_w, base_h = W - 0.2, 5.0
    # The crown stands heightMm above the lowest point, the capacitors' ends at z = 0.
    dome_r = min(lens_r, G['heightMm'] - (top + base_h))
    lm = kit.Mesh()
    lo, hi = (W - base_w) / 2, (W + base_w) / 2
    ring = lambda inset, z: [(x, y + (L - W) / 2, z) for x, y in kit.rounded_rect(lo + inset, lo + inset, hi - inset, hi - inset, 1.2 - inset, 3)]
    lm.loft(ring(0, top), ring(0.35, top + base_h), white)
    fresnel_dome(lm, (W / 2, L / 2), top + base_h, dome_r, white)
    lens = lm.to_object('lens', root)

    # The lens side: the solder joints at the ends.
    j = kit.Mesh()
    for x, y in through:
        joint(j, x, y, top)
    joints = j.to_object('joints', root)

    # The component side, under the board.
    b = kit.Mesh()
    sleeve = kit.material('cap-sleeve', '18191b', Roughness=0.45)
    stripe = kit.material('cap-stripe', '8d9196', Roughness=0.5)
    alu = kit.material('cap-end', 'b9bcc0', Metallic=1.0, Roughness=0.35)
    for x, y in caps:
        b.disc((x, y), 2.0, z0 - below + 0.25, z0 - 0.3, sleeve, n=20)
        b.arc_strip(2.01, z0 - below + 0.4, z0 - 0.4, math.radians(150), math.radians(210), stripe, segs=3, at=(x, y))
        b.disc((x, y), 1.75, z0 - below, z0 - below + 0.25, alu, n=20)
    # The two trimmers: a black body in a tinned frame, the orange rotor out of the x = 0 edge.
    frame = kit.material('trimmer-frame', 'c3c6ca', Metallic=1.0, Roughness=0.35)
    rotor = kit.material('trimmer', 'f08a24', Roughness=0.45)
    slot = kit.material('trimmer-slot', '7a3a08', Roughness=0.6)
    for y in (14.0, 22.1):
        b.box((1.0, y - 3.2, z0 - 4.6), (5.6, y + 3.2, z0), mp.black_plastic())
        b.box((0.7, y - 3.3, z0 - 4.7), (1.0, y + 3.3, z0), frame)
        zc = z0 - 2.5
        b.tube((0.9, y, zc), (-0.3, y, zc), 2.0, rotor, n=20)
        b.box((-0.32, y - 1.4, zc - 0.25), (-0.22, y + 1.4, zc + 0.25), slot)
        b.box((-0.32, y - 0.25, zc - 1.4), (-0.22, y + 0.25, zc + 1.4), slot)
    # J1: three pins in a base, the yellow cap on the two nearest the edge (H, the default).
    xs = [x for x, _ in jumper]
    b.box((min(xs) - 1.27, 2.1 - 1.25, z0 - 2.5), (max(xs) + 1.27, 2.1 + 1.25, z0), mp.black_plastic())
    b.box((xs[0] - 1.25, 2.1 - 1.2, z0 - below), (xs[1] + 1.25, 2.1 + 1.2, z0 - 2.5),
          kit.material('jumper', 'f2c230', Roughness=0.5))
    b.box((xs[2] - 0.32, 2.1 - 0.32, z0 - below + 1.0), (xs[2] + 0.32, 2.1 + 0.32, z0 - 2.5), mp.tin())
    # The BISS0001 (SOIC-16), the 7133 regulator (SOT-89), the diode and the passives.
    chip_under(b, 14.9, 6.9, z0, 9.9, 3.9, 1.5, 8, 1.27)
    b.box((13.7, 24.2, z0 - 1.5), (18.2, 26.7, z0), mp.epoxy())
    b.box((15.2, 26.7, z0 - 0.4), (16.7, 27.6, z0), mp.tin())
    for x in (14.0, 15.95, 17.9):
        b.box((x - 0.25, 23.4, z0 - 0.4), (x + 0.25, 24.2, z0), mp.tin())
    b.tube((21.7, 21.6, z0 - 0.8), (21.7, 25.2, z0 - 0.8), 0.8, kit.material('diode-glass', '9b3a2e', Roughness=0.25), n=10)
    b.tube((21.7, 21.6, z0 - 0.8), (21.7, 22.2, z0 - 0.8), 0.82, kit.material('diode-band', '161617', Roughness=0.4), n=10)
    for x, y, kind, along in ((8.0, 12.0, 'r', 'x'), (9.0, 15.0, 'c', 'y'), (12.5, 19.2, 'r', 'x'),
                              (16.5, 13.0, 'r', 'y'), (19.0, 17.0, 'c', 'x'), (20.5, 11.5, 'r', 'y'),
                              (8.5, 20.0, 'c', 'x'), (12.5, 22.0, 'r', 'x'), (17.5, 20.5, 'r', 'x'),
                              (19.5, 27.5, 'c', 'x'), (9.5, 27.0, 'r', 'y'), (7.0, 16.5, 'r', 'y'),
                              (21.0, 5.5, 'r', 'x'), (8.5, 4.4, 'c', 'x')):
        passive_under(b, x, y, z0, kind, along, size=(2.0, 1.25, 0.55))
    for dx, dy in ((-1.27, -0.73), (1.27, -0.73), (0.0, 1.47)):  # the PIR sensor's three leads
        joint(b, W / 2 + dx, L / 2 + dy, z0 - 0.5)
    under = b.to_object('components', root)

    pins = [(p['id'], (x, pin_y)) for p, x in zip(part['pins'], pin_x)]
    pin_obj = straight_header(root, pins, top)
    return [('body', [pcb, lens, joints, under]), ('pins', [pin_obj])]
