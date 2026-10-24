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

Materials are `solder-mask` (the PCB, with a faint clear coat) and `step-<rrggbb>` for every other
STEP colour (named by the STEP's sRGB colour; metal or plastic per `blender/pi5.py`). Two albedos
differ from the STEP's, which `LOOK` in `pi5.py` lists: the mask is a bright green, and the yellow
metal (the USB-A shells) is nickel, as in Raspberry Pi's photographs (ADR-L-2).

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
They are the same kind of GLB as the boards (meshopt, quantization), without textures unless the
file's budget names one (the IC markings and module legends below).
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

- the definition's family, the geometry hash, the triangle and byte budgets, and no textures
  except within a budgeted texture size (KTX2);
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

## Controller assets (SPEC 6.3 to 6.5, 10.4)

```sh
BLENDER_BIN=... npm run assets:build -- tboard idc-socket ribbon dupont-male dupont-female
npm run assets:check -- tboard idc-socket ribbon dupont-male dupont-female
BLENDER_BIN=... npm run assets:check -- --rebuild tboard idc-socket ribbon dupont-male dupont-female
```

All are in `src/renderer/public/models/`, in the boards' conventions (1 unit = 1 mm, modelled z up,
exported y up), and every GLB has a `.manifest.json` and a `.colliders.json`. `controllers.ts`
holds their checks, measured from the GLB (or the KTX2 texels) against the content files.

**tboard.glb** (`tboard.json`). Origin and axes of `tboard.json`: pin 1 at the origin, +x along the
stem toward pin 39, +y toward the even row. z = 0 is the breadboard's top surface, the underside of
the two yellow spacers; the PCB spans z 2.5 to 4.1, and the box header's rim is at z 15.3. The 40
stem pins reach down to z = -6.

| Node      | What it is                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------- |
| `tboard`  | root                                                                                            |
| `pcb`     | mesh: `mask-top` and `mask-bottom` (clear coat; colour, normal and AO maps) and `fr4`, the edge |
| `header`  | mesh: the grey shrouded box header, `shroud` (normal and AO maps)                               |
| `pins`    | mesh: the stem's 40 pins and the box header's 40, material `pin`                                |
| `pads`    | mesh: pads, plated holes, vias and solder, material `tin`                                       |
| `spacers` | mesh: the two 1 x 20 yellow spacers, material `spacer`                                          |
| `socket`  | empty in the header's middle, 5.08 mm below the rim: `(centerXMm, centerYMm, 10.22)`            |

The IDC socket's origin goes on `socket`, with no rotation: its lower body then stands in the header's
cavity (6.4 x 52.6 mm, floor 2.0 mm above the PCB) and its latch ears rest on the end walls (ADR-L-1). The PCB's two faces are mapped planar,
as each reads from outside with the header up: u across +y and v down +x on the top, u mirrored on
the underside. The silkscreen labels come from the pin table and are baked into `mask-top`'s
colour. The header's key slot is in its -x wall. Its pin 1 is the +y end of the key-side row
(x = centerXMm - pitch / 2), which holds the odd pins (ADR-0037).

**idc-socket.glb** (`ribbon.json`; 3M 891 series, 2 x 20, for 1.27 mm cable, TS-0449-L). Origin at
the centre of the mating face, which faces -z: the socket plugs down onto upward pins, its body
above. x runs across the two rows (contacts at x = -1.27 and +1.27), y along them. The lower body is
6.10 x 51.6 mm and goes into a box header's cavity; the cover above it carries the latch ears, 55.4 mm
over all, whose underside is 5.08 mm above the mating face (ADR-L-1). On a Pi the face rests on the
header's base.

| Node         | What it is                                                                      |
| ------------ | ------------------------------------------------------------------------------- |
| `idc-socket` | root                                                                            |
| `body`       | mesh: `idc-grey` (normal and AO maps), and `idc-contact`, the 40 openings' metal |
| `pin1`       | empty at contact 1, `(-1.27, +24.13, 0)`                                        |
| `cable-a`    | empty at the conductor-1 end of the cable's exit line, `(-3.05, +25.4, 6.3)`    |
| `cable-b`    | the line's other end, `(-3.05, -25.4, 6.3)`                                     |

The bump and the cable are on the -x wall. Seated on the T-board's `socket` with no rotation, the
bump stands in the key slot and the cable runs away from the stem, its underside above the header's
rim. The line from `cable-a` to `cable-b`
is the cable's mid-plane where it leaves the wall; conductor 1 is at `cable-a`.

**ribbon-ridges.ktx2, ribbon-colors.ktx2** (`ribbon.json`; `ribbon.manifest.json`). No GLB. Both
have u across the cable's 50.8 mm: conductor 1's edge at u = 0 and conductor 40's at u = 1.

- `ribbon-ridges.ktx2`: a tangent-space normal map of the 40 conductor ridges, linear UASTC with
  mipmaps, 1280 x 64. v runs along the cable, and one tile is 2.54 mm of it (the same texel density
  as across): repeat it along the cable. Each ridge is 0.15 mm high, crowned at the middle of its
  conductor's pitch, and the map tiles across as well. It needs a KTX2 transcoder.
- `ribbon-colors.ktx2`: 40 x 1 RGBA8 in sRGB, one texel per conductor in `ribbon.json`'s sequence,
  conductor 1 (brown) first. Lossless and without mipmaps: sample it with nearest filtering at
  (i + 0.5) / 40.

**dupont-male.glb, dupont-female.glb** (`dupont.json`). One housing each, 2.54 mm square and 12 mm
long, on the z axis: `housing` (black plastic, AO map) and `metal`.

| File            | Origin                                                       | Nodes                                           |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `dupont-male`   | the 0.64 mm pin's tip, pointing -z; housing z 5.5 to 17.5    | `dupont-male`, `body`, `wire` at `(0, 0, 17.5)` |
| `dupont-female` | the open mating face, facing -z; housing z 0 to 12           | `dupont-female`, `body`, `wire` at `(0, 0, 12)` |

`wire` marks where the runtime wire leaves the housing and points along the model's +z (glTF +y;
the node has no rotation of its own).

**Colliders.** `tboard`: `pcb`, `header`, and a `spacer-` and a `pins-` box for each strip (`a` is
the odd pins'). `idc-socket`: `body` (with the bump) and `strain-relief` (the cover with its ears, from 5.08 mm up). The Dupont ends:
`housing`, and the male's `pin` capsule. Each file encloses its model to within 0.05 mm.

**Checks** (`controllers.ts`):

- every GLB: geometry hash, budgets, KTX2 textures and the colliders;
- `tboard`: the PCB's outline, stem and thickness against `tboard.json`, on spacers whose underside
  is z = 0; the 40 stem pins at `pitchMm` x index along x and `rowSpacingPitches` across, the box
  header's 40 pins on its 2 x 20 grid, and the mounting holes, each within 0.05 mm and one to one;
  the shroud's size, position and height, with the key slot in the -x wall and the +x wall plain;
  the `socket` empty at the seating plane, and the socket's fit (the cavity takes the lower body, the
  ears rest on the end walls, the bump stands in the key slot above its floor, the pins enter the
  contact openings);
- `idc-socket`: the lower body 6.10 x 51.6 mm, the ears 55.4 mm over all and 5.08 mm up, the mating face
  on z = 0; the 40 contact openings on the 2 x 20 grid, each 6.0 mm deep; `pin1`, `cable-a` and
  `cable-b`, the cable's underside clear of a header's rim;
- `dupont-*`: the housing's size and position, the pin's side, tip and exposed length, and `wire`;
- `ribbon`: the lookup's 40 texels against the sequence, and the ridge map's 40 crowns and seam.

`ribbon` has textures only: `build.ts` encodes the PNGs its script saves with `ktx create`, and
`assets:check --rebuild` compares the lookup exactly and the ridge map by SSIM.

## Displays, ICs and off-board modules (ADR-0043 to ADR-0046)

Twenty-one parts in seven families, built by `dip.py`, `seven_segment.py`, `bar_graph.py`,
`dot_matrix.py`, `motor.py` and `module.py`. They use `partkit.py` and add `devicekit.py` (tapered
boxes, tubes and drilled slabs, a baked decal, boards with a legend, male headers, the STEP
helpers; `--preview <dir>` renders PNGs while developing) and, for the modules, `modparts.py` and
the variant files `mod_sensors.py`, `mod_ads.py` and `mod_boards.py`. Build one with
`npm run assets:build -- hc-sr04`. The files are 7 to 229 KB each, 0.67 MB together with their
manifests and colliders.

**On-board parts** (`ic-74hc595`, `ic-adc0834`, `ic-l293d`, the two seven-segment displays, the
four-digit display, `bar-graph-10`, `led-matrix-8x8`, and the bare `dht11`) follow the rigid frame
above: the origin is pin 1's hole, with `pin-<id>` empties at `offsetPitch * 2.54` and +z pointing
down. The body floats a standoff above the board: the DIP's `standoffMinMm` (0.51 mm), 0.5 mm for
the displays, 2.0 mm for the DHT11. The empties are at the body's underside, where the runtime lead
starts. The DIP also has the shoulder of each lead, in the `lead` material, and its top carries the
part number as a KTX2 marking. TI's 5.08 mm height counts from the seating plane, so the DIP's
body, which floats on its standoff, is 4.57 mm thick and `assets:check` expects that.

**Off-board modules** (`ads1115-module`, `ads7830-module`, `breadboard-power-module`,
`dht11-module`, `hc-sr04`, `hc-sr501`, `joystick-module`, `keypad-4x4`, `lcd1602-i2c`,
`relay-module-5v`, `sg90`, `dc-motor`):

- *Origin.* The footprint's corner on the table: the model's lowest x, y and z are all 0 (checked
  to 0.05 mm). x runs along the header row, y across it, z up. A module with a header rests on its
  pins' 1.5 mm tails; the keypad, servo and motor lie on the table.
- *Pins.* The module keeps its connector's layout: pin i is at pin 1 + `offsetPitch` * 2.54 mm
  (the relay's screw terminal block at its own 5 mm pitch), so the definition's offsets map straight
  onto the model. `assets:check` measures every pin's place relative to the first (0.05 mm) and the
  2.54 mm pitch of neighbouring header pins. The header pins are in the model, the plastic base and
  the metal pin in the node `pins`. `pin-<id>` is at the tip of each, +z up, where a female Dupont
  housing mates; the header is on the board's top face with its pins up whichever side the real
  board's header is on, so that a housing can reach it. Three kinds differ, each listed in
  `parts.ts` under `axes`:
  - the relay's screw terminals `NC`, `COM` and `NO`: at the block's front face, +z along +y, out
    of the board's edge;
  - the keypad and the servo: the female housing at the end of a flat tail or a cable lies on the
    table with its sockets facing -y, away from the module, and the empties are on that face;
  - the motor: two leads, each ending in a one-pin housing whose male pin sticks out along -y.
- *Body.* A node `body` holds the board and what stands on it (the servo's case, the motor's can).
  `pins`, `cable` or `tail`, `connector` and the animated nodes are beside it. `bodyMm` describes
  `body` (the servo's with its `horn`). The DHT11 breakout's `bodyMm` height is the sensor's 5.5 mm
  thickness, which stands 15.5 mm tall on the board, so only its footprint is compared.
- *Textures.* A board's solder-mask top carries its silkscreen legend as one KTX2 base-colour map
  (UVs run over the board's outline). The DHT11's grille, the relay's case top and terminal face,
  the keypad's keys, the LCD's screen and the housings' socket holes are small maps on panels of
  their own. The ADS1115 also has the occlusion map baked from its STEP; no other module has one.

**Names the studio looks up** (all unique in a file):

| Part | Node | What it is |
| ---- | ---- | ---------- |
| the seven-segment displays | `seg-a` to `seg-g`, `seg-dp` | one mesh each; the four-digit display's are `seg-<d>-<a..g\|dp>`, d from 1 at the leftmost digit |
| `bar-graph-10` | `bar-1` to `bar-10` | segment n is over pin n (LED n runs from pin n to pin 21 - n) |
| `led-matrix-8x8` | `dot-<row>-<col>` | row 1 at the top (+y), column 1 at the left (-x), as the datasheet's top view |
| `hc-sr501` | `lens` | the white dome |
| `relay-module-5v` | `lens`, `armature` | the indicator LED; the armature's pivot, hinged inside the case about core y |
| `sg90` | `horn` | a pivot on the output shaft's axis; the horn's mesh is its child, at rest along x (1.5 ms) |
| `dc-motor` | `rotor` | a pivot on the shaft's axis, turning about its own x axis; the shaft is its child |
| `joystick-module` | `stick` | a pivot at the top of the thumbstick's base, for tilting |
| `lcd1602-i2c` | `lcd-screen` | the character area, 56.2 x 11.5 mm (15 pitches and a character wide, a pitch and a character high, from the LCD-1602A datasheet), UVs 0 to 1 with glTF (0, 0) at the top left seen from above |
| `dht11` | `grille` | the sensor's vents, a panel in front of the housing |

The animated and tilting nodes are empty pivots with a mesh child, not meshes: quantization moves a
mesh node's origin to its bounding box's centre, which is not the axis of a horn, a shaft or a
thumbstick. A pivot's translation is its axis point and its rotation is the identity, so rotating
it about its own axis turns the part in place. The segments and bars share the material `segment`
and the dots `dot`; the studio gives each node its own material when it lights it. `lcd-screen`'s
texture is the blank backlit glass with its 32 character cells, and the studio replaces it with its
character texture.

**Sources.** The ADS1115 module and the motor are made from Adafruit's own STEP files, MIT licensed
(Copyright (c) 2016 Adafruit Industries), which permits copying and redistribution with the notice.
`sources.json` pins the licence and the two files by SHA-256 at commit `c128bce` (2026-10-01) of
`adafruit/Adafruit_CAD_Parts` (`1085 ADS1115 ADC`, `711 DC Toy Motor`), retrieved 2026-10-24; the
licence text is in each manifest and the notice in each GLB's `asset.copyright`. The other models
are drawn in Blender from their datasheet drawings (Kingbright SA56-11EWA, CA56-12EWA and DC10EWA,
Toplite TOP-CA-788BS, TI MPDI002C, Aosong DHT11, Elecfreaks HC-SR04, the LCD-1602A) or, where the
definition's figures are approximate (the LAFVIN ADS7830, the power module, the relay module, the
HC-SR501, the KY-023, the keypad, the SG90), from those figures. No unlicensed model is used.
