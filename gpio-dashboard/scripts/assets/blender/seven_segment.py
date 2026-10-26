"""A 0.56 in seven-segment display, one digit or four, from its content/parts/<id>.part.json
(SPEC 7, 10.4). The package and the digit are the datasheets' (Kingbright SA56-11EWA / SC56-11EWA
for one digit, CA56-12EWA for four): 14.22 mm tall, 8 mm wide along a row, segments 1.5 mm wide,
slanted 8 degrees, with a 1.5 mm decimal point at the lower right. The look is the kit's own
display, marked CL5611AH: a white housing with a black face, white diffused segments flush with
it whose ends meet in mitres at the digit's corners and in points at its middle, and the part
number printed in black on the side along pins 1 to 5 (SunFounder's photos of the kit display on
its component list and component pages).

The common-anode digit is printed CL5611BH, the same maker's common-anode part (SunFounder: an
"A" in a display's marking is common cathode, a "B" common anode), and the four-digit display
5641BS, the common-anode 0.56 in four-digit part this pinout and package are sold as.

Frame: origin at pin 1's hole on the board's top surface (z = 0), x along the pin row, y across
(pins 1.. along y = 0, the digit reads upright toward +y as the datasheet's top view). Pins sit at
(dx, dy) * 2.54 from the part definition and the body is centred on them. The studio lights the
segments by name: "seg-<a..g|dp>" on one digit, "seg-<d>-<a..g|dp>" with digit d from 1 (the
leftmost, D1) on four. Leads are generated at runtime from the "pin-<id>" empties, +z pointing down.

    blender -b --factory-startup --python-exit-code 1 -P seven_segment.py -- --part <part.json>
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
DIGITS = G['digitCount']
DIGIT_H = G['digitHeightMm']
# The digit's width along a row, as the kit display measures (8.1 mm on its 12.7 mm face).
DIGIT_W = G.get('digitWidthMm', 8.0)
PITCH_X = G.get('digitPitchMm', 0.0)
SEG = G['segmentWidthMm']
SHEAR = math.tan(math.radians(G['slantDeg']))
STANDOFF = 0.5  # the body's underside above the board; the datasheet draws none
PROUD = 0.05  # the face lies this far below the segments' tops, which stand at the body's height
DRAFT = 0.1  # the housing's sides lean in by this much from the underside to the face
GAP = 0.3  # between neighbouring segments
DP_DIA = 1.5  # the drawing's decimal point
DP_RIGHT = 1.55  # its centre, right of the digit's right edge (unslanted), on segment d's line
MARKING = {
    'seven-segment-cc': 'CL5611AH',
    'seven-segment-ca': 'CL5611BH',
    'seven-segment-4digit': '5641BS',
}[part['id']]
INK_MM = 1.6  # printed character height
INK_BELOW_TOP = 2.4  # the printing's middle below the face
GLYPH = 0.73  # Blender's built-in font: capitals and digits stand 0.73 of the size tall

pins = part['pins']
px = [p['offsetPitch'][0] * kit.PITCH for p in pins]
py = [p['offsetPitch'][1] * kit.PITCH for p in pins]
cx, cy = (min(px) + max(px)) / 2, (min(py) + max(py)) / 2
x0, x1, y0, y1 = cx - L / 2, cx + L / 2, cy - W / 2, cy + W / 2
z0, z1 = STANDOFF, H - PROUD

housing = kit.material('housing', 'e6e7e5', Roughness=0.5)
face = kit.material('face', '0e0e10', Roughness=0.45)
seg_mat = kit.material('segment', 'dfded8', Roughness=0.3)
ink = kit.material('marking', '232326', Roughness=0.6)

root = kit.root(args)

# The housing, its sides drafted, and the black face on top.
m = kit.Mesh()
t = DRAFT
top = [(x0 + t, y0 + t), (x1 - t, y0 + t), (x1 - t, y1 - t), (x0 + t, y1 - t)]
m.loft(
    [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)],
    [(x, y, z1) for x, y in top],
    housing,
    caps=(True, False),
)
m.polygon(top, z1, face)
# The printing on the side along pins 1 to 5 (-y), upright, leaning with the draft: drawn facing
# +z, then turned until it faces the side.
lean = math.atan(t / (z1 - z0))
zt = z1 - INK_BELOW_TOP
m.text(
    MARKING, INK_MM / GLYPH, (cx, y0 + t * (zt - z0) / (z1 - z0) - 0.006, zt),
    Matrix.Rotation(math.pi / 2 - lean, 3, 'X'), ink, fit=L - 3.0,
)
body = m.to_object('body', root)

# The digit, unslanted and centred on the origin: outer edges at +-X and +-Y, segments T wide.
# Corner joints are mitres along the diagonals from the outer corners; the middle joints are
# points on the vertical segments' centrelines. Each joint leaves GAP between its segments.
X, Y, T = DIGIT_W / 2, DIGIT_H / 2, SEG
k = GAP / 2 * math.sqrt(2)  # half the gap, measured along an edge that meets a 45 degree joint

upper_right = [  # b, counter-clockwise from above
    (X - T, T / 2 + k), (X - T / 2, k), (X, T / 2 + k), (X, Y - k), (X - T, Y - T - k)
]
top_bar = [(-X + T + k, Y - T), (X - T - k, Y - T), (X - k, Y), (-X + k, Y)]  # a
middle = [
    (-X + T / 2 + k, 0), (-X + T + k, -T / 2), (X - T - k, -T / 2),
    (X - T / 2 - k, 0), (X - T - k, T / 2), (-X + T + k, T / 2),
]  # g


def mirror(ring, sx, sy):
    """A ring mirrored in x (sx = -1) and/or y (sy = -1), still counter-clockwise."""
    out = [(x * sx, y * sy) for x, y in ring]
    return out[::-1] if sx * sy < 0 else out


SEGMENTS = {
    'a': top_bar,
    'b': upper_right,
    'c': mirror(upper_right, 1, -1),
    'd': mirror(top_bar, 1, -1),
    'e': mirror(upper_right, -1, -1),
    'f': mirror(upper_right, -1, 1),
    'g': middle,
}
DP_AT = (X + DP_RIGHT, -Y + T / 2)


def slant(points, origin):
    """Points of the unslanted digit, sheared to the slant and moved to the digit's centre."""
    return [(origin[0] + x + y * SHEAR, origin[1] + y) for x, y in points]


nodes = []
for d in range(DIGITS):
    origin = (cx + (d - (DIGITS - 1) / 2) * PITCH_X, cy)
    prefix = f'seg-{d + 1}-' if DIGITS > 1 else 'seg-'
    for key, ring in SEGMENTS.items():
        sm = kit.Mesh()
        # Set into the face; the underside is inside the body and never seen.
        sm.extrude(slant(ring, origin), H - 0.6, H, seg_mat, caps=(False, True))
        nodes.append(sm.to_object(prefix + key, root))
    dm = kit.Mesh()
    dm.disc(slant([DP_AT], origin)[0], DP_DIA / 2, H - 0.6, H, seg_mat, n=16, caps=(False, True))
    nodes.append(dm.to_object(prefix + 'dp', root))

for pin, x, y in zip(pins, px, py):
    kit.pin_empty(root, pin['id'], (x, y, STANDOFF), (0, 0, -1))

kit.finish(args, root, [kit.box_of('body', body, *nodes)])
print(f"{part['id']}: {kit.triangles(root)} triangles, {len(nodes)} segment nodes")
