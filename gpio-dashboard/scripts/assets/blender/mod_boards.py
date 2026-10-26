"""The board and cabled modules: the MB102 breadboard power supply, the 5 V relay module, the KY-023
joystick, the 4x4 membrane keypad, the LCD1602 with its I2C backpack, and the SG90 servo. Each
build() draws one variant into root and returns [(collider name, [objects])]; see module.py for the
frame and sensors' notes in mod_sensors.py for how the headers sit.

Modules with a header lie on its pin tails with the pins up, or out of the board's edge where the
real board has a right-angle header (the relay, the joystick). The keypad and the servo end in a
female housing on a cable or tail; it lies flat on the table with its socket openings facing
along the cable, away from the module, and its pin empties point out of the openings.
"""
import math
import os
import sys


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402
import modparts as mp  # noqa: E402


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


KEYS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D']


def keypad(root, part, args):
    G = part['geometry']['params']
    L, W, T = G['keypadLengthMm'], G['keypadWidthMm'], G['keypadThicknessMm']
    tail_total = G['cableLengthMm']
    pitch = G['connectorPitchMm']
    pins = part['pins']
    housing_len, housing_w, housing_h = 8.0, pins[-1]['offsetPitch'][0] * pitch + pitch, 2.54
    # The pad lies from y = tail_total up; the tail runs down to the housing at y = 0.
    y_pad = tail_total
    # Keys: a 4 x 4 grid, light legends on dark keys, laid out on the pad's top.
    key_w, key_h, px_, py_ = 14.5, 12.5, 17.5, 15.5
    kx0 = (L - (3 * px_ + key_w)) / 2
    ky0 = (W - (3 * py_ + key_h)) / 2
    items = []
    for i, key in enumerate(KEYS):
        r, c = divmod(i, 4)
        x0 = kx0 + c * px_
        y1 = W - ky0 - r * py_
        items.append(('box', x0, y1 - key_h, x0 + key_w, y1, '3f4046'))
        items.append(('text', key, x0 + key_w / 2, y1 - key_h / 2, 5.0 if key not in '*#' else 5.6, 'f0f0ea', 0, 'CENTER'))
    img = kit.decal('keypad-face', (0, 0, L, W), args.px, '1d1e21', items)
    face = kit.material('keypad-face', '1d1e21', Roughness=0.5)
    kit.textured(face, img)
    m = kit.Mesh()
    edge = kit.material('keypad-edge', '2a2b2f', Roughness=0.6)
    m.slab(kit.rounded_rect(0, y_pad, L, y_pad + W, 1.5), [], 0.0, T, edge, top_mat=face)
    pad = m.to_object('pad', root)
    kit.mark_top(pad, (0, y_pad, L, y_pad + W), T, face)
    tail_w = housing_w + 0.6
    tm = kit.Mesh()
    tm.box((L / 2 - tail_w / 2, housing_len, 0.0), (L / 2 + tail_w / 2, y_pad + 0.5, 0.35), kit.material('tail', '4a4b50', Roughness=0.5))
    tail = tm.to_object('tail', root)
    hm = kit.Mesh()
    hm.box((L / 2 - housing_w / 2, 0.0, 0.0), (L / 2 + housing_w / 2, housing_len, housing_h), mp.black_plastic(), taper=0.08)
    housing = hm.to_object('housing', root)
    sockets = [('box', (k + 0.5) * pitch - 0.6, housing_h / 2 - 0.6, (k + 0.5) * pitch + 0.6, housing_h / 2 + 0.6, '000000') for k in range(len(pins))]
    hole_img = kit.decal('housing-face', (0, 0, housing_w, housing_h), [256, 32], '17181a', sockets)
    hole_mat = kit.material('housing-face', '17181a', Roughness=0.7)
    kit.textured(hole_mat, hole_img)
    # Facing -y: u runs along +x, v up, and u x v = -y... x cross z is -y.
    front = kit.panel(root, 'housing-face', (L / 2 - housing_w / 2, -0.02, 0.0), (housing_w, 0, 0), (0, 0, housing_h), hole_mat)
    for p in pins:
        kit.pin_empty(root, p['id'], (L / 2 - housing_w / 2 + (p['offsetPitch'][0] + 0.5) * pitch, -0.02, housing_h / 2), (0, -1, 0))
    return [('body', [pad]), ('cable', [tail]), ('connector', [housing, front])]


def lcd1602(root, part, args):
    G = part['geometry']['params']
    L, W = G['boardLengthMm'], G['boardWidthMm']
    z0 = 0.0
    thick = G['pcbThicknessMm']
    # The backpack's header stands on the module, pins up, along its lower edge.
    pins = part['pins']
    hx = L - 20.0
    hy = 3.0
    labels = [kit.label(p['label'], hx + p['offsetPitch'][0] * kit.PITCH, 5.4, 0.85) for p in pins]
    labels += [kit.label('LCD1602 + I2C', 14.0, 3.0, 1.0), kit.label('1', 4.0, W - 5.8, 0.8), kit.label('16', L - 4.0, W - 5.8, 0.8)]
    z0 = mp.TAIL
    pcb, top = kit.board(root, 'pcb', (0, 0, L, W), z0, thick, '1d5a3a', args.px, labels,
                         holes=mounting_holes(L, W, G['mountingHoleSpanLongMm'], G['mountingHoleSpanShortMm'], 2.5), radius=1.0)
    stack = G['moduleThicknessMaxMm'] - thick
    bezel_l, bezel_w = 71.2, 24.2
    cx, cy = L / 2, 20.0
    view_l, view_w = G['viewAreaLengthMm'], G['viewAreaWidthMm']
    m = kit.Mesh()
    silver = kit.material('lcd-bezel', 'c9ccd0', Metallic=1.0, Roughness=0.4)
    m.slab(kit.rounded_rect(cx - bezel_l / 2, cy - bezel_w / 2, cx + bezel_l / 2, cy + bezel_w / 2, 0.6),
           [kit.rounded_rect(cx - view_l / 2, cy - view_w / 2, cx + view_l / 2, cy + view_w / 2, 0.0)],
           top, top + stack, silver)
    m.box((cx - view_l / 2, cy - view_w / 2, top + stack - 0.9), (cx + view_l / 2, cy + view_w / 2, top + stack - 0.5),
          kit.material('lcd-glass', '2a46b8', Roughness=0.25))
    bezel = m.to_object('lcd', root)
    # The character area of an HD44780 16 x 2: 15 pitches + a character wide, one pitch + a character high.
    char_w, char_h, pitch_x, pitch_y = 2.95, 5.55, 3.55, 5.95
    area_w, area_h = 15 * pitch_x + char_w, pitch_y + char_h
    # The screen: a quad with UVs 0-1 over the character area, +v toward the top row. Its texture is
    # the backlit glass with the 32 blank character cells; the studio draws characters over it.
    cells = [
        ('box', c * pitch_x, area_h - char_h - r * pitch_y, c * pitch_x + char_w, area_h - r * pitch_y, '3158dc')
        for r in range(2)
        for c in range(16)
    ]
    glass = kit.decal('lcd-screen', (0, 0, area_w, area_h), [256, 64], '2a46b8', cells)
    screen_mat = kit.material('lcd-screen', '2a46b8', Roughness=0.25)
    kit.textured(screen_mat, glass)
    screen = kit.panel(root, 'lcd-screen', (cx - area_w / 2, cy - area_h / 2, top + stack - 0.4), (area_w, 0, 0), (0, area_h, 0), screen_mat)
    strip = [(p['id'], (hx + p['offsetPitch'][0] * kit.PITCH, hy)) for p in pins]
    pin_obj = mp.headers(root, [strip], top)
    return [('body', [pcb, bezel, screen]), ('pins', [pin_obj])]


def sg90(root, part, args):
    G = part['geometry']['params']
    body_l, body_w, ears = G['bodyLengthMm'], G['bodyWidthMm'], G['earSpanMm']
    height = G['overallHeightMm']
    cable = G['cableLengthMm']
    pitch = G['connectorPitchMm']
    pins = part['pins']
    blue = kit.material('servo-blue', '2a6bd0', Roughness=0.45)
    white = kit.material('horn-white', 'f1f1ee', Roughness=0.5)
    # The case stands from z = 0; its long axis is x; the output end (and the shaft) at -x.
    x0 = (ears - body_l) / 2
    cy = body_w / 2
    case_h = 22.7
    m = kit.Mesh()
    m.box((x0, 0, 0), (x0 + body_l, body_w, case_h), blue, taper=0.1)
    m.box((0.0, 0.0, 15.9), (ears, body_w, 18.4), blue)  # the mounting flange and its ears
    shaft_x = x0 + body_w / 2 + 0.6
    m.disc((shaft_x, cy), body_w / 2 - 0.2, case_h, case_h + 3.8, blue, n=24)  # the gear housing
    m.disc((shaft_x, cy), 2.8, case_h + 3.8, case_h + 5.6, blue, n=16)
    spline_top = height - 2.0
    m.disc((shaft_x, cy), 2.4, case_h + 5.6, spline_top, kit.material('spline', 'dcdcd8', Roughness=0.4), n=16)
    body = m.to_object('body', root)
    # The horn turns about the output shaft: a pivot at the shaft axis, a double arm at rest along x.
    pivot = kit.node(root, 'horn', (shaft_x, cy, spline_top - 1.0))
    hm = kit.Mesh()
    hm.disc((0, 0), 3.6, 0, 3.0, white, n=20)
    arm = [(-10.5, -1.0), (-9.5, -2.1), (9.5, -2.1), (10.5, -1.0), (10.5, 1.0), (9.5, 2.1), (-9.5, 2.1), (-10.5, 1.0)]
    hm.extrude(arm, 1.0, 2.2, white)
    hm.to_object('horn-mesh', pivot)
    # The three-wire cable leaves the case's -y side near its base and runs straight out.
    housing_w, housing_len, housing_h = pins[-1]['offsetPitch'][0] * pitch + pitch, 8.0, 2.54
    hx = x0 + body_l - 5.0 - housing_w / 2
    wm = kit.Mesh()
    wires = [('624a2e', 0), ('c83a2e', 1), ('e8872a', 2)]  # brown, red, orange: GND, VCC, PWM
    for hexa, k in wires:
        x = hx + (k + 0.5) * pitch
        wm.tube((x, 0.4, 1.27), (x, -(cable - housing_len), 1.27), 0.55, kit.material(f'wire-{hexa}', hexa, Roughness=0.5), n=8)
    wire_obj = wm.to_object('cable', root)
    hm2 = kit.Mesh()
    y_back = -(cable - housing_len)
    hm2.box((hx, y_back - housing_len, 0.0), (hx + housing_w, y_back, housing_h), mp.black_plastic(), taper=0.08)
    housing = hm2.to_object('housing', root)
    hole_img = kit.decal('housing-face', (0, 0, housing_w, housing_h), [128, 32],
                         '17181a', [('box', (k + 0.5) * pitch - 0.6, housing_h / 2 - 0.6, (k + 0.5) * pitch + 0.6, housing_h / 2 + 0.6, '000000') for k in range(len(pins))])
    hole_mat = kit.material('housing-face', '17181a', Roughness=0.7)
    kit.textured(hole_mat, hole_img)
    front = kit.panel(root, 'housing-face', (hx, y_back - housing_len - 0.02, 0.0), (housing_w, 0, 0), (0, 0, housing_h), hole_mat)
    for p in pins:
        kit.pin_empty(root, p['id'], (hx + (p['offsetPitch'][0] + 0.5) * pitch, y_back - housing_len - 0.02, housing_h / 2), (0, -1, 0))
    return [('body', [body]), ('horn', [pivot]), ('cable', [wire_obj]), ('connector', [housing, front])]
