"""Bead-type NTC thermistor, 10 kOhm (SPEC 7, 10.4), from content/parts/ntc-10k.part.json.

A flex-2lead part: the origin is the midpoint of the two leads, 2.0 mm apart, which leave the
bottom of a glossy black epoxy drop pointing down. The drop is 2.2 mm across and 4.0 mm tall
(Semiware's MF52 drawing).

    blender -b --factory-startup --python-exit-code 1 -P ntc.py -- --part <part.json> --name <asset>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
R, L, SPACING = P['bodyDiameterMm'] / 2, P['bodyLengthMm'], P['leadSpacingMm']
SEAT = 1.0  # mm of lead showing between the bead and the board: a modelling choice, not a datasheet value
FOOT = 0.15  # radius of the rounded lower edge
CROWN = 1.4  # height of the domed top
STEPS = 8

epoxy = pk.plastic('epoxy', '#0a0a0c', 0.18)

zc = L - CROWN
profile = (
    [(0, 0)]
    + [(R - FOOT + FOOT * math.sin(a), FOOT - FOOT * math.cos(a)) for a in (math.pi / 2 * k / 3 for k in range(4))]
    + [(R, zc)]
    + [(R * math.cos(a), zc + CROWN * math.sin(a)) for a in (math.pi / 2 * k / STEPS for k in range(1, STEPS + 1))]
)

builder = pk.Builder()
builder.lathe(profile, epoxy, segs=24)
lo, hi = builder.bounds()
root = pk.root(args.name, seat_mm=SEAT)
builder.finish('body', root)
first, second = (p['id'] for p in DEF['pins'])
pk.pin(root, first, (-SPACING / 2, 0, 0), pk.DOWN)
pk.pin(root, second, (SPACING / 2, 0, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
