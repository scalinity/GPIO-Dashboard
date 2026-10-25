# The app icon: a breadboard with a lit green LED and an orange jumper, rendered in Blender and
# composited onto a macOS squircle. Writes two 1024 px PNGs into OUT_DIR:
#   icon-1024.png        the full icon (squircle, shadow, art) for `tauri icon`
#   foreground-1024.png  the art alone, for the Icon Composer layer (src-tauri/icons/AppIcon.icon)
#
#   blender -b --factory-startup -P scripts/icon/app_icon.py -- OUT_DIR
#   npx tauri icon OUT_DIR/icon-1024.png --output OUT_DIR/set   # then copy the files tauri.conf.json lists
#   cp OUT_DIR/foreground-1024.png src-tauri/icons/AppIcon.icon/Assets/foreground.png
#   xcrun actool src-tauri/icons/AppIcon.icon --compile OUT_DIR/car --platform macosx \
#     --minimum-deployment-target 11.0 --app-icon AppIcon --include-all-app-icons \
#     --output-partial-info-plist OUT_DIR/car/partial.plist        # then copy Assets.car to icons/
#
# Everything is modelled here; no external model, texture or HDRI is used.
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index("--") + 1]
S = 1024


def material(name, color, rough=0.5, coat=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # Breadboard: a bevelled block, top at z = 0, with a 7 x 4 grid of holes and a rail row.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.45))
    board = bpy.context.object
    board.scale = (7.2, 5.4, 0.9)
    bpy.ops.object.transform_apply(scale=True)
    hole = material("Hole", (0.012, 0.013, 0.016), rough=0.8)
    board.data.materials.append(material("Board", (0.90, 0.90, 0.89), rough=0.42, coat=0.15))
    board.data.materials.append(hole)
    bevel = board.modifiers.new("Bevel", "BEVEL")
    bevel.width, bevel.segments, bevel.limit_method = 0.22, 6, "ANGLE"
    bpy.ops.object.modifier_apply(modifier="Bevel")
    centres = [(-2.7 + i * 0.9, y) for i in range(7) for y in (0.95, 0.05, -0.85, -1.75, 2.0)]
    bm = bmesh.new()
    for x, y in centres:
        bmesh.ops.create_cube(
            bm, size=1.0, matrix=Matrix.LocRotScale(Vector((x, y, -0.25)), None, Vector((0.34, 0.34, 0.6)))
        )
    cut = bpy.data.meshes.new("Cutters")
    bm.to_mesh(cut)
    bm.free()
    cut.materials.append(hole)
    cutters = bpy.data.objects.new("Cutters", cut)
    scene.collection.objects.link(cutters)
    holes = board.modifiers.new("Holes", "BOOLEAN")
    holes.operation, holes.object, holes.solver, holes.material_mode = "DIFFERENCE", cutters, "EXACT", "TRANSFER"
    bpy.context.view_layer.objects.active = board
    bpy.ops.object.modifier_apply(modifier="Holes")
    bpy.data.objects.remove(cutters, do_unlink=True)
    for y, color in ((2.42, (0.80, 0.06, 0.06)), (1.58, (0.04, 0.16, 0.75))):
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, y, 0.002))
        stripe = bpy.context.object
        stripe.scale = (6.6, 0.13, 1)
        stripe.data.materials.append(material("Rail", color, rough=0.45))

    # LED: flange, body and dome over a hole, lit, with a green light inside.
    led_mat = material("LED", (0.0, 0.55, 0.1), rough=0.12, coat=1.0, emit=(0.0, 1.0, 0.12), strength=1.1)
    lx, ly = -0.9, 0.05
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.46, depth=0.12, location=(lx, ly, 0.06))
    parts.append(bpy.context.object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.40, depth=0.75, location=(lx, ly, 0.495))
    parts.append(bpy.context.object)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=0.40, location=(lx, ly, 0.87))
    parts.append(bpy.context.object)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.data.materials.append(led_mat)
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[1]
    bpy.ops.object.shade_smooth()
    bpy.ops.object.join()
    glow = bpy.data.lights.new("LEDGlow", "POINT")
    glow.energy, glow.color, glow.shadow_soft_size = 110, (0.2, 1.0, 0.4), 0.35
    glow_obj = bpy.data.objects.new("LEDGlow", glow)
    scene.collection.objects.link(glow_obj)
    glow_obj.location = (lx, ly, 0.7)

    # Jumper: an arc from the LED's row to the rail, with a housing at each end.
    start, end = Vector((0.9, 0.05, 0.0)), Vector((2.7, 2.0, 0.0))
    curve = bpy.data.curves.new("Wire", "CURVE")
    curve.dimensions, curve.bevel_depth, curve.bevel_resolution, curve.resolution_u = "3D", 0.17, 6, 32
    a, z = curve.splines.new("BEZIER").bezier_points.add(1) or curve.splines[0].bezier_points
    a.co, a.handle_left, a.handle_right = start + Vector((0, 0, 0.35)), start + Vector((0, 0, -0.2)), start + Vector((0, 0, 2.2))
    z.co, z.handle_right, z.handle_left = end + Vector((0, 0, 0.35)), end + Vector((0, 0, -0.2)), end + Vector((0, 0, 2.2))
    curve.materials.append(material("Wire", (1.0, 0.26, 0.0), rough=0.35, coat=0.6))
    scene.collection.objects.link(bpy.data.objects.new("Wire", curve))
    housing = material("Housing", (0.02, 0.02, 0.025), rough=0.5)
    for c in (start, end):
        bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.14, depth=0.42, location=(c.x, c.y, 0.2))
        bpy.context.object.data.materials.append(housing)

    # Everything turns together; a shadow catcher under the board grounds it.
    root = bpy.data.objects.new("IconRoot", None)
    scene.collection.objects.link(root)
    for o in scene.objects:
        if o is not root:
            o.parent = root
    root.rotation_euler = (0, 0, math.radians(-16))
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.9))
    bpy.context.object.is_shadow_catcher = True

    target = Vector((0.0, 0.25, -0.2))
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 62
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (-3.8, -11.0, 12.5)
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    for name, loc, power, size, color in (
        ("Key", (-6, -5, 10), 2200, 8, (1, 1, 1)),
        ("Rim", (6, 8, 5), 1400, 6, (0.75, 0.85, 1.0)),
        ("Fill", (8, -8, 4), 500, 8, (1.0, 0.95, 0.9)),
    ):
        light = bpy.data.lights.new(name, "AREA")
        light.energy, light.size, light.color = power, size, color
        o = bpy.data.objects.new(name, light)
        scene.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = (target - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.02, 0.03, 0.06, 1)
    background.inputs["Strength"].default_value = 0.6

    r = scene.render
    r.engine, r.resolution_x, r.resolution_y, r.film_transparent = "CYCLES", S, S, True
    scene.cycles.samples, scene.cycles.use_denoising = 128, True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Punchy"
    r.image_settings.file_format, r.image_settings.color_mode = "PNG", "RGBA"
    r.filepath = os.path.join(OUT, "fg.png")
    bpy.ops.render.render(write_still=True)


# --- compositing, in sRGB-encoded floats with straight alpha; rows run bottom-up as Blender's do ---


def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return a


def save(a, path):
    img = bpy.data.images.new("out", a.shape[1], a.shape[0], alpha=True)
    img.pixels[:] = np.clip(a, 0, 1).ravel()
    img.filepath_raw, img.file_format = path, "PNG"
    img.save()
    bpy.data.images.remove(img)


def box(a, r, axis):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis)
    n = a.shape[axis]
    return (np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(c, np.arange(n), axis=axis)) / (2 * r + 1)


def blur(a, sigma):
    """Three box passes, close to a Gaussian of this sigma."""
    r = max(1, int(round(sigma * 0.95)))
    for _ in range(3):
        a = box(box(a, r, 0), r, 1)
    return a


def resize(a, scale):
    """Bilinear, on premultiplied colour."""
    h, w = a.shape[:2]
    ys = (np.arange(int(h * scale)) + 0.5) / scale - 0.5
    xs = (np.arange(int(w * scale)) + 0.5) / scale - 0.5
    y0, x0 = np.clip(np.floor(ys).astype(int), 0, h - 1), np.clip(np.floor(xs).astype(int), 0, w - 1)
    y1, x1 = np.clip(y0 + 1, 0, h - 1), np.clip(x0 + 1, 0, w - 1)
    fy, fx = (ys - np.floor(ys))[:, None, None], (xs - np.floor(xs))[None, :, None]
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4]
    out = (pm[y0][:, x0] * (1 - fy) * (1 - fx) + pm[y0][:, x1] * (1 - fy) * fx
           + pm[y1][:, x0] * fy * (1 - fx) + pm[y1][:, x1] * fy * fx)
    alpha = out[..., 3:4]
    out[..., :3] = np.where(alpha > 1e-6, out[..., :3] / np.maximum(alpha, 1e-6), 0)
    return out


def place(layer, cx, cy):
    out = np.zeros((S, S, 4), np.float32)
    h, w = layer.shape[:2]
    y0, x0 = int(cy - h / 2), int(cx - w / 2)
    out[y0:y0 + h, x0:x0 + w] = layer
    return out


def over(dst, src):
    a = src[..., 3:4]
    out = dst.copy()
    oa = a + dst[..., 3:4] * (1 - a)
    out[..., :3] = np.where(oa > 1e-6, (src[..., :3] * a + dst[..., :3] * dst[..., 3:4] * (1 - a)) / np.maximum(oa, 1e-6), 0)
    out[..., 3:4] = oa
    return out


def screen(base, light):
    return 1 - (1 - base) * (1 - np.clip(light, 0, 1))


def composite():
    fg = load(os.path.join(OUT, "fg.png"))
    ys, xs = np.where(fg[..., 3] > 0.02)
    fg = fg[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    # The LED's bloom: its saturated green pixels, blurred at two widths.
    g = fg[..., 1]
    core = ((g > 0.5) & (g - np.maximum(fg[..., 0], fg[..., 2]) > 0.15)).astype(np.float32)
    glow = (blur(core, 9) * 0.55 + blur(core, 30) * 0.45)[..., None] * np.array([0.15, 1.0, 0.35], np.float32)

    def art(width, cx, cy):
        s = width / fg.shape[1]
        return (place(resize(fg, s), cx, cy),
                place(resize(np.dstack([glow, glow.max(axis=2, keepdims=True)]), s), cx, cy))

    # The squircle: a superellipse (n = 5) on Apple's macOS grid, an 824 px body on 1024.
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) + 0.5
    a = 412.0
    dist = (((np.abs(xx - 512) / a) ** 5 + (np.abs(yy - 512) / a) ** 5) ** 0.2 - 1) * a
    mask = np.clip(0.5 - dist, 0, 1)
    t = np.clip((yy - 100) / 824.0, 0, 1)[..., None]
    top, bottom = np.array([0.17, 0.24, 0.40]), np.array([0.035, 0.05, 0.11])
    bg = bottom + (top - bottom) * t
    bg += 0.10 * np.exp(-(((xx - 430) / 380) ** 2 + ((yy - 820) / 260) ** 2))[..., None] * np.array([0.55, 0.7, 1.0])
    bg += 0.12 * (np.clip(1 - np.abs(dist + 2.5) / 2.0, 0, 1) * np.clip((yy - 512) / 412, 0, 1))[..., None]
    shadow = np.zeros((S, S, 4), np.float32)
    shadow[..., 3] = blur(np.roll(mask, -12, axis=0), 14) * 0.45

    icon = over(shadow, np.dstack([bg, mask]))
    fgc, glc = art(700, 512, 452)
    fgc[..., 3] *= mask
    icon = over(icon, fgc)
    icon[..., :3] = screen(icon[..., :3], glc[..., :3] * 0.85 * mask[..., None])
    save(icon, os.path.join(OUT, "icon-1024.png"))

    # Icon Composer's canvas is the shape itself, so the art is placed larger.
    fg2, gl2 = art(820, 512, 470)
    fg2[..., :3] = screen(fg2[..., :3], gl2[..., :3] * 0.85)
    fg2[..., 3] = np.maximum(fg2[..., 3], np.clip(gl2[..., 3] * 0.5, 0, 1))
    save(fg2, os.path.join(OUT, "foreground-1024.png"))


os.makedirs(OUT, exist_ok=True)
build_scene()
composite()
