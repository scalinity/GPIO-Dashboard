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


def ads7830(root, part, args):
    G = part['geometry']['params']
    L, W = G['boardLengthApproxMm'], G['boardWidthApproxMm']
    z0, thick = mp.TAIL, 1.6
    pins = part['pins']
    channels = G['channelHeaderPins']
    margin = (L - (channels - 1) * kit.PITCH) / 2  # the channel header is centred on the board
    near_y = 1.9
    far_y = W - near_y
    pos = {}
    for p in pins:
        dx, dy = p['offsetPitch']
        pos[p['id']] = (margin + dx * kit.PITCH, near_y + dy * kit.PITCH)
    labels = [kit.label(p['label'], *(pos[p['id']][0], pos[p['id']][1] + (3.3 if p['offsetPitch'][1] == 0 else -3.3)), 0.8) for p in pins]
    labels += [kit.label('ADS7830', 3.6, W / 2, 1.0, rotation=90), kit.label('8-bit ADC', 18.2, W / 2, 0.8, rotation=90)]
    pcb, top = kit.board(root, 'pcb', (0, 0, L, W), z0, thick, '1b1c21', args.px, labels, radius=0.8)
    m = kit.Mesh()
    mp.chip(m, L / 2 + 0.6, W / 2, top, 5.0, 4.4, G['chipHeightMaxMm'] - 0.1, 8, 0.65)  # TSSOP-16
    mp.resistor(m, L - 3.0, W / 2 + 1.5, top)
    mp.resistor(m, L - 3.0, W / 2 - 1.5, top)
    mp.capacitor(m, L / 2 + 0.6, W / 2 + 4.0, top)
    parts_obj = m.to_object('smd', root)
    strips = [
        [(p['id'], pos[p['id']]) for p in pins if p['offsetPitch'][1] == 0],
        [(p['id'], pos[p['id']]) for p in pins if p['offsetPitch'][1] != 0],
    ]
    pin_obj = mp.headers(root, strips, top)
    return [('body', [pcb, parts_obj]), ('pins', [pin_obj])]
