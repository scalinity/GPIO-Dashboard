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

## Part models (SPEC 7, 10.4)

```sh
BLENDER_BIN=... npm run assets:build -- parts          # every part; or name them: led-5mm resistor ...
npm run assets:check -- parts                          # their checks, and parts/index.json
BLENDER_BIN=... npm run assets:check -- --rebuild parts
```

`parts` stands for every part asset; any asset name also works for `build` and `check`.

**Files.** `src/renderer/public/models/parts/<defId>.glb`, or `<defId>-<variant>.glb` where a
property changes the shape (the LED's `size`), each with `.manifest.json` and `.colliders.json`.
They are the same kind of GLB as the boards (meshopt, quantization), without textures.
`parts/index.json` maps each part definition to its files, sorted by definition, and `build`
merges its entries into it:

```json
{
  "led": [
    { "file": "led-3mm.glb", "when": { "size": "3mm" } },
    { "file": "led-5mm.glb", "when": { "size": "5mm" } }
  ],
  "resistor": [{ "file": "resistor.glb" }]
}
```

**Bodies only.** The leads are the runtime's. Each `pin-<pinId>` empty (the part definition's pin
id) is where a lead leaves the body, and its +z axis points out of the body along the lead: down
for every part but the axial ones, whose pin 1 points along -x and pin 2 along +x. In the glTF
file that axis is the empty's local +y: take `(0, 1, 0)` through the node's world rotation, then
convert with (x, y, z) -> (x, -z, y). The lead's diameter is in the definition's params.

**Frames.** As the boards: 1 unit = 1 mm, modelled in the core frame (z up), exported y up.

- Rigid parts: the origin is `pins[0]`'s hole centre on the board's top surface (z = 0), the body
  sits where it seats, and each pin empty is at `(dx * 2.54, dy * 2.54)` from its `offsetPitch`
  (within 0.05 mm). A part whose real leads leave the body at another pitch (TO-92 and the RGB
  LED at 1.27 mm, the tact switch's 6.5 x 4.5 mm terminals, the potentiometer's 5.0 mm) has its
  formed section of lead in the model, in a material named `lead`, ending at the pin on the
  board's surface. The other rigid parts have their pins at the body's underside.
- flex-2lead parts: the origin is the midpoint of the two pin empties, `pins[0]` toward -x and
  `pins[1]` toward +x, both at model z = 0. The root node's glTF `extras` carry `seatMm`, the
  height of that origin (and so of the pins) above the board's top surface when the part sits.
  The pins are the definition's lead spacing apart, or for the axial parts one body length, where
  the leads leave the end caps.

**Names the studio looks up.**

| Part                       | Animated nodes                             | Materials driven from the value or state                                              |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `resistor`                 |                                            | `band-1` to `band-4`: the four rings, each its own primitive (default 220 ohm, 5 %)   |
| `led`, 3 and 5 mm          |                                            | `lens` (transmissive; tinted and lit by the studio), `die`                            |
| `rgb-led-ca`, `rgb-led-cc` |                                            | `lens`, `die-r`, `die-g`, `die-b`                                                     |
| `tact-switch-6mm`          | `plunger`, travels -z                      |                                                                                       |
| `potentiometer-10k`        | `shaft`, turns about its own axis (core y) |                                                                                       |

Animate relative to a node's loaded transform: quantization moves a mesh node's origin to its
bounding box's centre, which for `plunger` and `shaft` is on the part's axis. `shaft` is modelled
at 50 % wiper with its slot upright, and its cross-section is symmetric, so it turns in place.
The driven materials carry a custom property `driven` (glTF `extras`), so that dedup keeps
materials with equal parameters apart.

**Checks** (`verify-parts.ts`, measured from the GLB):

- the definition's family, the geometry hash, the triangle and byte budgets, and no textures;
- the root, with `seatMm` for flex parts and none for rigid ones;
- every `pin-*` empty, animated node and driven material present;
- pins within 0.05 mm of their `offsetPitch` (rigid), or of plus and minus half the lead spacing
  (flex), and every lead axis within 1 degree of its exit direction;
- the body, without the `lead` stubs, within the datasheet's dimensions (`parts.ts` reads them
  from the definition's `geometry.params`), and the colliders covering it;
- `parts/index.json` listing every part file, sorted.

**Colliders.** `<name>.colliders.json` as for the boards, in the model's frame: the body's box,
and for the potentiometer a `shaft` capsule.

**Adding a part.** A script in `blender/` that takes `--part <definition>` and `--name` with the
shared arguments, builds the body with `blender/partkit.py` (whose export keeps custom
properties, which `lib/export.py` drops), and ends with `pk.write`. An entry for its family in
`parts.ts`'s `FAMILIES` (triangle budget, and the expectation read from the params) and one in
`PARTS` for each definition and variant.
