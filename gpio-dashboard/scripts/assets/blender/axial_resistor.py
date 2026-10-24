"""Axial-lead resistor, 1/4 W (SPEC 7, 10.4), from content/parts/resistor.part.json.

A flex-2lead part: the origin is the midpoint of the two leads, which leave the end caps along the
body's axis (x); the body lies on the board, so the pins sit one body radius above it (seatMm).
Dimensions are the Yageo CFR-25 drawing's. The four colour bands are separate primitives named
band-1 .. band-4 and the studio recolours them from the value and the tolerance.

    blender -b --factory-startup --python-exit-code 1 -P axial_resistor.py -- --part <part.json> --name <asset>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
L, D = P['bodyLengthMm'], P['bodyDiameterMm']
R = D / 2
CAP = 0.55  # length of each end cap
NECK = 0.06  # how far the lacquered body is under the caps' radius
BAND = (0.5, 0.012)  # width of a band, and how far it stands off the body
BAND_AT = (-1.9, -1.05, -0.2, 1.9)  # band centres along the axis; the fourth is the tolerance band
SEGS = 32

body = pk.plastic('body', '#6fa8c8', 0.45)
cap = pk.metal('cap', '#b9b7b0', 0.3)
# Default bands read 220 ohm 5%: red, red, brown, gold. The studio replaces them from the value.
bands = [
    pk.driven(pk.plastic(f'band-{i + 1}', hexa, 0.5, **extra))
    for i, (hexa, extra) in enumerate(
        (('#c1271d', {}), ('#c1271d', {}), ('#6b3a1a', {}), ('#d4a933', {'Metallic': 1.0}))
    )
]

half = L / 2
rb = R - NECK
profile = [
    (0, -half), (R - 0.12, -half), (R, -half + 0.12), (R, -half + CAP), (rb, -half + CAP),
    (rb, half - CAP), (R, half - CAP), (R, half - 0.12), (R - 0.12, half), (0, half),
]
mats = [cap, cap, cap, cap, body, cap, cap, cap, cap]

builder = pk.Builder()
builder.lathe(profile, mats, segs=SEGS, axis=pk.AXIS_X)
for z, mat in zip(BAND_AT, bands):
    builder.lathe([(rb + BAND[1], z - BAND[0] / 2), (rb + BAND[1], z + BAND[0] / 2)], mat, segs=SEGS, axis=pk.AXIS_X)

lo, hi = builder.bounds()
root = pk.root(args.name, seat_mm=R)
builder.finish('body', root)
first, second = (p['id'] for p in DEF['pins'])
pk.pin(root, first, (-half, 0, 0), pk.TOWARD_MINUS_X)
pk.pin(root, second, (half, 0, 0), pk.TOWARD_PLUS_X)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{DEF['id']}: {len(profile)} profile points, body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
