"""Principled BSDF materials that survive glTF export (SPEC 10.3), and the texture hookups."""
import bpy


def srgb(r, g, b):
    """An sRGB colour (0-1) as the linear values Blender's colour inputs take."""
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b))


def principled(name, color, **inputs):
    """A Principled BSDF material; inputs are socket names with spaces as underscores."""
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    for key, value in inputs.items():
        bsdf.inputs[key.replace('_', ' ')].default_value = value
    return mat


def emission(name, color):
    """A pure emission material, for baking a flat colour."""
    mat = bpy.data.materials.new(name)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.remove(nodes['Principled BSDF'])
    emit = nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = (*color, 1)
    links.new(emit.outputs['Emission'], nodes['Material Output'].inputs['Surface'])
    return mat


def _image(mat, image):
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    return node


def base_color(mat, image):
    tree = mat.node_tree
    tree.links.new(_image(mat, image).outputs['Color'], tree.nodes['Principled BSDF'].inputs['Base Color'])


def normal_map(mat, image):
    """A tangent-space normal map (+X/+Y/+Z, as Cycles bakes it)."""
    tree = mat.node_tree
    normal = tree.nodes.new('ShaderNodeNormalMap')
    tree.links.new(_image(mat, image).outputs['Color'], normal.inputs['Color'])
    tree.links.new(normal.outputs['Normal'], tree.nodes['Principled BSDF'].inputs['Normal'])


def occlusion(mat, image):
    """Ambient occlusion in the glTF occlusion slot. The exporter reads it only from the red channel
    plugged into a node group named "glTF Material Output" with an Occlusion input."""
    group = bpy.data.node_groups.get('glTF Material Output')
    if group is None:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    tree = mat.node_tree
    output = tree.nodes.new('ShaderNodeGroup')
    output.node_tree = group
    split = tree.nodes.new('ShaderNodeSeparateColor')
    tree.links.new(_image(mat, image).outputs['Color'], split.inputs['Color'])
    tree.links.new(split.outputs['Red'], output.inputs['Occlusion'])
