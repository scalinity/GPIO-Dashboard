"""Arguments, the pinned Blender version, and an empty millimetre scene with Cycles as the baker."""
import argparse
import sys

import bpy

# SPEC 3.2 pins the 5.2 LTS. A different major.minor fails unless --allow-version-drift.
BLENDER = (5, 2)


def start(add_args=None):
    """Parse the arguments after "--", check the Blender version and empty the scene.

    Every asset script takes --out (the GLB), --colliders (the JSON), and the bake's fixed
    --samples and --seed; add_args adds the asset's own.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--colliders', required=True)
    parser.add_argument('--samples', type=int, required=True)
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--allow-version-drift', action='store_true')
    if add_args:
        add_args(parser)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])

    if bpy.app.version[:2] != BLENDER and not args.allow_version_drift:
        raise RuntimeError(
            f'Blender {bpy.app.version_string} is not {BLENDER[0]}.{BLENDER[1]}; '
            'pass --allow-version-drift to build with it anyway'
        )

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)

    scene = bpy.context.scene
    # 1 Blender unit = 1 mm = 1 glTF unit. The unit scale stays at its default: the glTF importer
    # applies it and the exporter does not.
    # Cycles only bakes (SPEC 10.3): CPU, fixed samples and seed, no denoising.
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = args.samples
    scene.cycles.seed = args.seed
    scene.cycles.use_denoising = False
    return args


def link(obj, parent=None):
    """Put obj in the scene, optionally under parent."""
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    return obj
