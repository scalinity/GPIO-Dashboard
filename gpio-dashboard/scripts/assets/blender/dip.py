"""A DIP-N package from its content/parts/<id>.part.json (SPEC 7, 10.4): 74HC595, ADC0834, L293D.

The datasheet drawing is TI MPDI002C (N R-PDIP-T**): a black epoxy body with drafted sides, a
half-round notch at the pin-1 end and a pin-1 dimple, resting on its lead shoulders a standoff
above the seating plane. Frame: origin at pin 1's hole on the board's top surface (z = 0), pins at
(dx, dy) * 2.54 from the part definition, the body centred on them. The leads below the body are
generated at runtime; the model keeps the shoulder of each lead (out of the body's side and down
to the seating plane) and a "pin-<id>" empty at its lower end whose +z points down.

    blender -b --factory-startup --python-exit-code 1 -P dip.py -- --part <part.json>
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

# The top marking: what the chip's top reads, by part definition.
MARKING = {
    'ic-74hc595': ('SN74HC595N', 'HC595  4W2'),
    'ic-adc0834': ('ADC0834CCN', '0834  7P1'),
    'ic-l293d': ('L293DNE', 'L293D  3K9'),
}

L, W, H = G['bodyLengthMm'], G['bodyWidthMm'], G['bodyHeightMm']
STANDOFF = G['standoffMinMm']  # seating plane to the body's underside
LEAD_W = (G['leadWidthMinMm'] + G['leadWidthMaxMm']) / 2
LEAD_T = 0.25  # drawing: 0.010 in nominal
DRAFT = 0.25  # each side of the body leans in by this much at the top
SHOULDER = 1.0  # the lead leaves the body this far above the seating plane

pins = part['pins']
px = [p['offsetPitch'][0] * kit.PITCH for p in pins]
py = [p['offsetPitch'][1] * kit.PITCH for p in pins]
cx, cy = (min(px) + max(px)) / 2, (min(py) + max(py)) / 2
x0, x1, y0, y1 = cx - L / 2, cx + L / 2, cy - W / 2, cy + W / 2

epoxy = kit.material('epoxy', '121213', Roughness=0.55)
top = kit.material('epoxy-top', '121213', Roughness=0.5)
tin = kit.material('lead', 'c4c6c8', Metallic=1.0, Roughness=0.32)

root = scene.link(bpy.data.objects.new(part['id'], None))

# --- Body: drafted sides, the notch and the dimple cut in, the top marked ------------------------
m = kit.Mesh()
m.box((x0, y0, STANDOFF), (x1, y1, H), epoxy, taper=DRAFT)
body = m.to_object('body', root)
cutters = []
for name, c, r, depth in (
    ('notch', (x0 + DRAFT, cy), 1.0, 0.5),  # centred on the end's top edge: a half-round scoop
    ('dimple', (x0 + 1.9, y0 + 1.5), 0.45, 0.2),
):
    cm = kit.Mesh()
    cm.disc(c, r, H - depth, H + 1.0, epoxy, n=20)
    cutters.append(cm.to_object(name))
kit.cut(body, cutters)

line1, line2 = MARKING[part['id']]
face = (x0 + DRAFT, y0 + DRAFT, x1 - DRAFT, y1 - DRAFT)  # the whole top, so UVs stay in 0..1
img = kit.decal(
    f"{part['id']}-marking",
    face,
    args.px,
    '121213',
    [
        ('text', line1, cx + 1.2, cy + 0.8, 1.15, 'dcdcd6', 0, 'CENTER'),
        ('text', line2, cx + 1.2, cy - 0.7, 0.95, 'b4b4ae', 0, 'CENTER'),
    ],
)
kit.textured(top, img)
kit.mark_top(body, face, H, top)

# --- Lead shoulders and pin empties ---------------------------------------------------------------
leads = kit.Mesh()
w = LEAD_W / 2
for pin, x, y in zip(pins, px, py):
    front = y < cy
    face_y = y0 if front else y1
    inner = face_y + (0.15 if front else -0.15)  # reaches into the body
    outer = y - (LEAD_T / 2 if front else -LEAD_T / 2)
    z_h = STANDOFF + SHOULDER
    leads.box((x - w, min(inner, outer), z_h - LEAD_T / 2), (x + w, max(inner, outer), z_h + LEAD_T / 2), tin)
    leads.box((x - w, y - LEAD_T / 2, STANDOFF), (x + w, y + LEAD_T / 2, z_h - LEAD_T / 2), tin)
    kit.pin_empty(root, pin['id'], (x, y, STANDOFF), (0, 0, -1))
leads.to_object('leads', root)

kit.finish(args, root, [kit.box_of('body', body)])
print(f"{part['id']}: {kit.triangles(root)} triangles")
