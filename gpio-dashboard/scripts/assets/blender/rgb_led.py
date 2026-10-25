"""5 mm RGB LED, four leads, common anode or common cathode (SPEC 7, 10.4), from
content/parts/rgb-led-ca.part.json and rgb-led-cc.part.json.

A rigid part: the origin is pin 1's hole on the board's top surface, and the four pins sit on the
2.54 mm grid at x = 0, 2.54, 5.08 and 7.62. The leads leave the flange at the datasheet's 1.27 mm
pitch, so each is formed outward to its hole: the formed stubs (material `lead`) belong to the
model and end at the pins, where the runtime's straight lead takes over, pointing down. One clear
dome holds three dies on one anvil; each die is its own material (die-r, die-g, die-b) for the
studio to light. The dome's flat is on the red lead's side.

    blender -b --factory-startup --python-exit-code 1 -P rgb_led.py -- --part <part.json> --name <asset>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
DOME, FLANGE, THICK, LENGTH = P['domeDiameterMm'], P['flangeDiameterMm'], P['flangeThicknessMm'], P['bodyHeightMm']
SQUARE = P['leadSquareMm']
NATIVE = P['leadPitchNativeMm']
ZB = 3.0  # the flange's underside above the board, where the formed leads leave it
pins = DEF['pins']
CX = (len(pins) - 1) / 2 * pk.PITCH  # the dome's axis: the middle of the four holes

lens = pk.driven(pk.plastic('lens', '#eef1ff', 0.2, Transmission_Weight=1.0, IOR=1.5))
frame = pk.metal('frame', '#c9c9c4', 0.3)
lead = pk.metal('lead', '#c4c4bf', 0.35)
dies = {
    'R': pk.driven(pk.plastic('die-r', '#ff3b2a', 0.4)),
    'G': pk.driven(pk.plastic('die-g', '#3cff6a', 0.4)),
    'B': pk.driven(pk.plastic('die-b', '#3a5cff', 0.4)),
}

builder = pk.Builder()
rd, zc = pk.led_epoxy(builder, lens, FLANGE, THICK, DOME, LENGTH, flat=-1, segs=32, steps=6, at=(CX, 0, ZB))

# The formed leads: straight up into the flange at the native pitch, then out to the grid.
native = [CX + (i - (len(pins) - 1) / 2) * NATIVE for i in range(len(pins))]
hole = [p['offsetPitch'][0] * pk.PITCH for p in pins]
for xn, xh in zip(native, hole):
    builder.sweep([(xn, 0, ZB + 0.15), (xn, 0, ZB - 0.4), (xh, 0, 0.5), (xh, 0, 0)], SQUARE / 2, lead, segs=6)

# Inside the dome: the common lead (the second) climbs to a wide anvil on the axis holding the
# three dies; each other lead ends in a post, joined to its die by a bond wire.
za = ZB + THICK + 0.5 * (zc - ZB - THICK)
zk = ZB + THICK + 0.35 * (zc - ZB - THICK)
common = 1
builder.sweep([(native[common], 0, ZB), (native[common], 0, zk), (CX, 0, za - 0.1)], 0.2, frame, segs=6)
builder.lathe(
    [(0, za - 0.12), (0.7, za - 0.12), (1.2, za + 0.55), (1.1, za + 0.55), (0.65, za), (0, za)],
    frame, segs=16, at=(CX, 0, 0),
)
others = [i for i in range(len(pins)) if i != common]
for i, die_x in zip(others, (-0.45, 0.0, 0.45)):
    xn = native[i]
    post = (CX + (xn - CX) * 0.55, 0, za + 0.3)
    builder.sweep([(xn, 0, ZB), (xn, 0, zk), post], 0.15, frame, segs=6)
    builder.box((CX + die_x - 0.13, -0.13, za), (CX + die_x + 0.13, 0.13, za + 0.12), dies[pins[i]['id']])
    builder.sweep([(CX + die_x, 0, za + 0.12), ((CX + die_x + post[0]) / 2, 0, za + 0.5), post], 0.03, frame, segs=4)

lo, hi = builder.bounds(exclude=(lead,))
root = pk.root(args.name)
builder.finish('body', root)
for p, x in zip(pins, hole):
    pk.pin(root, p['id'], (x, p['offsetPitch'][1] * pk.PITCH, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
