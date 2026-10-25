"""Builds src/renderer/src/core/sim/fixtures/ngspice.json: the simulator's reference results (SPEC 9).

Usage (stdlib only; ngspice from Homebrew on PATH):
  python3 -I scripts/reference/ngspice_fixtures.py > src/renderer/src/core/sim/fixtures/ngspice.json

Each fixture is a small circuit of primitive elements. The script fits diode and BJT parameters from
the part definitions with the rules in ADR-0012 (the same rules as core/sim/fit.ts), runs each
circuit through ngspice in batch mode, and records the circuit, its netlist and the results. The
Vitest suite rebuilds every circuit from this file and must match within the recorded tolerance.
"""
import json
import math
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PARTS = os.path.join(ROOT, "src/renderer/src/content/parts")

# ADR-0012, mirrored in core/sim/fit.ts and core/sim/devices.ts.
VT = 1.380649e-23 * 300.15 / 1.602176634e-19
LED = {"n": 2, "rs": 2}
LED_INGAN = {"n": 3, "rs": 2}
INGAN_MIN_VF = 2.6
RECTIFIER = {"n": 2, "rs": 0.05}
BJT = {"is": 1e-14, "br": 1}
# core/constants/rp1.ts outputResistanceOhm('high') at the default 4 mA drive: (3.3 - 2.9) / 9.5 mA.
GPIO_HIGH_OHMS = (3.3 - 2.9) / 9.5e-3


def part(part_id):
    with open(os.path.join(PARTS, f"{part_id}.part.json"), encoding="utf-8") as f:
        return json.load(f)["sim"]["params"]


def saturation_current(vf, i_f, n, rs):
    return i_f / math.expm1((vf - i_f * rs) / (n * VT))


def led_die(part_id, key):
    p = part(part_id)
    vf = p[f"{key}.vfTypV"]
    family = LED_INGAN if vf >= INGAN_MIN_VF else LED
    i_f = p[f"{key}.ifTestMa"] / 1000
    return {"is": saturation_current(vf, i_f, **family), **family}


def rectifier(part_id):
    p = part(part_id)
    return {"is": saturation_current(p["vfTypFig4V"], p["vfTestA"], **RECTIFIER), **RECTIFIER}


def bjt(part_id):
    p = part(part_id)
    return {**BJT, "bf": math.sqrt(p["hfeMin"] * p["hfeMax"])}


def V(name, p, n, volts):
    return {"type": "V", "name": name, "p": p, "n": n, "volts": volts}


def R(p, n, ohms):
    return {"type": "R", "p": p, "n": n, "ohms": ohms}


def C(p, n, farads):
    return {"type": "C", "p": p, "n": n, "farads": farads}


def D(a, k, model, fit):
    return {"type": "D", "a": a, "k": k, **model, "fit": fit}


def Q(c, b, e, model, polarity, fit):
    return {"type": "Q", "c": c, "b": b, "e": e, **model, "polarity": polarity, "fit": fit}


def fixtures():
    out = [
        {
            "id": "divider",
            "analysis": "op",
            "elements": [V("v1", 1, 0, 5), R(1, 2, 1000), R(2, 0, 2000)],
            "probes": {"v(2)": "v(2)", "i(v1)": "i(v1)"},
        },
        {
            "id": "divider-3v3-10k-20k",
            "analysis": "op",
            "elements": [V("v1", 1, 0, 3.3), R(1, 2, 10_000), R(2, 0, 20_000)],
            "probes": {"v(2)": "v(2)"},
        },
    ]
    # LED + resistor, each colour and size, from a GPIO driven high through 220 Ω.
    for colour in ["red", "green", "blue", "yellow", "white"]:
        for size in ["5mm", "3mm"]:
            key = f"{colour}.{size}"
            out.append(
                {
                    "id": f"led-{colour}-{size}",
                    "analysis": "op",
                    "elements": [
                        V("vgpio", 1, 0, 3.3),
                        R(1, 2, GPIO_HIGH_OHMS),
                        R(2, 3, 220),
                        D(3, 0, led_die("led", key), {"part": "led", "key": key}),
                    ],
                    "probes": {"v(3)": "v(3)", "i(vgpio)": "i(vgpio)"},
                }
            )
    for colour in ["red", "green", "blue"]:
        out.append(
            {
                "id": f"rgb-cc-{colour}",
                "analysis": "op",
                "elements": [
                    V("v5", 1, 0, 5),
                    R(1, 2, 220),
                    D(2, 0, led_die("rgb-led-cc", colour), {"part": "rgb-led-cc", "key": colour}),
                ],
                "probes": {"v(2)": "v(2)", "i(v5)": "i(v5)"},
            }
        )
    out.append(
        {
            "id": "diode-1n4007",
            "analysis": "op",
            "elements": [
                V("v1", 1, 0, 5),
                R(1, 2, 1000),
                D(2, 0, rectifier("diode-1n4007"), {"part": "diode-1n4007"}),
            ],
            "probes": {"v(2)": "v(2)", "i(v1)": "i(v1)"},
        }
    )
    out.append(
        {
            "id": "rc-step",
            "analysis": "tran",
            "step": 5e-6,
            "stop": 5e-3,
            "elements": [V("v1", 1, 0, 3.3), R(1, 2, 1000), C(2, 0, 1e-6)],
            "probes": {f"v(2)@{t}": f"v(2) at={t}" for t in ["0.0005", "0.001", "0.002", "0.003", "0.005"]},
        }
    )
    # GPIO → 1 kΩ → PN2222 base; 5 V → 220 Ω → red LED → collector; emitter to ground.
    out.append(
        {
            "id": "bjt-switch-pn2222",
            "analysis": "op",
            "elements": [
                V("vgpio", 1, 0, 3.3),
                R(1, 2, GPIO_HIGH_OHMS),
                R(2, 3, 1000),
                V("v5", 4, 0, 5),
                R(4, 5, 220),
                D(5, 6, led_die("led", "red.5mm"), {"part": "led", "key": "red.5mm"}),
                Q(6, 3, 0, bjt("pn2222"), 1, {"part": "pn2222"}),
            ],
            "probes": {"v(3)": "v(3)", "v(6)": "v(6)", "i(vgpio)": "i(vgpio)", "i(v5)": "i(v5)"},
        }
    )
    # The same transistor in its active region, so β is what sets the collector current.
    out.append(
        {
            "id": "bjt-active-pn2222",
            "analysis": "op",
            "elements": [
                V("vb", 1, 0, 3.3),
                R(1, 2, 1e6),
                V("vc", 3, 0, 5),
                R(3, 4, 1000),
                Q(4, 2, 0, bjt("pn2222"), 1, {"part": "pn2222"}),
            ],
            "probes": {"v(2)": "v(2)", "v(4)": "v(4)", "i(vb)": "i(vb)", "i(vc)": "i(vc)"},
        }
    )
    out.append(
        {
            "id": "bjt-pnp-s8550",
            "analysis": "op",
            "elements": [
                V("ve", 1, 0, 5),
                R(2, 0, 10_000),
                R(3, 0, 1000),
                Q(3, 2, 1, bjt("s8550"), -1, {"part": "s8550"}),
            ],
            "probes": {"v(2)": "v(2)", "v(3)": "v(3)", "i(ve)": "i(ve)"},
        }
    )
    # Button between 3.3 V and a GPIO, with a 10 kΩ pull-down; the switch is its Ron/Roff.
    contact = part("tact-switch-6mm")["contactMaxOhm"]
    for state, ohms in [("pressed", contact), ("released", 1e9)]:
        out.append(
            {
                "id": f"button-pulldown-{state}",
                "analysis": "op",
                "elements": [V("v1", 1, 0, 3.3), R(1, 2, ohms), R(2, 0, 10_000)],
                "probes": {"v(2)": "v(2)"},
            }
        )
    return out


def netlist(fx):
    lines = [fx["id"]]
    models = []
    count = {"R": 0, "C": 0, "D": 0, "Q": 0}

    def name(kind):
        count[kind] += 1
        return f"{kind}{count[kind]}"

    for el in fx["elements"]:
        t = el["type"]
        if t == "V":
            lines.append(f"{el['name']} {el['p']} {el['n']} {el['volts']!r}")
        elif t == "R":
            lines.append(f"{name('R')} {el['p']} {el['n']} {el['ohms']!r}")
        elif t == "C":
            lines.append(f"{name('C')} {el['p']} {el['n']} {el['farads']!r} ic=0")
        elif t == "D":
            n = name("D")
            lines.append(f"{n} {el['a']} {el['k']} m{n}")
            models.append(f".model m{n} d(is={el['is']!r} n={el['n']!r} rs={el['rs']!r})")
        elif t == "Q":
            n = name("Q")
            kind = "npn" if el["polarity"] == 1 else "pnp"
            lines.append(f"{n} {el['c']} {el['b']} {el['e']} m{n}")
            models.append(f".model m{n} {kind}(is={el['is']!r} bf={el['bf']!r} br={el['br']!r})")
    lines += models
    lines += [".control", "set numdgt=10"]
    names = {}
    if fx["analysis"] == "op":
        lines.append("op")
        for i, (key, expr) in enumerate(fx["probes"].items()):
            names[f"p{i}"] = key
            lines.append(f"let p{i} = {expr}")
        lines.append("print " + " ".join(names))
    else:
        lines.append(f"tran {fx['step']!r} {fx['stop']!r} uic")
        for i, (key, expr) in enumerate(fx["probes"].items()):
            names[f"p{i}"] = key
            lines.append(f"meas tran p{i} find {expr}")
    lines += [".endc", ".end", ""]
    return "\n".join(lines), names


def run(fx):
    text, names = netlist(fx)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "fixture.cir")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        result = subprocess.run(["ngspice", "-b", path], capture_output=True, text=True, check=True)
    values = {}
    for line in result.stdout.splitlines():
        m = re.match(r"^\s*(p\d+)\s*=\s*([-+0-9.eE]+)", line)
        if m and m.group(1) in names:
            values[names[m.group(1)]] = float(m.group(2))
    missing = [key for key in fx["probes"] if key not in values]
    if missing:
        sys.exit(f"{fx['id']}: ngspice printed no value for {missing}\n{result.stdout}")
    return text, values


def main():
    version = subprocess.run(["ngspice", "-v"], capture_output=True, text=True).stdout
    match = re.search(r"ngspice-(\d+)", version)
    if not match:
        sys.exit("ngspice not found on PATH")
    out = []
    for fx in fixtures():
        text, values = run(fx)
        out.append({**fx, "netlist": text, "results": values})
    json.dump(
        {
            "generator": "scripts/reference/ngspice_fixtures.py",
            "ngspice": f"ngspice-{match.group(1)}",
            "tolerance": 0.02,
            "fixtures": out,
        },
        sys.stdout,
        indent=2,
    )
    sys.stdout.write("\n")


main()
