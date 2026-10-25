"""Tests for Board Sense (sense.py), run against a fake gpiod 2.x module that models the board.
Run from this directory: python3 -B -m unittest -v

The fake keeps nets of joined pins, some tied to a rail. A net follows the one pull applied to it,
follows its rail when tied, and otherwise holds its charge, so a floating pin keeps whatever its
last pull left. It records every request, reconfigure, read, wait and release, so the safety rules
are asserted on what libgpiod would have seen. The fake is instant: a missing settle wait is
caught by the order of the recorded calls, not by the levels.
"""

import asyncio
import dataclasses
import enum
import errno
import importlib
import json
import pathlib
import random
import sys
import time
import types
import unittest
from unittest import mock

import gpio_monitor
import sense

CHIP = "/dev/gpiochip4"
NOW = 1700000000.5
SETTLE = 100 / 1e6


class Bias(enum.Enum):
    AS_IS = 0
    UNKNOWN = 1
    DISABLED = 2
    PULL_UP = 3
    PULL_DOWN = 4


class Direction(enum.Enum):
    AS_IS = 0
    INPUT = 1
    OUTPUT = 2


class Value(enum.Enum):
    INACTIVE = 0
    ACTIVE = 1


@dataclasses.dataclass
class LineSettings:
    direction: Direction = Direction.AS_IS
    bias: Bias = Bias.AS_IS


ALLOWED_BIAS = {Bias.PULL_UP, Bias.PULL_DOWN, Bias.DISABLED}
SHORT = {Bias.PULL_UP: "up", Bias.PULL_DOWN: "down", Bias.DISABLED: "off"}


class Net:
    def __init__(self, pins, rail=None):
        self.pins = set(pins)
        self.rail = rail
        self.charge = 0


class Board:
    """The bench: nets of joined pins (some tied to GND or 3V3), and a record of every call."""

    def __init__(self, joined=(), gnd=(), vcc=(), busy=(), read_fails_at=None):
        self.nets = [Net(pins) for pins in joined]
        for pin in gnd:
            self.net_of(pin).rail = 0
        for pin in vcc:
            self.net_of(pin).rail = 1
        self.busy = set(busy)
        self.read_fails_at = read_fails_at
        self.chip_error = None
        self.held = set()  # lines in a live request
        self.touched = set()  # every line named in a request, whether or not it succeeded
        self.paths = set()
        self.bias = {}  # pin -> Bias currently applied
        self.log = []
        self.violations = []
        self.reads = 0

    def net_of(self, pin):
        for net in self.nets:
            if pin in net.pins:
                return net
        self.nets.append(Net({pin}))
        return self.nets[-1]

    def apply(self, config, pins):
        """Applies a line config to a request's pins as libgpiod does: a pin the config leaves out
        gets the default settings, which keep the direction and bias as they are."""
        applied = {pin: (Direction.AS_IS, Bias.AS_IS) for pin in pins}
        for group, settings in config.items():
            for pin in group:
                if pin not in applied:
                    self.violations.append(f"config names GPIO{pin}, which is not in the request")
                applied[pin] = (settings.direction, settings.bias)
        for pin, (_, bias) in applied.items():
            if bias is not Bias.AS_IS:
                self.bias[pin] = bias
        self.settle()
        return applied

    def settle(self):
        for net in self.nets:
            pulls = {self.bias[pin] for pin in net.pins if pin in self.bias} - {Bias.DISABLED}
            if net.rail is not None:
                net.charge = net.rail
            elif pulls == {Bias.PULL_UP}:
                net.charge = 1
            elif pulls == {Bias.PULL_DOWN}:
                net.charge = 0
            elif pulls:
                self.violations.append(f"opposing or unmodelled pulls on {sorted(net.pins)}")


def make_gpiod(board):
    class Request:
        def __init__(self, pins):
            self.pins = list(pins)
            self.live = True

        def reconfigure_lines(self, config):
            board.log.append(("reconfigure", board.apply(config, self.pins)))

        def get_values(self, lines=None):
            lines = list(lines or self.pins)
            if not set(lines) <= set(self.pins):
                board.violations.append("read of a line that is not requested")
            board.reads += 1
            if board.reads == board.read_fails_at:
                raise OSError(errno.EIO, "Input/output error")
            board.log.append(("read", {pin: board.bias.get(pin) for pin in lines}))
            return [Value.ACTIVE if board.net_of(pin).charge else Value.INACTIVE for pin in lines]

        def set_values(self, values):
            raise AssertionError("sensing must never set a line value")

        def release(self):
            if not self.live:
                raise RuntimeError("request already released")
            self.live = False
            board.held -= set(self.pins)  # the pins keep the last bias applied: release does not restore
            board.log.append(("release", sorted(self.pins)))

    def request_lines(path, consumer=None, config=None):
        pins = [pin for group in config for pin in group]
        board.paths.add(path)
        board.touched.update(pins)
        if len(set(pins)) != len(pins):
            board.violations.append("a line is configured twice")
        if board.busy & set(pins) or board.held & set(pins):
            raise OSError(errno.EBUSY, "Device or resource busy")
        request = Request(pins)
        board.held |= set(pins)
        for pin in pins:
            board.net_of(pin)
        board.log.append(("request", board.apply(config, pins)))
        return request

    class Chip:
        def __init__(self, path):
            if board.chip_error:
                raise board.chip_error

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    line = types.SimpleNamespace(Bias=Bias, Direction=Direction, Value=Value)
    return types.SimpleNamespace(request_lines=request_lines, LineSettings=LineSettings, Chip=Chip, line=line)


def short(entry):
    """A log entry reduced to what the pair-test order depends on."""
    kind = entry[0]
    if kind in ("request", "reconfigure"):
        return (kind, {pin: SHORT.get(bias, bias) for pin, (_, bias) in entry[1].items()})
    if kind == "read":
        return (kind, {pin: SHORT.get(bias, bias) for pin, bias in entry[1].items()})
    return entry


def assert_safe(test, board, claimed=()):
    """Every call the sensor made obeys the safety rules."""
    for entry in board.log:
        if entry[0] in ("request", "reconfigure"):
            for pin, (direction, bias) in entry[1].items():
                test.assertIs(direction, Direction.INPUT, f"GPIO{pin} was not requested as an input")
                test.assertIn(bias, ALLOWED_BIAS, f"GPIO{pin} had bias {bias}")
    test.assertFalse(board.touched & {0, 1}, "touched the HAT ID EEPROM pins")
    test.assertFalse(board.touched & set(claimed), "touched a pin the OS has claimed")
    test.assertEqual(board.violations, [])


def assert_released(test, board):
    test.assertEqual(board.held, set(), "lines are still held")


def assert_acks_after_release(test, board):
    acks = [entry for entry in board.log if entry[:2] == ("send", "sense_paused")]
    test.assertTrue(acks, "no sense_paused was sent")
    for ack in acks:
        test.assertEqual(ack[2], 0, "sense_paused was sent while lines were held")


def free(pins):
    """pinctrl and gpiod state for pins nobody has claimed."""
    return {
        str(pin): {"bcm": pin, "direction": "IN", "pull": "NONE", "function": "GPIO", "used": False} for pin in pins
    }


def alt(pin, function="SDA1"):
    return {"bcm": pin, "direction": "ALT", "pull": "NONE", "function": function, "used": False}


def used(pin, consumer="gpiozero"):
    return {"bcm": pin, "direction": "OUT", "pull": "NONE", "function": "GPIO", "used": True, "consumer": consumer}


class Bench:
    """A Sensor wired to a fake board, recording what it sends."""

    def __init__(self, case, board, state=None):
        self.board = board
        self.state = free(range(2, 28)) if state is None else state
        self.sent = []
        gpiod = make_gpiod(board)
        for patch in (
            mock.patch.dict(sys.modules, {"gpiod": gpiod}),
            mock.patch.object(gpio_monitor, "_detect_chip", return_value=CHIP),
        ):
            patch.start()
            case.addCleanup(patch.stop)
        self.sensor = sense.Sensor(
            self._send,
            lambda: self.state,
            sleep=lambda seconds: board.log.append(("sleep", seconds)),
            idle=lambda seconds: asyncio.sleep(0),
            clock=lambda: NOW,
        )

    async def _send(self, msg):
        self.board.log.append(("send", msg["type"], len(self.board.held)))
        self.sent.append(msg)

    def sweep(self, pins, **config):
        """One whole sweep, driven directly: the steps, then the data."""
        cfg = self.sensor._prepare({"pins": pins, **config})
        return list(self.sensor._sweep(cfg, self.state, self.sensor._epoch))

    def messages(self, kind):
        return [msg for msg in self.sent if msg["type"] == kind]


class BenchCase(unittest.TestCase):
    def bench(self, board=None, state=None):
        return Bench(self, board or Board(), state)


class AsyncBenchCase(unittest.IsolatedAsyncioTestCase):
    def bench(self, board=None, state=None):
        return Bench(self, board or Board(), state)


async def until(condition):
    deadline = time.monotonic() + 5
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("timed out waiting")
        await asyncio.sleep(0)


START = {"type": "sense_start", "config": {"pins": [4, 17, 27], "settleUs": 100, "periodMs": 250}}


class BiasClasses(BenchCase):
    def test_a_pin_tied_to_ground_reads_low_under_both_pulls(self):
        data = self.bench(Board(gnd=[4])).sweep([4, 5])[-1]
        self.assertEqual(data["bias"]["4"], {"up": 0, "down": 0})

    def test_a_pin_tied_to_3v3_reads_high_under_both_pulls(self):
        data = self.bench(Board(vcc=[4])).sweep([4, 5])[-1]
        self.assertEqual(data["bias"]["4"], {"up": 1, "down": 1})

    def test_an_unconnected_pin_follows_its_pull(self):
        data = self.bench().sweep([4, 5])[-1]
        self.assertEqual(data["bias"]["4"], {"up": 1, "down": 0})

    def test_joined_pins_follow_the_pull_together(self):
        data = self.bench(Board(joined=[(17, 27)])).sweep([17, 27])[-1]
        self.assertEqual(data["bias"]["17"], {"up": 1, "down": 0})
        self.assertEqual(data["bias"]["27"], {"up": 1, "down": 0})


class PairTest(BenchCase):
    def test_joined_pins_follow_the_driver_in_both_polarities(self):
        pairs = self.bench(Board(joined=[(17, 27)])).sweep([4, 17, 27])[-1]["pairs"]
        for a, b in (("17", "27"), ("27", "17")):
            self.assertEqual(pairs[a]["up"][b], 1)
            self.assertEqual(pairs[a]["down"][b], 0)

    def test_isolated_pins_hold_their_precharge(self):
        pairs = self.bench(Board(joined=[(17, 27)])).sweep([4, 17, 27])[-1]["pairs"]
        self.assertEqual(pairs["17"]["up"]["4"], 0)  # precharged low through its own pull-down
        self.assertEqual(pairs["17"]["down"]["4"], 1)  # precharged high through its own pull-up

    def test_the_driver_follows_its_own_pull(self):
        pairs = self.bench().sweep([4, 17])[-1]["pairs"]
        for a in ("4", "17"):
            self.assertEqual(pairs[a]["up"][a], 1)
            self.assertEqual(pairs[a]["down"][a], 0)

    def test_the_whole_matrix_on_a_small_board(self):
        # GPIO17 and GPIO27 joined, GPIO22 tied to GND, GPIO4 alone.
        data = self.bench(Board(joined=[(17, 27)], gnd=[22])).sweep([4, 17, 22, 27])[-1]
        expected = {
            "4": {"up": {"4": 1, "17": 0, "22": 0, "27": 0}, "down": {"4": 0, "17": 1, "22": 0, "27": 1}},
            "17": {"up": {"4": 0, "17": 1, "22": 0, "27": 1}, "down": {"4": 1, "17": 0, "22": 0, "27": 0}},
            "22": {"up": {"4": 0, "17": 0, "22": 0, "27": 0}, "down": {"4": 1, "17": 1, "22": 0, "27": 1}},
            "27": {"up": {"4": 0, "17": 1, "22": 0, "27": 1}, "down": {"4": 1, "17": 0, "22": 0, "27": 0}},
        }
        self.assertEqual(data["pairs"], expected)
        self.assertEqual(data["bias"]["22"], {"up": 0, "down": 0})

    def test_the_order_of_calls_in_a_sweep(self):
        bench = self.bench()
        bench.sweep([17, 27])
        wait = ("sleep", SETTLE)
        both = lambda mode: {17: mode, 27: mode}  # noqa: E731
        expected = [
            # bias test: request with pull-up, wait, read; pull-down, wait, read
            ("request", both("up")), wait, ("read", both("up")),
            ("reconfigure", both("down")), wait, ("read", both("down")),
            # pair test, A = 17: precharge every pin through its own opposite pull, wait,
            # then A takes the pull and the rest float, wait, read
            ("reconfigure", both("down")), wait, ("reconfigure", {17: "up", 27: "off"}), wait,
            ("read", {17: "up", 27: "off"}),
            ("reconfigure", both("up")), wait, ("reconfigure", {17: "down", 27: "off"}), wait,
            ("read", {17: "down", 27: "off"}),
            # A = 27
            ("reconfigure", both("down")), wait, ("reconfigure", {17: "off", 27: "up"}), wait,
            ("read", {17: "off", 27: "up"}),
            ("reconfigure", both("up")), wait, ("reconfigure", {17: "off", 27: "down"}), wait,
            ("read", {17: "off", 27: "down"}),
            # each pin's bias goes back to the pull pinctrl showed before the sweep, then release
            ("reconfigure", both("off")), ("release", [17, 27]),
        ]
        self.assertEqual([short(entry) for entry in bench.board.log], expected)

    def test_a_sweep_is_two_plus_two_per_pin_steps(self):
        for pins in ([4], [4, 5, 6], [4, 5, 6, 7, 8]):
            steps = self.bench().sweep(pins)[:-1]
            self.assertEqual(len(steps), 2 + 2 * len(pins))

    def test_the_sweep_reports_its_pins_time_and_chip(self):
        bench = self.bench()
        data = bench.sweep([27, 4, 17])[-1]
        self.assertEqual((data["t"], data["pins"], data["skipped"]), (NOW, [4, 17, 27], []))
        self.assertEqual(bench.board.paths, {CHIP})
        json.dumps(data)


class Exclusions(BenchCase):
    def test_pins_0_and_1_and_out_of_range_pins_are_refused_and_never_touched(self):
        bench = self.bench()
        data = bench.sweep([0, 1, 4, 28, 40, -1])[-1]
        self.assertEqual(data["pins"], [4])
        self.assertEqual([item["bcm"] for item in data["skipped"]], [-1, 0, 1, 28, 40])
        self.assertIn("EEPROM", data["skipped"][1]["reason"])
        self.assertEqual(bench.board.touched, {4})
        assert_safe(self, bench.board)

    def test_a_pin_on_an_alternate_function_is_skipped_with_the_reason(self):
        state = free(range(2, 28)) | {"2": alt(2, "SDA1")}
        bench = self.bench(state=state)
        data = bench.sweep([2, 4])[-1]
        self.assertEqual(data["pins"], [4])
        self.assertEqual(data["skipped"], [{"bcm": 2, "reason": "alternate function SDA1"}])
        assert_safe(self, bench.board, claimed=[2])

    def test_a_pin_left_as_an_output_is_skipped(self):
        state = free(range(2, 28)) | {"6": {"bcm": 6, "direction": "OUT", "function": "GPIO", "used": False}}
        bench = self.bench(state=state)
        data = bench.sweep([4, 6])[-1]
        self.assertEqual(data["pins"], [4])
        self.assertEqual(data["skipped"], [{"bcm": 6, "reason": "an output; sensing would change it"}])
        assert_safe(self, bench.board, claimed=[6])

    def test_a_pin_gpiod_reports_used_is_skipped_with_the_consumer(self):
        state = free(range(2, 28)) | {"5": used(5, "my-script")}
        bench = self.bench(state=state)
        data = bench.sweep([4, 5])[-1]
        self.assertEqual(data["pins"], [4])
        self.assertEqual(data["skipped"], [{"bcm": 5, "reason": "line in use by my-script"}])
        assert_safe(self, bench.board, claimed=[5])

    def test_a_pin_with_no_state_is_skipped_rather_than_assumed_free(self):
        state = free([4])
        bench = self.bench(state=state)
        data = bench.sweep([4, 5])[-1]
        self.assertEqual(data["pins"], [4])
        self.assertEqual([item["bcm"] for item in data["skipped"]], [5])
        assert_safe(self, bench.board, claimed=[5])

    def test_a_pin_without_gpiod_line_info_is_skipped(self):
        state = free(range(2, 28))
        del state["5"]["used"]
        data = self.bench(state=state).sweep([4, 5])[-1]
        self.assertEqual(data["pins"], [4])
        self.assertEqual(data["skipped"][0]["bcm"], 5)

    def test_a_pin_whose_pull_pinctrl_cannot_report_is_skipped(self):
        # Without the pull it had, release could not leave the pin as found.
        state = free(range(2, 28))
        state["5"]["pull"] = "UNKNOWN"
        del state["6"]["pull"]
        bench = self.bench(state=state)
        data = bench.sweep([4, 5, 6])[-1]
        self.assertEqual(data["pins"], [4])
        self.assertEqual([item["bcm"] for item in data["skipped"]], [5, 6])
        self.assertEqual(bench.board.touched, {4})

    def test_a_sweep_with_no_free_pin_touches_nothing(self):
        bench = self.bench(state={})
        data = bench.sweep([4, 5])[-1]
        self.assertEqual(data["pins"], [])
        self.assertEqual(bench.board.log, [])

    def test_a_line_the_kernel_refuses_is_skipped_and_the_rest_are_probed(self):
        bench = self.bench(Board(busy=[5]))
        data = bench.sweep([4, 5, 6])[-1]
        self.assertEqual(data["pins"], [4, 6])
        self.assertEqual(data["skipped"][0]["bcm"], 5)
        self.assertIn("cannot request line", data["skipped"][0]["reason"])
        self.assertEqual(set(data["pairs"]), {"4", "6"})
        events = bench.sensor._out
        self.assertEqual([event["data"]["kind"] for event in events], ["error"])
        self.assertIn("GPIO5", events[0]["data"]["message"])
        assert_safe(self, bench.board)
        assert_released(self, bench.board)


class Restore(BenchCase):
    """libgpiod's release keeps the last bias applied, so the sensor puts each pin's bias back first."""

    FOUND = {4: ("UP", Bias.PULL_UP), 5: ("DOWN", Bias.PULL_DOWN), 6: ("NONE", Bias.DISABLED)}

    def found_bench(self, board=None):
        """A bench whose GPIO4-6 were pulled up, pulled down and floating before sensing. Returns it
        with the bias each pin had."""
        board = board or Board()
        state = free(range(2, 28))
        for pin, (pull, bias) in self.FOUND.items():
            board.bias[pin] = bias
            state[str(pin)]["pull"] = pull
        return self.bench(board, state), dict(board.bias)

    def test_a_sweep_leaves_each_pin_with_the_bias_it_had(self):
        bench, before = self.found_bench()
        bench.sweep([4, 5, 6])
        self.assertEqual(bench.board.bias, before)
        assert_safe(self, bench.board)
        assert_released(self, bench.board)

    def test_a_pause_or_stop_at_any_step_leaves_each_pin_with_the_bias_it_had(self):
        for steps in range(1, 2 + 2 * 3 + 2):
            with self.subTest(steps=steps):
                bench, before = self.found_bench()
                pause_after(self, bench, steps)
                self.assertEqual(bench.board.bias, before)

    def test_an_error_mid_sweep_leaves_each_pin_with_the_bias_it_had(self):
        bench, before = self.found_bench(Board(read_fails_at=3))
        bench.sweep([4, 5, 6])
        self.assertEqual(bench.board.bias, before)

    def test_the_trial_requests_for_a_refused_line_leave_each_pin_with_the_bias_it_had(self):
        bench, before = self.found_bench(Board(busy=[5]))
        data = bench.sweep([4, 5, 6])[-1]
        self.assertEqual(data["pins"], [4, 6])
        self.assertEqual(bench.board.bias, before)

    def test_a_restore_that_fails_still_releases_the_lines(self):
        bench, _ = self.found_bench()
        cfg = bench.sensor._prepare({"pins": [4, 5, 6]})
        sweep = bench.sensor._sweep(cfg, bench.state, bench.sensor._epoch)
        next(sweep)  # the lines are held
        failing = mock.patch.object(bench.sensor._req, "reconfigure_lines", side_effect=OSError(errno.EIO, "EIO"))
        with failing, self.assertLogs("sense", "ERROR"):
            bench.sensor._interrupt()
        assert_released(self, bench.board)


class Config(unittest.TestCase):
    def test_defaults_and_conversion(self):
        cfg = sense.parse_config({"pins": [17, 4, 17]})
        self.assertEqual((cfg.pins, cfg.refused, cfg.settle_s, cfg.period_s), ([4, 17], [], 100 / 1e6, 0.25))
        cfg = sense.parse_config({"pins": [4], "settleUs": 250, "periodMs": 500})
        self.assertEqual((cfg.settle_s, cfg.period_s), (250 / 1e6, 0.5))

    def test_malformed_configs_are_rejected(self):
        bad = [
            None, [], {}, {"pins": 4}, {"pins": ["4"]}, {"pins": [4.0]}, {"pins": [True]},
            {"pins": [4], "settleUs": 0}, {"pins": [4], "settleUs": 1_000_000},
            {"pins": [4], "settleUs": "100"}, {"pins": [4], "settleUs": float("nan")},
            {"pins": [4], "periodMs": 1}, {"pins": [4], "periodMs": 10**9}, {"pins": [4], "periodMs": True},
        ]
        for config in bad:
            with self.subTest(config=config), self.assertRaises(ValueError):
                sense.parse_config(config)


class PauseAndResume(AsyncBenchCase):
    async def test_sense_paused_is_sent_only_after_every_line_is_released(self):
        bench = self.bench()
        await bench.sensor.handle(START)
        await until(lambda: bench.board.held)
        self.assertTrue(bench.board.held)
        await bench.sensor.handle({"type": "sense_pause"})
        assert_acks_after_release(self, bench.board)
        self.assertEqual(bench.messages("sense_paused"), [{"type": "sense_paused"}])
        assert_released(self, bench.board)

    async def test_a_pause_mid_sweep_takes_effect_before_the_next_step(self):
        bench = self.bench()
        await bench.sensor.handle(START)
        await until(lambda: bench.board.held)  # the runner is now between steps
        before = len(bench.board.log)
        await bench.sensor.handle({"type": "sense_pause"})
        self.assertEqual(
            [entry[0] for entry in bench.board.log[before:]], ["reconfigure", "release", "send"],
            "the only things between the pause and its acknowledgement are the restore and the release",
        )
        for _ in range(20):
            await asyncio.sleep(0)
        self.assertEqual(len(bench.board.log), before + 3, "a step ran after the pause")
        self.assertEqual(bench.messages("sense_sweep"), [])

    async def test_a_pause_with_nothing_running_is_acknowledged(self):
        bench = self.bench()
        await bench.sensor.handle({"type": "sense_pause"})
        self.assertEqual(bench.messages("sense_paused"), [{"type": "sense_paused"}])
        self.assertEqual(bench.board.log, [("send", "sense_paused", 0)])

    async def test_a_pause_just_after_a_sweep_finishes_drops_that_sweep(self):
        bench = self.bench()
        await bench.sensor.handle({**START, "config": {"pins": [4]}})
        await until(lambda: bench.board.log and bench.board.log[-1][0] == "release")
        await bench.sensor.handle({"type": "sense_pause"})
        for _ in range(20):
            await asyncio.sleep(0)
        self.assertEqual(bench.messages("sense_sweep"), [])

    async def test_resume_continues_sweeping(self):
        bench = self.bench()
        await bench.sensor.handle(START)
        await until(lambda: bench.messages("sense_sweep"))
        await bench.sensor.handle({"type": "sense_pause"})
        calls = len(bench.board.log)
        sweeps = len(bench.messages("sense_sweep"))
        for _ in range(50):
            await asyncio.sleep(0)
        self.assertEqual(len(bench.board.log), calls, "something ran while paused")
        await bench.sensor.handle({"type": "sense_resume"})
        await until(lambda: len(bench.messages("sense_sweep")) > sweeps)
        bench.sensor.stop()

    async def test_resume_without_a_start_does_nothing(self):
        bench = self.bench()
        await bench.sensor.handle({"type": "sense_resume"})
        for _ in range(10):
            await asyncio.sleep(0)
        self.assertEqual((bench.board.log, bench.sent), ([], []))

    async def test_a_pause_outlasts_stop_and_start_until_resume(self):
        bench = self.bench()
        await bench.sensor.handle({"type": "sense_pause"})
        await bench.sensor.handle(START)
        for _ in range(50):
            await asyncio.sleep(0)
        self.assertEqual(bench.board.touched, set(), "swept while paused")
        await bench.sensor.handle({"type": "sense_resume"})
        await until(lambda: bench.messages("sense_sweep"))
        bench.sensor.stop()

    def test_a_pause_at_any_step_leaves_nothing_running_or_held(self):
        for steps in range(1, 2 + 2 * 3 + 2):
            with self.subTest(steps=steps):
                bench = self.bench()
                pause_after(self, bench, steps)


def pause_after(test, bench, steps, pins=(4, 5, 6)):
    """Pauses, as the message handler does between two steps, after `steps` steps. Nothing may run
    afterwards and the lines must already be free."""
    cfg = bench.sensor._prepare({"pins": list(pins)})
    sweep = bench.sensor._sweep(cfg, bench.state, bench.sensor._epoch)
    for _ in range(steps):
        next(sweep)
    bench.sensor._interrupt()
    calls = len(bench.board.log)
    assert_released(test, bench.board)
    test.assertEqual(list(sweep), [], "the sweep went on after the pause")
    test.assertEqual(len(bench.board.log), calls, "a step ran after the pause")


class Release(AsyncBenchCase):
    async def test_lines_are_free_whenever_a_sweep_is_reported(self):
        bench = self.bench()
        await bench.sensor.handle(START)
        await until(lambda: len(bench.messages("sense_sweep")) >= 3)
        bench.sensor.stop()
        sweeps = [entry for entry in bench.board.log if entry[:2] == ("send", "sense_sweep")]
        self.assertEqual([entry[2] for entry in sweeps], [0] * len(sweeps))
        requests = [entry for entry in bench.board.log if entry[0] == "request"]
        releases = [entry for entry in bench.board.log if entry[0] == "release"]
        self.assertEqual(len(requests), len(releases))
        assert_safe(self, bench.board)

    async def test_stop_mid_sweep_releases_the_lines(self):
        bench = self.bench()
        await bench.sensor.handle(START)
        await until(lambda: bench.board.held)
        await bench.sensor.handle({"type": "sense_stop"})
        assert_released(self, bench.board)
        calls = len(bench.board.log)
        for _ in range(50):
            await asyncio.sleep(0)
        self.assertEqual(len(bench.board.log), calls, "sensing went on after stop")

    async def test_an_error_mid_sweep_releases_the_lines_and_sensing_goes_on(self):
        bench = self.bench(Board(read_fails_at=3))
        await bench.sensor.handle(START)
        await until(lambda: bench.messages("sense_sweep"))
        errors = bench.messages("sense_event")
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["data"]["kind"], "error")
        self.assertIn("Input/output error", errors[0]["data"]["message"])
        bench.sensor.stop()
        assert_released(self, bench.board)
        released = [entry for entry in bench.board.log if entry[0] == "release"]
        self.assertGreaterEqual(len(released), 2)
        assert_safe(self, bench.board)

    async def test_an_unexpected_failure_stops_sensing_and_says_so(self):
        bench = self.bench()

        def broken():
            raise RuntimeError("pinctrl exploded")

        bench.sensor._read_state = broken
        with self.assertLogs("sense", "ERROR"):
            await bench.sensor.handle(START)
            await until(lambda: bench.messages("sense_event"))
        self.assertIn("pinctrl exploded", bench.messages("sense_event")[0]["data"]["message"])
        self.assertEqual(bench.board.touched, set())

    async def test_a_repeated_error_is_reported_once(self):
        bench = self.bench(Board(busy=[5]))
        await bench.sensor.handle({**START, "config": {"pins": [4, 5]}})
        await until(lambda: len(bench.messages("sense_sweep")) >= 3)
        bench.sensor.stop()
        self.assertEqual(len(bench.messages("sense_event")), 1)


class Safety(BenchCase):
    def test_no_request_or_reconfigure_is_an_output_and_bias_is_always_up_down_or_off(self):
        bench = self.bench(Board(joined=[(17, 27)]))
        bench.sweep([4, 17, 27])
        entries = [entry for entry in bench.board.log if entry[0] in ("request", "reconfigure")]
        self.assertGreater(len(entries), 10)
        assert_safe(self, bench.board)
        seen = {bias for entry in entries for (_, bias) in entry[1].values()}
        self.assertEqual(seen, ALLOWED_BIAS)

    def test_the_pair_test_floats_every_pin_but_the_driver_when_it_reads(self):
        bench = self.bench()
        bench.sweep([4, 5, 6])
        reads = [short(entry)[1] for entry in bench.board.log if entry[0] == "read"][2:]  # past the bias test
        self.assertEqual(len(reads), 6)
        for biases in reads:
            driving = [pin for pin, mode in biases.items() if mode != "off"]
            self.assertEqual(len(driving), 1)
            self.assertIn(biases[driving[0]], ("up", "down"))

    def test_random_boards_pin_sets_and_pause_points_break_no_rule(self):
        rng = random.Random(20261024)
        for _ in range(200):
            wanted = rng.sample(range(-2, 32), rng.randint(0, 14))
            valid = [pin for pin in wanted if 2 <= pin <= 27]
            claimed = {pin for pin in valid if rng.random() < 0.25}
            state = free(range(0, 28))
            for pin in claimed:
                state[str(pin)] = rng.choice([alt(pin), used(pin)])
            spare = rng.sample(range(2, 28), 12)
            board = Board(
                joined=[spare[0:2], spare[2:5]], gnd=spare[5:6], vcc=spare[6:7],
                busy=[pin for pin in valid if pin not in claimed and rng.random() < 0.1],
            )
            bench = self.bench(board, state)
            cfg = bench.sensor._prepare({"pins": wanted, "settleUs": rng.choice([1, 100, 5000])})
            sweep = bench.sensor._sweep(cfg, state, bench.sensor._epoch)
            pause_at = rng.choice([None, *range(1, 2 * len(valid) + 3)])
            calls = None
            for step, _ in enumerate(sweep, 1):
                if step == pause_at:
                    bench.sensor._interrupt()
                    calls = len(board.log)
            if calls is not None:
                self.assertEqual(len(board.log), calls, "a step ran after the pause")
            assert_safe(self, board, claimed)
            assert_released(self, board)
            self.assertNotIn(0, board.touched)
            self.assertNotIn(1, board.touched)


class GuardsBite(BenchCase):
    """Each check above fails when the rule it guards is broken."""

    def test_an_output_request_is_caught(self):
        bench = self.bench()
        config = bench.sensor._config

        def output_config(pulls):
            result = config(pulls)
            for settings in result.values():
                settings.direction = Direction.OUTPUT
            return result

        with mock.patch.object(bench.sensor, "_config", output_config):
            bench.sweep([4, 5])
        with self.assertRaises(AssertionError):
            assert_safe(self, bench.board)

    def test_a_bias_other_than_up_down_or_off_is_caught(self):
        for forbidden in (Bias.AS_IS, Bias.UNKNOWN):
            with self.subTest(bias=forbidden):
                bench = self.bench()
                config = bench.sensor._config

                def bad_config(pulls, config=config, forbidden=forbidden):
                    result = config(pulls)
                    for settings in result.values():
                        settings.bias = forbidden
                    return result

                with mock.patch.object(bench.sensor, "_config", bad_config):
                    bench.sweep([4, 5])
                with self.assertRaises(AssertionError):
                    assert_safe(self, bench.board)

    def test_touching_pin_0_or_1_is_caught(self):
        bench = self.bench(state=free(range(0, 28)))
        with mock.patch.object(sense, "USER_GPIOS", range(0, 28)):
            bench.sweep([0, 1, 4])
        with self.assertRaises(AssertionError):
            assert_safe(self, bench.board)

    def test_requesting_a_claimed_pin_is_caught(self):
        bench = self.bench(state=free(range(2, 28)) | {"5": used(5)})
        with mock.patch.object(sense, "claim_reason", lambda info: None):
            bench.sweep([4, 5])
        with self.assertRaises(AssertionError):
            assert_safe(self, bench.board, claimed=[5])

    def test_lines_left_held_after_a_sweep_are_caught(self):
        bench = self.bench()
        with mock.patch.object(sense.Sensor, "_release", lambda self: None):
            bench.sweep([4, 5])
        with self.assertRaises(AssertionError):
            assert_released(self, bench.board)

    def test_a_step_that_runs_after_a_pause_is_caught(self):
        bench = self.bench()
        with mock.patch.object(sense.Sensor, "_interrupt", lambda self: self._release()):
            with self.assertRaises(AssertionError):
                pause_after(self, bench, 3)


class GuardsBiteAsync(AsyncBenchCase):
    async def test_an_acknowledgement_sent_with_lines_held_is_caught(self):
        bench = self.bench()
        with mock.patch.object(sense.Sensor, "_interrupt", lambda self: None):
            await bench.sensor.handle(START)
            await until(lambda: bench.board.held)
            await bench.sensor.handle({"type": "sense_pause"})
            with self.assertRaises(AssertionError):
                assert_acks_after_release(self, bench.board)
            bench.sensor._task.cancel()


class Refusal(AsyncBenchCase):
    async def start_and_collect(self, bench):
        await bench.sensor.handle(START)
        self.assertEqual(bench.board.touched, set())
        self.assertIsNone(bench.sensor._task)
        self.assertEqual([msg["type"] for msg in bench.sent], ["sense_event"])
        event = bench.sent[0]["data"]
        self.assertEqual(event["kind"], "error")
        return event["message"]

    async def test_a_missing_gpiod_refuses_to_start(self):
        bench = self.bench()
        with mock.patch.dict(sys.modules, {"gpiod": None}):
            message = await self.start_and_collect(bench)
        self.assertIn("import gpiod", message)
        self.assertIn("2.x", message)

    async def test_the_v1_binding_refuses_to_start(self):
        bench = self.bench()
        v1 = types.SimpleNamespace(Chip=lambda name: None, version_string=lambda: "1.6.3")
        with mock.patch.dict(sys.modules, {"gpiod": v1}):
            message = await self.start_and_collect(bench)
        self.assertIn("1.x", message)
        self.assertIn("2.x", message)

    async def test_a_chip_that_cannot_be_opened_refuses_to_start(self):
        board = Board()
        board.chip_error = PermissionError(errno.EACCES, "Permission denied")
        message = await self.start_and_collect(self.bench(board))
        self.assertIn(CHIP, message)
        self.assertIn("Permission denied", message)

    async def test_a_bad_config_refuses_to_start(self):
        bench = self.bench()
        await bench.sensor.handle({"type": "sense_start", "config": {"pins": "4"}})
        self.assertEqual(bench.sent[0]["data"]["kind"], "error")
        self.assertIsNone(bench.sensor._task)

    async def test_start_while_running_replaces_the_session(self):
        bench = self.bench()
        await bench.sensor.handle(START)
        await until(lambda: bench.board.held)
        await bench.sensor.handle({**START, "config": {"pins": [5]}})
        assert_released(self, bench.board)
        await until(lambda: any(msg["data"]["pins"] == [5] for msg in bench.messages("sense_sweep")))
        bench.sensor.stop()
        assert_released(self, bench.board)


class ConnectionClosed(Exception):
    pass


class FakeSocket:
    remote_address = ("127.0.0.1", 50000)

    def __init__(self):
        self.sent = []
        self.incoming = asyncio.Queue()
        self.incoming.put_nowait(json.dumps({"type": "auth", "token": "secret"}))

    async def recv(self):
        return await self.incoming.get()

    def __aiter__(self):
        return self

    async def __anext__(self):
        raw = await self.incoming.get()
        if raw is None:
            raise StopAsyncIteration
        return raw

    async def send(self, raw):
        self.sent.append(json.loads(raw))

    async def close(self, code, reason):
        pass

    def push(self, msg):
        """Queues a message from the app, or None to close the connection."""
        self.incoming.put_nowait(None if msg is None else json.dumps(msg))

    def types(self):
        return [msg["type"] for msg in self.sent]


def load_agent():
    """agent.py with websockets stubbed, since the package is only installed on the Pi."""
    stub = types.ModuleType("websockets")
    stub.WebSocketServerProtocol = object
    stub.ConnectionClosed = ConnectionClosed
    with mock.patch.dict(sys.modules, {"websockets": stub}):
        sys.modules.pop("agent", None)
        return importlib.import_module("agent")


class RecordingSensor:
    instances = []

    def __init__(self, send, read_state):
        self.send, self.read_state = send, read_state
        self.handled, self.stopped = [], False
        RecordingSensor.instances.append(self)

    async def handle(self, msg):
        self.handled.append(msg["type"])
        if msg["type"] == "sense_pause":
            await self.send({"type": "sense_paused"})

    def stop(self):
        self.stopped = True


class Wiring(AsyncBenchCase):
    def setUp(self):
        self.agent = load_agent()
        self.monitor = types.SimpleNamespace(read_all=lambda: {})

    async def serve(self, socket):
        await self.agent.handle_client(socket, self.monitor, "secret")

    async def test_the_four_app_messages_reach_the_sensor_and_its_messages_reach_the_socket(self):
        RecordingSensor.instances = []
        socket = FakeSocket()
        for msg in (START, {"type": "sense_pause"}, {"type": "sense_resume"}, {"type": "sense_stop"}, {"type": "bogus"}):
            socket.push(msg)
        socket.push(None)
        with mock.patch.object(self.agent, "Sensor", RecordingSensor):
            await self.serve(socket)
        (sensor,) = RecordingSensor.instances
        self.assertEqual(sensor.handled, ["sense_start", "sense_pause", "sense_resume", "sense_stop"])
        self.assertIs(sensor.read_state, self.monitor.read_all)
        self.assertEqual(socket.types(), ["auth_ok", "sense_paused", "error"])
        self.assertTrue(sensor.stopped, "sensing must stop when the client disconnects")

    async def test_sensing_runs_through_the_socket_and_stops_when_the_client_leaves(self):
        bench = self.bench()
        socket = FakeSocket()
        with mock.patch.object(self.agent, "Sensor", lambda send, read_state: bench.sensor):
            bench.sensor._send = lambda msg: socket.send(json.dumps(msg))
            server = asyncio.create_task(self.serve(socket))
            socket.push(START)
            await until(lambda: "sense_sweep" in socket.types())
            sweep = next(msg for msg in socket.sent if msg["type"] == "sense_sweep")
            self.assertEqual(sweep["data"]["pins"], [4, 17, 27])
            socket.push({"type": "sense_pause"})
            await until(lambda: "sense_paused" in socket.types())
            assert_released(self, bench.board)
            socket.push({"type": "sense_resume"})
            await until(lambda: socket.types().count("sense_sweep") >= 2)
            socket.push(None)  # the client leaves while sensing is running
            await server
        assert_released(self, bench.board)
        self.assertIsNone(bench.sensor._task)

    def test_the_agent_still_listens_on_loopback_only(self):
        source = pathlib.Path(self.agent.__file__).read_text()
        self.assertIn('host = "127.0.0.1"', source)
        self.assertNotIn("0.0.0.0", source)


if __name__ == "__main__":
    unittest.main()
