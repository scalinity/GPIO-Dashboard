"""Radial molded ceramic capacitor (SPEC 7, 10.4), from content/parts/ceramic-capacitor.part.json.

A flex-2lead part: the origin is the midpoint of the two leads, at the drawing's 5.08 mm spacing,
which leave the underside pointing down. The body stands on them, 0.5 mm up, with the leads
stepping in under it by the width of a lead (the formed stubs, material `lead`, belong to the
model). Dimensions are KEMET's C052 drawing: 4.83 wide, 2.29 thick, 4.83 tall, rounded at the top.

    blender -b --factory-startup --python-exit-code 1 -P ceramic_cap.py -- --part <part.json>
      --name <asset> --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402
from mathutils import Matrix  # noqa: E402

args, DEF, P = pk.start()
W, H, T = P['bodyLengthMm'], P['bodyHeightMm'], P['bodyThicknessMm']
SPACING, LEAD = P['leadSpacingMm'], P['leadDiameterMm']
SEAT = 1.0  # mm of lead showing between the body and the board: a modelling choice, not a datasheet value
LIFT = 0.5  # where the body's underside is above the pins
CORNER = 1.3  # radius of the rounded top corners
EDGE = 0.25  # rounding of the moulded edges

body = pk.plastic('body', '#e58b2c', 0.4)
lead = pk.metal('lead', '#c7c5be', 0.35)

# The silhouette seen from the front (x, z), counter-clockwise: square at the bottom, rounded on top.
arc = lambda cx, cz, a0: [(cx + CORNER * math.cos(a0 + math.pi / 2 * k / 6), cz + CORNER * math.sin(a0 + math.pi / 2 * k / 6)) for k in range(7)]  # noqa: E731
outline = [(-W / 2, LIFT), (W / 2, LIFT)] + arc(W / 2 - CORNER, LIFT + H - CORNER, 0) + arc(-W / 2 + CORNER, LIFT + H - CORNER, math.pi / 2) + []

builder = pk.Builder()
builder.prism(outline, -T / 2, T / 2, body, bottom=body, top=body)
# Round the moulded edges of the two faces only, and stand the silhouette up (x, y) -> (x, z).
builder.bevel(EDGE, 2, where=lambda e: any(len(f.verts) > 4 for f in e.link_faces))
builder.transform(Matrix.Rotation(math.pi / 2, 3, 'X'))
lo, hi = builder.bounds()

# The leads: the drawing's spacing at the pins, narrowing to the body's underside.
for side in (-1, 1):
    inner = side * (W / 2 - LEAD / 2 - 0.2)
    builder.sweep([(inner, 0, LIFT + 0.15), (inner, 0, LIFT), (side * SPACING / 2, 0, 0)], LEAD / 2, lead, segs=6)

root = pk.root(args.name, seat_mm=SEAT)
builder.finish('body', root)
first, second = (p['id'] for p in DEF['pins'])
pk.pin(root, first, (-SPACING / 2, 0, 0), pk.DOWN)
pk.pin(root, second, (SPACING / 2, 0, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
