"""TO-92 transistor (SPEC 7, 10.4), from content/parts/pn2222.part.json, s8050.part.json and
s8550.part.json.

A rigid part: the origin is pin 1's hole on the board's top surface and the three pins sit on the
2.54 mm grid, along +x. The flat face of the body points toward -y (column a at rotation 0), as the
part definitions' notes place it, with pin 1 on the left seen from that face. The body stands
3 mm above the board; its leads leave the underside at the package's 1.27 mm pitch, so the outer two
are formed outward to their holes. The formed stubs (material `lead`) belong to the model and end
at the pins, where the runtime's straight lead takes over, pointing down. The part number is
printed on the flat face as geometry.

    blender -b --factory-startup --python-exit-code 1 -P to92.py -- --part <part.json> --name <asset>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402
from mathutils import Matrix  # noqa: E402

args, DEF, P = pk.start()
W, DEPTH, H = P['bodyWidthMm'], P['bodyDepthMm'], P['bodyHeightMm']
LEAD = P.get('leadWidthMm') or P.get('leadDiaMaxMm')
NATIVE = 1.27  # the package's lead pitch
ZB = 3.0  # the body's underside above the board
CAP = 1.0  # height of the domed top
STEPS = 5
# What is printed on each part's flat face (the PN2222 in the kit is marked PN2222A).
MARKING = {'pn2222': 'PN2222A', 's8050': 'S8050', 's8550': 'S8550'}

R = W / 2
FLAT = DEPTH - R  # the flat face's distance from the body's axis, toward -y
pins = DEF['pins']
CX = pins[1]['offsetPitch'][0] * pk.PITCH  # the body's axis: over the middle pin

epoxy = pk.plastic('epoxy', '#141416', 0.42)
marking = pk.plastic('marking', '#e6e6e0', 0.5)
lead = pk.metal('lead', '#c8c6bf', 0.35)

zt = ZB + H
profile = (
    [(0, ZB), (R - 0.15, ZB), (R, ZB + 0.15), (R, zt - CAP)]
    + [(R * math.cos(a), zt - CAP + CAP * math.sin(a)) for a in (math.pi / 2 * k / STEPS for k in range(1, STEPS + 1))]
)


builder = pk.Builder()
builder.lathe(profile, epoxy, segs=32, at=(CX, 0, 0))
builder.cut((CX, -FLAT, 0), (0, -1, 0), epoxy)  # the flat face, toward -y
# The flat face reads from -y: the text is drawn facing +z and stood up with a quarter turn about x.
builder.text(
    MARKING[DEF['id']], 0.8, (CX, -FLAT - 0.006, ZB + 0.45 * H), Matrix.Rotation(math.pi / 2, 3, 'X'), marking, fit=3.3
)
lo, hi = builder.bounds()

for i, p in enumerate(pins):
    xh = p['offsetPitch'][0] * pk.PITCH
    xn = CX + (i - (len(pins) - 1) / 2) * NATIVE
    builder.sweep([(xn, 0, ZB + 0.15), (xn, 0, ZB - 0.5), (xh, 0, 0.8), (xh, 0, 0)], LEAD / 2, lead, segs=6)

root = pk.root(args.name)
builder.finish('body', root)
for p in pins:
    pk.pin(root, p['id'], (p['offsetPitch'][0] * pk.PITCH, p['offsetPitch'][1] * pk.PITCH, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
