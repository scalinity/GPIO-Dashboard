"""Components the module variants share (SPEC 10.4 "Off-board modules"): header strips, SMD
chips and passives, electrolytic cans. They add to a devicekit.Mesh and use one set of materials,
so every module reads from the same palette."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402

TAIL = 1.5  # header pin tails under the board: a module rests on them, at z = 0
BASE_H = 2.5  # a header's plastic base
ABOVE = 6.0  # a header pin above its base


def black_plastic():
    return kit.material('black-plastic', '17181a', Roughness=0.5)


def gold():
    return kit.material('pin-gold', 'd6b25c', Metallic=1.0, Roughness=0.3)


def tin():
    return kit.material('tin', 'c4c6c8', Metallic=1.0, Roughness=0.32)


def epoxy():
    return kit.material('epoxy', '121213', Roughness=0.5)


def headers(root, rows, board_top, along='x', name='pins'):
    """Straight male headers on a board's top face, pins up. rows is a list of lists of
    (pin id or None, (x, y)); each list is one strip along `along`. Makes the object `name`
    (plastic bases and metal pins, tails under the board) and a pin empty at each pin tip with
    +z up, where a female housing mates. Returns the object."""
    m = kit.Mesh()
    for row in rows:
        tips = kit.header(
            m,
            root,
            row,
            black_plastic(),
            gold(),
            board_top,
            row_dir=(1, 0) if along == 'x' else (0, 1),
            base_h=BASE_H,
            above=ABOVE,
            tail=TAIL,
        )
        for pid, at in tips:
            if pid is not None:
                kit.pin_empty(root, pid, at, (0, 0, 1))
    return m.to_object(name, root)


def chip(m, cx, cy, z, bx, by, h, n, pitch):
    """A small-outline chip: body bx (x) by (y) h tall, n leads per long side, pitch apart."""
    m.box((cx - bx / 2, cy - by / 2, z), (cx + bx / 2, cy + by / 2, z + h), epoxy(), taper=0.05)
    for side in (-1, 1):
        for i in range(n):
            x = cx + (i - (n - 1) / 2) * pitch
            edge = cy + side * by / 2
            y0, y1 = sorted((edge - side * 0.1, edge + side * 0.7))
            m.box((x - 0.12, y0, z), (x + 0.12, y1, z + 0.18), tin())


def smd(m, cx, cy, z, length, width, height, body, along='x'):
    """A chip resistor or capacitor with tinned end caps."""
    lx, ly = (length, width) if along == 'x' else (width, length)
    m.box((cx - lx / 2, cy - ly / 2, z), (cx + lx / 2, cy + ly / 2, z + height), body)
    cap = min(length * 0.25, 0.5)
    for s in (-1, 1):
        if along == 'x':
            x0, x1 = sorted((cx + s * lx / 2, cx + s * (lx / 2 - cap)))
            m.box((x0, cy - ly / 2, z), (x1, cy + ly / 2, z + height + 0.02), tin())
        else:
            y0, y1 = sorted((cy + s * ly / 2, cy + s * (ly / 2 - cap)))
            m.box((cx - lx / 2, y0, z), (cx + lx / 2, y1, z + height + 0.02), tin())


def resistor(m, cx, cy, z, size=(2.0, 1.25, 0.5), along='x'):
    smd(m, cx, cy, z, *size, kit.material('smd-resistor', '1c1c1d', Roughness=0.6), along)


def capacitor(m, cx, cy, z, size=(2.0, 1.25, 0.8), along='x'):
    smd(m, cx, cy, z, *size, kit.material('smd-ceramic', '8d7a52', Roughness=0.55), along)


def can(m, cx, cy, z, r, h):
    """An electrolytic capacitor: a black sleeve with a metal top."""
    m.disc((cx, cy), r, z, z + h - 0.3, kit.material('can-sleeve', '1b1d22', Roughness=0.45), n=16)
    m.disc((cx, cy), r - 0.25, z + h - 0.3, z + h, kit.material('can-top', 'b8bbc0', Metallic=1.0, Roughness=0.35), n=16)


def led(m, cx, cy, z, hex6='3fd36a', size=(1.6, 0.8, 0.6), along='x'):
    lx, ly = (size[0], size[1]) if along == 'x' else (size[1], size[0])
    m.box((cx - lx / 2, cy - ly / 2, z), (cx + lx / 2, cy + ly / 2, z + size[2]), kit.material(f'led-{hex6}', hex6, Roughness=0.3))
