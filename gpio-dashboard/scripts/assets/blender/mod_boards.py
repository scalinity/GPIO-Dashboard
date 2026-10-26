"""The board and cabled modules: the MB102 breadboard power supply, the 5 V relay module, the KY-023
joystick, the 4x4 membrane keypad, the LCD1602 with its I2C backpack, and the SG90 servo. Each
build() draws one variant into root and returns [(collider name, [objects])]; see module.py for the
frame and sensors' notes in mod_sensors.py for how the headers sit.

Modules with a header lie on its pin tails with the pins up, or out of the board's edge where the
real board has a right-angle header (the relay, the joystick). The LCD lies face up on its
backpack, whose right-angle header points its pins out past the module's left end, as on the real
board. The keypad and the servo end in a female housing on a cable or tail; it lies flat on the
table with its socket openings facing along the cable, away from the module, and its pin empties
point out of the openings.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402
import modparts as mp  # noqa: E402
from lib import bake, materials, scene  # noqa: E402


def mounting_holes(L, W, span_x, span_y, d):
    """Four holes on a rectangle span_x by span_y centred on an L by W board."""
    cx, cy = L / 2, W / 2
    return [(cx + sx * span_x / 2, cy + sy * span_y / 2, d) for sx in (-1, 1) for sy in (-1, 1)]


# --- What the power module, the relay and the joystick share --------------------------------------

BOARD_EDGE = '8f8775'  # a black board's cut edge: pale glass fibre between the two masks
NICKEL = 'c9cbcd'  # screws, plated shells and tinned pads


def _turn(items, rect):
    """Decal items laid out on a board, turned a quarter so the texture's u runs along the board's
    y: (x, y) goes to (y - y0, x1 - x), over (0, 0, y1 - y0, x1 - x0). Returns (items, rect)."""
    x0, y0, x1, y1 = rect
    out = []
    for item in items:
        if item[0] == 'text':
            _, body, x, y, h, ink, rot, align = item
            out.append(('text', body, y - y0, x1 - x, h, ink, rot - 90, align))
        elif item[0] == 'box':
            _, a, b, c, d, ink = item
            out.append(('box', b - y0, x1 - c, d - y0, x1 - a, ink))
        else:
            _, cx, cy, ro, ri, ink = item
            out.append(('ring', cy - y0, x1 - cx, ro, ri, ink))
    return out, (0, 0, y1 - y0, x1 - x0)


def _mark_top_turned(obj, rect, z, mat):
    """devicekit.mark_top with the texture's u along y and v along -x, as _turn() lays it out."""
    me = obj.data
    if mat not in list(me.materials):
        me.materials.append(mat)
    slot = list(me.materials).index(mat)
    uv = me.uv_layers.active or me.uv_layers.new(name='UVMap')
    x0, y0, x1, y1 = rect
    for poly in me.polygons:
        on = poly.normal.z > 0.99 and all(abs(me.vertices[i].co.z - z) < 1e-4 for i in poly.vertices)
        if on:
            poly.material_index = slot
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((co.y - y0) / (y1 - y0), (x1 - co.x) / (x1 - x0)) if on else (0, 0)


def _pcb(root, outline, holes, z0, mask_hex, px, items, turned=False, thickness=1.6):
    """A board of any outline (a counter-clockwise ring) with drilled holes (cx, cy, diameter): a
    glossy solder-mask top that carries the legend baked from decal items, and a pale cut edge.
    turned bakes the legend with u along y, for a board longer in y than its texture is high.
    Returns (object, z of the top face)."""
    top = z0 + thickness
    xs, ys = [p[0] for p in outline], [p[1] for p in outline]
    rect = (min(xs), min(ys), max(xs), max(ys))
    m = kit.Mesh()
    m.slab(outline, [kit.circle(cx, cy, d / 2, 14) for cx, cy, d in holes], z0, top,
           kit.material('board-edge', BOARD_EDGE, Roughness=0.7),
           top_mat=kit.material('board-mask', mask_hex, Roughness=0.32))
    obj = m.to_object('pcb', root)
    legend = kit.material('board-legend', mask_hex, Roughness=0.32)
    if turned:
        baked, area = _turn(items, rect)
        kit.textured(legend, kit.decal('pcb-legend', area, px, mask_hex, baked))
        _mark_top_turned(obj, rect, top, legend)
    else:
        kit.textured(legend, kit.decal('pcb-legend', rect, px, mask_hex, list(items)))
        kit.mark_top(obj, rect, top, legend)
    return obj, top


def _outline(x0, y0, x1, y1, w=0.15, ink=kit.SILK):
    """A silkscreen rectangle as four decal boxes."""
    return [('box', x0, y0, x1, y0 + w, ink), ('box', x0, y1 - w, x1, y1, ink),
            ('box', x0, y0, x0 + w, y1, ink), ('box', x1 - w, y0, x1, y1, ink)]


def _turned_box(m, c, half, z0, z1, mat, angle):
    """A box half[0] by half[1] (half sizes) about c = (x, y), turned by angle (degrees) about z."""
    a = math.radians(angle)
    ring = [
        (c[0] + math.cos(a) * u - math.sin(a) * v, c[1] + math.sin(a) * u + math.cos(a) * v)
        for u, v in ((-half[0], -half[1]), (half[0], -half[1]), (half[0], half[1]), (-half[0], half[1]))
    ]
    m.loft([(x, y, z0) for x, y in ring], [(x, y, z1) for x, y in ring], mat)


def _right_angle_header(m, root, pins, y_face, board_top, metal, length):
    """A right-angle male header lying on the board along x, its pins out along -y: the 2.5 mm
    plastic from y_face back, the pins level at its middle, turning down just behind it through the
    board to the tails the module rests on. pins is [(id, x)]; each gets its empty at the tip, +z
    along -y, where a female housing slides on."""
    h = kit.LEG / 2
    zc = board_top + kit.PITCH / 2
    xs = [x for _, x in pins]
    m.box((min(xs) - kit.PITCH / 2, y_face, board_top), (max(xs) + kit.PITCH / 2, y_face + 2.5, board_top + 2.5),
          mp.black_plastic(), taper=0.08)
    back = y_face + 2.5 + 0.3
    for pid, x in pins:
        m.box((x - h, y_face - length, zc - h), (x + h, back + h, zc + h), metal)
        m.box((x - h, back - h, board_top - 1.6 - mp.TAIL), (x + h, back + h, zc - h), metal)
        kit.pin_empty(root, pid, (x, y_face - length, zc), (0, -1, 0))


# --- The MB102 breadboard power supply ------------------------------------------------------------


def power_module(root, part, args):
    """SunFounder's black MB102 clone (its component photo 39_power_module.png, and the same board in
    the 45-in-1 kit's and Handson's photos), turned so the 2 x 4 output header J6 reads as its
    definition lays it out: the board as printed, its silkscreen upright, the USB-A socket J2 and the
    DC jack J1 at the +x edge facing out, the two ears with the rail pins at the -x edge.

    The 53 mm runs along y, across a breadboard's rails: each ear carries a 2-pin header underneath
    (- and +) for a rail pair, and a 1 x 4 jumper header with a yellow cap on its 3.3 V end selects
    that rail's voltage. Between them the push switch K1, the green power LED, two AMS1117
    regulators (U1 5.0 V, U2 3.3 V), the input diode D1, R1, C1 to C4. The board lies on the rail
    headers' plastic, their pins cut to the 1.5 mm tails other modules rest on."""
    G = part['geometry']['params']
    W, L = G['boardWidthMm'], G['boardLengthMm']
    pins = part['pins']
    z0 = mp.TAIL + mp.BASE_H  # the PCB's underside, on the rail headers' plastic
    yellow = kit.material('header-yellow', 'e3c552', Roughness=0.5)
    # The outline: a rectangle whose -x side steps out into an ear at each end, chamfered.
    outline = [(1.6, 0), (W, 0), (W, L), (1.6, L), (0, L - 1.8), (0, L - 6.3), (3.6, L - 9.4),
               (3.6, 9.4), (0, 6.3), (0, 1.8)]
    rails = [(3.85, y) for y in (2.9, 2.9 + kit.PITCH, L - 2.9 - kit.PITCH, L - 2.9)]  # -, +, -, +
    jumpers = [[1.49 + k * kit.PITCH for k in range(4)], [L - 9.71 + k * kit.PITCH for k in range(4)]]
    jx = 8.4
    first = pins[0]['offsetPitch']
    j6 = {p['id']: (7.48 + (p['offsetPitch'][0] - first[0]) * kit.PITCH, 35.59 + (p['offsetPitch'][1] - first[1]) * kit.PITCH)
          for p in pins}
    regs = [(17.33, 'AMS1117', '3.3  H716ME'), (25.15, 'AMS1117', '5.0  H730ME')]  # U2, U1
    ink, tin, dark = kit.SILK, NICKEL, '050506'

    items = [kit.label('Power', 24.7, 1.6, 1.3), kit.label('DC-in', 27.7, 51.8, 1.1),
             kit.label('GND', 11.3, 30.55, 1.1), kit.label('3.3V', 8.75, 39.4, 1.1), kit.label('5V', 13.83, 39.4, 1.1)]
    items += [kit.label(t, x, y, h, rotation=90) for t, x, y, h in (
        ('J2', 16.6, 10.5, 1.0), ('U2', 16.6, 12.8, 1.0), ('R1', 25.9, 21.7, 0.9), ('led1', 25.9, 26.9, 0.9),
        ('K1', 25.9, 30.3, 0.9), ('C4', 18.4, 28.3, 0.9), ('U1', 15.9, 28.7, 0.9), ('C3', 4.35, 17.44, 0.8),
        ('C2', 4.35, 21.46, 0.8), ('C1', 4.35, 25.49, 0.8), ('D1', 18.6, 35.7, 0.9), ('J1', 16.6, 42.0, 1.0))]
    for ys in jumpers:
        items += [kit.label(t, 11.0, (ys[k] + ys[k + 1]) / 2, 0.85, rotation=-90) for k, t in enumerate(('3.3', 'OFF', '5V'))]
    for (x, y), sign in zip(rails, '-+-+'):
        items += [('ring', x, y, 1.05, 0, tin), kit.label(sign, 1.5, y, 1.3)]
    for lo, hi in ((rails[0][1], rails[1][1]), (rails[2][1], rails[3][1])):
        items += _outline(2.55, lo - 1.4, 5.15, hi + 1.4)
        items += _outline(13.22, lo - 1.4, 15.82, hi + 1.4)  # the unused pair beside it
        items += [('ring', 14.52, y, 1.0, 0.45, tin) for y in (lo, hi)] + [('ring', 14.52, y, 0.45, 0, dark) for y in (lo, hi)]
    # J6's frame and the brackets under its 3.3 V and 5 V pairs.
    items += _outline(5.95, 31.55, 16.63, 37.1)
    for xa, xb in ((6.6, 10.9), (11.7, 16.0)):
        items += [('box', xa, 37.95, xb, 38.1, ink), ('box', xa, 37.4, xa + 0.15, 38.1, ink),
                  ('box', xb - 0.15, 37.4, xb, 38.1, ink)]
    # Pads under the surface-mount parts and their frames.
    for yc, _, _ in regs:
        items += [('box', 13.6, yc - 1.65, 16.6, yc + 1.65, tin)]
        items += [('box', 7.95, yl - 0.45, 9.4, yl + 0.45, tin) for yl in (yc - 2.3, yc, yc + 2.3)]
    for y in (17.44, 21.46, 25.49):
        items += _outline(5.0, y - 1.45, 7.2, y + 1.45)
        items += [('box', 5.4, y - 1.2, 6.8, y - 0.55, tin), ('box', 5.4, y + 0.55, 6.8, y + 1.2, tin)]
    items += _outline(19.65, 33.0, 22.6, 38.3) + [('box', 19.65, 33.6, 22.6, 33.8, ink)]
    items += [('box', 20.1, 33.2, 22.15, 34.0, tin), ('box', 20.1, 37.3, 22.15, 38.1, tin)]
    items += _outline(26.75, 20.75, 31.15, 22.45) + [('box', 27.2, 21.0, 27.9, 22.2, tin), ('box', 30.0, 21.0, 30.7, 22.2, tin)]
    items += [('ring', 29.87, 26.92, 2.25, 2.1, ink)]  # the LED's outline
    items += [('ring', x, y, 0.35, 0.15, tin) for x, y in ((18.2, 22.6), (8.0, 29.6), (24.0, 11.4), (5.3, 12.9))]
    pcb, top = _pcb(root, outline, [], z0, '141516', args.px, items, turned=True)

    m = kit.Mesh()
    steel = kit.material('nickel', NICKEL, Metallic=1.0, Roughness=0.3)
    black = kit.material('jack-black', '1e1f22', Roughness=0.55)
    shadow = kit.material('socket-dark', '0b0b0c', Roughness=0.8)
    # J2, the USB-A socket: a sheet-steel shell open at +x, the black tongue inside its upper half.
    for lo, hi in (((18.7, 5.75, top + 6.2), (32.9, 18.85, top + 6.6)), ((18.7, 5.75, top), (32.9, 18.85, top + 0.4)),
                   ((18.7, 5.75, top + 0.4), (32.9, 6.15, top + 6.2)), ((18.7, 18.45, top + 0.4), (32.9, 18.85, top + 6.2))):
        m.box(lo, hi, steel)
    m.box((22.9, 6.15, top + 0.4), (23.3, 18.45, top + 6.2), shadow)
    m.box((23.3, 7.0, top + 3.3), (31.6, 17.6, top + 5.2), black)
    for yc in (9.0, 11.0, 13.6, 15.6):
        m.box((25.0, yc - 0.5, top + 3.2), (31.4, yc + 0.5, top + 3.3), mp.gold())
    # J1, the 5.5 x 2.1 mm DC jack, its barrel at +x.
    m.box((19.8, 41.3, top), (33.4, 50.3, top + 11.0), black, taper=0.15)
    m.tube((33.39, 45.8, top + 6.3), (33.42, 45.8, top + 6.3), 3.15, shadow, n=20)
    m.tube((32.6, 45.8, top + 6.3), (33.43, 45.8, top + 6.3), 1.0, steel, n=10)
    # K1, the self-locking push switch, latched on.
    m.box((24.4, 31.4, top), (33.0, 40.0, top + 9.2), kit.material('switch-grey', 'a5a8ac', Roughness=0.5), taper=0.12)
    m.box((26.6, 33.6, top + 9.2), (30.8, 37.8, top + 12.2), kit.material('switch-button', 'ecebe6', Roughness=0.45), taper=0.1)
    # The green 3 mm power LED, standing on its leads.
    green = kit.material('led-green', '6fd24f', Roughness=0.25)
    for dx in (-1.27, 1.27):
        m.box((29.87 + dx - 0.25, 26.67, top), (29.87 + dx + 0.25, 27.17, top + 1.6), mp.tin())
    m.disc((29.87, 26.92), 1.95, top + 1.5, top + 2.5, green, n=16)
    m.disc((29.87, 26.92), 1.5, top + 2.5, top + 5.3, green, n=16)
    kit.dome(m, (29.87, 26.92), 1.5, 1.5, 1.5, top + 5.3, green, n=16, rings=3)
    # C4, a 5 mm surface-mount electrolytic: its can on a black seat, the minus marking on the top.
    m.box((19.59, 23.64, top), (24.89, 28.94, top + 0.9), mp.black_plastic())
    aluminium = kit.material('can-aluminium', 'c5c8cc', Metallic=0.8, Roughness=0.35)
    m.disc((22.24, 26.29), 2.5, top + 0.9, top + 5.8, aluminium, n=20)
    m.box((23.25, 25.2, top + 5.8), (24.35, 27.4, top + 5.82), black)
    # D1, R1, C1 to C3.
    m.box((20.0, 33.55, top), (22.25, 37.75, top + 2.0), mp.epoxy(), taper=0.12)
    m.box((20.2, 33.8, top + 2.0), (22.05, 34.3, top + 2.015), kit.material('band-grey', 'a7a9ad', Roughness=0.5))
    for y0 in (33.15, 37.7):
        m.box((20.25, y0, top), (22.0, y0 + 0.45, top + 0.25), mp.tin())
    mp.resistor(m, 28.94, 21.6, top)
    for y in (17.44, 21.46, 25.49):
        mp.capacitor(m, 6.1, y, top, along='y')
    # The jumper headers: four yellow-based pins, the cap on the two at the 3.3 V end.
    cap = kit.material('jumper-cap', 'e9b83a', Roughness=0.5)
    for ys in jumpers:
        m.box((jx - 1.27, ys[0] - 1.27, top), (jx + 1.27, ys[-1] + 1.27, top + mp.BASE_H), yellow)
        for y in ys[2:]:
            m.box((jx - 0.32, y - 0.32, z0), (jx + 0.32, y + 0.32, top + mp.BASE_H + mp.ABOVE), mp.gold())
        m.box((jx - 1.25, ys[0] - 1.25, top + mp.BASE_H), (jx + 1.25, ys[1] + 1.25, top + mp.BASE_H + 6.1), cap, taper=0.1)
        m.box((jx - 0.45, ys[0] - 0.3, top + mp.BASE_H + 6.1), (jx + 0.45, ys[1] + 0.3, top + mp.BASE_H + 6.12),
              kit.material('jumper-contact', '7a5a30', Metallic=0.6, Roughness=0.4))
    parts = m.to_object('components', root)

    # U1 and U2 (SOT-223), their tops marked.
    r = kit.Mesh()
    for yc, _, _ in regs:
        r.box((10.21, yc - 3.25, top + 0.1), (13.84, yc + 3.25, top + 1.7), mp.epoxy(), taper=0.08)
        r.box((13.0, yc - 1.5, top), (15.3, yc + 1.5, top + 0.28), mp.tin())
        for yl in (yc - 2.3, yc, yc + 2.3):
            r.box((8.6, yl - 0.35, top), (10.3, yl + 0.35, top + 0.28), mp.tin())
    reg = r.to_object('regulators', root)
    area = (10.25, regs[0][0] - 3.22, 13.8, regs[1][0] + 3.22)
    marks = []
    for yc, line1, line2 in regs:
        marks += [('text', line1, 12.75, yc, 0.55, 'b9bbbd', -90, 'CENTER'),
                  ('text', line2, 11.35, yc, 0.42, 'b9bbbd', -90, 'CENTER')]
    chip = kit.material('chip-top', '121213', Roughness=0.5)
    kit.textured(chip, kit.decal('chip-marks', area, [128, 512], '121213', marks))
    kit.mark_top(reg, area, top + 1.7, chip)

    # The pins: J6 on top, and the rail headers under the ears.
    p = kit.Mesh()
    for oy in sorted({q['offsetPitch'][1] for q in pins}):
        row = [(q['id'], j6[q['id']]) for q in pins if q['offsetPitch'][1] == oy]
        for pid, at in kit.header(p, root, row, yellow, mp.gold(), top, base_h=mp.BASE_H, above=mp.ABOVE, tail=mp.TAIL):
            kit.pin_empty(root, pid, at, (0, 0, 1))
    for k in (0, 2):
        (x, ya), (_, yb) = rails[k], rails[k + 1]
        p.box((x - 1.27, ya - 1.27, z0 - mp.BASE_H), (x + 1.27, yb + 1.27, z0), mp.black_plastic())
        for y in (ya, yb):
            p.box((x - 0.32, y - 0.32, 0.0), (x + 0.32, y + 0.32, top), mp.gold())
            p.box((x - 0.55, y - 0.55, top), (x + 0.55, y + 0.55, top + 0.35), mp.tin())
    pin_obj = p.to_object('pins', root)
    return [('body', [pcb, parts, reg]), ('pins', [pin_obj])]


# --- The 5 V relay module -------------------------------------------------------------------------


def relay_module(root, part, args):
    """The kit's relay module as SunFounder photographs it (Basic Starter Kit for Raspberry Pi,
    list_1.3.4.png; the same Keyes-style board as Botland's 8228): a black board, the blue Songle
    SRD-05VDC-SL-C in the middle with its printing, the blue 3-way 5 mm screw terminal block P2 at
    one end, wire entries out of the board's edge, and a right-angle 3-pin header at the other end,
    its pins out of the opposite edge. D2, the indicator, sits beside the header; D1, Q1 and R1 along
    the side.

    x runs across the board along the header row: S (beside D2, on the relay's and COM's centre
    line), +, -. y runs from the header's edge to the terminal block's. The header pins leave along
    -y; NC, COM and NO take a wire along +y, NC on S's side."""
    G = part['geometry']['params']
    W, L = G['boardWidthMm'], G['boardLengthMm']
    pins = part['pins']
    headers = [p for p in pins if p['connector'] == 'male-pin']
    sockets = [p for p in pins if p['connector'] == 'female-socket']
    pitch_t = G['screwTerminalPitchMm']
    rl, rw, rh = G['relayLengthMm'], G['relayWidthMm'], G['relayHeightMm']
    z0 = mp.TAIL
    sx = W / 2  # S
    face, reach = 0.9, 5.7  # the header's plastic face inside the edge; the pins beyond it
    tip = face - reach
    s0 = headers[0]['offsetPitch']
    # The terminals' entries, where the definition puts them from S: the block's face, at the far edge.
    entries = {p['id']: (sx + (p['offsetPitch'][0] - s0[0]) * pitch_t / 2, tip + (p['offsetPitch'][1] - s0[1]) * kit.PITCH)
               for p in sockets}
    t_face = min(y for _, y in entries.values()) - 0.02
    if not L - 0.6 < t_face <= L:
        raise RuntimeError(f'relay: the terminal block face at y {t_face:.2f} is not at the board edge {L}')
    txs = [x for x, _ in entries.values()]
    tx0, tx1 = min(txs) - pitch_t / 2, max(txs) + pitch_t / 2
    t_depth, t_rear, t_h = 7.6, 1.8, 10.0
    ty0 = t_face - t_depth
    rx0, rx1 = sx - rw / 2, sx + rw / 2
    ry1 = ty0 - 0.25
    ry0 = ry1 - rl

    # The board: P2, JK1 and the parts' names, the parts' pads and frames.
    ink, tin = kit.SILK, NICKEL
    items = [kit.label(t, x, y, h) for t, x, y, h in (
        ('P2', 21.7, 24.4, 1.0), ('JK1', 22.0, 17.6, 1.0), ('1', 19.3, 2.3, 0.9),
        ('D2', 7.95, 0.75, 0.75), ('D1', 3.6, 16.3, 0.8), ('Q1', 1.2, 14.4, 0.8), ('R1', 0.85, 7.8, 0.7))]
    items += [('box', 1.0, 17.6, 4.3, 17.75, ink), ('box', 1.0, 23.85, 4.3, 24.0, ink)]  # D1's brackets
    items += [('box', x, ya, x + 0.15, yb, ink) for x in (1.0, 4.15) for ya, yb in ((17.6, 18.9), (22.7, 24.0))]
    items += _outline(1.55, 6.45, 3.25, 9.15) + _outline(6.55, 1.45, 9.35, 3.45)
    items += [('box', 1.6, 18.2, 3.7, 19.2, tin), ('box', 1.6, 22.4, 3.7, 23.4, tin)]
    items += [('box', 1.85, 6.75, 2.95, 7.4, tin), ('box', 1.85, 8.2, 2.95, 8.85, tin)]
    items += [('box', 6.8, 1.95, 7.4, 2.95, tin), ('box', 8.5, 1.95, 9.1, 2.95, tin)]
    items += [('box', x - 0.45, y0, x + 0.45, y0 + 0.8, tin) for x, y0 in ((1.55, 11.1), (3.45, 11.1), (2.5, 12.95))]
    items += [('ring', x, y, 0.35, 0.15, tin) for x, y in ((0.9, 25.2), (0.9, 26.2), (21.3, 12.4))]
    holes = [(x, y, 3.0) for x in (2.1, W - 2.1) for y in (2.1, L - 2.1)]
    pcb, top = _pcb(root, kit.rounded_rect(0, 0, W, L, 0.5, n=2), holes, z0, '141516', args.px, items)

    # The Songle relay: its case with rounded edges, the top printed.
    c = kit.Mesh()
    c.box((rx0, ry0, top), (rx1, ry1, top + rh), kit.material('relay-case', '2a6cc4', Roughness=0.42))
    c.bevel(0.45, segments=2)
    relay = c.to_object('relay', root)
    white = 'eef3fa'

    def at(u, v):
        """A point on the top as the photo reads it: u along the relay from the terminal end, v
        across it from the far side."""
        return rx1 - v, ry1 - u

    def bar(u0, u1, v0, v1, hexa=white):
        (xa, yb), (xb, ya) = at(u0, v0), at(u1, v1)
        return ('box', xb, ya, xa, yb, hexa)

    def slanted(u0, u1, v0, v1, lean=0.6, n=6):
        """A bar whose ends lean: strips across it, each shifted along u."""
        h = (v1 - v0) / n
        return [bar(u0 + lean * (1 - (k + 0.5) / n), u1 + lean * (1 - (k + 0.5) / n), v0 + k * h, v0 + (k + 1) * h)
                for k in range(n)]

    def text(body, u, v, h):
        return ('text', body, *at(u, v), h, white, -90, 'CENTER')

    # Songle's logo, three leaning bars stepped like an S; the moulding's two dimples; the marks.
    printing = slanted(2.4, 7.3, 1.0, 1.85) + slanted(2.0, 6.9, 2.25, 3.1) + slanted(1.6, 6.5, 3.5, 4.35)
    printing += [('ring', *at(17.1, 1.7), 1.05, 0, '2560b4'), ('ring', *at(10.1, 7.65), 1.1, 0, '2560b4'),
                 ('ring', *at(2.9, 6.9), 1.5, 1.25, white), text('CQC', 2.9, 6.9, 0.7), text('\u25b3', 6.1, 6.8, 1.4),
                 text('c', 12.3, 7.2, 0.7), text('UR', 14.5, 6.75, 1.6), text('us', 16.8, 7.3, 0.7),
                 text('10A 250VAC  10A 125VAC', 9.55, 10.1, 0.92), text('10A  30VDC  10A  28VDC', 9.55, 11.85, 0.92),
                 text('SRD-05VDC-SL-C', 9.55, 13.75, 1.3)]
    rect = (rx0, ry0, rx1, ry1)
    top_mat = kit.material('relay-top', '2a6cc4', Roughness=0.42)
    kit.textured(top_mat, kit.decal('relay-top', rect, [512, 512], '2a6cc4', printing))
    kit.mark_top(relay, rect, top + rh, top_mat)

    # P2: the screw terminal block. A slab with three screw wells over the body, a lower step behind.
    blue = kit.material('terminal-blue', '2f8ee0', Roughness=0.5)
    floor = kit.material('terminal-well', '0e2a4a', Roughness=0.7)
    t = kit.Mesh()
    zw = top + t_h - 1.8  # the wells' floor, where the screw heads sit
    ring = [(tx0, ty0 + t_rear, top), (tx1, ty0 + t_rear, top), (tx1, t_face, top), (tx0, t_face, top)]
    t.loft(ring, [(x, y, zw) for x, y, _ in ring], blue, caps=(True, False))
    t.polygon([(x, y) for x, y, _ in ring], zw, floor)
    screw_y = t_face - 3.4
    t.slab(kit.rounded_rect(tx0, ty0 + t_rear, tx1, t_face, 0.3, n=2),
           [kit.circle(x, screw_y, 2.05, 16) for x in txs], zw, top + t_h, blue)
    t.box((tx0, ty0, top), (tx1, ty0 + t_rear, top + t_h - 2.0), blue)
    for x in txs:
        t.box((x - 0.45, ty0 + 0.45, top + t_h - 2.0), (x + 0.45, ty0 + 1.35, top + t_h - 1.98), floor)
    for k in range(1, len(txs)):
        x = tx0 + k * pitch_t
        t.box((x - 0.1, ty0 + t_rear, top + t_h), (x + 0.1, t_face, top + t_h + 0.02), floor)
    steel = kit.material('nickel', NICKEL, Metallic=1.0, Roughness=0.3)
    slot = kit.material('screw-slot', '3a3c40', Metallic=1.0, Roughness=0.5)
    for x, turn in zip(txs, (-25, 12, -40)):
        t.disc((x, screw_y), 1.75, zw, zw + 0.45, steel, n=16)
        _turned_box(t, (x, screw_y), (1.55, 0.22), zw + 0.45, zw + 0.47, slot, turn)
        _turned_box(t, (x, screw_y), (0.22, 0.85), zw + 0.45, zw + 0.47, slot, turn)
    # The small parts: D1 (SMA), Q1 (SOT-23), R1 (0805), and D2's white body.
    t.box((1.35, 18.65, top), (3.95, 22.95, top + 2.0), mp.epoxy(), taper=0.12)
    t.box((1.55, 21.9, top + 2.0), (3.75, 22.4, top + 2.015), kit.material('band-grey', 'a7a9ad', Roughness=0.5))
    for y0 in (18.25, 22.85):
        t.box((1.75, y0, top), (3.55, y0 + 0.5, top + 0.25), mp.tin())
    t.box((1.05, 11.75, top + 0.1), (3.95, 13.05, top + 1.0), mp.epoxy(), taper=0.05)
    for x, y0 in ((1.55, 11.25), (3.45, 11.25), (2.5, 13.0)):
        t.box((x - 0.2, y0, top), (x + 0.2, y0 + 0.55, top + 0.45), mp.tin())
    mp.resistor(t, 2.4, 7.8, top, along='y')
    t.box((6.95, 1.83, top), (8.95, 3.08, top + 0.35), kit.material('led-body', 'efeee8', Roughness=0.4))
    for x0 in (6.95, 8.65):
        t.box((x0, 1.83, top), (x0 + 0.3, 3.08, top + 0.37), mp.tin())
    parts = t.to_object('components', root)
    # D2's lens: a node the studio lights while the coil is driven.
    lm = kit.Mesh()
    lm.box((7.25, 1.95, top + 0.35), (8.65, 2.96, top + 0.8), kit.material('led-lens', 'f1e7e2', Roughness=0.2))
    lens = lm.to_object('lens', root)
    # The armature hinges inside the case; the opaque case hides it.
    pivot = kit.node(root, 'armature', (rx0 + 3.5, (ry0 + ry1) / 2, top + rh - 4.0))
    am = kit.Mesh()
    am.box((0.0, -3.0, -0.2), (rw - 7.0, 3.0, 0.2), kit.material('armature', 'a9acb1', Metallic=1.0, Roughness=0.35))
    am.to_object('armature-mesh', pivot)
    # The entries on the block's face: an opening per terminal with its clamp, the units' seams.
    width = tx1 - tx0
    # Decal items lie in one plane, so none of them overlaps another.
    face_items = []
    for x in txs:
        u = tx1 - x
        face_items += [('box', u - 1.6, 1.3, u - 1.35, 4.5, '060708'), ('box', u + 1.35, 1.3, u + 1.6, 4.5, '060708'),
                       ('box', u - 1.35, 4.3, u + 1.35, 4.5, '060708'), ('box', u - 1.35, 1.3, u + 1.35, 1.5, '060708'),
                       ('box', u - 1.35, 1.5, u + 1.35, 1.9, '6d7176'), ('box', u - 1.35, 1.9, u + 1.35, 3.4, '060708'),
                       ('box', u - 1.35, 3.4, u + 1.35, 4.3, '9fa3a8')]
    face_items += [('box', k * pitch_t - 0.12, 0, k * pitch_t + 0.12, t_h, '1c5d9c') for k in range(1, len(txs))]
    face_mat = kit.material('terminal-face', '2f8ee0', Roughness=0.5)
    kit.textured(face_mat, kit.decal('terminal-face', (0, 0, width, t_h), [256, 256], '2f8ee0', face_items))
    # Facing +y: u runs toward -x from the block's +x end, v up, and u x v = +y.
    panel = kit.panel(root, 'terminal-face', (tx1, t_face + 0.01, top), (-width, 0, 0), (0, 0, t_h), face_mat)

    pm = kit.Mesh()
    _right_angle_header(pm, root, [(p['id'], sx + (p['offsetPitch'][0] - s0[0]) * kit.PITCH) for p in headers],
                        face, top, mp.tin(), reach)
    pin_obj = pm.to_object('pins', root)
    for p in sockets:
        x, y = entries[p['id']]
        kit.pin_empty(root, p['id'], (x, y, top + 2.9), (0, 1, 0))
    return [('body', [pcb, relay, parts, lens, panel]), ('pins', [pin_obj])]


# --- The KY-023 joystick --------------------------------------------------------------------------


def joystick_module(root, part, args):
    """SunFounder's joystick module (09_joystick.png; Joy-IT's KY-023 photo for the cap's profile): a
    black 26 x 34 mm board, a right-angle 5-pin header along one 26 mm edge printed GND, +5V, VRX,
    VRY, SW, and a PS2-style thumbstick: a steel cage on a black base, a grey potentiometer on two
    sides with its cream rotor, the push switch on the third, and the black mushroom cap with its
    textured top. MH and an empty R1 are printed by the far corner.

    x runs along the header (GND first), y away from it. The pins leave along -y. The stick (the cap
    and its lever) tilts about the gimbal's centre, the pots' axis."""
    G = part['geometry']['params']
    W, L = G['boardWidthMm'], G['boardLengthMm']
    pins = part['pins']
    z0 = mp.TAIL
    mid = sum(p['offsetPitch'][0] for p in pins) / len(pins)
    xs = {p['id']: W / 2 + (p['offsetPitch'][0] - mid) * kit.PITCH for p in pins}
    face, reach = 0.3, 6.0
    cx, cy = 11.3, 16.6  # the stick's axis
    half, pot_t = 8.0, 3.0  # the cage's half width; a pot's thickness
    ink, tin = kit.SILK, NICKEL

    holes = mounting_holes(W, L, G['mountingHoleSpanShortApproxMm'], G['mountingHoleSpanLongApproxMm'], 3.1)
    items = [('ring', x, y, 2.25, 1.55, tin) for x, y, _ in holes]
    items += [('text', p['label'], xs[p['id']], 3.7, 1.2, ink, 90, 'LEFT') for p in pins]
    items += [kit.label('MH', 1.9, 26.4, 1.25, rotation=90), kit.label('R1', 21.2, 26.0, 1.0, rotation=90)]
    items += _outline(22.25, 24.0, 23.95, 28.1) + [('box', 22.55, y, 23.65, y + 1.1, tin) for y in (24.35, 26.65)]
    items += _outline(cx - 5.6, cy + half - 0.4, cx + 5.6, cy + half + pot_t + 0.6)  # around the Y pot
    items += _outline(cx + half - 0.3, cy - 5.4, W - 0.25, cy + 5.4)  # around the switch
    pcb, top = _pcb(root, kit.rounded_rect(0, 0, W, L, 0.5, n=2), holes, z0, '1b1b1d', args.px, items)

    m = kit.Mesh()
    base_black = kit.material('stick-base', '1a1a1c', Roughness=0.6)
    steel = kit.material('stick-cage', 'b9babc', Metallic=1.0, Roughness=0.38)
    grey = kit.material('pot-grey', '8b8e95', Roughness=0.35)
    cream = kit.material('pot-rotor', 'ece6d6', Roughness=0.5)
    m.box((cx - half + 1.0, cy - half + 1.0, top), (cx + half - 1.0, cy + half - 1.0, top + 1.5), base_black)
    sq = [(cx - half, cy - half), (cx + half, cy - half), (cx + half, cy + half), (cx - half, cy + half)]
    m.loft([(x, y, top + 1.0) for x, y in sq], [(x, y, top + 10.3) for x, y in sq], steel, caps=(False, False))
    m.polygon(sq, top + 9.6, base_black)
    m.slab(kit.rounded_rect(cx - half, cy - half, cx + half, cy + half, 0.6, n=2), [kit.circle(cx, cy, 5.6, 20)],
           top + 10.3, top + 10.8, steel)
    kit.dome(m, (cx, cy), 4.8, 4.8, 1.0, top + 9.6, base_black, n=16, rings=3)
    for sx_, sy_ in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = cx + sx_ * (half - 0.9), cy + sy_ * (half - 0.25)
        m.box((x - 0.7, y - 0.25, top), (x + 0.7, y + 0.25, top + 1.0), steel)
    # The X pot on the -x side, the Y pot on the +y side, each turned by the gimbal at the pivot's height.
    pz = top + 7.0
    m.box((cx - half - pot_t, cy - 5.0, top + 0.8), (cx - half, cy + 5.0, top + 11.2), grey, taper=0.1)
    m.tube((cx - half - pot_t, cy, pz), (cx - half - pot_t - 0.3, cy, pz), 1.9, cream, n=14)
    m.box((cx - half - pot_t - 0.32, cy - 0.35, pz - 1.1), (cx - half - pot_t - 0.3, cy + 0.35, pz + 1.1), base_black)
    m.box((cx - 5.0, cy + half, top + 0.8), (cx + 5.0, cy + half + pot_t, top + 11.2), grey, taper=0.1)
    m.tube((cx, cy + half + pot_t, pz), (cx, cy + half + pot_t + 0.3, pz), 1.9, cream, n=14)
    m.box((cx - 0.35, cy + half + pot_t + 0.3, pz - 1.1), (cx + 0.35, cy + half + pot_t + 0.32, pz + 1.1), base_black)
    for d in (-2.5, 0.0, 2.5):
        m.box((cx - half - 1.8, cy + d - 0.3, top), (cx - half - 1.4, cy + d + 0.3, top + 0.8), mp.tin())
        m.box((cx + d - 0.3, cy + half + 1.4, top), (cx + d + 0.3, cy + half + 1.8, top + 0.8), mp.tin())
    # The push switch on the +x side, under the stick.
    m.box((cx + half, cy - 4.9, top), (cx + half + 6.0, cy + 4.9, top + 3.6), grey, taper=0.08)
    m.box((cx + half + 1.4, cy - 1.8, top + 3.6), (cx + half + 4.8, cy + 1.8, top + 3.9), base_black)
    base = m.to_object('base', root)

    # The stick: a pivot at the gimbal's centre, the lever and the cap its child.
    pivot = kit.node(root, 'stick', (cx, cy, pz))
    s = kit.Mesh()
    s.disc((0, 0), 1.9, 2.0, 9.0, base_black, n=12)
    cap = kit.material('stick-cap', '242427', Roughness=0.75)
    pad = kit.material('stick-cap-top', '3a3b3f', Roughness=0.9)
    # The cap's profile (r, height above the board): the hollow skirt's underside out to its rim, the
    # dome up to the waist, the thumb pad's rounded rim and its dished top. 25.9 mm across and 17.8 mm
    # tall, as Tayda lists the PS2 joystick knob; its skirt overhangs the board on the X pot's side.
    profile = [(0, 15.0), (5.5, 14.8), (9.6, 14.0), (11.8, 12.8), (12.1, 12.6), (12.95, 12.6), (12.95, 13.3),
               (12.85, 14.3), (12.45, 15.7), (11.7, 17.1), (10.6, 18.3), (9.3, 19.4), (8.0, 20.25), (7.2, 20.9),
               (7.15, 21.5), (7.6, 22.1), (8.6, 22.7), (9.4, 23.4), (9.75, 24.4), (9.8, 26.4), (9.65, 28.3),
               (9.25, 29.4), (8.6, 30.1), (7.6, 30.4), (4.5, 30.25), (0, 30.15)]
    s.lathe([(r, z - (pz - top)) for r, z in profile], [cap] * (len(profile) - 3) + [pad, pad], segs=28)
    s.to_object('stick-mesh', pivot)

    pm = kit.Mesh()
    _right_angle_header(pm, root, [(p['id'], xs[p['id']]) for p in pins], face, top, mp.tin(), reach)
    pin_obj = pm.to_object('pins', root)
    return [('body', [pcb, base, pivot]), ('pins', [pin_obj])]


# --- Printing and boards for the keypad, the LCD and the servo -------------------------------------


def _ring_pts(x0, y0, x1, y1, r, z, n=4):
    return [(x, y, z) for x, y in kit.rounded_rect(x0, y0, x1, y1, r, n)]


def _decal(name, rect, px, base_hex, items):
    """devicekit.decal with rounded shapes and bolder text: bake a colour image of rect from a
    backing of base_hex and items drawn in order, each over the ones before it. Items:
      ('text', string, x, y, height_mm, hex, rotation_deg, align[, weight_mm])
      ('box', x0, y0, x1, y1, hex)
      ('ring', cx, cy, r_outer, r_inner, hex)            r_inner 0 fills the disc
      ('rbox', x0, y0, x1, y1, radius, hex)              a filled rounded rectangle
      ('rframe', x0, y0, x1, y1, radius, width, hex)     its outline, width inward
      ('poly', [(x, y), ...], hex)                       a convex polygon
    weight_mm thickens a text by drawing it again that far to each side."""
    x0, y0, x1, y1 = rect
    made = [kit._flat(f'{name}-backing', x0, y0, x1, y1, 0.001, kit.emissive(f'{name}-base', base_hex))]

    def mesh(label, verts, faces, mat):
        me = bpy.data.meshes.new(label)
        me.from_pydata(verts, [], faces)
        me.materials.append(mat)
        made.append(scene.link(bpy.data.objects.new(label, me)))

    for k, item in enumerate(items):
        # Each item lies a little above the one before, so the bake's rays meet the later first.
        z = 0.002 + 0.03 * k / max(len(items), 1)
        kind = item[0]
        ink = item[5] if kind == 'text' else item[-1]
        mat = kit.emissive(f'ink-{ink}', ink)
        if kind == 'text':
            body, x, y, h, _hex, rot, align = item[1:8]
            weight = item[8] if len(item) > 8 else 0.0
            shifts = [(0, 0)] + ([(weight, 0), (-weight, 0), (0, weight), (0, -weight)] if weight else [])
            for j, (dx, dy) in enumerate(shifts):
                curve = bpy.data.curves.new(f'{name}-t{k}-{j}', 'FONT')
                curve.body = body
                curve.size = h / 0.73  # Blender's built-in font: digits stand 0.73 of the size tall
                curve.align_x = align
                curve.align_y = 'CENTER'
                curve.materials.append(mat)
                obj = scene.link(bpy.data.objects.new(f'{name}-t{k}-{j}', curve))
                obj.location = (x + dx, y + dy, z)
                obj.rotation_euler.z = math.radians(rot)
                made.append(obj)
        elif kind == 'box':
            made.append(kit._flat(f'{name}-b{k}', item[1], item[2], item[3], item[4], z, mat))
        elif kind == 'ring':
            _, cx, cy, ro, ri, _hex = item
            n = 24
            outer = [(x, y, z) for x, y in kit.circle(cx, cy, ro, n)]
            if ri > 0:
                inner = [(x, y, z) for x, y in kit.circle(cx, cy, ri, n)]
                mesh(f'{name}-r{k}', outer + inner, [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)], mat)
            else:
                mesh(f'{name}-r{k}', outer, [tuple(range(n))], mat)
        elif kind == 'rbox':
            _, a, b, c, d, r, _hex = item
            pts = _ring_pts(a, b, c, d, r, z)
            mesh(f'{name}-q{k}', pts, [tuple(range(len(pts)))], mat)
        elif kind == 'rframe':
            _, a, b, c, d, r, w, _hex = item
            outer = _ring_pts(a, b, c, d, r, z)
            inner = _ring_pts(a + w, b + w, c - w, d - w, max(r - w, 0.05), z)
            n = len(outer)
            mesh(f'{name}-f{k}', outer + inner, [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)], mat)
        elif kind == 'poly':
            pts = [(x, y, z) for x, y in item[1]]
            mesh(f'{name}-p{k}', pts, [tuple(range(len(pts)))], mat)
    target = kit._flat(f'{name}-target', x0, y0, x1, y1, 0, materials.principled(f'{name}-target', (1, 1, 1)))
    uv = target.data.uv_layers.new(name='UVMap')
    for loop in target.data.loops:
        co = target.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))
    img = bake.bake(target, 'EMIT', bake.image(name, *px), made, extrusion=0.05, distance=0.1)
    for obj in [target, *made]:
        bpy.data.objects.remove(obj)
    return img


def _printed(name, hex6, img, **inputs):
    """A material whose base colour is a baked image."""
    mat = kit.material(name, hex6, **inputs)
    kit.textured(mat, img)
    return mat


def _mark_top(obj, rect, z, mat):
    """devicekit.mark_top, with the UVs clamped to 0-1: a rounded corner's rounding error would
    otherwise leave a UV a hair outside, and meshopt then leaves the UVs unquantized."""
    kit.mark_top(obj, rect, z, mat)
    for loop in obj.data.uv_layers.active.data:
        loop.uv = (min(max(loop.uv[0], 0.0), 1.0), min(max(loop.uv[1], 0.0), 1.0))


def _paint_down(obj, mat):
    """Give obj's downward faces the material mat (a board's solder-masked underside)."""
    me = obj.data
    if mat not in list(me.materials):
        me.materials.append(mat)
    slot = list(me.materials).index(mat)
    for poly in me.polygons:
        if poly.normal.z < -0.99:
            poly.material_index = slot


def _board(root, name, rect, z0, thickness, mask_hex, px, items, holes=(), radius=0.8, rough=0.35, underside=True):
    """A circuit board as devicekit.board makes one, with its own materials (so two boards in one
    model keep their colours) and, with underside, the solder mask on its bottom face too (otherwise
    the bottom shows the cut edge's colour). Returns (object, top z)."""
    x0, y0, x1, y1 = rect
    top = z0 + thickness
    edge = kit.material('pcb-edge', kit.FR4, Roughness=0.6)
    mask = kit.material(f'{name}-mask', mask_hex, Roughness=rough, Coat_Weight=0.5, Coat_Roughness=0.15)
    m = kit.Mesh()
    m.slab(kit.rounded_rect(x0, y0, x1, y1, radius), [kit.circle(cx, cy, d / 2, 12) for cx, cy, d in holes],
           z0, top, edge, top_mat=mask)
    obj = m.to_object(name, root)
    img = _decal(f'{name}-legend', rect, px, mask_hex, list(items))
    legend = _printed(f'{name}-legend', mask_hex, img, Roughness=rough, Coat_Weight=0.5, Coat_Roughness=0.15)
    _mark_top(obj, rect, top, legend)
    if underside:
        _paint_down(obj, mask)
    return obj, top


def _housing(root, name, x0, y_face, width, length, height, pitch, n, px):
    """A black female housing lying on the table, its socket face toward -y at y_face: the body and
    a panel with the n square openings, pitch apart and centred across it. Returns the objects and
    the openings' centres (x) at mid-height."""
    hm = kit.Mesh()
    hm.box((x0, y_face, 0.0), (x0 + width, y_face + length, height), mp.black_plastic(), taper=0.12)
    body = hm.to_object(name, root)
    first = (width - (n - 1) * pitch) / 2
    holes = [('box', first + k * pitch - 0.62, height / 2 - 0.62, first + k * pitch + 0.62, height / 2 + 0.62, '030304')
             for k in range(n)]
    face_mat = _printed(f'{name}-face', '17181a', _decal(f'{name}-face', (0, 0, width, height), px, '17181a', holes),
                        Roughness=0.7)
    # Facing -y: u along +x and v up, u x v = -y.
    face = kit.panel(root, f'{name}-face', (x0, y_face - 0.02, 0.0), (width, 0, 0), (0, 0, height), face_mat)
    return [body, face], [x0 + first + k * pitch for k in range(n)]


# --- The 4x4 membrane keypad --------------------------------------------------------------------

KEYS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D']
KEY_BLUE, KEY_RED, KEY_RIM, KEY_INK = '3a82dc', 'e2262e', 'd7dbe0', 'f6f7f9'
PAD_BLACK, PAD_LINE = '161718', 'c6c9cd'


def keypad(root, part, args):
    """The common black membrane keypad (SunFounder's keypad photo, protosupplies, Parallax 27899):
    a 0.8 mm pad 70 mm across the keys and 77 mm along the tail, a pale line 2.3 mm in from its
    edge, sixteen 11.5 mm keys on a 14.7 x 14.6 mm grid (blue digits, red letters and symbols, white
    legends, a pale rim), and a 20 mm clear tail with eight silver traces from the middle of the
    lower edge to a black 1 x 8 female housing."""
    G = part['geometry']['params']
    W, L, T = G['keypadWidthMm'], G['keypadLengthMm'], G['keypadThicknessMm']
    total = G['cableLengthMm']  # the tail with its housing, from the pad's edge
    pitch = G['connectorPitchMm']
    pins = part['pins']
    n = len(pins)
    hw, hl, hh = n * pitch + 0.3, 8.0, 2.6  # the housing: across, along the tail, thick
    tail_w = 20.0
    y_pad = total
    key, px_, py_ = 11.5, 14.7, 14.6
    kx0 = (W - (3 * px_ + key)) / 2
    ky1 = y_pad + L - (L - (3 * py_ + key)) / 2
    items = [('rframe', 2.3, y_pad + 2.3, W - 2.3, y_pad + L - 2.3, 3.0, 0.55, PAD_LINE)]
    for i, k in enumerate(KEYS):
        r, c = divmod(i, 4)
        x0, y1 = kx0 + c * px_, ky1 - r * py_
        items.append(('rbox', x0, y1 - key, x0 + key, y1, 1.4, KEY_RIM))
        ink = KEY_RED if k in 'ABCD*#' else KEY_BLUE
        items.append(('rbox', x0 + 0.45, y1 - key + 0.45, x0 + key - 0.45, y1 - 0.45, 1.0, ink))
        h, dy = {'*': (7.5, -1.6), '#': (4.6, 0.0)}.get(k, (5.8, 0.0))
        xc, yc = x0 + key / 2, y1 - key / 2
        items.append(('text', k, xc, yc + dy, h, KEY_INK, 0, 'CENTER', 0.1))
        if k == '1':  # the built-in font's 1 is a bare stroke; the keypad's has a flag
            left, top = xc - 0.6, yc + h / 2 + 0.1
            flag = [(left - 1.5, top - 1.2), (left - 1.5, top - 2.15), (left + 0.4, top - 0.95), (left + 0.4, top)]
            items.append(('poly', flag, KEY_INK))
    rect = (0, y_pad, W, y_pad + L)
    face = _printed('keypad-face', PAD_BLACK, _decal('keypad-face', rect, args.px, PAD_BLACK, items),
                    Roughness=0.3, Coat_Weight=0.4, Coat_Roughness=0.1)
    m = kit.Mesh()
    m.slab(kit.rounded_rect(*rect, 2.5), [], 0.0, T, kit.material('keypad-edge', '202124', Roughness=0.5), top_mat=face)
    pad = m.to_object('pad', root)
    _mark_top(pad, rect, T, face)
    # The tail: a clear film over eight traces, darker over the row lines near the housing.
    tx0 = W / 2 - tail_w / 2
    first = (tail_w - (n - 1) * pitch) / 2
    lines = [('box', first + k * pitch - 0.45, 0, first + k * pitch + 0.45, y_pad - hl, 'e8eaec') for k in range(n)]
    lines.append(('box', first - 0.75, 0, first + 3 * pitch + 0.75, 7.0, '45484d'))
    film = _printed('keypad-tail', 'b9bec5', _decal('keypad-tail', (0, 0, tail_w, y_pad - hl), [64, 256], 'b9bec5', lines),
                    Roughness=0.25)
    tm = kit.Mesh()
    tm.box((tx0, hl, 0.0), (tx0 + tail_w, y_pad, 0.2), film)
    tail = tm.to_object('tail', root)
    _mark_top(tail, (tx0, hl, tx0 + tail_w, y_pad), 0.2, film)
    connector, sockets = _housing(root, 'housing', W / 2 - hw / 2, 0.0, hw, hl, hh, pitch, n, [256, 32])
    for p, x in zip(pins, sockets):
        kit.pin_empty(root, p['id'], (x, -0.02, hh / 2), (0, -1, 0))
    return [('body', [pad]), ('cable', [tail]), ('connector', connector)]


# --- The LCD1602 with its PCF8574 backpack ---------------------------------------------------------

LCD_GREEN, LCD_TRACE, PAD_GOLD, TIN = '2f9a3c', '4fb357', 'c9a457', 'cdd0d3'
BACKPACK_BLACK = '15161a'
SCREEN_BLUE, CELL_BLUE = '2358d8', '1e4cc2'


def _backpack_frame(objs, x_mirror, z_face):
    """Bring objects drawn in the backpack's frame (the module seen from behind: x mirrored, its
    component face up at z = 0) into the module's: a half turn about y, x -> x_mirror - x and
    z -> z_face - z."""
    turn = Matrix.Translation((x_mirror, 0, z_face)) @ Matrix.Rotation(math.pi, 4, 'Y')
    for obj in objs:
        obj.data.transform(turn)
        obj.data.update()


def _turned_rect(cx, cy, length, width, angle_deg):
    a = math.radians(angle_deg)
    u, v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    return [(cx + su * length / 2 * u[0] + sv * width / 2 * v[0], cy + su * length / 2 * u[1] + sv * width / 2 * v[1])
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def _so16_y(m, cx, cy, z, bx, by, h, n, pitch):
    """A small-outline chip whose two rows of n gull-wing leads run along y."""
    m.box((cx - bx / 2, cy - by / 2, z), (cx + bx / 2, cy + by / 2, z + h), mp.epoxy(), taper=0.08)
    for side in (-1, 1):
        for i in range(n):
            y = cy + (i - (n - 1) / 2) * pitch
            x0, x1 = sorted((cx + side * (bx / 2 - 0.1), cx + side * (bx / 2 + 1.1)))
            m.box((x0, y - 0.21, z), (x1, y + 0.21, z + 0.25), mp.tin())




def lcd1602(root, part, args):
    """The LCD-1602A (SunFounder's mechanical drawing) with the PCF8574 backpack behind it, as
    SunFounder's photos show its I2C LCD1602: a green 80 x 36 mm board with four gold-ringed holes
    and the 16 pads along its top edge, a black bezel (72.2 x 24.1 mm) round the blue glass of the
    64.5 x 14.5 mm view area, and on the back the black backpack on a 16-pin header with the SO-16
    PCF8574T, the blue 3362 contrast trimmer, the backlight jumper and the 4-pin right-angle header
    (GND, VCC, SDA, SCL from the top edge down), whose pins point out past the left end. The module
    lies face up on its backpack, so the trimmer is its lowest point (ADR-0044)."""
    G = part['geometry']['params']
    L, W = G['boardLengthMm'], G['boardWidthMm']
    t = G['pcbThicknessMm']
    pins = part['pins']
    # The LCD's board spans z 0 to t. Behind it are the header's 2.5 mm spacer, the backpack's
    # board and the trimmer (4.3 mm with its rotor); in front, the bezel and its 0.1 mm ribs make
    # the whole stack moduleHeightWithBackpackMm.
    spacer, trimmer, rib = 2.5, 4.3, 0.1
    face_z = -(spacer + t)  # the backpack's component face, which faces -z
    bezel_top = G['moduleHeightWithBackpackMm'] + face_z - trimmer - rib
    hx, hy = (L - G['mountingHoleSpanLongMm']) / 2, (W - G['mountingHoleSpanShortMm']) / 2
    holes = [(x, y, 2 * 1.35) for x in (hx, L - hx) for y in (hy, W - hy)]
    pin1_x, pin_y = 8.1, W - 2.1  # the 16-pin row: 8.10 mm in from the left end, 2.10 mm down
    pads = [(pin1_x + k * kit.PITCH, pin_y) for k in range(16)]

    # The board's face: gold-ringed holes, the tinned pads (pin 1 square), the pin numbers, traces.
    items = [('ring', x, y, 2.5, 1.2, PAD_GOLD) for x, y, _d in holes]
    items += [('box', 1.3, 6.0, 1.75, 30.0, LCD_TRACE), ('box', L - 1.75, 6.0, L - 1.3, 30.0, LCD_TRACE),
              ('box', 48.6, 31.4, 74.0, 31.85, LCD_TRACE), ('box', 6.0, 3.4, 74.0, 3.85, LCD_TRACE),
              ('box', 48.6, 31.85, 49.05, 33.4, LCD_TRACE)]
    items += [('ring', x, y, 0.85, 0, TIN) for x, y in pads[1:]]
    items += [('box', pin1_x - 0.85, pin_y - 0.85, pin1_x + 0.85, pin_y + 0.85, TIN)]
    items += [kit.label('1', pin1_x, pin_y - 2.0, 0.9), kit.label('16', pads[-1][0], pin_y - 2.0, 0.9)]
    pcb, top = _board(root, 'pcb', (0, 0, L, W), 0.0, t, LCD_GREEN, args.px, items, holes=holes, radius=0.8)

    m = kit.Mesh()
    for x, y in pads:  # the backpack's pins, soldered through the LCD's board
        m.disc((x, y), 0.75, top, top + 0.7, mp.tin(), n=6, r_top=0.32, caps=(False, True))
    # The bezel: a black metal frame round the view area, its two ribs, and the blue glass in it.
    bx0, by0, bx1, by1 = (L - 72.2) / 2, 5.8, (L + 72.2) / 2, 5.8 + 24.1
    cx, cy = L / 2, (by0 + by1) / 2
    vl, vw = G['viewAreaLengthMm'], G['viewAreaWidthMm']
    view = (cx - vl / 2, cy - vw / 2, cx + vl / 2, cy + vw / 2)
    bezel_mat = kit.material('lcd-bezel', '19191b', Metallic=0.5, Roughness=0.4)
    m.slab(kit.rounded_rect(bx0, by0, bx1, by1, 0.6, 2), [kit.rounded_rect(*view, 0.0)], top, bezel_top, bezel_mat)
    for y in (by0 + 2.0, by1 - 2.0):  # the frame's two pressed ribs
        m.box((bx0 + 2.2, y - 0.3, bezel_top), (bx1 - 2.2, y + 0.3, bezel_top + rib), bezel_mat)
    m.polygon(kit.rounded_rect(*view, 0.0), bezel_top - 0.8, kit.material('lcd-glass', SCREEN_BLUE, Roughness=0.12))
    bezel = m.to_object('lcd', root)
    # The character area of an HD44780 16 x 2: 15 pitches + a character wide, a pitch + a character high.
    char_w, char_h, pitch_x, pitch_y = 2.95, 5.55, 3.55, 5.95
    area_w, area_h = 15 * pitch_x + char_w, pitch_y + char_h
    # The screen: a quad with UVs 0-1 over the character area, +v toward the top row. Its texture is
    # the backlit glass with its 32 unlit character cells; the studio draws characters over it.
    cells = [('box', c * pitch_x, area_h - char_h - r * pitch_y, c * pitch_x + char_w, area_h - r * pitch_y, CELL_BLUE)
             for r in range(2) for c in range(16)]
    screen_mat = _printed('lcd-screen', SCREEN_BLUE,
                          _decal('lcd-screen', (0, 0, area_w, area_h), [256, 64], SCREEN_BLUE, cells), Roughness=0.12)
    screen = kit.panel(root, 'lcd-screen', (cx - area_w / 2, cy - area_h / 2, bezel_top - 0.75),
                       (area_w, 0, 0), (0, area_h, 0), screen_mat)

    # Behind the board, drawn as seen from the back: x' = L - x and z' = face_z - z, so the
    # backpack's component face is z' = 0 and the LCD's back is z' = face_z.
    def X(x):
        return L - x


    # The backpack: 41.5 x 19 mm, centred on the 16 pins, its top edge 0.1 mm in from the LCD's.
    mid = (pads[0][0] + pads[-1][0]) / 2
    bp = (X(mid + 20.75), W - 19.1, X(mid - 20.75), W - 0.1)
    i2c = [W - 5.6 - k * kit.PITCH for k in range(len(pins))]  # GND (by the 16-pin edge) to SCL
    hdr_x0 = bp[2] - 1.4  # the right-angle header's block straddles the backpack's end
    jy = W - 8.2  # the backlight jumper's centre line
    legend = [('ring', X(x), y, 0.8, 0, TIN) for x, y in pads]
    legend += [kit.label(p['label'], hdr_x0 - 2.3, y, 1.0) for p, y in zip(pins, i2c)]
    legend += [kit.label('LED', bp[0] + 3.9, 31.6, 0.85), kit.label('POWER', bp[0] + 6.6, 19.6, 0.85),
               kit.label('FC-113', bp[2] - 3.6, 18.3, 0.75)]
    for k, name in enumerate(('A0', 'A1', 'A2')):
        ax = bp[0] + 26.5 + k * 2.2
        legend += [kit.label(name, ax, 17.7, 0.7), ('box', ax - 0.8, 18.8, ax - 0.15, 19.7, TIN),
                   ('box', ax + 0.15, 18.8, ax + 0.8, 19.7, TIN)]
    board, _ = _board(root, 'backpack', bp, -t, t, BACKPACK_BLACK, [512, 256], legend, radius=0.5, underside=False)

    pm = kit.Mesh()
    black = mp.black_plastic()
    for bx, by in ((54.9, 18.1), (27.0, 15.0)):  # the LCD's two chip-on-board blobs (U1, U2)
        kit.dome(pm, (X(bx), by), 5.0, 5.0, 1.0, face_z, black, n=12, rings=2)
    pm.box((X(pads[-1][0] + 1.27), pin_y - 1.25, face_z), (X(pin1_x - 1.27), pin_y + 1.25, -t), black)  # the spacer
    _so16_y(pm, bp[0] + 19.1, 28.0, 0.0, 7.5, 10.3, 2.3, 8, 1.27)  # PCF8574T, SO-16
    # The 3362 trimmer: a blue cube with a white rotor and its cross slot.
    tx, ty = bp[2] - 9.9, W - 8.2
    pm.box((tx - 3.5, ty - 3.5, 0.0), (tx + 3.5, ty + 3.5, trimmer - 0.35),
           kit.material('trimmer-blue', '3f80de', Roughness=0.4), taper=0.15)
    pm.disc((tx, ty), 2.2, trimmer - 0.35, trimmer - 0.05, kit.material('trimmer-rotor', 'efeee8', Roughness=0.45), n=14,
            caps=(False, True))
    for a in (45, -45):
        pm.extrude(_turned_rect(tx, ty, 3.4, 0.55, a), trimmer - 0.05, trimmer, mp.epoxy(), caps=(False, True))
    # The backlight jumper: a right-angle pair of pins at the far end with its cap on them.
    jx = bp[0] + 2.9
    pm.box((jx, jy - kit.PITCH, 0.0), (jx + kit.PITCH, jy + kit.PITCH, kit.PITCH), black)
    for y in (jy - kit.PITCH / 2, jy + kit.PITCH / 2):
        pm.box((jx - 5.4, y - 0.32, 0.95), (jx + 3.2, y + 0.32, 1.59), mp.tin())
        pm.box((jx + 2.86, y - 0.32, -t - 1.0), (jx + 3.5, y + 0.32, 1.59), mp.tin())
    pm.box((jx - 6.0, jy - 2.5, 0.0), (jx, jy + 2.5, 2.6), black, taper=0.1)  # its cap
    # Small parts: the power LED, the backlight transistor and the resistors.
    mp.smd(pm, bp[0] + 5.3, 23.6, 0.0, 1.6, 0.8, 0.5, kit.material('led-red', 'd8352d', Roughness=0.3), along='y')
    pm.box((bp[0] + 6.4, 30.35, 0.0), (bp[0] + 9.3, 31.65, 1.0), mp.epoxy())
    for x, y in [(bp[0] + 10.9 + k * 2.6, 19.0) for k in range(3)] + [(bp[2] - 7.1, 21.6)]:
        mp.smd(pm, x, y, 0.0, 1.6, 0.8, 0.45, mp.epoxy())
    parts = pm.to_object('backpack-parts', root)

    # The I2C header: a right-angle block, its pins bent down into the backpack and out past the end.
    hm = kit.Mesh()
    hm.box((hdr_x0, i2c[-1] - kit.PITCH / 2, 0.0), (hdr_x0 + kit.PITCH, i2c[0] + kit.PITCH / 2, kit.PITCH),
           mp.black_plastic())
    tip = hdr_x0 + kit.PITCH + 6.0
    h = kit.LEG / 2
    for y in i2c:
        hm.box((hdr_x0 - 0.6 - h, y - h, kit.PITCH / 2 - h), (tip, y + h, kit.PITCH / 2 + h), mp.gold())
        hm.box((hdr_x0 - 0.6 - h, y - h, -t - 1.0), (hdr_x0 - 0.6 + h, y + h, kit.PITCH / 2 - h), mp.gold())
    header = hm.to_object('pins', root)
    _backpack_frame([board, parts, header], L, face_z)
    for p, y in zip(pins, i2c):
        kit.pin_empty(root, p['id'], (L - tip, y, face_z - kit.PITCH / 2), (-1, 0, 0))
    return [('body', [pcb, bezel, screen, board, parts]), ('pins', [header])]


# --- The SG90 micro servo ----------------------------------------------------------------------------

SERVO_BLUE, HORN_WHITE = '2040c4', 'f1f0ea'
WIRES = [('5e3a20', -1.0), ('c8261d', 0.0), ('ef8a1d', 1.0)]  # brown, red, orange: GND, VCC, PWM


def _flange(x0, x1, w, slot=1.1, hole_r=1.0, hole_in=2.4, k=8):
    """The servo's mounting flange from above, counter-clockwise: x0 to x1 by w, with a keyhole at
    each end (a hole hole_in from the end and a slot out to it)."""
    cy, s = w / 2, slot / 2
    reach = math.sqrt(hole_r ** 2 - s ** 2)
    a0 = math.atan2(s, reach)

    def around(hx, start):
        step = (2 * math.pi - 2 * a0) / k
        return [(hx + hole_r * math.cos(start - j * step), cy + hole_r * math.sin(start - j * step)) for j in range(k + 1)]

    pts = [(x0, 0.0), (x1, 0.0), (x1, cy - s)]
    pts += around(x1 - hole_in, -a0)
    pts += [(x1, cy + s), (x1, w), (x0, w), (x0, cy + s)]
    pts += around(x0 + hole_in, math.pi - a0)
    pts += [(x0, cy - s)]
    return pts


def _tower(cx, cy, R, lobe_dx, r, n=24, k=10):
    """The gear tower's outline from above, counter-clockwise: a circle of radius R round the shaft
    joined with a smaller lobe of radius r, lobe_dx toward -x."""
    a = (R ** 2 - r ** 2 + lobe_dx ** 2) / (2 * lobe_dx)
    h = math.sqrt(R ** 2 - a ** 2)
    big = math.pi - math.atan2(h, a)  # where the circles meet, seen from the shaft
    small = math.atan2(h, a - lobe_dx) % (2 * math.pi)  # and from the lobe's centre
    pts = [(cx + R * math.cos(-big + j * 2 * big / n), cy + R * math.sin(-big + j * 2 * big / n)) for j in range(n + 1)]
    lx = cx - lobe_dx
    step = (2 * math.pi - 2 * small) / k
    pts += [(lx + r * math.cos(small + j * step), cy + r * math.sin(small + j * step)) for j in range(1, k)]
    return pts


def sg90(root, part, args):
    """The TowerPro SG90 (its data sheet drawing and TowerPro's photos): a translucent blue case,
    22.2 x 11.8 mm, with a 2.5 mm flange whose ears carry a keyhole at each end, the round gear
    tower over the output shaft 5.9 mm from one end, a white double-arm horn on the shaft (31 mm
    over all), the black TowerPro label on its side, and the brown, red and orange flat cable that
    leaves the shaft end low down, turns along the table and ends in a black 3-way JR housing."""
    G = part['geometry']['params']
    body_l, w, ears = G['bodyLengthMm'], G['bodyWidthMm'], G['earSpanMm']
    height, cable, pitch = G['overallHeightMm'], G['cableLengthMm'], G['connectorPitchMm']
    pins = part['pins']
    blue = kit.material('servo-blue', SERVO_BLUE, Roughness=0.16, Coat_Weight=0.6, Coat_Roughness=0.06)
    white = kit.material('horn-white', HORN_WHITE, Roughness=0.45)
    dark = kit.material('servo-hole', '0d0f1a', Roughness=0.6)
    x0 = (ears - body_l) / 2
    x1 = x0 + body_l
    cy = w / 2
    flange0, flange1, lid, tower = 15.9, 18.4, 22.7, 26.8  # heights over the table
    shaft_x = x1 - 5.9
    m = kit.Mesh()
    m.extrude(kit.rounded_rect(x0 + 0.3, 0.3, x1 - 0.3, w - 0.3, 0.4, 2), 0.0, 1.0, blue, caps=(False, False))
    m.extrude(kit.rounded_rect(x0, 0.0, x1, w, 0.6, 2), 1.0, flange0, blue, caps=(True, False))
    m.slab(_flange(0.0, ears, w), [], flange0, flange1, blue)
    m.extrude(kit.rounded_rect(x0, 0.0, x1, w, 0.6, 2), flange1, lid, blue, caps=(False, True))
    m.slab(_tower(shaft_x, cy, 5.7, 6.0, 2.9), [], lid, tower, blue)
    m.polygon(kit.circle(shaft_x - 6.0, cy, 0.6, 8), tower + 0.01, dark)
    m.disc((shaft_x, cy), 3.3, tower, tower + 0.6, blue, n=18, caps=(False, True))
    m.disc((shaft_x, cy), 2.35, tower + 0.6, tower + 1.0, white, n=12, caps=(False, False))
    body = m.to_object('case', root)
    # The label on the -y side: black, a gold border, TOWER PRO, a cream panel, SG90.
    lw, lh, lz = 15.6, 11.4, 2.8
    gold, cream, ink = 'd6b453', 'eee1a3', '161616'
    label_img = _decal('servo-label', (0, 0, lw, lh), args.px, '121212', [
        ('rframe', 0.45, 0.45, lw - 0.45, lh - 0.45, 0.5, 0.22, gold),
        ('text', 'TOWER PRO', lw / 2, 9.1, 1.45, gold, 0, 'CENTER', 0.04),
        ('rbox', 1.8, 4.6, lw - 1.8, 7.7, 0.3, cream),
        ('text', 'Micro Servo', lw / 2, 6.75, 0.95, ink, 0, 'CENTER', 0.02),
        ('text', '9g', lw / 2, 5.3, 0.95, ink, 0, 'CENTER', 0.02),
        ('box', 1.8, 3.9, lw - 1.8, 4.05, gold),
        ('text', 'SG90', lw / 2, 2.3, 1.6, gold, 0, 'CENTER', 0.06),
    ])
    label_mat = _printed('servo-label', '121212', label_img, Roughness=0.35)
    label = kit.panel(root, 'servo-label', ((x0 + x1) / 2 - lw / 2, -0.02, lz), (lw, 0, 0), (0, 0, lh), label_mat)

    # The horn turns about the output shaft: a pivot on its axis, a double arm at rest along x.
    hub_z = tower + 0.8
    pivot = kit.node(root, 'horn', (shaft_x, cy, hub_z))
    top = height - hub_z
    hm = kit.Mesh()
    hm.disc((0, 0), 3.4, 0.0, top, white, n=20)
    tip, half_hub, half_tip = 8.6, 2.9, 1.6
    arm = [(-tip, -half_tip), (0.0, -half_hub), (tip, -half_tip)]
    arm += [(tip + half_tip * math.cos(math.radians(-90 + 30 * j)), half_tip * math.sin(math.radians(-90 + 30 * j)))
            for j in range(1, 6)]
    arm += [(tip, half_tip), (0.0, half_hub), (-tip, half_tip)]
    arm += [(-tip + half_tip * math.cos(math.radians(90 + 30 * j)), half_tip * math.sin(math.radians(90 + 30 * j)))
            for j in range(1, 6)]
    arm_top = top - 0.3  # the hub stands a little proud of the arms
    hm.extrude(arm, arm_top - 1.5, arm_top, white)
    for x in (-7.8, -6.2, -4.6, 4.6, 6.2, 7.8):
        hm.polygon(kit.circle(x, 0.0, 0.45, 8), arm_top + 0.01, dark)
    hm.polygon(kit.circle(0.0, 0.0, 1.0, 10), top + 0.01, dark)
    hm.to_object('horn-mesh', pivot)

    # The flat cable leaves the shaft end at the table, turns toward -y and runs to the housing,
    # where its three wires spread to the sockets. Its length, housing included, is cableLengthMm.
    R, r_wire, run = 7.0, 0.5, 2.0
    hw, hl, hh = len(pins) * pitch + 0.5, 14.0, 3.2
    xc = x1 + run + R
    y_back = cy - R + run + math.pi / 2 * R + hl - cable
    y_fan = y_back + 7.0
    connector, sockets = _housing(root, 'housing', xc - hw / 2, y_back - hl, hw, hl, hh, pitch, len(pins), [128, 32])
    wm = kit.Mesh()
    for (hexa, o), sx in zip(WIRES, sockets):
        z = r_wire
        path = [(x1 - 0.8, cy + o, z), (x1 + run, cy + o, z)]
        path += [(x1 + run + (R + o) * math.sin(math.radians(a)), cy - R + (R + o) * math.cos(math.radians(a)), z)
                 for a in range(15, 90, 15)]
        path += [(xc + o, cy - R, z), (xc + o, y_fan, z), (sx, y_back + 1.5, z), (sx, y_back - 0.6, z)]
        wm.sweep(path, r_wire, kit.material(f'wire-{hexa}', hexa, Roughness=0.45), segs=6, caps=(False, False))
    wires = wm.to_object('cable', root)
    for p, sx in zip(pins, sockets):
        kit.pin_empty(root, p['id'], (sx, y_back - hl - 0.02, hh / 2), (0, -1, 0))
    return [('body', [body, label]), ('horn', [pivot]), ('cable', [wires]), ('connector', connector)]
