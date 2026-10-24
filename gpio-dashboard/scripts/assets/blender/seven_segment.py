"""A 0.56 in seven-segment display, one digit or four, from its content/parts/<id>.part.json
(SPEC 7, 10.4). Kingbright SA56-11EWA / SC56-11EWA (one digit) and CA56-12EWA (four digits): a gray
face with white diffused segments, slanted 8 degrees, and a right-hand decimal point.

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


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402

args, part = kit.start()
G = part['geometry']['params']

L, W, H = G['bodyLengthMm'], G['bodyWidthMm'], G['bodyHeightMm']
DIGITS = G['digitCount']
DIGIT_H = G['digitHeightMm']
DIGIT_W = G.get('digitWidthMm', 8.0)  # the datasheet's 8 mm across the slanted digit
PITCH_X = G.get('digitPitchMm', 0.0)
SEG = G['segmentWidthMm']
SHEAR = math.tan(math.radians(G['slantDeg']))
STANDOFF = 0.5  # the body's underside above the board; the datasheet draws none
PROUD = 0.05  # the face lies this far below the segments' tops, which stand at the body's height
GAP = 0.3  # between neighbouring segments
DP_DIA = 1.5  # the drawing's decimal point

pins = part['pins']
px = [p['offsetPitch'][0] * kit.PITCH for p in pins]
py = [p['offsetPitch'][1] * kit.PITCH for p in pins]
cx, cy = (min(px) + max(px)) / 2, (min(py) + max(py)) / 2

face_mat = kit.material('face', '8c8d8f', Roughness=0.5)
seg_mat = kit.material('segment', 'ecebe6', Roughness=0.35)

root = kit.root(args)

m = kit.Mesh()
m.box((cx - L / 2, cy - W / 2, STANDOFF), (cx + L / 2, cy + W / 2, H - PROUD), face_mat, taper=0.1)
body = m.to_object('body', root)

# The digit: segment centrelines on a 6 mm wide, DIGIT_H tall frame, sheared to the slant.
half_w = (DIGIT_W - 2 * math.tan(math.radians(G['slantDeg'])) * (DIGIT_H / 2)) / 2  # unslanted half width
xv = half_w - SEG / 2  # vertical segments' centrelines
yh = DIGIT_H / 2 - SEG / 2  # horizontal segments' centrelines (a and d; g is at 0)
z0, z1 = H - 0.6, H


def hexagon(length, vertical):
    """A segment outline, point to point `length` long and SEG thick, around the origin."""
    hl, ht = length / 2, SEG / 2
    if vertical:
        return [(0, hl), (-ht, hl - ht), (-ht, -hl + ht), (0, -hl), (ht, -hl + ht), (ht, hl - ht)]
    return [(hl, 0), (hl - ht, ht), (-hl + ht, ht), (-hl, 0), (-hl + ht, -ht), (hl - ht, -ht)]


def segment(name, centre, outline, origin):
    """One segment as its own node, sheared and moved to its digit."""
    ox, oy = origin
    ring = [(ox + centre[0] + x + (centre[1] + y) * SHEAR, oy + centre[1] + y) for x, y in outline]
    sm = kit.Mesh()
    sm.extrude(ring, z0, z1, seg_mat)
    return sm.to_object(name, root)


long_h = 2 * xv + SEG / 2 + SEG / 2 - 2 * GAP  # point to point, between the vertical segments
long_v = yh - GAP  # a vertical segment spans from one centreline to the next, less a gap
SEGMENTS = {
    'a': ((0, yh), hexagon(long_h, False)),
    'b': ((xv, yh / 2), hexagon(long_v, True)),
    'c': ((xv, -yh / 2), hexagon(long_v, True)),
    'd': ((0, -yh), hexagon(long_h, False)),
    'e': ((-xv, -yh / 2), hexagon(long_v, True)),
    'f': ((-xv, yh / 2), hexagon(long_v, True)),
    'g': ((0, 0), hexagon(long_h, False)),
}
nodes = []
for d in range(DIGITS):
    origin = (cx + (d - (DIGITS - 1) / 2) * PITCH_X, cy)
    prefix = f'seg-{d + 1}-' if DIGITS > 1 else 'seg-'
    for key, (centre, outline) in SEGMENTS.items():
        nodes.append(segment(prefix + key, centre, outline, origin))
    # The decimal point: a round dot at the lower right, on the slant.
    dp_at = (xv + SEG / 2 + 1.2, -yh)
    dm = kit.Mesh()
    dm.disc(
        (origin[0] + dp_at[0] + dp_at[1] * SHEAR, origin[1] + dp_at[1]),
        DP_DIA / 2,
        z0,
        z1,
        seg_mat,
        n=12,
    )
    nodes.append(dm.to_object(prefix + 'dp', root))

for pin, x, y in zip(pins, px, py):
    kit.pin_empty(root, pin['id'], (x, y, STANDOFF), (0, 0, -1))

kit.finish(args, root, [kit.box_of('body', body, *nodes)])
print(f"{part['id']}: {kit.triangles(root)} triangles, {len(nodes)} segment nodes")
