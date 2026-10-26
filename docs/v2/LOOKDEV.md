# Look-dev checklist

The Studio has two looks (SPEC 10.1, ADR-0143). Every photo check below is made in the Studio
look, which is checked against the reference photos (SPEC 2.2, 10.1, 18; acceptance 15), and the
Pi 5 against Raspberry Pi's official imagery. The Lab look has its own checklist at the end, read
against the exhibit house style rather than the photos. The photos are vendor images in a public
repository, so they are referenced in place and never committed or composited into a committed
file:

```
/Users/danny/Documents/Tools/GPIO Dashboard/docs/v2/3D Reference Images/T-Cobbler and BreadBoard/
```

Photo numbers follow `docs/v2/reference/IMAGES.md`. The Tauri-window screenshots are the app's
own renders and live in `docs/v2/lookdev/`. To check an item, read the screenshot and the photo
with vision at an approximately matched camera, fix whatever differs, and record the date.

Look-dev pass of 2026-10-24 (task 7.7): the fixes are ADR-0065 (the socket plugs into the shroud),
ADR-0066 (tin, mask and the Pi's colours) and ADR-0067 (the stage, the grade, bloom). The captures are
the Tauri window's own, 900 px wide, with the dev overlay hidden. `pi-top.png` (the Pi against the
product brief's photograph) and `bench-iso.png` (the whole default bench) are in `lookdev/` too.
Colours quoted are sRGB means over a patch of the capture, against the same patch of the photo.

Retake of 2026-10-25 on the final render path (after ADR-0082 and ADR-0127 to ADR-0131), in the
Tauri window at 1168 x 734 points: `bench-iso-2026-10-25.png` (the 4-Digit 7-Segment bench, iso
preset) and `lead-focus-2026-10-25.png` (a lead's housing at the T-board, camera on the lead). Read
against photos 1 and 3 they hold every row above: the red mask with dull tin pad cones, the yellow
spacers, the grey shroud with the socket seated, vertical black housings, the ribbon's broad arch.
The comparison is made by reading the capture and the photo side by side; the photos stay where they
are and no composite is committed, because they are vendor images in a public repository (SPEC 2.2).

## Side-by-sides

| Pair | Reference photo | Studio camera | Screenshot | Status |
|------|-----------------|---------------|------------|--------|
| T-board top | 3 (`T-Cobbler and BreadBoard - Image 1.jpg`), 6 | Top, framed on the T-board; then an angle like photo 6 | `lookdev/tboard-top.png`, `lookdev/tboard-angle.png` | done 2026-10-24 |
| T-board underside | 5 (`T-Type Board - Bottom.jpg`) | Below, straight on (T-board alone) | `lookdev/tboard-bottom.png` | done 2026-10-24 |
| Ribbon with its sockets | 1 (`Ribbon and BreadBoard - Image 2.jpg`), 3 | Iso over the T-board end of a bench scene | `lookdev/ribbon.png` | done 2026-10-24 |
| Breadboard, top-down | 3 | Top, framed on the bb-830 | `lookdev/breadboard-top.png` | done 2026-10-24 |
| Dupont leads | 3 | Top, over a bundle of M–M leads (the bench has no module for an M–F lead to end on) | `lookdev/dupont.png` | done 2026-10-24 |

## Checklist

### T-board, top (photos 3 and 6)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| T1 | Label text and order | With the header at the top, the left column reads 3V3, SDA1, SCL1, GPIO4, GND, GPIO17, GPIO27, GPIO22, 3V3, SPIMOSI, SPIMISO, SPISCLK, GND, ID_SD, GPIO5, GPIO6, GPIO13, GPIO19, GPIO26, GND and the right column 5V0, 5V0, GND, TXD0, RXD0, GPIO18, GND, GPIO23, GPIO24, GND, GPIO25, SPICE0, SPICE1, ID_SC, GND, GPIO12, GND, GPIO16, GPIO20, GPIO21, generated from `tboard.json` | pass 2026-10-24: both columns read in the order listed, from `tboard.json` |
| T2 | Label placement | White sans-serif text sits inboard of each pin column (left column's labels right of its pads, right column's left of its pads), upright with the header at the top | pass 2026-10-24 |
| T3 | Title | "GPIO Extension Board" in dark text on a white box across the top bar, just below the box header | pass 2026-10-24 |
| T4 | Solder mask | Saturated red with a clearcoat highlight; traces read as slightly raised, darker-red lines | pass 2026-10-24: the top is 215, 0, 1 (photo 3: 208, 10, 14). The coat is a faint sheen on purpose: a full one washed the mask to salmon at low angles (ADR-0066). Top-face traces are as faint as in photo 3 |
| T5 | Pads and mounting holes | Round tinned (silver) pads; two large plated mounting holes with silver rings at the stem end | pass 2026-10-24: the solder cones were over-bright and are now a dull tin (ADR-0066) |
| T6 | Board edge | Thin cream FR-4 edge visible where the board is cut | pass 2026-10-24 |
| T7 | Box header | Light-grey matte shroud with the 2×20 pins inside; the key slot centred in the long wall on the side away from the stem | pass 2026-10-24 |
| T8 | Proportions | Top bar about 59 mm across and stem about 60 mm long (photo 4's callouts; `tboard.json` outline); the header spans most of the bar | pass 2026-10-24: the outline is `tboard.json`'s calibrated 57.7 mm bar and 58.1 mm of stem past it (the callouts' 59 and 60 are nominal, ADR-0004); the shroud's 58.5 mm overhangs the bar by 0.4 mm each side, as the data has it |

### T-board, underside (photo 5)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| U1 | Pin strips | Two 1×20 male strips in bright yellow plastic spacers run the stem, 6 pitches (15.24 mm) apart | pass 2026-10-24: strips 6 pitches apart; the yellow reads paler than the photo (201, 160, 107 against 245, 203, 26), which AgX does to a bright yellow (ADR-0066) |
| U2 | Pin-1 pad | The 2×20 footprint's square pad is at the corner photo 5 shows (top left, header end up, seen from below) | pass 2026-10-24: the square pad is the top left, in the row away from the stem |
| U3 | Traces | Traces fan from the header pads down the stem between the strips, under red mask | pass 2026-10-24: stylised, one rule routes all 40 (ADR-0037) |
| U4 | Male pins | Square tinned pins stand below the spacers by about the length photo 6 shows | pass 2026-10-24: 6.0 mm below the spacers (photo 6: 5.5 to 5.8) |

### Ribbon and IDC sockets (photos 1 and 3)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| R1 | Colour order | Brown, red, orange, yellow, green, blue, violet, grey, white, black, four times over; conductor 1 is brown (`ribbon.json`) | pass 2026-10-24: read in the render, and by `assets:check` |
| R2 | Pin-1 edge | The brown conductor is on the socket's pin-1 side (by its triangle), and at the Pi it is on the edge away from the USB and Ethernet ports (SPEC 2.2, 6.4) | pass 2026-10-24 at the T-board in the render (the brown edge is by the socket's pin-1 triangle); at the Pi the edge away from the Ethernet and USB ports follows from ADR-0049's placement; on 2026-10-25 the Pi's socket sits under the ribbon's rising loop (ADR-0050) from every camera preset, so it cannot be re-read in a capture, and the real cable is HIL (`HIL_CHECKLIST.md`) |
| R3 | Sockets | Grey like the box header, with the strain-relief bar over the cable, the polarization bump, and the pin-1 triangle | pass 2026-10-24: grey, strain-relief bar, pin-1 triangle. The polarization bump now stands in the shroud's key slot (ADR-0065), so a seated socket hides it |
| R4 | Surface and drape | Slightly glossy PVC with visible conductor ridges; 50.8 mm wide; bends only out of its plane, as a broad smooth sheet | pass 2026-10-24: surface and width as before; the drape is the solver's, `lookdev/ribbon-drape.png` (a new bench project, looking along the board at the Pi), against photo 1. Like photo 1's, the ribbon leaves the T-board's socket in one broad, smooth arch, a flat sheet bent only about its width, with no kink or twist; at the solver's earlier stiffness it folded into a tight U beside the Pi (ADR-0079). The arch ends differently because the sockets differ: photo 1's far socket stands free above the board and the cable loops back over it, while the bench's is seated on the Pi, so the ribbon comes down into it |

### Breadboard, top-down (photos 1 and 3)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| B1 | Body | White ABS, satin, slightly translucent at its edges | pass 2026-10-24: translucency at the edges is not visible in the Studio, the sheen gives the satin |
| B2 | Holes | Dark square holes on the 2.54 mm grid, with a glimpse of contact inside; rail holes in groups of 5 with gaps | pass 2026-10-24 |
| B3 | Legend | Letters a–e and f–j at both ends; row numbers 1, 5, 10 … 60 beside column a and beside column j, in small grey numerals | pass 2026-10-24: seen at the row-60 end; the row-1 end is the same generator (`breadboard.py`) and is under the T-board on the default bench |
| B4 | Rails | Each rail has its red (+) or blue (−) line along it and red "+" / blue "−" marks at the ends; one long side has + outer and − inner, the other + inner and − outer, as `bb-830.board.json` says | pass 2026-10-24: + outer on one side and + inner on the other, as the board data says |
| B5 | Trench | A recessed groove between columns e and f | pass 2026-10-24 |
| B6 | Proportions | 165.1 × 54.6 × 8.5 mm and 63 rows (BB830 datasheet) | pass 2026-10-24: measured by `assets:check` |

### Dupont leads (photo 3)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| D1 | Housings | Black, 2.54 mm square in section and about 12 mm long; male pins silver with about 5.5 mm exposed; the female end open (`dupont.json`) | pass 2026-10-25: housings as 2026-10-24. A seated end hides its pin and mouth by design, so the models were opened in Blender through the Blender MCP (geometry-only copies, `lookdev/dupont-ends-blender.png`): the male end is 2.54 x 2.54 x 17.5 mm, a 12 mm housing and 5.5 mm of exposed pin in a metallic tin (0.638, 0.638, 0.604); the female end is the 12 mm housing with its open mouth |
| D2 | Wire | Satin PVC about 1.0 mm across; a bundle's colours in the order brown … black | pass 2026-10-24: the colours are the document's, shown brown to black in `dupont.png` |
| D3 | Drape | A male housing in a hole stands vertical, and the lead leaves it upward and arcs naturally (SPEC 10.5) | pass 2026-10-24: `lookdev/dupont-drape.png` (the 4-Digit 7-Segment circuit as a project, iso camera, the solver's shapes). Every male housing stands vertical in its hole and its lead leaves it straight up, then arcs smoothly over the board to its other end; none sags off the board's edge onto the table, as all of them did before (ADR-0078). As in photo 3, the wire runs straight out of the housing along its axis for a few centimetres before it curves, with no kink at the strain relief. Not modelled: a real lead keeps a set where a hand has bent it, so a builder's dense circuit can be dressed lower and flatter than these elastic leads, which each stand at their own stiffness (10 N mm^2, ADR-0079) |
| D4 | Length | 200 mm leads | pass 2026-10-25 in the Studio: on the 4-Digit 7-Segment build in the Tauri window, all 37 leads resolve to 200 mm stock and a 165 mm wire (`leadReach`), and the solver's chains measure within 0.49 mm of 165 mm |

### Raspberry Pi 5 (official imagery)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| P1 | Materials | Per-colour materials from the STEP read like the product brief's photo at a similar angle: solder mask with clearcoat, metal shields and connectors, plastic ports | pass 2026-10-24: the mask is the brief's bright green, the USB-A shells silver, the connectors metal and plastic (ADR-0066); the brief's legends and logos are not in the no-graphics STEP |
| P2 | Header | The 40 instanced header pins sit at the drawing's coordinates; none of the STEP's own pins show | pass 2026-10-24: 40 gold posts on the drawing's grid, none of the STEP's own |

### Stage, Studio look

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| S1 | Lighting, Studio look | Neutral studio light from the CC0 HDRI plus one key light with soft shadows; AO visible in holes and under parts; AgX tone mapping | pass 2026-10-24: neutral greys, one softer key with its soft shadow, AO in the holes and under the parts, AgX then a colour grade (ADR-0067) |
| S2 | No gimmicks, Studio look | No film grain, chromatic aberration or lens dirt; bloom only on lit LEDs | pass 2026-10-24: nothing added; bloom takes only what passes 2, so the metal rings and shields no longer glow (ADR-0067) |

## Lab look

The Lab look (ADR-0143 to ADR-0145) is read against the exhibit house style's night lab, its
style bible and exemplars, rather than against the photos. Captures of 2026-10-26: headless
Chromium on WebGPU at 1168 x 734 points and a pixel ratio of 1, the side panels shown, the dev
overlay hidden, the Flowing LEDs tutorial; not yet taken in the Tauri window.
`lookdev/lab-iso.png`, `lab-front.png` and `lab-top.png` are the presets with the LEDs dark,
`lab-close-lit.png` an orbit 420 mm from the bench with the chaser running, and `lab-orbits.png`
eight orbit angles 1500 mm out, 45 degrees apart: the camera south of the bench first, then turning through the east.

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| L1 | The lit circuit leads | With a tutorial simulating, the LEDs are the brightest thing in the frame, and bloom covers at most 5% of it | pass 2026-10-26 at the close and iso views (`lab-close-lit.png`: the lit LED is the brightest point, its glow well under 1% of the frame, judged by eye, not counted). At the front preset the amber light bars come near the lit LED's brightness |
| L2 | The bench reads | The boards, Pi, ribbon and leads are sharp and stand apart from the mat and the room | pass 2026-10-26 (`lab-iso.png`, `lab-front.png`, `lab-top.png`) |
| L3 | Every side furnished | Each of 8 orbit angles shows an anchor piece | pass 2026-10-26 (`lab-orbits.png`): the window between its bars and the credenza; the plant and the window's corner; the wall bench with the oscilloscope and power supply; the pegboard bench; the poster and the stool; the shelf and the soldering station; the drawer cabinet; the window with the cabinet |
| L4 | No halo in the blur | The breadboard's and the Pi's edges stay crisp against the blurred room, with no bright fringe or stepped copy | pass 2026-10-26 (`lab-front.png`: the breadboard and the leads against the window) |
| L5 | Nothing on the set blooms | With the LEDs dark, the bloom forced on adds nothing | pass 2026-10-26: `e2e/lab.spec.ts` reads the bloom's high pass empty at the iso, top and front presets |
| L6 | Faint grain | Grain is visible only on close inspection of a flat area | pass: at 0.06 of the colour, a fine speckle on flat mat at 4x zoom (pixel noise 0.45 of a level, against 0.10 at 0.03), unseen at full size |
| L7 | The near side cuts away | A side the camera stands near or behind opens, with nothing opaque between the camera and the bench | pass 2026-10-26: the orbit angles from the north in `lab-orbits.png` stand with the north side cut away; `e2e/lab.spec.ts` checks the cut sides all the way round |

Three critic rounds scored the look-and-light rows of the house style's rubric at 54%, 62% and
68% (ADR-0145). What they leave: the mat reads as a large flat plane at the working distance,
and a lit LED's glow is small against the room.
