"""What the display, IC and module families need beyond partkit.py (SPEC 7, 10.4 "Parts").

partkit.py holds what every part script shares: the arguments, the root, the pin-<id> empties, the
mesh Builder and an export that keeps custom properties. This file adds the rest the displays, ICs
and off-board modules ask for: a Builder with tapered boxes, frusta, tubes and drilled slabs; a
planar-UV decal baked from text and shapes; circuit boards with a legend; male headers; the STEP
helpers; and development previews.

Frames (SPEC 7, the part GLB contract). Millimetres, z up.
  Rigid (on-board) parts: the origin is pin[0]'s hole centre on the board's top surface (z = 0);
  a pin's offsetPitch [dx, dy] sits at (dx, dy) * 2.54. Each pin leaves the body at an empty
  "pin-<pinId>" whose local +z points out of the body (down, -z, for a part standing on a board).
  Off-board modules: the origin is the footprint's corner on the table (x and y at the model's
  lowest values, z = 0 at the table). Pin empties sit at each connector's tip and their local +z
  points out along the pin, where the mating housing arrives.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import partkit  # noqa: E402
from lib import bake, export, materials, scene  # noqa: E402

PITCH = partkit.PITCH
LEG = 0.64  # a 2.54 mm header pin's square side


def start(add_args=None):
    """partkit.start() plus --preview <dir>, which renders PNGs of the result for looking at it
    while developing (the build never passes it). Returns (args, part definition); args.px is the
    texture budget as [w, h]."""
    def extra(p):
        p.add_argument('--preview')
        if add_args:
            add_args(p)

    args, part, _ = partkit.start(extra)
    args.px = [int(n) for n in (args.texture or '0x0').split('x')]
    return args, part


def rgb(hex6):
    """An sRGB hex colour (no #) as the linear values Blender takes."""
    return partkit.colour('#' + hex6)


_cache = {}


def material(name, hex6, **inputs):
    """A Principled BSDF material, created once per name."""
    if name not in _cache:
        _cache[name] = materials.principled(name, rgb(hex6), **inputs)
    return _cache[name]


def driven(mat):
    """A material the studio recolours or lights (partkit.driven keeps dedup from merging it)."""
    return partkit.driven(mat)


def emissive(name, hex6):
    """A material with its colour as emission, for baking flat colours into a texture."""
    key = f'{name}:emission'
    if key not in _cache:
        _cache[key] = materials.emission(name, rgb(hex6))
    return _cache[key]


# --- partkit's Builder, with what the families add -----------------------------------------------


class Mesh(partkit.Builder):
    """partkit.Builder plus tapered boxes, frusta, tubes, lofts between rings, drilled slabs and
    planar UVs. Solids are wound so every face points out: a ring counter-clockwise from above, or
    about its axis, gives outward side faces. to_object() welds the seams and shades by angle."""

    def _verts(self, points):
        return [self._v(p) for p in points]

    def loft(self, lower, upper, mat, caps=(True, True)):
        """A solid between two rings of (x, y, z) points listed counter-clockwise from above."""
        n = len(lower)
        a, b = self._verts(lower), self._verts(upper)
        for i in range(n):
            j = (i + 1) % n
            self._face([a[i], a[j], b[j], b[i]], mat)
        if caps[0]:
            self._face(list(reversed(self._verts(lower))), mat)
        if caps[1]:
            self._face(self._verts(upper), mat)

    def box(self, lo, hi, mat, taper=0.0, caps=(True, True)):
        """An axis-aligned box. taper insets the top ring on every side."""
        if taper == 0.0 and caps == (True, True):
            return super().box(lo, hi, mat)
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        t = taper
        self.loft(
            [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)],
            [(x0 + t, y0 + t, z1), (x1 - t, y0 + t, z1), (x1 - t, y1 - t, z1), (x0 + t, y1 - t, z1)],
            mat,
            caps,
        )

    def extrude(self, ring, z0, z1, mat, caps=(True, True)):
        """A polygon (x, y points, counter-clockwise from above) extruded from z0 to z1."""
        self.prism(ring, z0, z1, mat, bottom=mat if caps[0] else None, top=mat if caps[1] else None)

    def disc(self, c, r, z0, z1, mat, n=16, r_top=None, caps=(True, True)):
        """A vertical cylinder or cone frustum around (cx, cy)."""
        cx, cy = c
        rt = r if r_top is None else r_top

        def ring(rad, z):
            return [
                (cx + rad * math.cos(2 * math.pi * k / n), cy + rad * math.sin(2 * math.pi * k / n), z)
                for k in range(n)
            ]

        self.loft(ring(r, z0), ring(rt, z1), mat, caps)

    def tube(self, p0, p1, r, mat, n=12, caps=(True, True), r1=None):
        """A cylinder (or frustum, r1 at p1) from p0 to p1 along any axis."""
        a, b = Vector(p0), Vector(p1)
        axis = (b - a).normalized()
        helper = Vector((1, 0, 0)) if abs(axis.x) < 0.9 else Vector((0, 1, 0))
        u = axis.cross(helper).normalized()
        v = axis.cross(u).normalized()
        rr = r if r1 is None else r1

        def ring(c, rad):
            return [
                tuple(c + rad * (math.cos(2 * math.pi * k / n) * u + math.sin(2 * math.pi * k / n) * v))
                for k in range(n)
            ]

        # Rings run counter-clockwise about the axis, so the side faces point outward.
        lo, up = self._verts(ring(a, r)), self._verts(ring(b, rr))
        for i in range(n):
            j = (i + 1) % n
            self._face([lo[i], lo[j], up[j], up[i]], mat)
        if caps[0]:
            self._face(list(reversed(self._verts(ring(a, r)))), mat)
        if caps[1]:
            self._face(self._verts(ring(b, rr)), mat)

    def slab(self, outline, holes, z0, z1, mat, top_mat=None):
        """A plate with straight holes through it: outline and holes are (x, y) rings, all
        counter-clockwise from above. The top takes top_mat when given."""
        top = top_mat or mat
        rings = [(list(outline), False)] + [(list(reversed(h)), True) for h in holes]
        for pts, _hole in rings:
            lo = self._verts([(x, y, z0) for x, y in pts])
            up = self._verts([(x, y, z1) for x, y in pts])
            n = len(pts)
            for i in range(n):
                j = (i + 1) % n
                self._face([lo[i], lo[j], up[j], up[i]], mat)
        # The top and the bottom, filled around the holes.
        for z, m, facing_up in ((z1, top, True), (z0, mat, False)):
            edges = []
            for pts, _hole in rings:
                verts = self._verts([(x, y, z) for x, y in pts])
                edges += [self.bm.edges.new((verts[i - 1], verts[i])) for i in range(len(verts))]
            res = bmesh.ops.triangle_fill(self.bm, use_beauty=True, use_dissolve=False, edges=edges)
            for f in res['geom']:
                if isinstance(f, bmesh.types.BMFace):
                    f.material_index = self._slot(m)
                    f.normal_update()
                    if (f.normal.z > 0) != facing_up:
                        f.normal_flip()

    def to_object(self, name, parent=None):
        """Weld the seams, shade by angle and make the mesh object under parent."""
        return self.finish(name, parent)


def cut(obj, cutters):
    """Subtract each cutter object from obj with an exact Boolean, then delete the cutter."""
    for c in cutters:
        mod = obj.modifiers.new('cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = c
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(c)


def mark_top(obj, rect, z, mat, tol=1e-4):
    """Give the upward faces lying at height z the material mat and UVs that run over rect =
    (x0, y0, x1, y1) as decal() maps it; every other face's UVs collapse to a point."""
    me = obj.data
    if mat not in list(me.materials):
        me.materials.append(mat)
    slot = list(me.materials).index(mat)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    uv = bm.loops.layers.uv.verify()
    x0, y0, x1, y1 = rect
    for f in bm.faces:
        on = f.normal.z > 0.99 and all(abs(v.co.z - z) < tol for v in f.verts)
        if on:
            f.material_index = slot
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0)) if on else (0, 0)
    bm.to_mesh(me)
    bm.free()


def mesh_object(name, parent, build):
    """A one-off Mesh made by build(mesh) and turned into an object."""
    m = Mesh()
    build(m)
    return m.to_object(name, parent)


def rounded_rect(x0, y0, x1, y1, r, n=4):
    """A rectangle with rounded corners as a counter-clockwise ring."""
    if r <= 0:
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def circle(cx, cy, r, n=12, clockwise=False):
    pts = [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
    return list(reversed(pts)) if clockwise else pts


# --- Pins ---------------------------------------------------------------------------------------


def pin_empty(root, pin_id, position, direction):
    """The empty "pin-<id>" at position whose local +z points along direction (core frame)."""
    turn = Vector((0, 0, 1)).rotation_difference(Vector(direction)).to_euler()
    return partkit.pin(root, pin_id, position, (turn.x, turn.y, turn.z))


def root(args):
    """The part's root node, named for the file."""
    return partkit.root(args.name)


def node(root, name, location=(0, 0, 0)):
    """An empty node the studio finds by name (a pivot for a part that moves)."""
    obj = scene.link(bpy.data.objects.new(name, None), root)
    obj.location = location
    return obj


def header(m, root, pins, base_mat, pin_mat, board_top, row_dir=(1, 0), base_h=2.5, above=6.0, tail=1.5,
           base_width=PITCH):
    """A straight male header on the top face of a board. pins is [(pin id or None, (x, y))] in a
    straight row along row_dir; the black base sits on board_top and the metal pin stands above it
    and ends in a tail below the board. Returns the pin tips for the empties."""
    tips = []
    dx, dy = row_dir
    xs = [p[1][0] for p in pins]
    ys = [p[1][1] for p in pins]
    half = PITCH / 2
    if dx:
        lo = (min(xs) - half, min(ys) - base_width / 2, board_top)
        hi = (max(xs) + half, max(ys) + base_width / 2, board_top + base_h)
    else:
        lo = (min(xs) - base_width / 2, min(ys) - half, board_top)
        hi = (max(xs) + base_width / 2, max(ys) + half, board_top + base_h)
    m.box(lo, hi, base_mat, taper=0.0)
    h = LEG / 2
    for pid, (x, y) in pins:
        m.box((x - h, y - h, board_top - tail), (x + h, y + h, board_top + base_h + above), pin_mat)
        tips.append((pid, (x, y, board_top + base_h + above)))
    return tips


# --- Decals: text and shapes baked into a colour texture ------------------------------------------


def _flat(name, x0, y0, x1, y1, z, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [(0, 1, 2, 3)])
    me.materials.append(mat)
    return scene.link(bpy.data.objects.new(name, me))


def decal(name, rect, px, base_hex, items):
    """Bake a colour image of what lies over rect = (x0, y0, x1, y1) on a face: a backing of
    base_hex, then items drawn in order. An item is one of
      ('text', string, x, y, height_mm, hex, rotation_deg, align)
      ('box', x0, y0, x1, y1, hex)
      ('ring', cx, cy, r_outer, r_inner, hex)
    The image maps u = (x - x0) / (x1 - x0), v = (y - y0) / (y1 - y0) as Mesh.planar_uv does.
    """
    x0, y0, x1, y1 = rect
    made = []
    z = 0.002
    made.append(_flat('backing', x0, y0, x1, y1, z / 2, emissive(f'{name}-base', base_hex)))
    for k, item in enumerate(items):
        ink = item[5] if item[0] == 'text' else item[-1]
        mat = emissive(f'ink-{ink}', ink)
        if item[0] == 'text':
            _, body, x, y, h, _hex, rot, align = item
            curve = bpy.data.curves.new(f'{name}-t{k}', 'FONT')
            curve.body = body
            curve.size = h / 0.73  # Blender's built-in font: digits stand 0.73 of the size tall
            curve.align_x = align
            curve.align_y = 'CENTER'
            curve.materials.append(mat)
            obj = scene.link(bpy.data.objects.new(f'{name}-t{k}', curve))
            obj.location = (x, y, z)
            obj.rotation_euler.z = math.radians(rot)
            made.append(obj)
        elif item[0] == 'box':
            made.append(_flat(f'{name}-b{k}', item[1], item[2], item[3], item[4], z, mat))
        elif item[0] == 'ring':
            _, cx, cy, ro, ri, _hex = item
            me = bpy.data.meshes.new(f'{name}-r{k}')
            n = 20
            verts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n), z)
                     for r in (ro, ri) for i in range(n)]
            faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
            if ri > 0:
                me.from_pydata(verts, [], faces)
            else:
                me.from_pydata(verts[:n], [], [tuple(range(n))])
            me.materials.append(mat)
            made.append(scene.link(bpy.data.objects.new(f'{name}-r{k}', me)))
    target = _flat(f'{name}-target', x0, y0, x1, y1, 0, materials.principled(f'{name}-target', (1, 1, 1)))
    uv = target.data.uv_layers.new(name='UVMap')
    for loop in target.data.loops:
        co = target.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))
    img = bake.bake(target, 'EMIT', bake.image(name, *px), made, extrusion=0.05, distance=0.1)
    for obj in [target, *made]:
        bpy.data.objects.remove(obj)
    return img


def textured(mat, img):
    """Put a baked colour image on a material's base colour."""
    materials.base_color(mat, img)


# --- Finishing ----------------------------------------------------------------------------------


def finish(args, root, boxes):
    """Export the GLB (with custom properties) and the colliders, then render previews when
    --preview was given."""
    bpy.context.view_layer.update()
    partkit.write(args, root, boxes)
    if args.preview:
        _preview(args.preview, root)


def box_of(name, *objs):
    """A collider box around objects (their children included)."""
    bpy.context.view_layer.update()
    flat = []
    for o in objs:
        flat += [o, *o.children_recursive]
    return export.box(name, [o for o in flat if o.type in ('MESH', 'CURVE')])


def triangles(root):
    return sum(
        len(p.vertices) - 2
        for o in [root, *root.children_recursive]
        if o.type == 'MESH'
        for p in o.data.polygons
    )


def _preview(directory, root):
    """PNGs of the model from three sides, with a red dot at each pin empty. Development only."""
    os.makedirs(directory, exist_ok=True)
    sc = bpy.context.scene
    objs = [o for o in [root, *root.children_recursive] if o.type == 'MESH']
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    hi = Vector((max(p[i] for p in pts) for i in range(3)))
    centre, size = (lo + hi) / 2, max((hi - lo).length, 1.0)

    dot = materials.emission('preview-pin', (1, 0.05, 0.05))
    for o in [root, *root.children_recursive]:
        if o.name.startswith('pin-'):
            me = bpy.data.meshes.new('dot')
            bm = bmesh.new()
            bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=max(size * 0.012, 0.25))
            bm.to_mesh(me)
            bm.free()
            me.materials.append(dot)
            d = scene.link(bpy.data.objects.new('dot', me))
            d.location = o.matrix_world.translation
            # A short stalk along the pin's axis so its direction shows.
            stalk = bpy.data.meshes.new('stalk')
            bm = bmesh.new()
            bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=max(size * 0.006, 0.12), radius2=0.0,
                                  depth=max(size * 0.05, 1.0), matrix=Matrix.Translation((0, 0, max(size * 0.025, 0.5))))
            bm.to_mesh(stalk)
            bm.free()
            stalk.materials.append(dot)
            s = scene.link(bpy.data.objects.new('stalk', stalk))
            s.matrix_world = o.matrix_world

    world = sc.world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.57, 0.6, 1)
    bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    sun_obj = scene.link(bpy.data.objects.new('sun', sun))
    sun_obj.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    cam = bpy.data.cameras.new('cam')
    cam.lens = 60
    cam_obj = scene.link(bpy.data.objects.new('cam', cam))
    sc.camera = cam_obj
    sc.render.resolution_x, sc.render.resolution_y = 960, 720
    sc.cycles.samples = 24
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = 'Standard'
    views = {
        'iso': Vector((-0.55, -0.8, 0.65)),
        'top': Vector((0.0, -0.02, 1.0)),
        'front': Vector((0.0, -1.0, 0.18)),
        'back': Vector((0.45, 0.85, 0.5)),
    }
    for label, direction in views.items():
        d = direction.normalized()
        cam_obj.location = centre + d * size * 1.9
        cam_obj.rotation_euler = (centre - cam_obj.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(directory, f'{label}.png')
        bpy.ops.render.render(write_still=True)


# --- Boards and modules ---------------------------------------------------------------------------

FR4 = 'b79f62'  # a PCB's cut edge
SILK = 'eeeee8'  # white legend ink


def board(root, name, rect, z0, thickness, mask_hex, px, labels=(), holes=(), radius=1.0, rough=0.45):
    """A circuit board: a slab from z0 up by thickness with rounded corners and drilled holes, a
    solder-mask top that carries a legend baked from labels (decal items), and a pale cut edge.
    Returns (object, z of the top face). holes are (cx, cy, diameter)."""
    x0, y0, x1, y1 = rect
    top_z = z0 + thickness
    edge = material('pcb-edge', FR4, Roughness=0.6)
    mask = material('pcb-mask', mask_hex, Roughness=rough)
    m = Mesh()
    m.slab(
        rounded_rect(x0, y0, x1, y1, radius),
        [circle(cx, cy, d / 2, 12) for cx, cy, d in holes],
        z0,
        top_z,
        edge,
        top_mat=mask,
    )
    obj = m.to_object(name, root)
    img = decal(f'{name}-legend', rect, px, mask_hex, list(labels))
    legend = material('pcb-legend', mask_hex, Roughness=rough)
    textured(legend, img)
    mark_top(obj, rect, top_z, legend)
    return obj, top_z


def import_step(path):
    """The meshes of a step-to-glb.ts intermediate GLB, back in the STEP's own frame (z up)."""
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def join(objects, name):
    """Join objects into the first one and name it."""
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = joined.data.name = name
    return joined


def clean_step(obj, angle_deg=30):
    """Weld the faces a STEP reader leaves apart and shade by angle instead of its normals."""
    bpy.context.view_layer.objects.active = obj
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=math.radians(angle_deg))


def restyle_step(obj, metals, overrides=None, roughness=0.5):
    """Replace each STEP colour material ("step-<hex>") on obj with a Principled one: the colours
    in metals are metal (with their roughness), the rest plastic. overrides maps a hex to
    (new hex, inputs) for colours that stand in for something else, such as a black PCB."""
    overrides = overrides or {}
    for slot in obj.material_slots:
        old = slot.material
        if not old.name.startswith('step-'):
            continue
        hexa = old.name.removeprefix('step-')
        old.name = f'imported-{hexa}'
        if hexa in overrides:
            new_hex, inputs = overrides[hexa]
            slot.material = materials.principled(f'step-{hexa}', rgb(new_hex), **inputs)
        elif hexa in metals:
            slot.material = materials.principled(f'step-{hexa}', rgb(hexa), Metallic=1.0, Roughness=metals[hexa])
        else:
            slot.material = materials.principled(f'step-{hexa}', rgb(hexa), Roughness=roughness)
        bpy.data.materials.remove(old)


def bake_occlusion(obj, px, distance, name):
    """Unwrap obj, bake ambient occlusion into one image and put it in every material's occlusion
    slot. Islands are repacked at one texel density so a small board gets the whole map."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(shape_method='AABB', rotate=True, margin_method='FRACTION', margin=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.scene.world.light_settings.distance = distance
    img = bake.bake(obj, 'AO', bake.image(name, *px, color=False))
    for slot in obj.material_slots:
        materials.occlusion(slot.material, img)
    return img


def panel(root, name, origin, u, v, mat):
    """A flat quad from origin along u and v (3-vectors), UV (0, 0) at origin and (1, 1) opposite.
    It faces u x v. glTF flips v on export, so a texture drawn top-down reads with +v up."""
    o = Vector(origin)
    a, b = Vector(u), Vector(v)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(o), tuple(o + a), tuple(o + a + b), tuple(o + b)], [], [(0, 1, 2, 3)])
    me.materials.append(mat)
    uv = me.uv_layers.new(name='UVMap')
    for loop, co in zip(uv.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop.uv = co
    return scene.link(bpy.data.objects.new(name, me), root)


def dome(m, centre, rx, ry, rz, z0, mat, n=24, rings=8):
    """The upper half of an ellipsoid (semi-axes rx, ry, rz) standing on z0, as a smooth solid."""
    cx, cy = centre
    levels = [
        (z0 + rz * math.sin(math.pi / 2 * k / rings), math.cos(math.pi / 2 * k / rings))
        for k in range(rings)
    ]
    ring = lambda z, s: [
        (cx + rx * s * math.cos(2 * math.pi * i / n), cy + ry * s * math.sin(2 * math.pi * i / n), z)
        for i in range(n)
    ]
    for (za, sa), (zb, sb) in zip(levels, levels[1:] + [(z0 + rz, 0.0)]):
        if sb == 0.0:
            apex = m._verts([(cx, cy, zb)])[0]
            lo = m._verts(ring(za, sa))
            for i in range(n):
                m._face([lo[i], lo[(i + 1) % n], apex], mat)
        else:
            m.loft(ring(za, sa), ring(zb, sb), mat, caps=(False, False))


def label(text, x, y, height=0.9, rotation=0, align='CENTER', ink=SILK):
    """A legend text item for board()/decal()."""
    return ('text', text, x, y, height, ink, rotation, align)


def recentre(root):
    """Move the model so its lowest corner is the origin: the footprint's corner on the table."""
    bpy.context.view_layer.update()
    pts = [
        o.matrix_world @ Vector(c)
        for o in [root, *root.children_recursive]
        if o.type == 'MESH'
        for c in o.bound_box
    ]
    lo = Vector((min(p[i] for p in pts) for i in range(3)))
    for o in root.children:
        o.location -= lo
    bpy.context.view_layer.update()
    return lo
