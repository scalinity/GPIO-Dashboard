"""glTF Binary export and the physics collider file (SPEC 10.3 stage 5)."""
import json

import bpy
from mathutils import Vector


def glb(path, root, tangents=False, copyright=''):
    """Export root and its descendants. Blender's z-up becomes glTF's y-up (the exporter's
    default), so a core point (x, y, z) lands at (x, z, -y)."""
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_tangents=tangents,
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        export_copyright=copyright,
    )


def box(name, objects):
    """The axis-aligned box around objects, in the scene frame (mm, z up)."""
    corners = [obj.matrix_world @ Vector(c) for obj in objects for c in obj.bound_box]
    return {
        'name': name,
        'min': [round(min(c[i] for c in corners), 4) for i in range(3)],
        'max': [round(max(c[i] for c in corners), 4) for i in range(3)],
    }


def colliders(path, boxes, capsules=()):
    """Simplified proxies for physics (SPEC 10.5): axis-aligned boxes {name, min, max} and
    capsules {name, a, b, radius}, in the asset's core frame (mm, z up)."""
    with open(path, 'w') as f:
        json.dump({'units': 'mm', 'frame': 'core, z up', 'boxes': boxes, 'capsules': list(capsules)}, f, indent=2)
        f.write('\n')
