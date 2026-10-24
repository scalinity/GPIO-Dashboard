"""An 8 x 8 LED dot matrix from its content/parts/<id>.part.json (SPEC 7, 10.4). Shanghai Toplite
TOP-CA-788BS: a 20 mm square black body 5.9 mm high with 64 white 1.9 mm dots on a 2.5 mm pitch, and
pin 1 at the lower left of the dot field.

Frame: origin at pin 1's hole on the board's top surface (z = 0), x along the row, y across. Pins
are at (dx, dy) * 2.54 from the part definition (the real 2.5 mm pitch and 15 mm row spacing are
snapped to the breadboard grid there), the body centred on them. Dot "dot-<row>-<col>" follows the
datasheet's top view: row 1 at the top (+y), column 1 at the left (-x). Leads are generated at
runtime from the "pin-<id>" empties, +z pointing down.

    blender -b --factory-startup --python-exit-code 1 -P dot_matrix.py -- --part <part.json>
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
ROWS, COLS = G['rows'], G['cols']
DOT_D, DOT_PITCH = G['dotDiaMm'], G['dotPitchMm']
STANDOFF = 0.5
PROUD = 0.05
MARK = 1.0  # pin 1's corner is chamfered

pins = part['pins']
px = [p['offsetPitch'][0] * kit.PITCH for p in pins]
py = [p['offsetPitch'][1] * kit.PITCH for p in pins]
cx, cy = (min(px) + max(px)) / 2, (min(py) + max(py)) / 2
x0, x1, y0, y1 = cx - L / 2, cx + L / 2, cy - W / 2, cy + W / 2

face = kit.material('face', '0d0d0e', Roughness=0.4)
dot = kit.material('dot', 'ecebe6', Roughness=0.35)

root = scene.link(bpy.data.objects.new(part['id'], None))

m = kit.Mesh()
m.prism([(x0 + MARK, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0 + MARK)], STANDOFF, H, face)
body = m.to_object('body', root)

for r in range(ROWS):
    for c in range(COLS):
        x = cx + (c - (COLS - 1) / 2) * DOT_PITCH
        y = cy + ((ROWS - 1) / 2 - r) * DOT_PITCH
        dm = kit.Mesh()
        # A shallow dome: a short wall under a slightly smaller top, with no underside.
        dm.disc((x, y), DOT_D / 2, H - 0.4, H + PROUD, dot, n=10, r_top=DOT_D / 2 - 0.1, caps=(False, True))
        dm.to_object(f'dot-{r + 1}-{c + 1}', root)

for pin, x, y in zip(pins, px, py):
    kit.pin_empty(root, pin['id'], (x, y, STANDOFF), (0, 0, -1))

kit.finish(args, root, [kit.box_of('body', body)])
print(f"{part['id']}: {kit.triangles(root)} triangles")
