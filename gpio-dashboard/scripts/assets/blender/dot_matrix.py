"""An 8 x 8 LED dot matrix from its content/parts/<id>.part.json (SPEC 7, 10.4). The package is
Shanghai Toplite TOP-CA-788BS's drawing: a 20 mm square body 5.9 mm high with 64 1.9 mm dots on a
2.5 mm pitch, and pin 1 at the lower left of the dot field. The look is the kit's own part, marked
788BS: a white housing with square corners, a black face, the dots flat white diffused epoxy
flush with it, and "788BS" printed in black on the side along pins 1 to 8, which marks pin 1's
side (SunFounder's photos of the kit matrix on its component list and the Kepler kit's 788BS
page).

Frame: origin at pin 1's hole on the board's top surface (z = 0), x along the row, y across. Pins
are at (dx, dy) * 2.54 from the part definition (the real 2.5 mm pitch and 15 mm row spacing are
snapped to the breadboard grid there), the body centred on them. Dot "dot-<row>-<col>" follows the
datasheet's top view: row 1 at the top (+y), column 1 at the left (-x). Leads are generated at
runtime from the "pin-<id>" empties, +z pointing down.

    blender -b --factory-startup --python-exit-code 1 -P dot_matrix.py -- --part <part.json>
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
ROWS, COLS = G['rows'], G['cols']
DOT_D, DOT_PITCH = G['dotDiaMm'], G['dotPitchMm']
STANDOFF = 0.5
PROUD = 0.05  # the face lies this far below the dots' tops, which stand at the body's height
MARKING = '788BS'
INK_MM = 1.8  # printed character height, as the kit's photo shows it
INK_BELOW_TOP = 2.2  # the printing's middle below the face
GLYPH = 0.73  # Blender's built-in font: capitals and digits stand 0.73 of the size tall

pins = part['pins']
px = [p['offsetPitch'][0] * kit.PITCH for p in pins]
py = [p['offsetPitch'][1] * kit.PITCH for p in pins]
cx, cy = (min(px) + max(px)) / 2, (min(py) + max(py)) / 2
x0, x1, y0, y1 = cx - L / 2, cx + L / 2, cy - W / 2, cy + W / 2

housing = kit.material('housing', 'e6e7e5', Roughness=0.5)
face = kit.material('face', '0e0e10', Roughness=0.45)
dot = kit.material('dot', 'dfded8', Roughness=0.3)
ink = kit.material('marking', '232326', Roughness=0.6)

root = kit.root(args)

m = kit.Mesh()
m.prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], STANDOFF, H - PROUD, housing, bottom=housing, top=face)
# The printing faces -y, upright: drawn facing +z, stood up by a quarter turn about x.
m.text(
    MARKING, INK_MM / GLYPH, (cx, y0 - 0.006, H - PROUD - INK_BELOW_TOP),
    Matrix.Rotation(math.pi / 2, 3, 'X'), ink,
)
body = m.to_object('body', root)

dots = []
for r in range(ROWS):
    for c in range(COLS):
        x = cx + (c - (COLS - 1) / 2) * DOT_PITCH
        y = cy + ((ROWS - 1) / 2 - r) * DOT_PITCH
        dm = kit.Mesh()
        # A flat disc at the body's height, PROUD over the face: the only part of a dot in view.
        dm.polygon(kit.circle(x, y, DOT_D / 2, n=20), H, dot)
        dots.append(dm.to_object(f'dot-{r + 1}-{c + 1}', root))

for pin, x, y in zip(pins, px, py):
    kit.pin_empty(root, pin['id'], (x, y, STANDOFF), (0, 0, -1))

# The collider is the housing's box, which holds the dots; the printing stands 0.006 mm off its side.
kit.finish(args, root, [kit.partkit.box_of('body', (x0, y0, STANDOFF), (x1, y1, H))])
print(f"{part['id']}: {kit.triangles(root)} triangles")
