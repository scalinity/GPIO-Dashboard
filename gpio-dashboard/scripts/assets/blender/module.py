"""The module family (SPEC 7, 10.4 "Off-board modules"): one script, a variant per part definition's
geometry.params.variant. The shapes come from the modules' datasheet drawings; the one official
STEP (Adafruit's ADS1115, MIT) is read by step-to-glb.ts and passed as --step-glb.

    variant                    part definition          drawn in
    dht11-3pin-breakout        dht11-module             mod_sensors.py
    dht11-bare-4pin-sip        dht11 (on a board)       mod_sensors.py
    hc-sr04, hc-sr501          hc-sr04, hc-sr501        mod_sensors.py
    adafruit-1085-stemma-qt    ads1115-module           mod_ads.py (from the STEP)
    lafvin-ads7830             ads7830-module           mod_ads.py
    breadboard-power-module    breadboard-power-module  mod_boards.py (the definition's id: it
    relay-module-5v            relay-module-5v          mod_boards.py  has no variant)
    ky-023-joystick, membrane-keypad-4x4, lcd1602a-i2c-backpack, sg90-micro-servo
                               joystick-module, keypad-4x4, lcd1602-i2c, sg90    mod_boards.py

Frames. An off-board module's origin is the footprint's corner on the table: the lowest x, y and z of
the model, so the module rests on z = 0. Its connector pins keep the part definition's layout:
pin i sits at pin 1 + offsetPitch * 2.54 (a screw terminal at its own pitch), and each "pin-<id>"
empty has +z out along the pin, where the mating housing arrives. A part that goes on a board (the
bare DHT11) takes the rigid frame instead: origin at pin 1's hole on the board surface, +z down.

    blender -b --factory-startup --python-exit-code 1 -P module.py -- --part <part.json>
      --texture <w>x<h> --samples <n> --seed <n> --out <glb> --colliders <json>
      [--step-glb <glb>] [--preview <dir>]
"""
import importlib
import os
import sys


sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import devicekit as kit  # noqa: E402

args, part = kit.start(lambda p: p.add_argument('--step-glb'))
# Two definitions (the power module and the relay) carry no variant; their id names the drawing.
VARIANT = part['geometry']['params'].get('variant', part['id'])

DRAWN_IN = {
    'dht11-3pin-breakout': ('mod_sensors', 'dht11_module'),
    'dht11-bare-4pin-sip': ('mod_sensors', 'dht11_bare'),
    'hc-sr04': ('mod_sensors', 'hc_sr04'),
    'hc-sr501': ('mod_sensors', 'hc_sr501'),
    'adafruit-1085-stemma-qt': ('mod_ads', 'ads1115'),
    'lafvin-ads7830': ('mod_ads', 'ads7830'),
    'breadboard-power-module': ('mod_boards', 'power_module'),
    'relay-module-5v': ('mod_boards', 'relay_module'),
    'ky-023-joystick': ('mod_boards', 'joystick_module'),
    'membrane-keypad-4x4': ('mod_boards', 'keypad'),
    'lcd1602a-i2c-backpack': ('mod_boards', 'lcd1602'),
    'sg90-micro-servo': ('mod_boards', 'sg90'),
}
if VARIANT not in DRAWN_IN:
    raise RuntimeError(f'module.py has no variant {VARIANT}')
module, function = DRAWN_IN[VARIANT]

root = kit.root(args)
colliders = getattr(importlib.import_module(module), function)(root, part, args)
# The board and what stands on it hang under one "body" node; bodyMm describes it.
for name, objs in colliders:
    if name == 'body' and not (len(objs) == 1 and objs[0].name == 'body'):
        group = kit.node(root, 'body')
        for obj in objs:
            obj.parent = group
        colliders = [('body', [group]) if n == 'body' else (n, o) for n, o in colliders]
if part['footprint']['kind'] == 'offboard':
    kit.recentre(root)
kit.finish(args, root, [kit.box_of(name, *objs) for name, objs in colliders])
print(f"{part['id']}: {kit.triangles(root)} triangles")
