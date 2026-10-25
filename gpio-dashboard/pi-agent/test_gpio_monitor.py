"""Tests for the pinctrl output parser. Run from this directory: python3 -m unittest -v

The sample lines follow raspberrypi/utils pinctrl/pinctrl.c (print_gpio_state), which prints
"<n>: <function> [<drive>] <pull> | <level> // <name> = <function name>": the drive level (dh or
dl) appears only for an output, between the function and the pull.
"""

import subprocess
import unittest
from unittest import mock

import gpio_monitor

PINCTRL_OUTPUT = "\n".join(
    [
        " 0: no    pu | hi // ID_SD/GPIO0 = none",
        " 2: a3    pu | hi // GPIO2 = SDA1",
        " 4: ip    pd | lo // GPIO4 = input",
        "17: op dh pd | hi // GPIO17 = output",
        "18: op dl pn | lo // GPIO18 = output",
        "27: ip    -- | hi // GPIO27 = input",
        "28: no    pd | -- // GPIO28 = none",
    ]
)


def read_pins():
    result = subprocess.CompletedProcess(["pinctrl", "get"], 0, stdout=PINCTRL_OUTPUT, stderr="")
    with mock.patch.object(gpio_monitor.subprocess, "run", return_value=result):
        monitor = gpio_monitor.GpioMonitor()
        monitor._gpiod_available = False
        return monitor.read_all()


class PinctrlParsing(unittest.TestCase):
    def test_reads_an_output_pin_with_its_drive_field(self):
        pins = read_pins()
        self.assertEqual(
            (pins["17"]["direction"], pins["17"]["state"], pins["17"]["pull"]),
            ("OUT", "HIGH", "DOWN"),
        )
        self.assertEqual(
            (pins["18"]["direction"], pins["18"]["state"], pins["18"]["pull"]),
            ("OUT", "LOW", "NONE"),
        )

    def test_reads_inputs_and_alternate_functions(self):
        pins = read_pins()
        self.assertEqual((pins["4"]["direction"], pins["4"]["state"]), ("IN", "LOW"))
        self.assertEqual(pins["2"]["direction"], "ALT")
        self.assertEqual(pins["2"]["info"], "GPIO2 = SDA1")
        self.assertEqual(pins["27"]["pull"], "NONE")

    def test_reports_the_header_gpios_and_nothing_beyond_gpio27(self):
        self.assertEqual(set(read_pins()), {"0", "2", "4", "17", "18", "27"})

    def test_names_an_alternate_function_and_a_pin_with_none(self):
        pins = read_pins()
        self.assertEqual(pins["2"]["function"], "SDA1")
        self.assertEqual((pins["0"]["direction"], pins["0"]["function"]), ("NONE", "NONE"))


class FakeChip:
    LABELS = {}

    def __init__(self, path):
        self.label = self.LABELS[path]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_info(self):
        return mock.Mock(label=self.label)


class ChipDetection(unittest.TestCase):
    def detect(self, labels):
        FakeChip.LABELS = labels
        fake = mock.Mock(Chip=FakeChip)
        with mock.patch.dict("sys.modules", {"gpiod": fake}), mock.patch.object(
            gpio_monitor.glob, "glob", return_value=sorted(labels)
        ):
            return gpio_monitor._detect_chip()

    def test_finds_rp1_by_label_on_current_kernels(self):
        # Since raspberrypi/linux PR 6144 (Aug 2024) the RP1 header chip is gpiochip0.
        labels = {"/dev/gpiochip0": "pinctrl-rp1", "/dev/gpiochip10": "gpio-brcmstb@107d508500"}
        self.assertEqual(self.detect(labels), "/dev/gpiochip0")

    def test_finds_rp1_by_label_on_older_kernels(self):
        labels = {"/dev/gpiochip0": "gpio-brcmstb@107d508500", "/dev/gpiochip4": "pinctrl-rp1"}
        self.assertEqual(self.detect(labels), "/dev/gpiochip4")


if __name__ == "__main__":
    unittest.main()
