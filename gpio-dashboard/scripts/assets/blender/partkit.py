"""Helpers shared by the electronic-part family scripts (SPEC 10.3, 10.4).

lib/ is shared with the board assets and holds the scene, material and collider helpers; this
module adds what the part GLB contract needs on top of them:

  - a mesh Builder (lathes, prisms, boxes, sweeps) that welds its seams and shades by angle;
  - the pin-<id> empties, whose +z axis points along the lead out of the body;
  - an export that keeps custom properties (the root's seatMm), which lib/export.glb drops.

Every part is modelled in the core frame, mm, z up. A rigid part's origin is pin 1's hole at the
board's top surface; a flex-2lead part's origin is the midpoint of its two pins.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import export, materials, scene  # noqa: E402

PITCH = 2.54
SMOOTH_ANGLE = math.radians(35)

# Rotations that turn an empty's +z axis along a lead's exit direction.
DOWN = (math.pi, 0, 0)
TOWARD_PLUS_X = (0, math.pi / 2, 0)
TOWARD_MINUS_X = (0, -math.pi / 2, 0)
# A lathe is built around z; these turn its axis onto x or y.
AXIS_Z = Matrix.Identity(3)
AXIS_X = Matrix.Rotation(math.pi / 2, 3, 'Y')
AXIS_Y = Matrix.Rotation(-math.pi / 2, 3, 'X')


def start(add_args=None):
    """Parse the arguments, then return (args, part definition, geometry params).

    The params of a family with sizes are the ones under args.variant's prefix ("5mm.flange..."),
    with the prefix removed. add_args(parser) adds a family's own arguments.
    """

    def arguments(p):
        p.add_argument('--part', required=True)
        p.add_argument('--name', required=True)  # the asset's name, for the root node
        p.add_argument('--variant')
        p.add_argument('--texture')  # build.ts passes the texture budget; most parts carry none
        if add_args:
            add_args(p)

    args = scene.start(arguments)
    with open(args.part) as f:
        definition = json.load(f)
    params = definition['geometry']['params']
    if args.variant:
        prefix = args.variant + '.'
        params = {k[len(prefix):]: v for k, v in params.items() if k.startswith(prefix)}
    return args, definition, params


# --- Materials ------------------------------------------------------------------------------


def colour(hexa):
    """'#rrggbb' (sRGB) as the linear colour Blender's inputs take."""
    return materials.srgb(*(int(hexa[i:i + 2], 16) / 255 for i in (1, 3, 5)))


def plastic(name, hexa, roughness=0.5, **inputs):
    return materials.principled(name, colour(hexa), Roughness=roughness, **inputs)


def metal(name, hexa, roughness=0.35):
    return materials.principled(name, colour(hexa), Metallic=1.0, Roughness=roughness)


def driven(mat):
    """Mark a material the studio recolours or lights from the part's value or state. The name is
    kept as a custom property so that gltf-transform's dedup, which ignores names, keeps materials
    that happen to share every parameter apart."""
    mat['driven'] = mat.name
    return mat


# --- Geometry -------------------------------------------------------------------------------


class Builder:
    """Collects faces in a bmesh, one material per face, and makes one mesh object of them."""

    def __init__(self):
        self.bm = bmesh.new()
        self.materials = []

    def _slot(self, mat):
        if mat not in self.materials:
            self.materials.append(mat)
        return self.materials.index(mat)

    def _face(self, verts, mat):
        face = self.bm.faces.new(verts)
        face.material_index = self._slot(mat)
        return face

    def _v(self, p):
        return self.bm.verts.new(Vector(p))

    def quad(self, a, b, c, d, mat):
        """A quad (or triangle, if d is None) wound counter-clockwise seen from its front."""
        self._face([self._v(p) for p in (a, b, c, d) if p is not None], mat)

    def polygon(self, points, z, mat, up=True):
        """A flat face at height z; up faces +z, otherwise -z."""
        pts = [(x, y, z) for x, y in (points if up else reversed(points))]
        self._face([self._v(p) for p in pts], mat)

    def box(self, lo, hi, mat):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        for pts in (
            ((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)),
            ((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)),
            ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)),
            ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)),
            ((x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)),
            ((x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)),
        ):
            self._face([self._v(p) for p in pts], mat)

    def prism(self, outline, z0, z1, side, bottom=None, top=None, at=(0, 0)):
        """The counter-clockwise outline (x, y) extruded from z0 to z1. A missing cap is left open."""
        ox, oy = at
        pts = [(x + ox, y + oy) for x, y in outline]
        n = len(pts)
        for i in range(n):
            (xa, ya), (xb, yb) = pts[i], pts[(i + 1) % n]
            self._face([self._v(p) for p in ((xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1))], side)
        if bottom:
            self.polygon(pts, z0, bottom, up=False)
        if top:
            self.polygon(pts, z1, top, up=True)

    def lathe(self, profile, mats, segs=32, at=(0, 0, 0), axis=AXIS_Z, clamp=None, sweep=None):
        """Revolve profile, a list of (r, z) from the axis outward and upward and back to the axis
        (the outside is on the right of the walk, so normals point out), about z.

        mats is one material or one per profile segment. axis turns the result (AXIS_X, AXIS_Y);
        at moves it. clamp(point) can flatten the result, after the move. sweep = (a0, a1) in
        radians makes a partial revolution, with its ends left open.
        """
        a0, a1 = sweep if sweep else (0.0, 2 * math.pi)
        count = segs if sweep is None else segs + 1
        ox = Vector(at)

        def place(r, z, j):
            a = a0 + (a1 - a0) * j / segs
            p = axis @ Vector((r * math.cos(a), r * math.sin(a), z)) + ox
            return clamp(p) if clamp else p

        rings = []
        for r, z in profile:
            if abs(r) < 1e-9:
                rings.append([self.bm.verts.new(place(r, z, 0))])
            else:
                rings.append([self.bm.verts.new(place(r, z, j)) for j in range(count)])
        for i in range(len(profile) - 1):
            mat = mats[i] if isinstance(mats, (list, tuple)) else mats
            lo, hi = rings[i], rings[i + 1]
            for j in range(segs):
                j2 = (j + 1) % count
                if len(lo) == 1:  # the bottom pole
                    self._face([lo[0], hi[j2], hi[j]], mat)
                elif len(hi) == 1:  # the top pole
                    self._face([lo[j], lo[j2], hi[0]], mat)
                else:
                    self._face([lo[j], lo[j2], hi[j2], hi[j]], mat)

    def sweep(self, points, radius, mat, segs=8, caps=(True, True)):
        """A round tube along the polyline points, rings turned to face the mean tangent."""
        pts = [Vector(p) for p in points]
        tangents = []
        for i, p in enumerate(pts):
            before = (p - pts[i - 1]).normalized() if i > 0 else None
            after = (pts[i + 1] - p).normalized() if i < len(pts) - 1 else None
            tangents.append(((before or after) + (after or before)).normalized())
        side = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        rings = []
        for i, (p, t) in enumerate(zip(pts, tangents)):
            side = (side - t * side.dot(t)).normalized()
            other = t.cross(side)
            # A bend is wider across its plane by 1/cos(half the turn); keep the tube's width.
            before = (p - pts[i - 1]).normalized() if i > 0 else t
            after = (pts[i + 1] - p).normalized() if i < len(pts) - 1 else t
            stretch = 1.0 / max(math.cos(math.acos(max(-1.0, min(1.0, before.dot(after)))) / 2), 0.5)
            bend = (after - before)
            bend = bend.normalized() if bend.length > 1e-9 else side
            ring = []
            for j in range(segs):
                a = 2 * math.pi * j / segs
                v = side * math.cos(a) + other * math.sin(a)
                v += bend * (v.dot(bend) * (stretch - 1.0))
                ring.append(self.bm.verts.new(p + v * radius))
            rings.append(ring)
        for lo, hi in zip(rings, rings[1:]):
            for j in range(segs):
                self._face([lo[j], lo[(j + 1) % segs], hi[(j + 1) % segs], hi[j]], mat)
        if caps[0]:
            self._face(list(reversed(rings[0])), mat)
        if caps[1]:
            self._face(rings[-1], mat)

    def arc_strip(self, radius, z0, z1, a0, a1, mat, segs=4, at=(0, 0)):
        """A curved strip on a vertical cylinder of the given radius, facing out."""
        ring = [
            (at[0] + radius * math.cos(a0 + (a1 - a0) * j / segs), at[1] + radius * math.sin(a0 + (a1 - a0) * j / segs))
            for j in range(segs + 1)
        ]
        for (xa, ya), (xb, yb) in zip(ring, ring[1:]):
            self._face([self._v(p) for p in ((xa, ya, z0), (xb, yb, z0), (xb, yb, z1), (xa, ya, z1))], mat)

    def bevel(self, offset, segments=2, where=None):
        """Round the edges for which where(edge) is true (all of them by default). The faces are
        welded first: each is built from its own vertices, so none shares an edge yet."""
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        edges = [e for e in self.bm.edges if where is None or where(e)]
        bmesh.ops.bevel(self.bm, geom=edges, offset=offset, segments=segments, affect='EDGES')

    def cut(self, point, normal, mat):
        """Slice off everything on the side of the plane that `normal` points to, and close the cut
        with a flat face (facing along `normal`) in mat. The solids built so far must be welded
        shut, as lathes are."""
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        geom = list(self.bm.verts) + list(self.bm.edges) + list(self.bm.faces)
        result = bmesh.ops.bisect_plane(
            self.bm, geom=geom, plane_co=Vector(point), plane_no=Vector(normal), dist=1e-6, clear_outer=True
        )
        edges = [g for g in result['geom_cut'] if isinstance(g, bmesh.types.BMEdge)]
        fill = bmesh.ops.triangle_fill(self.bm, edges=edges, use_beauty=True)
        for face in fill['geom']:
            if isinstance(face, bmesh.types.BMFace):
                face.normal_update()
                if face.normal.dot(Vector(normal)) < 0:
                    face.normal_flip()
                face.material_index = self._slot(mat)

    def transform(self, matrix):
        """Move every vertex by a 3x3 rotation (as a Matrix) after the faces are built."""
        bmesh.ops.transform(self.bm, matrix=matrix.to_4x4(), verts=self.bm.verts)

    def text(self, body, size, at, rotation, mat, fit=None, resolution=2):
        """Flat filled text, centred on `at` after the 3x3 `rotation` stands it up (it is drawn in
        the xy plane, facing +z). With fit, it is shrunk to be at most that wide (mm). The font is
        Blender's built-in one."""
        curve = bpy.data.curves.new(body, 'FONT')
        curve.body = body
        curve.size = size
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.resolution_u = resolution
        obj = bpy.data.objects.new(body, curve)
        bpy.context.scene.collection.objects.link(obj)
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        xs = [v.co.x for v in mesh.vertices]
        scale = min(1.0, fit / (max(xs) - min(xs))) if fit else 1.0
        for poly in mesh.polygons:
            pts = [rotation @ (mesh.vertices[i].co * scale) + Vector(at) for i in poly.vertices]
            self._face([self.bm.verts.new(p) for p in pts], mat)
        bpy.data.objects.remove(obj)
        bpy.data.curves.remove(curve)
        bpy.data.meshes.remove(mesh)

    def bounds(self, exclude=()):
        """(min, max) of the vertices of every face not in the excluded materials."""
        keep = [f for f in self.bm.faces if self.materials[f.material_index] not in exclude]
        co = [v.co for f in keep for v in f.verts]
        return (
            [min(c[i] for c in co) for i in range(3)],
            [max(c[i] for c in co) for i in range(3)],
        )

    def finish(self, name, parent, origin=(0, 0, 0)):
        """Weld the seams, make the mesh object under parent, and shade by angle. The object's
        origin is `origin` (an animated node pivots there); the vertices stay where they were."""
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.translate(self.bm, vec=-Vector(origin), verts=self.bm.verts)
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for mat in self.materials:
            mesh.materials.append(mat)
        mesh.shade_smooth()
        mesh.set_sharp_from_angle(angle=SMOOTH_ANGLE)
        obj = scene.link(bpy.data.objects.new(name, mesh), parent)
        obj.location = origin
        return obj


def led_epoxy(builder, mat, flange, thickness, dome, length, flat, segs=32, steps=6, at=(0, 0, 0)):
    """The epoxy of a round 3 or 5 mm LED around z: the flange, with a flat on the cathode side
    (flat = +1 for +x, -1 for -x), then the dome. z = 0 is the flange's underside and `length` the
    dome's top. Returns the dome's radius and the height where its hemisphere starts."""
    rf, rd = flange / 2, dome / 2
    zc = length - rd
    profile = [(0, 0), (rf - 0.1, 0), (rf, 0.1), (rf, thickness - 0.1), (rf - 0.1, thickness), (rd, thickness), (rd, zc)]
    profile += [(rd * math.cos(a), zc + rd * math.sin(a)) for a in (math.pi / 2 * k / steps for k in range(1, steps + 1))]
    cut = max(rf - 0.3, rd + 0.03)

    def clamp(p):
        if p.z - at[2] <= thickness + 1e-6:
            p.x = at[0] + flat * min(flat * (p.x - at[0]), cut)
        return p

    builder.lathe(profile, mat, segs=segs, at=at, clamp=clamp)
    return rd, zc


# --- Empties and export ----------------------------------------------------------------------


def root(name, seat_mm=None):
    """The part's root node. seatMm (flex-2lead parts) is the height of the pins above the board
    when the part sits, read from the root's glTF extras."""
    obj = scene.link(bpy.data.objects.new(name, None))
    if seat_mm is not None:
        obj['seatMm'] = float(seat_mm)
    return obj


def pin(parent, pin_id, location, rotation):
    """An empty named pin-<pin_id> where a lead leaves the body; its +z axis runs out of the body."""
    obj = bpy.data.objects.new(f'pin-{pin_id}', None)
    obj.empty_display_type = 'SINGLE_ARROW'
    obj.empty_display_size = 0.5
    obj.location = location
    obj.rotation_euler = rotation
    return scene.link(obj, parent)


def box_of(name, lo, hi):
    return {'name': name, 'min': [round(c, 4) for c in lo], 'max': [round(c, 4) for c in hi]}


def glb(path, root_obj):
    """lib/export.glb with custom properties kept, for the root's seatMm."""
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root_obj, *root_obj.children_recursive]:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_tangents=False,
        export_image_format='AUTO',
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=True,
    )


def write(args, root_obj, boxes, capsules=()):
    """Export the GLB and the collider file; the part is done."""
    glb(args.out, root_obj)
    export.colliders(args.colliders, boxes, capsules)
