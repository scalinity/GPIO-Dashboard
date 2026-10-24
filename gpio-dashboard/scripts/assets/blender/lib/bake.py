"""Cycles bakes into images (SPEC 10.3). Samples and seed are fixed by scene.start()."""
import bpy

MARGIN = 4  # px of edge padding around UV islands


def image(name, width, height, color=True):
    """A bake target. Colour images are sRGB; occlusion and normal maps are data."""
    img = bpy.data.images.new(name, width, height, alpha=False)
    img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return img


def bake(target, kind, img, sources=(), extrusion=0.0, distance=0.0):
    """Bake one pass of target into img through target's active UV map.

    kind is 'AO', 'NORMAL' (tangent space) or 'EMIT'. With sources, the pass is baked from them
    onto target (selected to active): rays start extrusion mm out along target's normals and
    reach at most distance mm. Every material on target writes into img, so bake before the
    materials read from it.
    """
    nodes = [slot.material.node_tree.nodes for slot in target.material_slots]
    for tree in nodes:
        node = tree.new('ShaderNodeTexImage')
        node.name = 'bake'
        node.image = img
        tree.active = node

    bpy.ops.object.select_all(action='DESELECT')
    for obj in sources:
        obj.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    settings = bpy.context.scene.render.bake
    settings.use_selected_to_active = bool(sources)
    settings.cage_extrusion = extrusion
    settings.max_ray_distance = distance
    settings.margin = MARGIN
    bpy.ops.object.bake(type=kind, normal_space='TANGENT', use_clear=True)

    for tree in nodes:
        tree.remove(tree['bake'])
    img.pack()
    return img
