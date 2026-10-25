"""The ribbon cable's cross-section detail from content/controllers/ribbon.json (SPEC 6.4, 10.4).

The cable itself is generated at runtime along the simulated strip; Blender bakes the two
textures it wears, both with u across the cable from conductor 1's edge to conductor 40's:

    ridges  a tangent-space normal map of the 40 conductor ridges, baked from a mesh that carries
            them. The conductors run along v, so it tiles along the cable: one tile is TILE mm.
    colors  a 40 x 1 colour lookup, one texel per conductor, in ribbon.json's colour sequence.

The script saves PNGs next to --out; build.ts encodes them to KTX2.

    blender -b --factory-startup --python-exit-code 1 -P ribbon.py -- --ribbon <ribbon.json>
      --colors <name=rrggbb,...> --texture <w>x<h> --samples <n> --seed <n> --out <glb>
      --colliders <json>
"""
import json
import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import bake, materials, scene  # noqa: E402

args = scene.start(
    lambda p: (
        p.add_argument('--ribbon', required=True),
        p.add_argument('--colors', required=True),
        p.add_argument('--texture', required=True),
    )
)
with open(args.ribbon) as f:
    R = json.load(f)
TEXTURE = [int(n) for n in args.texture.split('x')]
SRGB = {k: tuple(int(v[i:i + 2], 16) / 255 for i in (0, 2, 4)) for k, v in (c.split('=') for c in args.colors.split(','))}

N, P, W = R['conductors'], R['pitchMm'], R['widthMm']
# Each conductor sits under a rounded ridge; the web between conductors is RIDGE_DEPTH lower.
RIDGE_DEPTH = 0.15
SEGMENTS = 32  # of the high-poly mesh, per ridge
TILE = TEXTURE[1] * W / TEXTURE[0]  # mm along the cable one texture tile covers (square texels)
STEM = os.path.splitext(args.out)[0]


def save(img, suffix):
    img.filepath_raw = f'{STEM}-{suffix}.png'
    img.file_format = 'PNG'
    img.save()


def plane(name, x0, x1, y1, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0, 0, 0), (x1, 0, 0), (x1, y1, 0), (x0, y1, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(mat)
    obj = scene.link(bpy.data.objects.new(name, me))
    uv = me.uv_layers.new(name='UVMap')
    for loop in me.loops:
        co = me.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (co.x / W, co.y / TILE)
    return obj


# --- Ridges: baked from a strip with N raised-cosine ridges, valleys at u = 0 and u = 1 ----------
low = plane('ridges', 0, W, TILE, materials.principled('ridges', (0.5, 0.5, 0.5)))
bm = bmesh.new()
columns = N * SEGMENTS
rows = [[bm.verts.new((i * W / columns, y, RIDGE_DEPTH * (0.5 - 0.5 * math.cos(2 * math.pi * i / SEGMENTS))))
         for i in range(columns + 1)] for y in (0, TILE)]
for i in range(columns):
    bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))
me = bpy.data.meshes.new('ridges-high')
bm.to_mesh(me)
bm.free()
me.shade_smooth()
high = scene.link(bpy.data.objects.new('ridges-high', me))
save(bake.bake(low, 'NORMAL', bake.image('ribbon-ridges', *TEXTURE, color=False), [high], extrusion=0.3, distance=0.6), 'ridges')
bpy.data.objects.remove(high)
bpy.data.objects.remove(low)

# --- Colours: one emissive quad per conductor, baked onto a texel each -----------------------------
quads = []
for i in range(N):
    colour = materials.srgb(*SRGB[R['colors'][i % len(R['colors'])]])
    quad = plane(f'conductor-{i + 1}', i * W / N, (i + 1) * W / N, TILE, materials.emission(f'c{i}', colour))
    quad.location.z = 0.001
    quads.append(quad)
target = plane('colors', 0, W, TILE, materials.principled('colors', (1, 1, 1)))
save(bake.bake(target, 'EMIT', bake.image('ribbon-colors', N, 1), quads, extrusion=0.05, distance=0.1), 'colors')
