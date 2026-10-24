# Look-dev checklist

The Studio's look is checked against the reference photos (SPEC 2.2, 10.1, 18; acceptance 15),
and the Pi 5 against Raspberry Pi's official imagery. The photos are vendor images in a public
repository, so they are referenced in place and never committed or composited into a committed
file:

```
/Users/danny/Documents/Tools/GPIO Dashboard/docs/v2/3D Reference Images/T-Cobbler and BreadBoard/
```

Photo numbers follow `docs/v2/reference/IMAGES.md`. The Tauri-window screenshots are the app's
own renders and live in `docs/v2/lookdev/`. To check an item, read the screenshot and the photo
with vision at an approximately matched camera, fix whatever differs, and record the date.

## Side-by-sides

| Pair | Reference photo | Studio camera | Screenshot | Status |
|------|-----------------|---------------|------------|--------|
| T-board top | 3 (`T-Cobbler and BreadBoard - Image 1.jpg`), 6 | Top, framed on the T-board; then an angle like photo 6 | `lookdev/tboard-top.png`, `lookdev/tboard-angle.png` | pending |
| T-board underside | 5 (`T-Type Board - Bottom.jpg`) | Below, straight on (T-board alone) | `lookdev/tboard-bottom.png` | pending |
| Ribbon with its sockets | 1 (`Ribbon and BreadBoard - Image 2.jpg`), 3 | Iso over the T-board end of a bench scene | `lookdev/ribbon.png` | pending |
| Breadboard, top-down | 3 | Top, framed on the bb-830 | `lookdev/breadboard-top.png` | pending |
| Dupont leads | 3 | Top, over a bundle of M–M and M–F leads | `lookdev/dupont.png` | pending |

## Checklist

### T-board, top (photos 3 and 6)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| T1 | Label text and order | With the header at the top, the left column reads 3V3, SDA1, SCL1, GPIO4, GND, GPIO17, GPIO27, GPIO22, 3V3, SPIMOSI, SPIMISO, SPISCLK, GND, ID_SD, GPIO5, GPIO6, GPIO13, GPIO19, GPIO26, GND and the right column 5V0, 5V0, GND, TXD0, RXD0, GPIO18, GND, GPIO23, GPIO24, GND, GPIO25, SPICE0, SPICE1, ID_SC, GND, GPIO12, GND, GPIO16, GPIO20, GPIO21, generated from `tboard.json` | pending |
| T2 | Label placement | White sans-serif text sits inboard of each pin column (left column's labels right of its pads, right column's left of its pads), upright with the header at the top | pending |
| T3 | Title | "GPIO Extension Board" in dark text on a white box across the top bar, just below the box header | pending |
| T4 | Solder mask | Saturated red with a clearcoat highlight; traces read as slightly raised, darker-red lines | pending |
| T5 | Pads and mounting holes | Round tinned (silver) pads; two large plated mounting holes with silver rings at the stem end | pending |
| T6 | Board edge | Thin cream FR-4 edge visible where the board is cut | pending |
| T7 | Box header | Light-grey matte shroud with the 2×20 pins inside; the key slot centred in the long wall on the side away from the stem | pending |
| T8 | Proportions | Top bar about 59 mm across and stem about 60 mm long (photo 4's callouts; `tboard.json` outline); the header spans most of the bar | pending |

### T-board, underside (photo 5)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| U1 | Pin strips | Two 1×20 male strips in bright yellow plastic spacers run the stem, 6 pitches (15.24 mm) apart | pending |
| U2 | Pin-1 pad | The 2×20 footprint's square pad is at the corner photo 5 shows (top left, header end up, seen from below) | pending |
| U3 | Traces | Traces fan from the header pads down the stem between the strips, under red mask | pending |
| U4 | Male pins | Square tinned pins stand below the spacers by about the length photo 6 shows | pending |

### Ribbon and IDC sockets (photos 1 and 3)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| R1 | Colour order | Brown, red, orange, yellow, green, blue, violet, grey, white, black, four times over; conductor 1 is brown (`ribbon.json`) | pending |
| R2 | Pin-1 edge | The brown conductor is on the socket's pin-1 side (by its triangle), and at the Pi it is on the edge away from the USB and Ethernet ports (SPEC 2.2, 6.4) | pending |
| R3 | Sockets | Grey like the box header, with the strain-relief bar over the cable, the polarization bump, and the pin-1 triangle | pending |
| R4 | Surface and drape | Slightly glossy PVC with visible conductor ridges; 50.8 mm wide; bends only out of its plane, as a broad smooth sheet | pending |

### Breadboard, top-down (photos 1 and 3)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| B1 | Body | White ABS, satin, slightly translucent at its edges | pending |
| B2 | Holes | Dark square holes on the 2.54 mm grid, with a glimpse of contact inside; rail holes in groups of 5 with gaps | pending |
| B3 | Legend | Letters a–e and f–j at both ends; row numbers 1, 5, 10 … 60 beside column a and beside column j, in small grey numerals | pending |
| B4 | Rails | Each rail has its red (+) or blue (−) line along it and red "+" / blue "−" marks at the ends; one long side has + outer and − inner, the other + inner and − outer, as `bb-830.board.json` says | pending |
| B5 | Trench | A recessed groove between columns e and f | pending |
| B6 | Proportions | 165.1 × 54.6 × 8.5 mm and 63 rows (BB830 datasheet) | pending |

### Dupont leads (photo 3)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| D1 | Housings | Black, 2.54 mm square in section and about 12 mm long; male pins silver with about 5.5 mm exposed; the female end open (`dupont.json`) | pending |
| D2 | Wire | Satin PVC about 1.0 mm across; a bundle's colours in the order brown … black | pending |
| D3 | Drape | A male housing in a hole stands vertical, and the lead leaves it upward and arcs naturally (SPEC 10.5) | pending |
| D4 | Length | 200 mm leads | pending |

### Raspberry Pi 5 (official imagery)

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| P1 | Materials | Per-colour materials from the STEP read like the product brief's photo at a similar angle: solder mask with clearcoat, metal shields and connectors, plastic ports | pending |
| P2 | Header | The 40 instanced header pins sit at the drawing's coordinates; none of the STEP's own pins show | pending |

### Stage

| # | Check | Pass when | Status |
|---|-------|-----------|--------|
| S1 | Lighting | Neutral studio light from the CC0 HDRI plus one key light with soft shadows; AO visible in holes and under parts; AgX tone mapping | pending |
| S2 | No gimmicks | No film grain, chromatic aberration or lens dirt; bloom only on lit LEDs | pending |
