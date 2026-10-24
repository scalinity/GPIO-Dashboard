"""Axial rectifier diode in a DO-41 package (SPEC 7, 10.4), from content/parts/diode-1n4007.part.json.

A flex-2lead part: the origin is the midpoint of the two leads, which leave the body's end faces
along x; the anode (pin 1) is at -x and the cathode, marked by the silver band, at +x. The body
lies on the board, so the pins sit one body radius above it (seatMm). Dimensions are Vishay's
DO-41 outline at its maxima, which the part definition's bodyMm also uses.

    blender -b --factory-startup --python-exit-code 1 -P diode.py -- --part <part.json> --name <asset>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
L, D = P['bodyLengthMm'], P['bodyDiameterMm']
R, half = D / 2, L / 2
ROUND = 0.4  # radius of the moulded body's rounded end
BAND = (0.9, 0.45)  # width of the cathode band, and its distance from the cathode end
SEGS = 32

body = pk.plastic('body', '#16171a', 0.38)
band = pk.plastic('band', '#cfcfca', 0.35, Metallic=0.7)

# The body is a hair under the band's radius, so the band is the widest part and sits flush.
rb = R - 0.012
corner = [(rb - ROUND + ROUND * math.sin(t), ROUND - ROUND * math.cos(t)) for t in (math.pi / 2 * k / 4 for k in range(5))]
profile = (
    [(0, -half)]
    + [(r, -half + z) for r, z in corner]
    + [(r, half - z) for r, z in reversed(corner)]
    + [(0, half)]
)

builder = pk.Builder()
builder.lathe(profile, body, segs=SEGS, axis=pk.AXIS_X)
z1 = half - BAND[1]
builder.lathe([(R, z1 - BAND[0]), (R, z1)], band, segs=SEGS, axis=pk.AXIS_X)

lo, hi = builder.bounds()
root = pk.root(args.name, seat_mm=R)
builder.finish('body', root)
anode, cathode = (p['id'] for p in DEF['pins'])
pk.pin(root, anode, (-half, 0, 0), pk.TOWARD_MINUS_X)
pk.pin(root, cathode, (half, 0, 0), pk.TOWARD_PLUS_X)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
