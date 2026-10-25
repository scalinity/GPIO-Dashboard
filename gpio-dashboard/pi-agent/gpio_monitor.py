#!/usr/bin/env python3
"""GPIO state reader using pinctrl (read-only, no pin claiming)."""

import glob
import logging
import re
import subprocess

log = logging.getLogger("gpio_monitor")

# BCM GPIO pins on the 40-pin header (0-27)
BCM_PINS = set(range(28))

# Regex for pinctrl output lines. An input or alternate function has two fields before the "|":
#   " 2: ip    pd | hi // GPIO2 = input"
# An output has a third, the drive level (dh or dl), between the function and the pull:
#   "17: op dh pd | hi // GPIO17 = output"
# (raspberrypi/utils, pinctrl/pinctrl.c: print_gpio_state, drive names "dl", "dh", "--")
PINCTRL_RE = re.compile(
    r"^\s*(?P<gpio>\d+):\s+(?P<func>\S+)(?:\s+(?:dh|dl|--))?\s+(?P<pull>\S+)\s*\|"
    r"\s*(?P<level>\S+)\s*//\s*(?P<info>.*)?$"
)

DIRECTION_MAP = {
    "ip": "IN",
    "op": "OUT",
    "no": "NONE",
}

PULL_MAP = {
    "pu": "UP",
    "pd": "DOWN",
    "pn": "NONE",
    "--": "NONE",
}

LEVEL_MAP = {
    "hi": "HIGH",
    "lo": "LOW",
}


def _detect_chip() -> str:
    """The device path of the chip carrying the header's GPIOs, found by label: pinctrl-rp1 on a
    Pi 5 (gpiochip0 on kernels since Aug 2024, gpiochip4 before; raspberrypi/linux PR 6144),
    pinctrl-bcm2711 or pinctrl-bcm2835 on earlier models. libgpiod 2's Chip takes a device path."""
    try:
        import gpiod
    except ImportError:
        return "/dev/gpiochip0"
    for path in sorted(glob.glob("/dev/gpiochip*")):
        try:
            with gpiod.Chip(path) as chip:
                if chip.get_info().label.startswith(("pinctrl-rp1", "pinctrl-bcm")):
                    return path
        except Exception:
            continue
    return "/dev/gpiochip0"


def _parse_function(func_str: str, comment: str = "") -> tuple[str, str]:
    """Parse pinctrl function string into (direction, function_name).

    Returns (direction, alt_function) where direction is IN/OUT/ALT/NONE. An alternate function
    (a0-a8) is named after the "=" in pinctrl's comment ("GPIO2 = SDA1"); the code is only its
    FUNCSEL index (gpiolib.c fsel_names).
    """
    direction = DIRECTION_MAP.get(func_str, "ALT")
    if func_str in ("ip", "op"):
        return direction, "GPIO"
    if func_str == "no":
        return direction, "NONE"
    if "=" in comment:
        return direction, comment.split("=", 1)[1].strip()
    return direction, func_str.upper()


class GpioMonitor:
    """Reads GPIO state via pinctrl without claiming any pins."""

    def __init__(self):
        self._chip = _detect_chip()
        self._gpiod_available = False
        try:
            import gpiod
            self._gpiod = gpiod
            self._gpiod_available = True
            log.info("gpiod available for enrichment")
        except ImportError:
            log.info("gpiod not available, using pinctrl only")

    def read_all(self) -> dict:
        """Read all BCM GPIO pin states.

        Returns dict keyed by BCM pin number (as string) with pin info.
        Uses pinctrl which reads hardware registers without claiming pins.
        """
        pins = {}

        # Primary: parse pinctrl output
        try:
            result = subprocess.run(
                ["pinctrl", "get"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            for line in result.stdout.splitlines():
                m = PINCTRL_RE.match(line)
                if not m:
                    continue
                gpio_num = int(m.group("gpio"))
                if gpio_num not in BCM_PINS:
                    continue

                func_str = m.group("func")
                pull_str = m.group("pull")
                level_str = m.group("level")
                comment = m.group("info").strip() if m.group("info") else ""

                direction, function = _parse_function(func_str, comment)
                state = LEVEL_MAP.get(level_str, "UNKNOWN")
                pull = PULL_MAP.get(pull_str, "UNKNOWN")

                pins[str(gpio_num)] = {
                    "bcm": gpio_num,
                    "state": state,
                    "direction": direction,
                    "pull": pull,
                    "function": function,
                    "info": comment,
                }
        except FileNotFoundError:
            log.warning("pinctrl not found - install raspi-utils")
        except subprocess.TimeoutExpired:
            log.warning("pinctrl timed out")
        except Exception:
            log.exception("Error reading pinctrl")

        # Enrichment: gpiod line info (read-only, no claiming)
        if self._gpiod_available and pins:
            try:
                chip = self._gpiod.Chip(self._chip)
                try:
                    for gpio_str, pin_data in pins.items():
                        try:
                            info = chip.get_line_info(int(gpio_str))
                            if info.consumer:
                                pin_data["consumer"] = info.consumer
                            if info.name:
                                pin_data["name"] = info.name
                            pin_data["used"] = info.used
                        except Exception:
                            pass
                finally:
                    chip.close()
            except Exception:
                log.debug("gpiod enrichment failed", exc_info=True)

        return pins
