"""The board and cabled modules: the MB102 breadboard power supply, the 5 V relay module, the KY-023
joystick, the 4x4 membrane keypad, the LCD1602 with its I2C backpack, and the SG90 servo. Each
build() draws one variant into root and returns [(collider name, [objects])]; see module.py for the
frame and sensors' notes in mod_sensors.py for how the headers sit.

Modules with a header lie on its pin tails with the pins up. The keypad and the servo end in a
female housing on a cable or tail; it lies flat on the table with its socket openings facing
along the cable, away from the module, and its pin empties point out of the openings.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402
import modparts as mp  # noqa: E402
from lib import scene  # noqa: E402


def mounting_holes(L, W, span_x, span_y, d):
    """Four holes on a rectangle span_x by span_y centred on an L by W board."""
    cx, cy = L / 2, W / 2
    return [(cx + sx * span_x / 2, cy + sy * span_y / 2, d) for sx in (-1, 1) for sy in (-1, 1)]


def power_module(root, part, args):
    G = part['geometry']['params']
    L, W = G['boardLengthMm'], G['boardWidthMm']
    z0 = mp.TAIL
    pins = part['pins']
    x0, y0 = 40.0, 7.0  # pin 1 of the 2 x 4 output header
    labels = [
        kit.label('3.3V', x0 + 1.27, 11.8, 0.9),
        kit.label('5V', x0 + 6.35, 11.8, 0.9),
        kit.label('GND', x0 + 3.8, 4.4, 0.9),
        kit.label('MB102', 22.0, 19.0, 1.6),
        kit.label('POWER SUPPLY', 22.0, 15.5, 1.0),
        kit.label('DC 6.5-12V', 21.0, 33.0, 0.9),
        kit.label('3.3V/OFF/5V', 39.0, 31.6, 0.8),
    ]
    pcb, top = kit.board(root, 'pcb', (0, 0, L, W), z0, 1.6, '1d5a3a', args.px, labels,
                         holes=mounting_holes(L, W, 48, 30, 3.0))
    m = kit.Mesh()
    black = kit.material('jack-black', '1d1e20', Roughness=0.55)
    steel = kit.material('usb-shell', 'b7b9bd', Metallic=1.0, Roughness=0.35)
    dark = kit.material('socket-dark', '08090a', Roughness=0.8)
    m.box((0.2, 22.0, top), (14.4, 31.0, top + 10.4), black, taper=0.15)  # DC barrel jack
    m.tube((0.17, 26.5, top + 5.2), (0.21, 26.5, top + 5.2), 2.9, dark, n=20)
    m.tube((0.17, 26.5, top + 5.2), (0.23, 26.5, top + 5.2), 1.0, steel, n=12)
    m.box((0.0, 4.0, top), (13.4, 16.2, top + 5.8), steel)  # USB-A receptacle
    m.box((-0.02, 5.2, top + 1.0), (0.1, 15.0, top + 2.0), dark)
    m.box((-0.02, 5.2, top + 3.8), (0.1, 15.0, top + 4.8), dark)
    m.box((19.0, 25.0, top), (27.6, 29.0, top + 3.4), kit.material('switch', 'e8e8ea', Roughness=0.5))
    m.box((21.5, 26.2, top + 3.4), (24.1, 27.8, top + 4.6), black)  # the slide switch
    for y in (27.5, 21.0):  # two linear regulators, SOT-223
        m.box((30.0, y - 1.75, top), (36.5, y + 1.75, top + 1.6), mp.epoxy(), taper=0.05)
        m.box((36.5, y - 1.5, top + 0.2), (39.0, y + 1.5, top + 0.7), mp.tin())
    mp.can(m, 25.0, 9.0, top, 3.15, 7.0)
    mp.can(m, 31.5, 10.0, top, 3.15, 7.0)
    mp.led(m, 18.0, 9.0, top, '36d160', (2.0, 1.25, 0.8))
    mp.resistor(m, 18.0, 6.2, top)
    mp.capacitor(m, 27.0, 17.2, top)
    # Two 5V / OFF / 3.3V jumper blocks, each a 3-pin header with a cap over two pins.
    for x in (41.0, 46.0):
        row = [(None, (x, 22.0 + k * kit.PITCH)) for k in range(3)]
        kit.header(m, root, row, mp.black_plastic(), mp.gold(), top, row_dir=(0, 1), base_h=2.5, above=3.2, tail=0.0)
        m.box((x - 1.2, 21.5, top + 2.5), (x + 1.2, 26.6, top + 6.2), kit.material('jumper-cap', 'e9c23a', Roughness=0.5))
    parts = m.to_object('components', root)
    first = pins[0]['offsetPitch']
    strip = [(p['id'], (x0 + (p['offsetPitch'][0] - first[0]) * kit.PITCH, y0 + (p['offsetPitch'][1] - first[1]) * kit.PITCH)) for p in pins]
    rows = [[s for s in strip if abs(s[1][1] - y0 - r * kit.PITCH) < 1e-6] for r in (0, 1)]
    pin_obj = mp.headers(root, rows, top)
    return [('body', [pcb, parts]), ('pins', [pin_obj])]


def relay_module(root, part, args):
    G = part['geometry']['params']
    L, W = G['boardLengthMm'], G['boardWidthMm']
    z0 = mp.TAIL
    pins = part['pins']
    sockets = [p for p in pins if p['connector'] == 'female-socket']
    headers = [p for p in pins if p['connector'] == 'male-pin']
    pitch_t = G['screwTerminalPitchMm']
    hx, hy = L / 2 - 5.0, 1.6  # the S pin; the screw terminals sit 10 pitches away
    block_y1 = W
    labels = [kit.label('5V RELAY MODULE', 4.2, W / 2, 1.2, rotation=90)]
    pcb, top = kit.board(root, 'pcb', (0, 0, L, W), z0, 1.6, '15161a', args.px, labels,
                         holes=mounting_holes(L, W, L - 6.0, W - 6.0, 3.1), radius=1.2)
    m = kit.Mesh()
    # The Songle relay: a blue case, its top marked.
    rx0, rx1 = L / 2 - G['relayLengthMm'] / 2, L / 2 + G['relayLengthMm'] / 2
    ry0, ry1 = 3.1, 3.1 + G['relayWidthMm']
    case = kit.material('relay-case', '2058a8', Roughness=0.45)
    m.box((rx0, ry0, top), (rx1, ry1, top + G['relayHeightMm']), case, taper=0.2)
    relay = m.to_object('relay', root)
    rect = (rx0 + 0.2, ry0 + 0.2, rx1 - 0.2, ry1 - 0.2)
    img = kit.decal('relay-top', rect, [256, 256], '2058a8', [
        kit.label('SRD-05VDC-SL-C', (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2 + 2.0, 1.1, ink='f4f4f0'),
        kit.label('SONGLE', (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2 - 0.4, 1.4, ink='f4f4f0'),
        kit.label('10A 250VAC  10A 30VDC', (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2 - 2.6, 0.8, ink='dfe6f0'),
    ])
    top_mat = kit.material('relay-top', '2058a8', Roughness=0.45)
    kit.textured(top_mat, img)
    kit.mark_top(relay, rect, top + G['relayHeightMm'] - 0.0, top_mat)
    # The three-way screw terminal block on the far edge, wire entries facing out of the edge.
    tx0 = hx - pitch_t / 2
    tx1 = hx + 2 * pitch_t + pitch_t / 2
    block_h, block_d = 10.0, 8.4
    c = kit.Mesh()
    blue = kit.material('terminal-blue', '2a63c4', Roughness=0.5)
    c.box((tx0, block_y1 - block_d, top), (tx1, block_y1, top + block_h), blue, taper=0.1)
    for k in range(3):
        sx = hx + k * pitch_t
        c.disc((sx, block_y1 - block_d / 2 - 0.5), 1.9, top + block_h, top + block_h + 0.25, mp.tin(), n=14)
    # Small parts: the driver transistor, diode, resistor.
    c.box((28.2, 12.0, top), (31.2, 13.4, top + 1.1), mp.epoxy())
    mp.resistor(c, 29.7, 9.2, top)
    mp.resistor(c, 29.7, 6.4, top)
    c.box((29.0, 15.6, top), (32.0, 16.8, top + 1.2), kit.material('diode', '2a2b2f', Roughness=0.5))
    parts = c.to_object('components', root)
    # The indicator LED's lens: a node the studio lights.
    lm = kit.Mesh()
    lm.box((30.0, 3.4, top), (32.0, 4.65, top + 0.9), kit.material('led-lens', '3fd36a', Roughness=0.25))
    lens = lm.to_object('lens', root)
    # The armature hinges inside the case; it never shows through the opaque case.
    pivot = kit.node(root, 'armature', (rx0 + 4.0, (ry0 + ry1) / 2, top + 4.0))
    am = kit.Mesh()
    am.box((0.0, -3.0, -0.2), (G['relayLengthMm'] - 9.0, 3.0, 0.2), kit.material('armature', 'a9acb1', Metallic=1.0, Roughness=0.35))
    am.to_object('armature-mesh', pivot)
    # Entry labels and holes drawn on a panel at the block's face.
    width = tx1 - tx0
    holes = [('box', (k * pitch_t + pitch_t / 2) - 1.7, 3.0, (k * pitch_t + pitch_t / 2) + 1.7, 5.6, '050506') for k in range(3)]
    face_img = kit.decal('terminal-face', (0, 0, width, block_h), [256, 128], '2a63c4', holes)
    face_mat = kit.material('terminal-face', '2a63c4', Roughness=0.5)
    kit.textured(face_mat, face_img)
    # Facing +y: u runs toward -x from the block's +x end, v up, and u x v = +y.
    face = kit.panel(root, 'terminal-face', (tx1, block_y1 + 0.02, top), (-width, 0, 0), (0, 0, block_h), face_mat)
    strip = [(p['id'], (hx + p['offsetPitch'][0] * kit.PITCH, hy)) for p in headers]
    pin_obj = mp.headers(root, [strip], top)
    for p in sockets:
        # A wire enters the block's front face, mid-height; the pin empty points out of it.
        x = hx + p['offsetPitch'][0] * pitch_t / 2
        kit.pin_empty(root, p['id'], (x, block_y1 + 0.02, top + 4.3), (0, 1, 0))
    return [('body', [pcb, relay, parts, lens, face]), ('pins', [pin_obj])]


def joystick_module(root, part, args):
    G = part['geometry']['params']
    L, W = G['boardLengthMm'], G['boardWidthMm']
    z0 = mp.TAIL
    pins = part['pins']
    cx = L / 2
    hy = 2.2
    labels = [kit.label(p['label'], cx + (p['offsetPitch'][0] - 2) * kit.PITCH, 5.6, 0.85) for p in pins]
    labels += [kit.label('KY-023', cx, W - 2.4, 1.0)]
    pcb, top = kit.board(root, 'pcb', (0, 0, L, W), z0, 1.6, '1a2b3a', args.px, labels,
                         holes=mounting_holes(L, W, G['mountingHoleSpanLongApproxMm'], G['mountingHoleSpanShortApproxMm'], 3.0))
    gy = 15.0  # the thumbstick's axis
    m = kit.Mesh()
    black = kit.material('stick-black', '1b1c1f', Roughness=0.5)
    m.box((cx - 8.0, gy - 8.0, top), (cx + 8.0, gy + 8.0, top + 10.5), black, taper=0.2)
    mp.resistor(m, cx + 12.0, 6.0, top)
    mp.resistor(m, cx - 12.0, 6.0, top)
    base = m.to_object('base', root)
    # The stick tilts about the middle of its base; it is a pivot node.
    pivot = kit.node(root, 'stick', (cx, gy, top + 10.5))
    sm = kit.Mesh()
    top_z = z0 + part['bodyMm'][2] - (top + 10.5)  # the stick's top is the module's height
    sm.disc((0, 0), 2.0, 0, top_z - 3.2, black, n=12)
    sm.disc((0, 0), 7.2, top_z - 3.4, top_z - 0.4, black, n=24)
    sm.disc((0, 0), 6.4, top_z - 0.4, top_z, black, n=24, r_top=5.2)
    sm.to_object('stick-mesh', pivot)
    strip = [(p['id'], (cx + (p['offsetPitch'][0] - 2) * kit.PITCH, hy)) for p in pins]
    pin_obj = mp.headers(root, [strip], top)
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
    # The screen as a quad with UVs 0-1 over the character area, +v toward the top row.
    screen = kit.panel(root, 'lcd-screen', (cx - area_w / 2, cy - area_h / 2, top + stack - 0.4), (area_w, 0, 0), (0, area_h, 0),
                       kit.material('lcd-screen', '2a46b8', Roughness=0.25))
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
    hm.prism(arm, 1.0, 2.2, white)
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
    return [('body', [body]), ('cable', [wire_obj]), ('connector', [housing, front])]
