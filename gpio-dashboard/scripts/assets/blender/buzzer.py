"""12 mm magnetic buzzer, active and passive (SPEC 7, 10.4), from content/parts/active-buzzer.part.json
and passive-buzzer.part.json.

A rigid part: the origin is pin 1's hole on the board's top surface; the two pins are the grid's
(0, 0) and (3, 0) pitches, 7.62 mm apart, and the body stands on the board between them. A black
cylinder 12 mm across with a sound hole in its top and a + moulded beside the positive lead. The
active buzzer (built-in oscillator) has its hole covered by the kit's seal sticker and a sealed
black base; the passive one has an open hole and, under it, the bare green board of its coil. The
heights are the part definitions': 9.5 mm (Huawha TMB12A05) and 9.0 mm (Soberton WT-1209T).

    blender -b --factory-startup --python-exit-code 1 -P buzzer.py -- --part <part.json> --name <asset>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
R, H = P['bodyDiaMm'] / 2, P['heightMm']
HOLE = 0.9  # radius of the sound hole
PLUS_AT = 4.75  # distance of the + mark from the axis, on the positive lead's side
STICKER = 3.9  # radius of the active buzzer's seal
SEGS = 48
active = DEF['id'] == 'active-buzzer'

pins = DEF['pins']
CX = (pins[0]['offsetPitch'][0] + pins[-1]['offsetPitch'][0]) / 2 * pk.PITCH

body = pk.plastic('body', '#1a1a1d', 0.5)
hole = pk.plastic('hole', '#050506', 0.9)
board = pk.plastic('board', '#1f6b3a', 0.4)
seal = pk.plastic('seal', '#e8e2c6', 0.7)
marking = pk.plastic('marking', '#d6d6d0', 0.6)

top = [(R, H - 0.5), (R - 0.5, H), (HOLE, H), (HOLE, H - 1.5), (0, H - 1.5)]
if active:
    profile = [(0, 0), (R - 0.3, 0), (R, 0.3)] + top
    mats = [body] * 5 + [hole] * 2
else:
    # The coil's green board is inset under the case's lip.
    profile = [(0, 0), (R - 0.4, 0), (R - 0.4, 1.0), (R, 1.0)] + top
    mats = [board, board] + [body] * 4 + [hole] * 2

builder = pk.Builder()
builder.lathe(profile, mats, segs=SEGS, at=(CX, 0, 0))
if active:
    builder.lathe([(STICKER, H), (STICKER, H + 0.05), (0, H + 0.05)], seal, segs=SEGS, at=(CX, 0, 0))

# The + mark, where the positive lead is (pin 1, toward -x).
x, a, t = CX - PLUS_AT, 0.45, 0.1  # centre, arm length and half-width
cross = [(-t, -a), (t, -a), (t, -t), (a, -t), (a, t), (t, t), (t, a), (-t, a), (-t, t), (-a, t), (-a, -t), (-t, -t)]
builder.polygon([(x + dx, dy) for dx, dy in cross], H + 0.008, marking)

lo, hi = builder.bounds()
root = pk.root(args.name)
builder.finish('body', root)
for p in pins:
    pk.pin(root, p['id'], (p['offsetPitch'][0] * pk.PITCH, p['offsetPitch'][1] * pk.PITCH, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
