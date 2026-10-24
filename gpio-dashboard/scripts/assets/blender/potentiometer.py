"""16 mm rotary potentiometer, horizontal terminals (SPEC 7, 10.4, 10.6), from
content/parts/potentiometer-10k.part.json.

A rigid part: the origin is pin 1's hole on the board's top surface; the three pins are the grid's
(0, 0), (2, 0) and (4, 0) pitches. Dimensions are Alpha's RV16AF-20 drawing: a round case 16.5 mm
across and 9.1 mm deep, a front bezel 17 mm across, an M7 bushing 6.5 mm long and a 6 mm shaft 15
mm long measured from the bezel, with the shaft 12.5 mm above the board. The shaft points toward -y
and the case's rear face, which carries the three flat terminals, is the plane y = 0.3.
The terminals leave the underside of the case and end at the pins (material `lead`), where the
runtime's straight lead takes over, pointing down.

The shaft is the animated node `shaft`, which turns about its own axis (y) through the wiper's 300
degrees; its origin is on that axis, and in its modelled pose, with the slot upright, the wiper is
at 50 %. The shaft's cross-section is symmetric about its axis, so the node turns about it
wherever its pivot sits along it.

    blender -b --factory-startup --python-exit-code 1 -P potentiometer.py -- --part <part.json>
      --name <asset> --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
R_BODY, R_FRONT = P['bodyDiameterMm'] / 2, P['frontWidthMm'] / 2
DEPTH, BUSH_LEN = P['bodyDepthMm'], P['bushingLengthMm']
R_SHAFT, SHAFT_LEN = P['shaftDiameterMm'] / 2, P['shaftLengthMm']
ZC = P['shaftAxisHeightMm']
STRIP = (P['pinWidthMm'] / 2, P['pinThicknessMm'] / 2)
R_BUSH = 3.5  # the M7 thread's major radius
R_PLATE = R_BODY - 0.35  # the rear plate sits just inside the case
Y_REAR = STRIP[1] + 0.05  # the rear plane, just behind the strips, which are centred on y = 0
Y_FRONT = Y_REAR - DEPTH
Y_BUSH = Y_FRONT - BUSH_LEN
Y_TIP = Y_FRONT - SHAFT_LEN
SEGS = 48

pins = DEF['pins']
xs = [p['offsetPitch'][0] * pk.PITCH for p in pins]
CX = xs[len(xs) // 2]  # the shaft is over the middle terminal, the wiper

steel = pk.metal('case', '#a9acaf', 0.4)
nickel = pk.metal('bushing', '#cdcfd1', 0.3)
shaft_mat = pk.metal('shaft', '#c3c5c7', 0.28)
base = pk.plastic('base', '#c4682a', 0.5)
slot = pk.plastic('slot', '#18181a', 0.6)
lead = pk.metal('lead', '#c4c2bb', 0.35)

profile = [
    (0, Y_BUSH), (R_BUSH - 0.25, Y_BUSH), (R_BUSH, Y_BUSH + 0.25), (R_BUSH, Y_FRONT), (R_FRONT, Y_FRONT),
    (R_FRONT, Y_FRONT + 0.9), (R_BODY, Y_FRONT + 0.9), (R_BODY, Y_REAR - 0.9), (R_PLATE, Y_REAR - 0.9),
    (R_PLATE, Y_REAR), (0, Y_REAR),
]
mats = [nickel, nickel, nickel, steel, steel, steel, steel, steel, base, base]
builder = pk.Builder()
builder.lathe(profile, mats, segs=SEGS, at=(CX, 0, ZC), axis=pk.AXIS_Y)
lo, hi = builder.bounds()

# The terminals: flat strips from under the case down to the pins, one per pin.
for x in xs:
    underside = ZC - math.sqrt(R_PLATE**2 - (x - CX) ** 2)
    builder.box((x - STRIP[0], -STRIP[1], 0), (x + STRIP[0], STRIP[1], underside + 0.4), lead)

# The shaft, from inside the bushing to its tip, with a slot across the tip.
shaft = pk.Builder()
shaft.lathe(
    [(0, Y_TIP), (R_SHAFT - 0.3, Y_TIP), (R_SHAFT, Y_TIP + 0.3), (R_SHAFT, Y_BUSH + 1.4), (0, Y_BUSH + 1.4)],
    shaft_mat, segs=32, at=(CX, 0, ZC), axis=pk.AXIS_Y,
)
y = Y_TIP - 0.008
shaft.quad((CX - 0.35, y, ZC - R_SHAFT + 0.5), (CX + 0.35, y, ZC - R_SHAFT + 0.5), (CX + 0.35, y, ZC + R_SHAFT - 0.5), (CX - 0.35, y, ZC + R_SHAFT - 0.5), slot)

root = pk.root(args.name)
builder.finish('body', root)
shaft.finish('shaft', root, origin=(CX, Y_BUSH, ZC))
for p, x in zip(pins, xs):
    pk.pin(root, p['id'], (x, p['offsetPitch'][1] * pk.PITCH, 0), pk.DOWN)
pk.write(
    args,
    root,
    [pk.box_of('body', lo, hi)],
    [{'name': 'shaft', 'a': [round(c, 4) for c in (CX, Y_BUSH, ZC)], 'b': [round(c, 4) for c in (CX, Y_TIP, ZC)], 'radius': R_SHAFT}],
)
print(f"{args.name}: case {hi[0] - lo[0]:.2f} x {Y_REAR - Y_TIP:.2f} x {hi[2] - lo[2]:.2f} mm")
