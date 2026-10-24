# Asset pipeline

Builds the shipped 3D models (SPEC 10.3, 10.4) headlessly from committed scripts and pinned
sources, and checks them.

```sh
BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender npm run assets:build [-- bb-830 ...]
npm run assets:check                  # the committed models
BLENDER_BIN=... npm run assets:check -- --rebuild   # also rebuild into a temp folder and compare
```

Both take `--allow-version-drift` to run a Blender other than 5.2. `KTX_BIN` names `toktx` when
KTX-Software is not on `PATH`; its `ktx` beside it does the encoding (ADR-A1 on `ktx create`).
Downloads are verified against `sources.json` and cached in `~/.cache/gpio-dashboard-assets/`.
A full build takes about 6 minutes, most of it reading the Pi 5 STEP.

## Runtime contract

**Files.** `src/renderer/public/models/{bb-830,bb-400,pi5}.glb`, served at `/models/<name>.glb`.
They require `EXT_meshopt_compression` and `KHR_texture_basisu` and use `KHR_mesh_quantization`,
so the loader needs a meshopt decoder and a KTX2 (Basis Universal) transcoder. Colour textures
are ETC1S in sRGB; normal and occlusion textures are UASTC, linear.

**Units and axes.** 1 glTF unit = 1 mm. Each model is built in the core frame (z up) and
exported with glTF's y up, so a core point (x, y, z) sits at three.js (x, z, -y).

**Transforms.** The root node of each file has the identity transform and sits at the asset's
origin below. Mesh nodes under it carry meshopt's quantization (a translation and a uniform
scale), so read positions through world matrices, never as raw vertex values.

**bb-830.glb, bb-400.glb.** Origin at the board's core local origin (core/geometry/breadboard.ts):
x from the row-1 end along the rows, y from the column-a-side edge, z = 0 on the top surface,
with the body below it to z = -8.5.

| Node | What it is |
|------|------------|
| `bb-830` / `bb-400` | root |
| `body` | the mesh, with three primitives by material |

| Material | Faces |
|----------|-------|
| `abs` | the top: chamfers, hole recesses, trench and rail channels. Base colour is the legend; normal and occlusion maps |
| `abs_plain` | the sides and bottom |
| `nickel` | the contact at the bottom of each hole: one connected piece per hole, centred on it |

Holes sit where `holePosition` puts them, within 0.005 mm (assets:check measures the centre of
every `nickel` piece).

**pi5.glb.** Origin and axes of `pi5-board.json`: the PCB's bottom-left corner as drawn, +x
toward the USB and Ethernet ports, +y toward the 40-pin header's edge. z = 0 is the table the
Pi rests on (the model's lowest point, its underside parts); the PCB spans z 1.480 to 2.756.

| Node | What it is |
|------|------------|
| `pi5` | root |
| `board` | the mesh: one primitive per STEP colour, all sharing one occlusion map |
| `header` | empty at the 40-pin header's centre on the PCB's top face: core (32.5, 52.5, 2.756) |

Materials are `solder-mask` (the PCB, with a clear coat) and `step-<rrggbb>` for every other
STEP colour (the STEP's sRGB colour; metal or plastic per `blender/pi5.py`).

The 40 header pins are not in the file. The STEP's pins stood on `pi5-board.json`'s grid (the
build fails otherwise) as 0.64 mm square posts from z 0.886 to 11.326, that is 8.57 mm above the
PCB's top face. Instance them from `pi5-header.json` and `pi5-board.json`, relative to `header`.

**Colliders.** `<name>.colliders.json`: `{ units: "mm", frame: "core, z up", boxes: [{ name,
min, max }], capsules: [{ name, a, b, radius }] }`, axis-aligned in the same frame as the model.
The breadboards have one box, `body`. The Pi has `pcb`, `header-pins` (the removed pins' field),
`header-base`, and one box per STEP body 4 mm or more across, named after it.

**Manifests.** `<name>.manifest.json` records the tools' versions, the Blender script's and
shared library's hashes and arguments, the content files read and their hashes, the sources
(the Pi's MIT licence text from Raspberry Pi Ltd included), the triangle count, file size,
each texture's format and size, the budgets, and the geometry hash.

## Stages

1. `sources.ts`: download, verify against `sources.json`, cache. Archive members are pinned too.
2. `step-to-glb.ts`: occt-import-js reads a STEP into an intermediate GLB, one node per body,
   one material per STEP colour. A STEP too large for its 2 GB heap is read in parts.
3. `blender/<script>.py`: model or adapt, assign materials, unwrap, bake with Cycles (fixed
   samples and seed, CPU), export. Shared helpers in `blender/lib/`.
4. `optimize.ts`: gltf-transform dedup, weld, prune; KTX2 (ETC1S for colour, UASTC for normal
   and occlusion) at most the asset's texture budget; meshopt.
5. `build.ts` measures the written GLB, refuses one over budget, and writes the GLB, manifest
   and colliders. `check.ts` and the Vitest guard (`src/renderer/src/content/models.test.ts`)
   run `verify.ts` on the committed files.

To add an asset: a `sources.json` entry for anything downloaded, a script in `blender/` that
reads its content file and uses `lib/`, an entry in `assets.ts` with its budget, and the checks
for its kind in `verify.ts`. Never commit `.blend` files or downloads.
