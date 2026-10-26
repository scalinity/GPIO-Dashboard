"""A 10-segment LED bar graph from its content/parts/<id>.part.json (SPEC 7, 10.4). The package is
Kingbright DC10EWA's drawing (25.4 x 10.16 x 8 mm, ten 1.78 x 5.08 mm segments on a 2.54 mm pitch,
the anode end, pin 1, marked by a chamfered corner); the look is the kit's own part, marked
2510SR-1: a white housing with a black face, the ten segments white diffused epoxy flush with it,
and "2510SR-1  420" printed in black on the side along pins 1 to 10 (SunFounder's photo of it on
the Basic Starter Kit's page 1.3.3, led_bar_sche.png, and the kit's component list).

Frame: origin at pin 1's hole on the board's top surface (z = 0), x along the row, y across.
Pins are at (dx, dy) * 2.54 from the part definition, the body centred on them. Segment n is the
node "bar-<n>", over pin n's column (LED n runs from pin n to pin 21 - n). Leads are generated at
runtime from the "pin-<id>" empties, +z pointing down.

    blender -b --factory-startup --python-exit-code 1 -P bar_graph.py -- --part <part.json>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json> [--preview <dir>]
"""
import math
import os
import sys

from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402

args, part = kit.start()
G = part['geometry']['params']

L, W, H = G['bodyLengthMm'], G['bodyWidthMm'], G['bodyHeightMm']
COUNT = G['segmentCount']
BAR_W, BAR_H, BAR_PITCH = G['segmentWidthMm'], G['segmentHeightMm'], G['segmentPitchMm']
STANDOFF = 0.5
PROUD = 0.05  # the face lies this far below the segments' tops, which stand at the body's height
MARK = 1.0  # the anode mark: a corner chamfer this long
# The side marking as the kit's photo shows it: the part number centred 11 mm along the side from
# pin 1's end and the lot code 20.5 mm along, both 1.85 mm tall with their middle 2.7 mm below the
# face.
MARKING = (('2510SR-1', 11.05), ('420', 20.55))
INK_MM = 1.85
INK_BELOW_TOP = 2.7
GLYPH = 0.73  # Blender's built-in font: capitals and digits stand 0.73 of the size tall

pins = part['pins']
px = [p['offsetPitch'][0] * kit.PITCH for p in pins]
py = [p['offsetPitch'][1] * kit.PITCH for p in pins]
cx, cy = (min(px) + max(px)) / 2, (min(py) + max(py)) / 2
x0, x1, y0, y1 = cx - L / 2, cx + L / 2, cy - W / 2, cy + W / 2

housing = kit.material('housing', 'e6e7e5', Roughness=0.5)
face = kit.material('face', '0e0e10', Roughness=0.45)
seg = kit.material('segment', 'dfded8', Roughness=0.3)
ink = kit.material('marking', '232326', Roughness=0.6)

root = kit.root(args)

m = kit.Mesh()
m.prism(
    [(x0 + MARK, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0 + MARK)],
    STANDOFF,
    H - PROUD,
    housing,
    bottom=housing,
    top=face,
)
# The printing faces -y, upright: drawn facing +z, stood up by a quarter turn about x.
for text, along in MARKING:
    m.text(
        text, INK_MM / GLYPH, (x0 + along, y0 - 0.006, H - PROUD - INK_BELOW_TOP),
        Matrix.Rotation(math.pi / 2, 3, 'X'), ink,
    )
body = m.to_object('body', root)

bars = []
for n in range(COUNT):
    x = px[0] + n * BAR_PITCH
    bm = kit.Mesh()
    ring = [
        (x - BAR_W / 2, cy - BAR_H / 2), (x + BAR_W / 2, cy - BAR_H / 2),
        (x + BAR_W / 2, cy + BAR_H / 2), (x - BAR_W / 2, cy + BAR_H / 2),
    ]
    # Set into the face; its underside is inside the body and never seen.
    bm.extrude(ring, H - 0.6, H, seg, caps=(False, True))
    bars.append(bm.to_object(f'bar-{n + 1}', root))

for pin, x, y in zip(pins, px, py):
    kit.pin_empty(root, pin['id'], (x, y, STANDOFF), (0, 0, -1))

# The collider is the housing's box, which holds the segments; the printing stands 0.006 mm off its side.
kit.finish(args, root, [kit.partkit.box_of('body', (x0, y0, STANDOFF), (x1, y1, float(H)))])
print(f"{part['id']}: {kit.triangles(root)} triangles")
