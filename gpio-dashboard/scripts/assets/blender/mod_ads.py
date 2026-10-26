"""The ADC modules: the ADS1115 breakout (Adafruit 1085, from Adafruit's own STEP, MIT licence) and
the ADS7830 module of the kit (modelled from the datasheet drawing).

The ADS1115 STEP is a bare board with its parts; Adafruit ships the header loose, so the header
strips here are drawn on the ten pads the part definition names. step-to-glb.ts has already read
the STEP; this script keeps it as modelled, lifts it onto the header's tails, checks the header
holes are where the definition says, restyles the materials and bakes ambient occlusion.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402
import modparts as mp  # noqa: E402

# The STEP colours that are metal, with their roughness; 302810 is the board's solder mask.
METALS = {'808080': 0.35}
SOLDER = ('1b1b1d', dict(Roughness=0.45, Coat_Weight=1.0, Coat_Roughness=0.1))
# Where the first header pad sits in the STEP's frame (board corner at the origin, z up): the
# bottom row's left pad, VIN on the product photo, read from the board's drilled holes.
PAD_1 = (6.35, 2.54)
TOLERANCE = 0.05


def ads1115(root, part, args):
    bodies = kit.import_step(args.step_glb)
    for obj in bodies:
        obj.data.transform(Matrix.Translation((0, 0, mp.TAIL)))
    bpy.context.view_layer.update()

    # The pads must be drilled where the definition puts the pins.
    board = next(o for o in bodies if o.name == 'Board')
    top = max(v.co.z for v in board.data.vertices)
    bottom = min(v.co.z for v in board.data.vertices)
    pins = [(p['id'], (PAD_1[0] + p['offsetPitch'][0] * kit.PITCH, PAD_1[1] + p['offsetPitch'][1] * kit.PITCH)) for p in part['pins']]
    for pid, (x, y) in pins:
        ring = [v.co for v in board.data.vertices if math.hypot(v.co.x - x, v.co.y - y) < 0.6]
        high = [c for c in ring if abs(c.z - top) < 1e-3]
        low = [c for c in ring if abs(c.z - bottom) < 1e-3]
        if len(high) < 8 or len(low) < 8:
            raise RuntimeError(f'no drilled hole at pad {pid} ({x:.2f}, {y:.2f}): the STEP changed')
        cx = sum(c.x for c in high) / len(high)
        cy = sum(c.y for c in high) / len(high)
        if math.hypot(cx - x, cy - y) > TOLERANCE:
            raise RuntimeError(f'pad {pid} is drilled at ({cx:.3f}, {cy:.3f}), not ({x:.3f}, {y:.3f})')

    # The 3 x 3 mm body of the converter is the one grey piece of its size; it is black epoxy.
    chip = kit.material('chip', '121213', Roughness=0.5)
    for obj in bodies:
        dims = obj.dimensions
        if abs(dims.x - 3.0) < 0.3 and abs(dims.y - 3.0) < 0.3 and 0.8 < dims.z < 1.2:
            obj.material_slots[0].material = chip
    board = kit.join(bodies, 'board')
    kit.clean_step(board)
    kit.restyle_step(board, METALS, {'302810': SOLDER})
    kit.bake_occlusion(board, args.px, 1.5, 'ads1115-occlusion')

    strips = [pins[:6], pins[6:]]
    pin_obj = mp.headers(root, strips, top)
    board.parent = root
    return [('body', [board]), ('pins', [pin_obj])]


ADS_BLUE = '1d4aa6'  # the LAFVIN board's solder mask
ADS_VIA = '0f2a66'


def ads7830(root, part, args):
    """The kit's LAFVIN ADS7830 module, after the kit's board drawing (ADS7830_Module.png) and its
    photos: a blue board with A0 to A7 down one long edge and VCC, SDA, SCL, GND on the other, the
    TSSOP-16 converter in the middle with R1, R3 and R2 above it toward A0, the power LED by the
    ADS7830 legend, C1 below the chip and LAFVIN at the A7 end. The model is the drawing turned so
    that A0 to A7 run along +x: the drawing's down is the model's +x and its right the model's +y,
    so its upright text reads along +y and its sideways pin labels along -x."""
    G = part['geometry']['params']
    L, W = G['boardLengthApproxMm'], G['boardWidthApproxMm']
    z0, thick = mp.TAIL, 1.6
    pins = part['pins']
    channels = G['channelHeaderPins']
    margin = (L - (channels - 1) * kit.PITCH) / 2  # the channel header is centred on the board
    near_y = (W - G['headerColumnSpacingPitch'] * kit.PITCH) / 2
    pos = {p['id']: (margin + p['offsetPitch'][0] * kit.PITCH, near_y + p['offsetPitch'][1] * kit.PITCH) for p in pins}
    # Positions read off the drawing (25.6 px to the mm), measured from A0's pad.
    ax, ay = pos[pins[0]['id']]
    chip = (ax + 9.02, ay + 5.84)
    labels = []
    for p in pins:
        x, y = pos[p['id']]
        side = 1.95 if p['offsetPitch'][1] == 0 else -1.95  # beside each pad, toward the middle
        labels.append(kit.label(p['label'], x, y + side, 0.85, rotation=180))
    labels += [
        kit.label('ADS7830', ax - 0.7, ay + 6.99, 1.1, rotation=90),
        kit.label('LAFVIN', ax + 16.56, ay + 6.91, 2.1, rotation=90),
        kit.label('R1', ax + 2.23, ay + 3.91, 0.7, rotation=90),
        kit.label('R3', ax + 2.23, ay + 6.72, 0.7, rotation=90),
        kit.label('R2', ax + 2.23, ay + 8.87, 0.7, rotation=90),
        kit.label('LED1', ax + 1.13, ay + 8.9, 0.7, rotation=90),
        kit.label('C1', ax + 13.75, ay + 8.67, 0.8, rotation=90),
        ('ring', chip[0] - 2.9, chip[1] - 2.25, 0.25, 0, kit.SILK),  # pin 1's dot
    ]
    # Silkscreen outlines round the passives and the LED.
    outlines = [(ax + 4.08, ay + y, 2.9, 1.4) for y in (3.89, 6.62, 8.77)]  # R1, R3, R2
    outlines += [(ax + 1.11, ay + 6.52, 1.3, 2.75), (ax + 13.65, ay + 6.33, 1.75, 3.1)]  # LED1, C1
    for cx, cy, lx, ly in outlines:
        x0, y0, x1, y1 = cx - lx / 2, cy - ly / 2, cx + lx / 2, cy + ly / 2
        labels += [('box', x0, y0, x1, y0 + 0.12, kit.SILK), ('box', x0, y1 - 0.12, x1, y1, kit.SILK),
                   ('box', x0, y0, x0 + 0.12, y1, kit.SILK), ('box', x1 - 0.12, y0, x1, y1, kit.SILK)]
    # Tented vias, a shade darker than the mask.
    for vx, vy in ((0.9, 15.3), (2.9, 14.2), (4.2, 12.6), (17.9, 12.4), (19.6, 14.4), (20.4, 11.2),
                   (16.0, 3.9), (11.5, 4.0), (7.0, 4.0), (20.5, 4.0), (1.2, 4.6)):
        labels.append(('ring', vx, vy, 0.22, 0, ADS_VIA))
    pcb, top = kit.board(root, 'pcb', (0, 0, L, W), z0, thick, ADS_BLUE, args.px, labels, radius=0.5, rough=0.32)
    m = kit.Mesh()
    mp.chip(m, chip[0], chip[1], top, 5.0, 4.4, G['chipHeightMaxMm'] - 0.1, 8, 0.65)  # TSSOP-16
    for cy in (ay + 3.89, ay + 6.62, ay + 8.77):  # R1, R3, R2 (0805)
        mp.resistor(m, ax + 4.08, cy, top)
    mp.smd(m, ax + 1.11, ay + 6.52, top, 2.0, 1.25, 0.6, kit.material('led-clear', 'efe3d6', Roughness=0.2), along='y')
    mp.capacitor(m, ax + 13.65, ay + 6.33, top, along='y')
    parts_obj = m.to_object('smd', root)
    strips = [
        [(p['id'], pos[p['id']]) for p in pins if p['offsetPitch'][1] == 0],
        [(p['id'], pos[p['id']]) for p in pins if p['offsetPitch'][1] != 0],
    ]
    pin_obj = mp.headers(root, strips, top)
    return [('body', [pcb, parts_obj]), ('pins', [pin_obj])]
