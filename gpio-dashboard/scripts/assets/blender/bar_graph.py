"""A 10-segment LED bar graph from its content/parts/<id>.part.json (SPEC 7, 10.4). Kingbright
DC10EWA: a gray body with ten white diffused segments, 1.78 x 5.08 mm on a 2.54 mm pitch, and the
anode end (pin 1) marked by a chamfered corner.

Frame: origin at pin 1's hole on the board's top surface (z = 0), x along the row, y across.
Pins are at (dx, dy) * 2.54 from the part definition, the body centred on them. Segment n is the
node "bar-<n>", over pin n's column (LED n runs from pin n to pin 21 - n). Leads are generated at
runtime from the "pin-<id>" empties, +z pointing down.

    blender -b --factory-startup --python-exit-code 1 -P bar_graph.py -- --part <part.json>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json> [--preview <dir>]
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402
from lib import scene  # noqa: E402

args, part = kit.start()
G = part['geometry']['params']

L, W, H = G['bodyLengthMm'], G['bodyWidthMm'], G['bodyHeightMm']
COUNT = G['segmentCount']
BAR_W, BAR_H, BAR_PITCH = G['segmentWidthMm'], G['segmentHeightMm'], G['segmentPitchMm']
STANDOFF = 0.5
PROUD = 0.05
MARK = 1.0  # the anode mark: a corner chamfer this long

pins = part['pins']
px = [p['offsetPitch'][0] * kit.PITCH for p in pins]
py = [p['offsetPitch'][1] * kit.PITCH for p in pins]
cx, cy = (min(px) + max(px)) / 2, (min(py) + max(py)) / 2
x0, x1, y0, y1 = cx - L / 2, cx + L / 2, cy - W / 2, cy + W / 2

face = kit.material('face', '8c8d8f', Roughness=0.5)
seg = kit.material('segment', 'ecebe6', Roughness=0.35)

root = scene.link(bpy.data.objects.new(part['id'], None))

m = kit.Mesh()
m.prism(
    [(x0 + MARK, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0 + MARK)], STANDOFF, H, face
)
body = m.to_object('body', root)

for n in range(COUNT):
    x = px[0] + n * BAR_PITCH
    bm = kit.Mesh()
    bm.box((x - BAR_W / 2, cy - BAR_H / 2, H - 0.6), (x + BAR_W / 2, cy + BAR_H / 2, H + PROUD), seg)
    bm.to_object(f'bar-{n + 1}', root)

for pin, x, y in zip(pins, px, py):
    kit.pin_empty(root, pin['id'], (x, y, STANDOFF), (0, 0, -1))

kit.finish(args, root, [kit.box_of('body', body)])
print(f"{part['id']}: {kit.triangles(root)} triangles")
