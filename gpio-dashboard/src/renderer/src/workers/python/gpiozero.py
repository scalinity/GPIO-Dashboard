"""A gpiozero subset for the simulator (SPEC 13.2): LED, PWMLED, Button, Buzzer, TonalBuzzer.

Background blinking and beeping run as PWM, since the simulator has no threads: on for on_time,
off for off_time, repeating, which is what gpiozero's background thread produces when n is None.
"""
import time

import _sim
from pyodide.ffi import create_proxy


def _pin(pin):
    if isinstance(pin, str):
        if pin.upper().startswith("GPIO"):
            return int(pin[4:])
        if pin.upper().startswith("BOARD"):
            return _sim.board_to_bcm(int(pin[5:]))
        return int(pin)
    return pin


class _Output:
    def __init__(self, pin, active_high=True, initial_value=False):
        self.pin = _pin(pin)
        self.active_high = active_high
        self._value = bool(initial_value)
        _sim.setup(self.pin, "out", "off", self._value == active_high)

    def _drive(self, on):
        self._value = bool(on)
        _sim.output(self.pin, self._value == self.active_high)

    def on(self):
        self._drive(True)

    def off(self):
        self._drive(False)

    def toggle(self):
        self._drive(not self._value)

    @property
    def value(self):
        return int(self._value)

    @value.setter
    def value(self, v):
        self._drive(v)

    @property
    def is_active(self):
        return self._value

    def _repeat(self, on_time, off_time, n, background):
        if background and n is None:
            duty = on_time / (on_time + off_time)
            _sim.pwm(self.pin, 1 / (on_time + off_time), duty if self.active_high else 1 - duty)
            self._value = True
            return
        count = 0
        while n is None or count < n:
            self.on()
            time.sleep(on_time)
            self.off()
            time.sleep(off_time)
            count += 1

    def close(self):
        self.off()
        _sim.cleanup(self.pin)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class LED(_Output):
    def blink(self, on_time=1, off_time=1, n=None, background=True):
        self._repeat(on_time, off_time, n, background)

    @property
    def is_lit(self):
        return self.is_active


class Buzzer(_Output):
    def beep(self, on_time=1, off_time=1, n=None, background=True):
        self._repeat(on_time, off_time, n, background)


class PWMLED:
    def __init__(self, pin, active_high=True, initial_value=0, frequency=100):
        self.pin = _pin(pin)
        self.active_high = active_high
        self.frequency = frequency
        _sim.setup(self.pin, "out", "off", False)
        self.value = initial_value

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        if not 0 <= v <= 1:
            raise ValueError("PWMLED value must be between 0 and 1")
        self._value = v
        _sim.pwm(self.pin, self.frequency, v if self.active_high else 1 - v)

    def on(self):
        self.value = 1

    def off(self):
        self.value = 0

    def toggle(self):
        self.value = 1 - self._value

    @property
    def is_lit(self):
        return self._value > 0

    def close(self):
        self.off()
        _sim.cleanup(self.pin)


class TonalBuzzer:
    def __init__(self, pin, initial_value=None):
        self.pin = _pin(pin)
        _sim.setup(self.pin, "out", "off", False)
        self.value = None
        if initial_value is not None:
            self.play(initial_value)

    def play(self, tone):
        frequency = tone if isinstance(tone, (int, float)) else _note(tone)
        self.value = frequency
        _sim.pwm(self.pin, frequency, 0.5)

    def stop(self):
        self.value = None
        _sim.pwm_stop(self.pin)

    def close(self):
        self.stop()
        _sim.cleanup(self.pin)


_NOTES = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}


def _note(name):
    """'A4' is 440 Hz; sharps ('#') and flats ('b') shift a semitone."""
    letter, rest = name[0].upper(), name[1:]
    shift = 1 if rest.startswith("#") else -1 if rest.startswith("b") else 0
    octave = int(rest.lstrip("#b"))
    return 440 * 2 ** ((_NOTES[letter] + shift + 12 * (octave - 4)) / 12)


class Button:
    def __init__(self, pin, pull_up=True, active_state=None, bounce_time=None):
        self.pin = _pin(pin)
        pull = "up" if pull_up is True else "down" if pull_up is False else "off"
        if pull_up is None and active_state is None:
            raise ValueError("active_state must be set when pull_up is None")
        self._active_high = active_state if pull_up is None else not pull_up
        _sim.setup(self.pin, "in", pull, False)
        self._pressed_cb = None
        self._released_cb = None
        _sim.watch(self.pin, "both", create_proxy(self._edge))

    def _edge(self, _):
        if self.is_pressed:
            if self._pressed_cb:
                self._pressed_cb()
        elif self._released_cb:
            self._released_cb()

    @property
    def is_pressed(self):
        return bool(_sim.input(self.pin)) == self._active_high

    @property
    def value(self):
        return int(self.is_pressed)

    def wait_for_press(self, timeout=None):
        return self._wait(True, timeout)

    def wait_for_release(self, timeout=None):
        return self._wait(False, timeout)

    def _wait(self, pressed, timeout):
        start = time.time()
        while self.is_pressed != pressed:
            if timeout is not None and time.time() - start >= timeout:
                return False
            time.sleep(0.001)
        return True

    when_pressed = property(lambda self: self._pressed_cb, lambda self, f: setattr(self, "_pressed_cb", f))
    when_released = property(lambda self: self._released_cb, lambda self, f: setattr(self, "_released_cb", f))

    def close(self):
        _sim.unwatch(self.pin)
        _sim.cleanup(self.pin)
