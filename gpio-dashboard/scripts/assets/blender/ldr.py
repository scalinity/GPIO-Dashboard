"""CdS photoresistor, GL5528 (SPEC 7, 10.4), from content/parts/ldr.part.json.

A flex-2lead part: the origin is the midpoint of the two leads, 3.0 mm apart, which leave the
disc's lower flat pointing down. The disc stands on edge in the xz plane, 5.1 mm across, cut
flat top and bottom to 4.3 mm, and 2.1 mm thick. Its face, toward -y, shows the cadmium
sulphide track in a serpentine between two silver electrodes (Senba's GL55 drawing and photographs).

    blender -b --factory-startup --python-exit-code 1 -P ldr.py -- --part <part.json> --name <asset>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402
from mathutils import Matrix  # noqa: E402

args, DEF, P = pk.start()
R, FLAT, T, SPACING = P['discDiameterMm'] / 2, P['flatHeightMm'], P['thicknessMm'], P['leadPitchMm']
SEAT = 1.0  # mm of lead showing between the disc and the board: a modelling choice, not a datasheet value
EDGE = 0.14
ARC = 14  # segments in each of the two arcs
PASSES = 7  # horizontal runs of the serpentine
RUN, PITCH, GAP = 2.8, 0.5, 0.22  # the serpentine's run length, spacing between runs, and track width

rim = pk.plastic('rim', '#c9731c', 0.3)
ceramic = pk.plastic('ceramic', '#d9bd8e', 0.45)
track = pk.plastic('track', '#6e3418', 0.35)
electrode = pk.metal('electrode', '#bdbdb7', 0.3)

half = FLAT / 2
phi = math.asin(half / R)
right = [(R * math.cos(-phi + 2 * phi * k / ARC), half + R * math.sin(-phi + 2 * phi * k / ARC)) for k in range(ARC + 1)]
left = [(-x, z) for x, z in reversed(right)]
outline = right + left  # counter-clockwise from the lower right; the flats are the two joins

builder = pk.Builder()
builder.prism(outline, -T / 2, T / 2, rim, bottom=rim, top=ceramic)
builder.bevel(EDGE, 2, where=lambda e: any(len(f.verts) > 4 for f in e.link_faces))
builder.transform(Matrix.Rotation(math.pi / 2, 3, 'X'))  # outline y -> z; the +z cap becomes the -y face
lo, hi = builder.bounds()

# The face's pattern, a hair in front of it, facing -y.
y = -T / 2 - 0.008
mid = half
span = (PASSES - 1) * PITCH
for i in range(PASSES):
    z = mid - span / 2 + i * PITCH
    builder.quad((-RUN / 2, y, z - GAP / 2), (RUN / 2, y, z - GAP / 2), (RUN / 2, y, z + GAP / 2), (-RUN / 2, y, z + GAP / 2), track)
    if i < PASSES - 1:
        x = RUN / 2 - GAP if i % 2 == 0 else -RUN / 2  # the runs join alternately at the right and the left
        builder.quad((x, y, z + GAP / 2), (x + GAP, y, z + GAP / 2), (x + GAP, y, z + PITCH - GAP / 2), (x, y, z + PITCH - GAP / 2), track)
for side, z in ((-1, mid - span / 2), (1, mid + span / 2)):
    x0, x1 = (side * (RUN / 2 + 0.05), side * (RUN / 2 + 0.35))
    builder.quad((min(x0, x1), y, z - 0.35), (max(x0, x1), y, z - 0.35), (max(x0, x1), y, z + 0.35), (min(x0, x1), y, z + 0.35), electrode)

root = pk.root(args.name, seat_mm=SEAT)
builder.finish('body', root)
first, second = (p['id'] for p in DEF['pins'])
pk.pin(root, first, (-SPACING / 2, 0, 0), pk.DOWN)
pk.pin(root, second, (SPACING / 2, 0, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm")
