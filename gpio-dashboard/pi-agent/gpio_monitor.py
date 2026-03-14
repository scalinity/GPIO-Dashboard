#!/usr/bin/env python3
"""GPIO state reader using pinctrl (read-only, no pin claiming)."""

import logging
import re
import subprocess

log = logging.getLogger("gpio_monitor")

# BCM GPIO pins on the 40-pin header (0-27)
BCM_PINS = set(range(28))

# Regex for pinctrl output lines like: "2: ip    pd | hi // GPIO2 = input"
PINCTRL_RE = re.compile(
    r"^\s*(\d+):\s+(\S+)\s+(\S+)\s*\|\s*(\S+)\s*//\s*(.*)?$"
)

DIRECTION_MAP = {
    "ip": "IN",
    "op": "OUT",
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
    """Detect GPIO chip name based on Pi model."""
    try:
        with open("/sys/firmware/devicetree/base/model", "r") as f:
            model = f.read().strip("\x00").strip()
        if "Pi 5" in model:
            return "gpiochip4"
        return "gpiochip0"
    except FileNotFoundError:
        return "gpiochip0"


def _parse_function(func_str: str) -> tuple[str, str]:
    """Parse pinctrl function string into (direction, function_name).

    Returns (direction, alt_function) where direction is IN/OUT/ALT
    and alt_function describes the pin role (GPIO, I2C, SPI, etc.).
    """
    direction = DIRECTION_MAP.get(func_str, "ALT")
    if func_str in ("ip", "op"):
        return direction, "GPIO"
    # Alt functions: a0-a5, or named functions
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
                gpio_num = int(m.group(1))
                if gpio_num not in BCM_PINS:
                    continue

                func_str = m.group(2)
                pull_str = m.group(3)
                level_str = m.group(4)
                comment = m.group(5).strip() if m.group(5) else ""

                direction, function = _parse_function(func_str)
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
                chip.close()
            except Exception:
                log.debug("gpiod enrichment failed", exc_info=True)

        return pins
