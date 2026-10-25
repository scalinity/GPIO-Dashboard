#!/usr/bin/env python3
"""Board Sense: infers which header GPIOs are joined by changing only the bias of input lines.

One sweep (SPEC 14.5) requests the probed lines as inputs and reads them under pull-up and under
pull-down. Then, for each driving pin A and each polarity, it precharges every probed pin through
its own opposite pull, floats every pin but A (bias disabled) while A takes the pull, and reads
them all. Levels are reported raw; the app interprets them. Lines are held only during a sweep.

Safety rules, each guarded by a test in test_sense.py:
- Every line is an input. _config is the only place a LineSettings is built, and it always sets
  Direction.INPUT. Nothing here requests an output or sets a value.
- Bias is "up", "down" or "off" (PULL_UP, PULL_DOWN, DISABLED) and nothing else. _config looks
  those three up by name. Bias.AS_IS would keep whatever mode a pad was left in, and libgpiod has
  no bus-keeper value, so no pad can be left in bus-keeper mode.
- GPIO0 and GPIO1 (the HAT ID EEPROM), pins outside 2-27, and pins the OS has claimed (an alternate
  function in pinctrl, or a gpiod consumer) are never requested.
- Lines are released at the end of every sweep, and on pause, stop and error, before sense_paused
  is sent.
- Releasing a request keeps the last bias applied, so each line is first put back to the pull pinctrl
  showed before the sweep, and a pin whose pull pinctrl does not report is never requested. The
  direction is not restored: only inputs and unconfigured pins are probed, and libgpiod has no
  setting that puts a pin back to unconfigured.
- Everything runs on the event loop and yields between steps, so a message such as sense_pause is
  handled between two steps and takes effect before the next one starts.

libgpiod binding (looked up 2026-10-24). This needs the v2 Python API; there is no v1 code path.
- Raspberry Pi OS Bookworm: apt's python3-libgpiod is 1.6.3-1+b3, the v1 API.
  https://packages.debian.org/bookworm/python3-libgpiod
- Raspberry Pi OS Trixie: apt's python3-libgpiod is 2.2.1-2+deb13u1, the v2 API.
  https://packages.debian.org/trixie/python3-libgpiod
- Debian has no python3-gpiod package, and archive.raspberrypi.com carries no libgpiod package
  for either release, so Raspberry Pi OS uses Debian's.
- pip install gpiod: the official v2 bindings (2.x; 1.5.4 and earlier are an unrelated, deprecated
  pure-Python package). It vendors libgpiod. aarch64 wheels exist for CPython 3.10 to 3.14, so
  Bookworm (3.11) and Trixie (3.13) need no compiler. 32-bit builds from the sdist and needs
  python3-dev. https://pypi.org/project/gpiod/
"""

import asyncio
import contextlib
import logging
import time
from typing import NamedTuple

import gpio_monitor

log = logging.getLogger("sense")

MESSAGES = ("sense_start", "sense_stop", "sense_pause", "sense_resume")

CONSUMER = "gpio-dashboard-sense"
USER_GPIOS = range(2, 28)  # BCM 0 and 1 are the HAT ID EEPROM
# A settle longer than this would stretch one step past what the app waits for a pause (1 s).
MAX_SETTLE_US = 50_000
PERIOD_MS = (50, 60_000)

OPPOSITE = {"up": "down", "down": "up"}
BIAS = {"up": "PULL_UP", "down": "PULL_DOWN", "off": "DISABLED"}
FOUND = {"UP": "up", "DOWN": "down", "NONE": "off"}  # pinctrl's pull, as the bias that restores it

NEEDS_V2 = (
    "Board Sense needs the libgpiod 2.x Python binding. Raspberry Pi OS Trixie has it as apt "
    "python3-libgpiod; on Bookworm, whose apt package is 1.6.3, the agent's install.sh puts gpiod 2 "
    "in a venv. Deploy the agent again from the dashboard."
)


class SenseUnavailable(ValueError):
    pass


class Config(NamedTuple):
    pins: list
    refused: list
    settle_s: float
    period_s: float


def load_gpiod():
    """The gpiod module, or SenseUnavailable if it is missing or is the v1 binding."""
    try:
        import gpiod
    except ImportError:
        raise SenseUnavailable(f"`import gpiod` failed. {NEEDS_V2}") from None
    if not all(hasattr(gpiod, name) for name in ("request_lines", "LineSettings", "line")):
        raise SenseUnavailable(f"The installed Python gpiod is the libgpiod 1.x binding. {NEEDS_V2}")
    return gpiod


def parse_config(config):
    """The sense_start config as a Config. Pins outside 2-27 are refused, not dropped silently:
    they are listed in every sweep's `skipped`. Anything malformed raises ValueError."""
    if not isinstance(config, dict):
        raise ValueError("sense_start needs a config object")
    raw = config.get("pins")
    if not isinstance(raw, list) or any(type(pin) is not int for pin in raw):
        raise ValueError("config.pins must be a list of BCM pin numbers")
    settle_us = _number(config, "settleUs", 100, 1, MAX_SETTLE_US)
    period_ms = _number(config, "periodMs", 250, *PERIOD_MS)
    wanted = sorted(set(raw))
    refused = [
        {"bcm": pin, "reason": "reserved for the HAT ID EEPROM" if pin in (0, 1) else "not a user GPIO (BCM 2-27)"}
        for pin in wanted
        if pin not in USER_GPIOS
    ]
    return Config([pin for pin in wanted if pin in USER_GPIOS], refused, settle_us / 1e6, period_ms / 1e3)


def _number(config, key, default, low, high):
    value = config.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise ValueError(f"config.{key} must be a number from {low} to {high}")
    return value


def claim_reason(info):
    """Why a pin must be left alone, or None when it is free. `info` is the pin's entry from
    GpioMonitor.read_all(): pinctrl's function and gpiod's line info."""
    if info is None:
        return "no pinctrl state for this pin"
    if info.get("direction") == "ALT":
        return f"alternate function {info.get('function')}"
    if info.get("used") is None:
        return "gpiod line info unavailable"
    if info["used"]:
        return f"line in use by {info.get('consumer') or 'another process'}"
    if info.get("direction") == "OUT":
        return "an output; sensing would change it"
    if info.get("pull") not in FOUND:
        return "pinctrl does not report its pull"
    return None


class Sensor:
    """One client's Board Sense session. `send` is an async callable that takes a message dict;
    `read_state` returns GpioMonitor.read_all()'s dict. The rest are seams for tests."""

    def __init__(self, send, read_state, sleep=time.sleep, idle=asyncio.sleep, clock=time.time):
        self._send = send
        self._read_state = read_state
        self._sleep = sleep
        self._idle = idle
        self._clock = clock
        self._task = None
        self._paused = False
        self._epoch = 0  # bumped by every pause and stop: a sweep from an older epoch is abandoned
        self._req = None
        self._found = {}  # pin -> the bias it had before the sweep
        self._restore = {}  # the held request's pins -> the bias to put back before releasing it
        self._out = []
        self._reported = set()

    async def handle(self, msg):
        kind = msg.get("type")
        if kind == "sense_start":
            await self.start(msg.get("config"))
        elif kind == "sense_stop":
            self.stop()
        elif kind == "sense_pause":
            await self.pause()
        elif kind == "sense_resume":
            self.resume()

    async def start(self, config):
        self.stop()
        self._reported.clear()
        try:
            cfg = self._prepare(config)
        except ValueError as exc:
            self._error(str(exc))
            await self._flush()
            return
        self._task = asyncio.create_task(self._run(cfg))

    def stop(self):
        if self._task is not None:
            self._task.cancel()
            self._task = None
        self._interrupt()

    async def pause(self):
        """Releases every line, then acknowledges. Pausing stays in force, across stop and start,
        until sense_resume."""
        self._paused = True
        self._interrupt()
        await self._send({"type": "sense_paused"})

    def resume(self):
        self._paused = False
        self._reported.clear()

    def _prepare(self, config):
        cfg = parse_config(config)
        self._g = load_gpiod()
        self._path = gpio_monitor._detect_chip()
        self._active = self._g.line.Value.ACTIVE
        try:
            with self._g.Chip(self._path):
                pass
        except OSError as exc:
            raise ValueError(f"cannot open GPIO chip {self._path}: {exc}") from exc
        return cfg

    def _interrupt(self):
        """Abandons any sweep in progress and releases its lines."""
        self._epoch += 1
        self._release()

    async def _run(self, cfg):
        try:
            while True:
                began = time.monotonic()
                if not self._paused:
                    await self._one_sweep(cfg)
                await self._idle(max(0.0, cfg.period_s - (time.monotonic() - began)))
        except Exception as exc:
            log.exception("Board Sense loop failed")
            self._error(f"sensing stopped: {exc}")
            with contextlib.suppress(Exception):
                await self._flush()

    async def _one_sweep(self, cfg):
        epoch = self._epoch
        state = await asyncio.get_running_loop().run_in_executor(None, self._read_state)
        if epoch != self._epoch:  # paused or stopped while pinctrl was being read
            return
        data = None
        for data in self._sweep(cfg, state, epoch):
            await asyncio.sleep(0)  # between steps, so a pause is handled before the next step
        await self._flush()
        if data is not None and epoch == self._epoch:
            await self._send({"type": "sense_sweep", "data": data})

    def _sweep(self, cfg, state, epoch):
        """One sweep as a generator: it yields None after each step, then yields the sweep's data
        once the lines are released. If the epoch changes, it stops without yielding the data."""
        skipped = list(cfg.refused)
        pins = []
        for pin in cfg.pins:
            reason = claim_reason(state.get(str(pin)))
            if reason:
                skipped.append({"bcm": pin, "reason": reason})
            else:
                pins.append(pin)
        self._found = {pin: FOUND[state[str(pin)]["pull"]] for pin in pins}
        data = {"t": self._clock(), "pins": pins, "skipped": skipped, "bias": {}, "pairs": {}}
        try:
            for _ in self._steps(cfg, pins, data):
                yield
                if epoch != self._epoch:
                    return
        except Exception as exc:
            self._error(f"sweep failed: {exc}")
            return
        finally:
            if epoch == self._epoch:
                self._release()
        yield data

    def _steps(self, cfg, pins, data):
        """The sweep's steps, yielding after each: bias up, bias down, then one step per driving
        pin and polarity, 2 + 2 x pins in all."""
        pins = data["pins"] = self._open(pins, data)
        if not pins:
            return
        for mode in ("up", "down"):
            if mode == "down":
                self._set({pin: "down" for pin in pins})
            for pin, level in self._read(cfg, pins).items():
                data["bias"].setdefault(str(pin), {})[mode] = level
            yield
        for a in pins:
            row = data["pairs"][str(a)] = {}
            for mode in ("up", "down"):
                self._set({pin: OPPOSITE[mode] for pin in pins})  # precharge through each pin's own pull
                self._sleep(cfg.settle_s)
                self._set({**{pin: "off" for pin in pins}, a: mode})  # float all but A
                row[mode] = {str(pin): level for pin, level in self._read(cfg, pins).items()}
                yield

    def _open(self, pins, data):
        """Requests the lines with pull-up. If the kernel refuses the request, finds the lines that
        refuse, skips and reports them, and requests the rest."""
        if not pins:
            return pins
        try:
            self._set({pin: "up" for pin in pins})
            return pins
        except OSError:
            pass
        usable = []
        for pin in pins:
            try:
                req = self._request({pin: "up"})
            except OSError as exc:
                reason = f"cannot request line: {exc}"
                data["skipped"].append({"bcm": pin, "reason": reason})
                self._error(f"GPIO{pin}: {reason}")
            else:
                self._give_back(req, {pin: self._found[pin]})
                usable.append(pin)
        if usable:
            self._set({pin: "up" for pin in usable})
        return usable

    def _read(self, cfg, pins):
        self._sleep(cfg.settle_s)
        values = self._req.get_values(pins)
        return {pin: int(value == self._active) for pin, value in zip(pins, values)}

    def _config(self, pulls):
        """libgpiod's line config for {pin: "up" | "down" | "off"}: every line an input, with one
        of the three biases. Nothing else in this file builds a LineSettings."""
        groups = {}
        for pin, mode in pulls.items():
            groups.setdefault(mode, []).append(pin)
        line = self._g.line
        return {
            tuple(group): self._g.LineSettings(direction=line.Direction.INPUT, bias=getattr(line.Bias, BIAS[mode]))
            for mode, group in groups.items()
        }

    def _request(self, pulls):
        return self._g.request_lines(self._path, consumer=CONSUMER, config=self._config(pulls))

    def _set(self, pulls):
        """Applies a bias to every held line. `pulls` always names all of them: a line left out of a
        reconfigure would get libgpiod's default settings, which keep the direction and bias as is."""
        if self._req is None:
            self._req = self._request(pulls)
            self._restore = {pin: self._found[pin] for pin in pulls}
        else:
            self._req.reconfigure_lines(self._config(pulls))

    def _release(self):
        req, self._req = self._req, None
        if req is not None:
            try:
                self._give_back(req, self._restore)
            except Exception:
                log.exception("Restoring or releasing GPIO lines failed")

    def _give_back(self, req, pulls):
        """Puts each line back to its bias from before the sweep, then releases the request, which
        would otherwise keep the last bias applied. The lines are released even if the restore fails."""
        try:
            req.reconfigure_lines(self._config(pulls))
        finally:
            req.release()

    def _error(self, message):
        """Queues an error event, once per message until the next start or resume."""
        if message not in self._reported:
            self._reported.add(message)
            self._out.append({"type": "sense_event", "data": {"kind": "error", "message": message}})

    async def _flush(self):
        out, self._out = self._out, []
        for msg in out:
            await self._send(msg)
