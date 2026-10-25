"""Round single-colour LED, 3 mm and 5 mm (SPEC 7, 10.4), from content/parts/led.part.json.

One file per size (--variant 3mm | 5mm reads that size's "<size>.<param>" entries). A flex-2lead
part: the origin is the midpoint of the two leads, which leave the underside of the flange pointing
down; the anode (pin 1) is at -x and the cathode, on the flat side of the flange, at +x. The epoxy
is one material, `lens`, which the studio tints and lights from the current. The lead frame inside
it (the cathode's cup, the anode's post, the bond wire) and the die show through the clear dome.

    blender -b --factory-startup --python-exit-code 1 -P led.py -- --part <part.json> --name <asset>
      --variant <3mm|5mm> --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
DOME, FLANGE, THICK, LENGTH = P['domeDiameterMm'], P['flangeDiameterMm'], P['flangeThicknessMm'], P['bodyLengthMm']
HALF = P['leadPitchMm'] / 2
SEAT = 1.0  # mm of lead showing between the flange and the board: a modelling choice, not a datasheet value
BIG = DOME > 4

# Default red; the studio replaces the lens from the colour property and lights it.
lens = pk.driven(pk.plastic('lens', '#ff2a1f', 0.2, Transmission_Weight=1.0, IOR=1.5))
frame = pk.metal('frame', '#c9c9c4', 0.3)
die = pk.driven(pk.plastic('die', '#f4e7a3', 0.4))

builder = pk.Builder()
rd, zc = pk.led_epoxy(builder, lens, FLANGE, THICK, DOME, LENGTH, flat=1, segs=32 if BIG else 24, steps=6 if BIG else 5)

# Inside the dome, scaled to its size: the cathode leg climbs to a cup on the axis holding the
# die; the anode leg ends in a post, and a bond wire joins the post to the die.
s = rd / 2.5
za = THICK + 0.5 * (zc - THICK)
zk = THICK + 0.35 * (zc - THICK)
leg = 0.2
builder.sweep([(HALF, 0, 0), (HALF, 0, zk), (0.1 * s, 0, za - 0.1)], leg, frame, segs=6)
builder.lathe(
    [(0, za - 0.12), (0.45 * s, za - 0.12), (0.85 * s, za + 0.45 * s), (0.75 * s, za + 0.45 * s), (0.35 * s, za), (0, za)],
    frame, segs=16,
)
builder.box((-0.15 * s, -0.15 * s, za), (0.15 * s, 0.15 * s, za + 0.14), die)
builder.sweep([(-HALF, 0, 0), (-HALF, 0, zk), (-0.9 * s, 0, za + 0.3 * s)], leg, frame, segs=6)
builder.sweep([(0.05 * s, 0, za + 0.14), (-0.3 * s, 0, za + 0.45 * s), (-0.9 * s, 0, za + 0.3 * s)], 0.035, frame, segs=4)

lo, hi = builder.bounds()
root = pk.root(args.name, seat_mm=SEAT)
builder.finish('body', root)
anode, cathode = (p['id'] for p in DEF['pins'])
pk.pin(root, anode, (-HALF, 0, 0), pk.DOWN)
pk.pin(root, cathode, (HALF, 0, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
