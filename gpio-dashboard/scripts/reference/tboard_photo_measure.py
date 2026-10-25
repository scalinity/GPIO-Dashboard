"""Calibrated measurements of the T-board from its straight-on underside photo.

Usage (numpy and Pillow are throwaway dependencies, nothing is installed):
  uv run --with numpy --with pillow python -I scripts/reference/tboard_photo_measure.py \
      "<main checkout>/docs/v2/3D Reference Images/T-Cobbler and BreadBoard/T-Type Board - Bottom.jpg"

Method (SPEC 6.3, evidence priority 2):
- Scale comes from features on a 2.54 mm pitch in the same photo:
  x from the 20 pads of each header row, y from the 20 pin bases of a stem strip.
  Agreement of the two scales (aspect ≈ 1) shows the shot is close to orthographic.
- The outline comes from the board mask (everything that is not near-white background).
- Pixel coordinates are image coordinates of the underside view (mirrored left/right
  relative to the top view); every reported length is mirror-invariant.
Prints JSON. The numbers feed content/controllers/tboard.json and DECISIONS.md.
"""
import json
import sys

import numpy as np
from PIL import Image

PITCH = 2.54

im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
H, W, _ = im.shape
R, G, B = im[..., 0], im[..., 1], im[..., 2]
background = (R > 225) & (G > 225) & (B > 225)
red = (R > 150) & (G < 90) & (B < 90)
yellow = (R > 190) & (G > 150) & (B < 120)
mx, mn = np.maximum(np.maximum(R, G), B), np.minimum(np.minimum(R, G), B)
metal = ~background & ((mx - mn) < 70) & (mx > 90) & ~red & ~yellow
board = ~background


def runs(v):
    out, s = [], None
    for i, x in enumerate(v):
        if x and s is None:
            s = i
        elif not x and s is not None:
            out.append((s, i - 1))
            s = None
    if s is not None:
        out.append((s, len(v) - 1))
    return out


def local_max(profile, min_dist, k=9):
    """Smoothed local maxima, strongest first, at least min_dist apart, sub-pixel refined."""
    sm = np.convolve(profile.astype(float), np.ones(k) / k, mode="same")
    idx = [i for i in range(1, len(sm) - 1)
           if sm[i] >= sm[i - 1] and sm[i] > sm[i + 1] and sm[i] > sm.max() * 0.35]
    keep = []
    for i in sorted(idx, key=lambda i: -sm[i]):
        if all(abs(i - j) >= min_dist for j in keep):
            keep.append(i)
    out = []
    for i in sorted(keep):
        a, b, c = sm[i - 1], sm[i], sm[i + 1]
        den = a - 2 * b + c
        out.append(i + (0.5 * (a - c) / den if den else 0.0))
    return out


def fit(c):
    n = np.arange(len(c))
    p, q = np.polyfit(n, c, 1)
    return float(p), float(q), float(np.abs(np.asarray(c) - (p * n + q)).max())


def centroid_runs(profile, thresh, min_gap):
    merged = []
    for a, b in runs(profile > thresh):
        if merged and a - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return [float((np.arange(a, b + 1) * profile[a:b + 1]).sum() / profile[a:b + 1].sum())
            for a, b in merged]


# Header pad rows (y) and pads along each row (x).
hdr_prof = metal[:160].sum(axis=1)
pad_rows = [y for y in centroid_runs(hdr_prof, hdr_prof.max() * 0.3, 8) if y > 20][:2]
hdr = []
for y in pad_rows:
    xs = local_max(metal[int(y) - 12:int(y) + 13].sum(axis=0), 35)
    hdr.append((len(xs), *fit(xs)))

# Pin strips: yellow spacer centres, then pin bases along each strip.
ycols = yellow[200:].sum(axis=0)
strip_x = centroid_runs(ycols, ycols.max() * 0.3, 40)
strips = []
for cx in strip_x:
    ys = local_max(metal[290:H - 140, int(cx) - 9:int(cx) + 10].sum(axis=1), 35)
    p, q, r = fit(ys)
    strips.append({"x_px": cx, "count": len(ys), "pitch_px": p, "first_px": q + 290, "resid_px": r})

good_x = [h for h in hdr if h[0] == 20 and h[3] < 15]
good_y = [s for s in strips if s["count"] == 20 and s["resid_px"] < 5]
if not good_x or not good_y:
    sys.exit("calibration features not found cleanly")
sx = np.mean([h[1] for h in good_x]) / PITCH
sy = np.mean([s["pitch_px"] for s in good_y]) / PITCH
ref = good_y[0]
pin1_y = ref["first_px"]
pin20_y = pin1_y + 19 * ref["pitch_px"]


def extent_row(y):
    r = [x for x in runs(board[y]) if x[1] - x[0] > 20]
    return (r[0][0], r[-1][1]) if r else None


def extent_col(x):
    r = [y for y in runs(board[:, x]) if y[1] - y[0] > 20]
    return (r[0][0], r[-1][1]) if r else None


bar_rows = [y for y in range(0, 400) if (e := extent_row(y)) and e[1] - e[0] > W * 0.8]
bar = [extent_row(y) for y in range(60, 200)]
stem = [extent_row(y) for y in range(500, 1300)]
bl, br = np.median([e[0] for e in bar]), np.median([e[1] for e in bar])
sl, sr = np.median([e[0] for e in stem]), np.median([e[1] for e in stem])
top, bottom = extent_col(int((sl + sr) / 2))

hole_band = metal[int(H * 0.9):]
hole_x = centroid_runs(hole_band.sum(axis=0), 8, 30)
hole_rows = centroid_runs(hole_band.sum(axis=1), hole_band.sum(axis=1).max() * 0.3, 30)
hole_y = float(np.mean(hole_rows)) + int(H * 0.9)
hdr_mid_y = float(np.mean(pad_rows))
hdr_mid_x = float(np.mean([h[2] + 9.5 * h[1] for h in good_x]))

mm = lambda px, s: round(float(px) / s, 2)  # noqa: E731
out = {
    "photo": sys.argv[1].rsplit("/", 1)[-1],
    "scale_px_per_mm": {"x": round(sx, 3), "y": round(sy, 3), "aspect_y_over_x": round(sy / sx, 4)},
    "fit_quality_px": {"header_rows_max_resid": [round(h[3], 2) for h in good_x],
                       "strip_max_resid": round(ref["resid_px"], 2)},
    "pin_row_spacing_mm": mm(abs(strip_x[1] - strip_x[0]), sx),
    "pin_row_spacing_pitches": round(abs(strip_x[1] - strip_x[0]) / sx / PITCH, 3),
    "header_row_spacing_mm": mm(pad_rows[1] - pad_rows[0], sy),
    "top_bar_width_mm": mm(br - bl + 1, sx),
    "top_bar_depth_mm": mm(bar_rows[-1] - bar_rows[0] + 1, sy),
    "stem_width_mm": mm(sr - sl + 1, sx),
    "overall_length_mm": mm(bottom - top + 1, sy),
    "stem_length_below_bar_mm": mm(bottom - bar_rows[-1], sy),
    "strip_to_stem_edge_mm": [mm(min(strip_x) - sl, sx), mm(sr - max(strip_x), sx)],
    "strip_midline_minus_stem_midline_mm": mm((sum(strip_x) / 2) - (sl + sr) / 2, sx),
    "strip_midline_minus_header_midline_mm": mm((sum(strip_x) / 2) - hdr_mid_x, sx),
    "top_edge_to_header_centre_mm": mm(hdr_mid_y - top, sy),
    "header_centre_to_pin1_mm": mm(pin1_y - hdr_mid_y, sy),
    "top_edge_to_pin1_mm": mm(pin1_y - top, sy),
    "pin20_to_stem_end_mm": mm(bottom - pin20_y, sy),
    "mounting_holes_spacing_mm": mm(abs(hole_x[-1] - hole_x[0]), sx),
    "pin20_to_mounting_hole_centre_mm": mm(hole_y - pin20_y, sy),
    "mounting_hole_centre_to_stem_end_mm": mm(bottom - hole_y, sy),
}
print(json.dumps(out, indent=2))
