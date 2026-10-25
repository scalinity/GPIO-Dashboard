"""Sensor modules: the DHT11 (3-pin breakout and the bare 4-pin sensor), HC-SR04 and HC-SR501.
Each build() draws one variant into root and returns [(collider name, [objects])].

Every board lies on its header's pin tails with its header on top, pins up (modparts.TAIL), so a
female Dupont housing mates from above; the board starts at x = y = 0 before module.py moves the
model's lowest corner to the origin. A module's header row runs along +x with pin 1 first, the
way the part definition's offsetPitch has it.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402
import modparts as mp  # noqa: E402

DHT_BLUE = '2f8fd8'


def vents(root, name, origin, width, height, args):
    """The sensor's grille: dark square vents drawn on a panel in front of the housing."""
    items = [('box', 0, 0, width, height, DHT_BLUE)]
    cols, rows = 4, 4
    for r in range(rows):
        for c in range(cols):
            x = width * (0.19 + 0.205 * c)
            y = height * (0.83 - 0.12 * r)
            items.append(('box', x - 0.55, y - 0.5, x + 0.55, y + 0.5, '123a5c'))
    img = kit.decal(f'{name}-grille', (0, 0, width, height), [256, 256], DHT_BLUE, items[1:])
    mat = kit.material(f'{name}-grille', DHT_BLUE, Roughness=0.4)
    kit.textured(mat, img)
    # Facing -y: u runs along +x, v up +z, and u x v = -y.
    return kit.panel(root, name, origin, (width, 0, 0), (0, 0, height), mat)


def sensor_body(m, x0, y0, z0, w, t, h):
    """The DHT11 housing: w across, t thick, h tall, with a slight draft on its sides."""
    m.box((x0, y0, z0), (x0 + w, y0 + t, z0 + h), kit.material('dht-blue', DHT_BLUE, Roughness=0.4), taper=0.15)


def dht11_module(root, part, args):
    G = part['geometry']['params']
    L, W = G['boardLengthApproxMm'], G['boardWidthApproxMm']
    z0, thick = mp.TAIL, 1.2
    cx = L / 2
    pins = part['pins']
    labels = [
        kit.label('S', cx - kit.PITCH, 5.4, 1.0),
        kit.label('-', cx + kit.PITCH, 5.4, 1.2),
        kit.label('DHT11', cx, 14.7, 0.9),
    ]
    pcb, top = kit.board(root, 'pcb', (0, 0, L, W), z0, thick, '15161a', args.px, labels, holes=[(2.4, 13.4, 2.4)])
    sw, st, sh = G['sensorWidthMm'], G['sensorThicknessMm'], G['sensorLengthMm']
    gap = 1.0  # between the housing and the board
    sy = 7.0
    m = kit.Mesh()
    sensor_body(m, cx - sw / 2, sy, top + gap, sw, st, sh)
    for dx in (-3.81, -1.27, 1.27, 3.81):  # the sensor's four legs into the board
        m.box((cx + dx - 0.25, sy + st / 2 - 0.25, top - 0.4), (cx + dx + 0.25, sy + st / 2 + 0.25, top + gap), mp.gold())
    sensor = m.to_object('sensor', root)
    vents(root, 'grille', (cx - sw / 2, sy - 0.02, top + gap + sh * 0.0), sw, sh, args)
    c = kit.Mesh()
    mp.resistor(c, cx + 5.2, 3.2, top)  # R1, 10 kOhm
    mp.led(c, cx - 5.2, 3.2, top, 'd9332b')
    parts_obj = c.to_object('smd', root)
    strip = [(p['id'], (cx + (p['offsetPitch'][0] - 1) * kit.PITCH, 2.0)) for p in pins]
    pin_obj = mp.headers(root, [strip], top)
    return [('body', [pcb, sensor, parts_obj]), ('pins', [pin_obj])]


def dht11_bare(root, part, args):
    """The bare 4-pin sensor, standing in the board on its legs: origin at pin VDD."""
    G = part['geometry']['params']
    w, t, h = G['bodyWidthMm'], G['bodyThicknessMm'], G['bodyHeightMm']
    pins = part['pins']
    px = [p['offsetPitch'][0] * kit.PITCH for p in pins]
    cx = (min(px) + max(px)) / 2
    z0 = 2.0  # the housing's underside above the board; the legs run on to 8 mm
    m = kit.Mesh()
    sensor_body(m, cx - w / 2, -t / 2, z0, w, t, h)
    body = m.to_object('body', root)
    vents(root, 'grille', (cx - w / 2, -t / 2 - 0.02, z0), w, h, args)
    for pin, x in zip(pins, px):
        kit.pin_empty(root, pin['id'], (x, 0, z0), (0, 0, -1))
    return [('body', [body])]


def hc_sr04(root, part, args):
    G = part['geometry']['params']
    L, W, height = G['boardLengthMm'], G['boardWidthMm'], G['heightMm']
    z0, thick = mp.TAIL, 1.6
    cx = L / 2
    pins = part['pins']
    strip_x = cx - 1.5 * kit.PITCH
    labels = [kit.label(p['label'], strip_x + i * kit.PITCH, 5.1, 0.85) for i, p in enumerate(pins)]
    labels += [kit.label('HC-SR04', cx, 18.0, 1.0, ink='d8e2f0')]
    pcb, top = kit.board(root, 'pcb', (0, 0, L, W), z0, thick, '1c63b0', args.px, labels)
    d = G['transducerDiameterApproxMm']
    spacing = G['transducerCentreSpacingApproxMm']
    can_h = z0 + height - top
    m = kit.Mesh()
    metal = kit.material('can-metal', 'b4b7bb', Metallic=1.0, Roughness=0.4)
    mesh = kit.material('can-mesh', '16181b', Roughness=0.8)
    for sx in (-1, 1):
        c = (cx + sx * spacing / 2, 11.5)
        m.disc(c, d / 2, top, top + can_h - 0.1, metal, n=24)
        m.disc(c, d / 2 - 1.6, top + can_h - 0.1, top + can_h + 0.02, mesh, n=24, caps=(False, True))
    mp.can(m, cx, 14.0, top, 1.9, 6.0)  # the crystal's can, stood in by a small cylinder
    body = m.to_object('transducers', root)
    strip = [(p['id'], (strip_x + p['offsetPitch'][0] * kit.PITCH, 2.0)) for p in pins]
    pin_obj = mp.headers(root, [strip], top)
    return [('body', [pcb, body]), ('pins', [pin_obj])]


def hc_sr501(root, part, args):
    G = part['geometry']['params']
    L, W, height = G['boardLengthMm'], G['boardWidthMm'], G['heightMm']
    z0, thick = mp.TAIL, 1.6
    lens_r = G['lensDiameterMm'] / 2
    dome_cx = lens_r + 0.6
    strip_cx = (dome_cx + lens_r + L) / 2  # the free end of the board beside the lens
    pins = part['pins']
    xs = [strip_cx + (p['offsetPitch'][0] - 1) * kit.PITCH for p in pins]
    labels = [kit.label(p['label'], x, 9.4, 0.8) for p, x in zip(pins, xs)]
    labels += [kit.label('Sx', strip_cx, 3.0, 0.9), kit.label('Tx', strip_cx, 21.0, 0.9)]
    pcb, top = kit.board(
        root, 'pcb', (0, 0, L, W), z0, thick, '1d7a3d', args.px, labels,
        holes=[(L - 1.8, 1.8, 2.0), (L - 1.8, W - 1.8, 2.0)],
    )
    m = kit.Mesh()
    skirt_h = 13.0
    white = kit.material('lens', 'efefe9', Roughness=0.45, Sheen_Weight=0.4, Sheen_Roughness=0.5)
    m.disc((dome_cx, W / 2), lens_r, top, top + skirt_h, white, n=32)
    top_h = z0 + height - (top + skirt_h)
    kit.dome(m, (dome_cx, W / 2), lens_r, lens_r, top_h, top + skirt_h, white, n=32, rings=8)
    lens = m.to_object('lens', root)
    c = kit.Mesh()
    orange = kit.material('trimmer', 'e0821f', Roughness=0.5)
    for y in (6.0, W - 6.0):
        c.box((strip_cx - 2.2, y - 2.2, top), (strip_cx + 2.2, y + 2.2, top + 3.6), orange)
        c.disc((strip_cx, y), 1.2, top + 3.6, top + 3.8, mp.tin(), n=12)
    smd_obj = c.to_object('trimmers', root)
    strip = [(p['id'], (x, W / 2)) for p, x in zip(pins, xs)]
    pin_obj = mp.headers(root, [strip], top)
    return [('body', [pcb, lens, smd_obj]), ('pins', [pin_obj])]
