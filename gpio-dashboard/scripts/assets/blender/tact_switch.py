"""6 x 6 mm tactile switch (SPEC 7, 10.4, 10.6), from content/parts/tact-switch-6mm.part.json.

A rigid part: the origin is pin 1's hole on the board's top surface. The four pins are the grid's
(0, 0), (0, 3), (2, 0) and (2, 3) pitches, the body sits centred between them, and the datasheet's
6.5 x 4.5 mm terminals are formed out to them: each foot (material `lead`) leaves the body's wall
just above the board and ends at its pin, where the runtime's straight lead takes over, pointing
down. A black housing carries a steel cover with a round opening, and the round plunger (the node
`plunger`, travelling along -z) stands 0.9 mm proud of the cover, 4.3 mm above the board in all.
The plunger's origin is at its foot, on its axis. Dimensions are Omron's B3F-1000 drawing.

    blender -b --factory-startup --python-exit-code 1 -P tact_switch.py -- --part <part.json>
      --name <asset> --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit as pk  # noqa: E402

args, DEF, P = pk.start()
W, D = P['bodyWidthMm'], P['bodyDepthMm']
TOTAL, BODY = P['heightMm'], P['bodyHeightMm']
PLUNGER = P['plungerDiaMm'] / 2
TERMINAL = P['terminalWidthMm'] / 2
COVER = 0.4  # the steel cover's thickness
OPENING = PLUNGER + 0.2
RAYS = 16

pins = DEF['pins']
xs = [p['offsetPitch'][0] * pk.PITCH for p in pins]
ys = [p['offsetPitch'][1] * pk.PITCH for p in pins]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2

housing = pk.plastic('housing', '#1c1c1f', 0.55)
cover = pk.metal('cover', '#b9bcbf', 0.32)
plunger_mat = pk.plastic('plunger', '#2c2c31', 0.45)
lead = pk.metal('lead', '#c6c4bd', 0.3)

builder = pk.Builder()
z_cover = BODY - COVER
builder.box((cx - W / 2, cy - D / 2, 0), (cx + W / 2, cy + D / 2, z_cover), housing)
builder.bevel(0.3, 1)

# The cover: a square plate with a round opening, joined by quads along 16 rays from the axis.
half = W / 2 - 0.1
edge = []
for k in range(RAYS):
    a = 2 * math.pi * k / RAYS
    c, s = math.cos(a), math.sin(a)
    t = half / max(abs(c), abs(s))
    edge.append((cx + t * c, cy + t * s))
ring = [(cx + OPENING * math.cos(2 * math.pi * k / RAYS), cy + OPENING * math.sin(2 * math.pi * k / RAYS)) for k in range(RAYS)]
for k in range(RAYS):
    j = (k + 1) % RAYS
    (ix, iy), (jx, jy), (ox, oy), (px, py) = ring[k], ring[j], edge[k], edge[j]
    top, bottom = BODY, z_cover
    builder.quad((ix, iy, top), (ox, oy, top), (px, py, top), (jx, jy, top), cover)               # the plate
    builder.quad((ox, oy, bottom), (px, py, bottom), (px, py, top), (ox, oy, top), cover)          # its outer wall
    builder.quad((jx, jy, bottom), (ix, iy, bottom), (ix, iy, top), (jx, jy, top), cover)          # the opening's wall
lo, hi = builder.bounds()

# The feet: out of the wall nearest each pin, then down to it.
for x, y in zip(xs, ys):
    sign = -1 if y < cy else 1
    inside = cy + sign * (D / 2 - 0.3)
    builder.box((x - TERMINAL, min(y - 0.15, inside), 0.3), (x + TERMINAL, max(y + 0.15, inside), 0.6), lead)
    builder.box((x - TERMINAL, y - 0.15, 0), (x + TERMINAL, y + 0.15, 0.6), lead)

# The plunger: an animated node, built around its own axis from its foot, which sits inside the housing.
foot = 2.7
nub = TOTAL - foot
plunger = pk.Builder()
plunger.lathe(
    [(0, foot), (PLUNGER, foot), (PLUNGER, TOTAL - 0.25), (PLUNGER - 0.25, TOTAL), (0, TOTAL)],
    plunger_mat, segs=28, at=(cx, cy, 0),
)
lo[2], hi[2] = min(lo[2], 0), max(hi[2], TOTAL)

root = pk.root(args.name)
builder.finish('body', root)
plunger.finish('plunger', root, origin=(cx, cy, foot))
for p, x, y in zip(pins, xs, ys):
    pk.pin(root, p['id'], (x, y, 0), pk.DOWN)
pk.write(args, root, [pk.box_of('body', lo, hi)])
print(f"{args.name}: body {hi[0] - lo[0]:.2f} x {hi[1] - lo[1]:.2f} x {hi[2] - lo[2]:.2f} mm, plunger {nub:.2f} mm above its foot")
