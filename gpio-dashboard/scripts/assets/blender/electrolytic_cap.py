"""Radial aluminium electrolytic capacitor (SPEC 7, 10.4), from
content/parts/electrolytic-capacitor.part.json.

A flex-2lead part: the origin is the midpoint of the two leads, 3.5 mm apart, which leave the
rubber seal pointing down. The positive lead (pin 1, "+") is at -x; the negative lead, with the
sleeve's marked stripe, is at +x. The can has its crimped base, the groove, the sleeve and a
scored vent in the top; the printed value is dynamic and is not in the model. Dimensions are
Nichicon's UVR 8 x 11.5 drawing.

    blender -b --factory-startup --python-exit-code 1 -P electrolytic_cap.py -- --part <part.json>
      --name <asset> --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
RC, L, SPACING = P['diameterMm'] / 2, P['lengthMm'], P['leadSpacingMm']
SLEEVE = 0.06  # the sleeve film's thickness
SEAT = 1.0  # mm of lead showing between the can and the board: a modelling choice, not a datasheet value
SEGS = 36
GROOVE = (1.1, 1.5, 0.28)  # the can's rolled groove: from z, to z, and how deep
STRIPE = math.radians(26)  # half the stripe's angle, centred on the negative lead (+x)
MINUS_AT = (3.0, 4.6, 6.2, 7.8, 9.4)  # heights of the minus signs along the stripe

sleeve = pk.plastic('sleeve', '#0d1018', 0.4)
stripe = pk.plastic('stripe', '#aeb4bc', 0.5)
mark = pk.plastic('mark', '#14171d', 0.5)
alu = pk.metal('aluminium', '#b4b7ba', 0.4)
seal = pk.plastic('seal', '#0c0c0e', 0.7)
vent = pk.metal('vent', '#6d7073', 0.5)

rs = RC + SLEEVE
top = L
profile = [
    (0, 0), (RC - 0.6, 0),                        # the rubber seal, flush with the can's rim
    (RC - 0.1, 0), (RC, 0.1), (RC, GROOVE[0]),    # the crimped base
    (RC - GROOVE[2], GROOVE[0] + 0.15), (RC - GROOVE[2], GROOVE[1] - 0.15), (rs, GROOVE[1]),  # the groove
    (rs, top - 0.45), (rs - 0.25, top - 0.1), (rs - 0.5, top),   # the sleeve, and the rolled top edge
    (0, top),
]
mats = [seal, alu, alu, alu, alu, alu, alu, sleeve, sleeve, alu, alu]

builder = pk.Builder()
builder.lathe(profile, mats, segs=SEGS)
# The stripe on the sleeve, its minus signs, and the vent's score marks on the top.
# Each layer stands off by more than the facets of the one under it sag (0.015 mm on the sleeve).
builder.arc_strip(rs + 0.02, GROOVE[1] + 0.05, top - 0.5, -STRIPE, STRIPE, stripe, segs=6)
for z in MINUS_AT:
    builder.arc_strip(rs + 0.045, z - 0.17, z + 0.17, -STRIPE * 0.55, STRIPE * 0.55, mark, segs=4)
zt = top + 0.01
for a, b in (((-1.0, -2.1), (-1.0, 2.1)), ((-1.0, 0.0), (1.9, 2.0)), ((-1.0, 0.0), (1.9, -2.0))):
    (xa, ya), (xb, yb) = a, b
    dx, dy = yb - ya, xa - xb
    n = math.hypot(dx, dy)
    w = 0.1 / n
    builder.quad((xa - dx * w, ya - dy * w, zt), (xa + dx * w, ya + dy * w, zt), (xb + dx * w, yb + dy * w, zt), (xb - dx * w, yb - dy * w, zt), vent)

lo, hi = builder.bounds()
root = pk.root(args.name, seat_mm=SEAT)
builder.finish('body', root)
positive, negative = (p['id'] for p in DEF['pins'])
pk.pin(root, positive, (-SPACING / 2, 0, 0), pk.DOWN)
pk.pin(root, negative, (SPACING / 2, 0, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
