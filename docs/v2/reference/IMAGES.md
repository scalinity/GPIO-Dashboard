# Reference photos

Vendor product photos of the T-board kit, used as the look-dev target and as
geometry evidence for the T-board, ribbon and Dupont leads (SPEC 2.2).

**Location (not in git).** `gh repo view --json visibility` reported
`PUBLIC` on 2026-10-23, so the photos are referenced in place and never
committed:

```
/Users/danny/Documents/Tools/GPIO Dashboard/docs/v2/3D Reference Images/T-Cobbler and BreadBoard/
```

Every file was read with vision on 2026-10-23. Sizes are in bytes; hashes are
SHA-256 of the file as found.

| # | File | Pixels | Bytes | SHA-256 | Description |
|---|------|--------|-------|---------|-------------|
| 1 | `Ribbon and BreadBoard - Image 2.jpg` | 1500×1392 | 226575 | `504cb859572e250d687c446d7dbdf90d0d4cdf9e54f42aee009667d60f345fcc` | Angled view: T-board on a full-size breadboard (header at the high-row end in this staged shot), ribbon looping back to its second IDC socket; shows ribbon drape and socket orientation. |
| 2 | `Ribbon and BreadBoard.jpg` | 1500×1496 | 175850 | `3c954cfbc824ef886ae4c956b8543065c231e26c8d3cc9ed86c4068a544522cc` | Listing graphic: "Size: 200*50mm" (ribbon), "T-type GPIO adapter: 73mm*59mm", "1Pcs 400-hole breadboard", 10-pin M–F and M–M DuPont lines; small inset photo of the kit. |
| 3 | `T-Cobbler and BreadBoard - Image 1.jpg` | 1485×1500 | 243119 | `a1d884007276a85302ef8bae2e54858d73df0665d81609c3c713b592a168cc98` | Top-down kit layout: T-board with full label table, 63-row breadboard (a–e / f–j, four rails, `+`/`−` legend), M–M and M–F 10-lead bundles, ribbon with two grey IDC sockets. |
| 4 | `T-Cobbler and BreadBoard - Image 2.jpg` | 1464×1500 | 225743 | `3d4275f4a4c86f3d218aeda70165f8249806e300de4310b17da62c9acce6eb03` | Dimension callouts: T-board 59 mm top bar, 60 mm stem, 11 mm and 14.5 mm at the header end; breadboard 160 mm; ribbon 200 mm; leads 200 mm. The two "5.5mm" width callouts are wrong (SPEC 2.2) and are ignored. |
| 5 | `T-Type Board - Bottom.jpg` | 1203×1500 | 108844 | `82c741f4d3de7c9976651bb9ec0ccd0b0104ed349f28201ef0e6f355ba943295` | T-board underside, straight on: 2×20 header pads (square pin-1 pad), routed traces in red mask, two 1×20 male pin strips with yellow plastic spacers, two plated mounting holes at the stem end. Used for the pin-row spacing calibration. |
| 6 | `T-Type Board - Single Subject.jpg` | 1500×821 | 89608 | `b217e796ebba17fbcc09a2b4a85d58d88dca1511e20c36b48ed991b01fab2e58` | Angled T-board: grey shrouded 2×20 box header with its central key slot, red solder mask with traces, white silkscreen, tinned pads, male pins with yellow spacers under the stem. |

## Observations carried into the data files

- **Label table** (photo 3, read straight on; pins counted from the header end):
  - odd side (left when the header is at the top): 3V3, SDA1, SCL1, GPIO4, GND,
    GPIO17, GPIO27, GPIO22, 3V3, SPIMOSI, SPIMISO, SPISCLK, GND, ID_SD, GPIO5,
    GPIO6, GPIO13, GPIO19, GPIO26, GND
  - even side: 5V0, 5V0, GND, TXD0, RXD0, GPIO18, GND, GPIO23, GPIO24, GND,
    GPIO25, SPICE0, SPICE1, ID_SC, GND, GPIO12, GND, GPIO16, GPIO20, GPIO21
  - This matches SPEC 6.3 exactly.
- **Box header key slot** (photos 3, 4, 6): the slot is in the middle of the
  long wall on the side away from the stem.
- **Breadboard** (photos 3, 4): 63 numbered rows (legend every 5 rows), columns
  a–e and f–j, four rails. One long side has `+` (red) on the outer rail and `−`
  (blue) on the inner rail; the other side has `+` inner and `−` outer. The rails
  run in groups of 5 holes.
- **Leads** (photo 3): the M–M bundle shows pins at both ends; the M–F bundle
  shows bare housings (female) at one end. Bundle colour order: brown, red,
  orange, yellow, green, blue, violet, grey, white, black.
- **Ribbon** (photos 1, 3, 4): grey IDC sockets with strain relief; standard
  10-colour rainbow sequence repeated four times.

Calibrated measurements taken from these photos are recorded with their method
in `gpio-dashboard/src/renderer/src/content/controllers/tboard.json` and in
`docs/v2/DECISIONS.md`.
