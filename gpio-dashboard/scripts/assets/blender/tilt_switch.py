"""Roll-ball tilt switch, SW-520D (SPEC 7, 10.4), from content/parts/tilt-switch.part.json.

A rigid part: the origin is pin 1's hole on the board's top surface. The two pins sit on the grid
at x = 0 and 2.54 (the datasheet's 2.4 mm spacing, taken up by the leads' bend, as the part
definition says), where the leads leave a black resin plug. The switch stands on them: a
tin-plated can 5.2 mm across around the plug, its upper end closed and rounded, 11.5 mm tall in
all, 2 mm above the board. The ball is sealed inside the can and is not modelled.

    blender -b --factory-startup --python-exit-code 1 -P tilt_switch.py -- --part <part.json>
      --name <asset> --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
R, L = P['bodyDiaMm'] / 2, P['bodyLengthMm']
ZB = 2.0  # the plug's underside above the board, where the leads leave it
PLUG = 0.25  # how far the plug is inside the can's rim
ROUND = 0.5  # radius of the can's rounded upper edge
STEPS = 4

pins = DEF['pins']
CX = (pins[0]['offsetPitch'][0] + pins[-1]['offsetPitch'][0]) / 2 * pk.PITCH

can = pk.metal('can', '#b8babd', 0.28)
resin = pk.plastic('resin', '#0f0f11', 0.5)

zt = ZB + L
profile = (
    [(0, ZB), (R - PLUG, ZB), (R, ZB), (R, ZB + 2.2), (R - 0.15, ZB + 2.35), (R - 0.15, ZB + 2.55), (R, ZB + 2.7), (R, zt - ROUND)]
    + [(R - ROUND + ROUND * math.cos(a), zt - ROUND + ROUND * math.sin(a)) for a in (math.pi / 2 * k / STEPS for k in range(1, STEPS + 1))]
    + [(0, zt)]
)
mats = [resin] + [can] * (len(profile) - 2)

builder = pk.Builder()
builder.lathe(profile, mats, segs=32, at=(CX, 0, 0))
lo, hi = builder.bounds()
root = pk.root(args.name)
builder.finish('body', root)
for p in pins:
    pk.pin(root, p['id'], (p['offsetPitch'][0] * pk.PITCH, p['offsetPitch'][1] * pk.PITCH, ZB), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
