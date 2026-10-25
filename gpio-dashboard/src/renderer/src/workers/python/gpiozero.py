"""A gpiozero subset for the simulator (SPEC 13.2): the devices core/code/pins.ts reads.

Outputs: OutputDevice, DigitalOutputDevice, LED, Buzzer, PWMOutputDevice, PWMLED, RGBLED,
TonalBuzzer, Servo, AngularServo. Inputs: InputDevice, DigitalInputDevice, Button, MotionSensor,
LineSensor, DistanceSensor.

There are no threads here. Background blinking and beeping run as PWM, since a pin that toggles
by itself is what gpiozero's thread produces when n is None: on for on_time, off for off_time,
repeating. A device whose events a thread polls (DistanceSensor's range events) adds a poller that
a sleep runs; the others take their events from the simulator's edge detection, which runs a
callback from the next shim call or sleep that sees the edge. Not modelled: fades (PWMLED.pulse,
RGBLED.blink and pulse), Button.when_held, and the smoothing queues of the sensors.
"""
import inspect
import time
import warnings

import _prelude
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


def _call(callback, device):
    """gpiozero passes the device to a callback that takes an argument, and nothing to one that does not."""
    if callback is None:
        return
    try:
        takes_device = len(inspect.signature(callback).parameters) > 0
    except (TypeError, ValueError):
        takes_device = False
    callback(device) if takes_device else callback()


# --- Outputs ---


class OutputDevice:
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

    def close(self):
        self.off()
        _sim.cleanup(self.pin)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class DigitalOutputDevice(OutputDevice):
    def blink(self, on_time=1, off_time=1, n=None, background=True):
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


class LED(DigitalOutputDevice):
    @property
    def is_lit(self):
        return self.is_active


class Buzzer(DigitalOutputDevice):
    beep = DigitalOutputDevice.blink


class PWMOutputDevice:
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
            raise ValueError("PWM value must be between 0 and 1")
        self._value = v
        _sim.pwm(self.pin, self.frequency, v if self.active_high else 1 - v)

    def on(self):
        self.value = 1

    def off(self):
        self.value = 0

    def toggle(self):
        self.value = 1 - self._value

    @property
    def is_active(self):
        return self._value > 0

    def close(self):
        self.off()
        _sim.cleanup(self.pin)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class PWMLED(PWMOutputDevice):
    @property
    def is_lit(self):
        return self.is_active


def _rgb_channel(index):
    def get(self):
        return self._channels[index].value

    def set_(self, v):
        self._channels[index].value = v if self.pwm else int(v)

    return property(get, set_)


class RGBLED:
    def __init__(self, red, green, blue, active_high=True, initial_value=(0, 0, 0), pwm=True):
        channel = PWMLED if pwm else LED
        self._channels = tuple(channel(pin, active_high=active_high) for pin in (red, green, blue))
        self.pwm = pwm
        self.value = initial_value

    @property
    def value(self):
        return tuple(c.value for c in self._channels)

    @value.setter
    def value(self, colour):
        if len(colour) != 3 or not all(0 <= v <= 1 for v in colour):
            raise ValueError("RGBLED value must be a tuple of three numbers from 0 to 1")
        for c, v in zip(self._channels, colour):
            c.value = v if self.pwm else int(v)

    color = value
    red = _rgb_channel(0)
    green = _rgb_channel(1)
    blue = _rgb_channel(2)

    @property
    def is_lit(self):
        return any(self.value)

    @property
    def is_active(self):
        return self.is_lit

    def on(self):
        self.value = (1, 1, 1)

    def off(self):
        self.value = (0, 0, 0)

    def toggle(self):
        self.value = tuple(1 - v for v in self.value)

    def close(self):
        for c in self._channels:
            c.close()


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


class Servo:
    """A hobby servo on a PWM pin: a pulse of min_pulse_width to max_pulse_width every frame_width."""

    def __init__(
        self,
        pin,
        initial_value=0,
        min_pulse_width=1 / 1000,
        max_pulse_width=2 / 1000,
        frame_width=20 / 1000,
    ):
        if min_pulse_width >= max_pulse_width:
            raise ValueError("max_pulse_width must be greater than min_pulse_width")
        if max_pulse_width >= frame_width:
            raise ValueError("frame_width must be greater than max_pulse_width")
        self.pin = _pin(pin)
        self._min_pulse = min_pulse_width
        self._pulse_range = max_pulse_width - min_pulse_width
        self._frame = frame_width
        self._value = None
        _sim.setup(self.pin, "out", "off", False)
        self.value = initial_value

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        if v is None:
            _sim.pwm_stop(self.pin)
        elif -1 <= v <= 1:
            pulse = self._min_pulse + (v + 1) / 2 * self._pulse_range
            _sim.pwm(self.pin, 1 / self._frame, pulse / self._frame)
        else:
            raise ValueError("Servo value must be between -1 and 1, or None")
        self._value = v

    @property
    def pulse_width(self):
        if self._value is None:
            return None
        return self._min_pulse + (self._value + 1) / 2 * self._pulse_range

    @property
    def is_active(self):
        return self._value is not None

    def min(self):
        self.value = -1

    def mid(self):
        self.value = 0

    def max(self):
        self.value = 1

    def detach(self):
        self.value = None

    def close(self):
        self.detach()
        _sim.cleanup(self.pin)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class AngularServo(Servo):
    def __init__(
        self,
        pin,
        initial_angle=0,
        min_angle=-90,
        max_angle=90,
        min_pulse_width=1 / 1000,
        max_pulse_width=2 / 1000,
        frame_width=20 / 1000,
    ):
        self._min_angle = min_angle
        self._angle_range = max_angle - min_angle
        if self._angle_range == 0:
            raise ValueError("max_angle must differ from min_angle")
        self._max_angle = max_angle
        super().__init__(
            pin,
            self._to_value(initial_angle),
            min_pulse_width,
            max_pulse_width,
            frame_width,
        )

    def _to_value(self, angle):
        if angle is None:
            return None
        low, high = sorted((self._min_angle, self._max_angle))
        if not low <= angle <= high:
            raise ValueError(f"AngularServo angle must be between {self._min_angle} and {self._max_angle}, or None")
        return 2 * ((angle - self._min_angle) / self._angle_range) - 1

    @property
    def angle(self):
        if self._value is None:
            return None
        return self._min_angle + (self._value + 1) / 2 * self._angle_range

    @angle.setter
    def angle(self, angle):
        self.value = self._to_value(angle)


# --- Inputs ---


class InputDevice:
    def __init__(self, pin, pull_up=False, active_state=None):
        if pull_up is None and active_state is None:
            raise ValueError("active_state must be set when pull_up is None")
        self.pin = _pin(pin)
        self.pull_up = pull_up
        self._active_high = active_state if pull_up is None else not pull_up
        pull = "up" if pull_up is True else "down" if pull_up is False else "off"
        _sim.setup(self.pin, "in", pull, False)

    @property
    def is_active(self):
        return bool(_sim.input(self.pin)) == self._active_high

    @property
    def value(self):
        return int(self.is_active)

    def close(self):
        _sim.cleanup(self.pin)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class DigitalInputDevice(InputDevice):
    def __init__(self, pin, pull_up=False, active_state=None, bounce_time=None):
        super().__init__(pin, pull_up, active_state)
        self._activated_cb = None
        self._deactivated_cb = None
        _sim.watch(self.pin, "both", create_proxy(self._edge))

    def _edge(self, _):
        if self.is_active:
            _call(self._activated_cb, self)
        else:
            _call(self._deactivated_cb, self)

    when_activated = property(
        lambda self: self._activated_cb, lambda self, f: setattr(self, "_activated_cb", f)
    )
    when_deactivated = property(
        lambda self: self._deactivated_cb, lambda self, f: setattr(self, "_deactivated_cb", f)
    )

    def wait_for_active(self, timeout=None):
        return self._wait(True, timeout)

    def wait_for_inactive(self, timeout=None):
        return self._wait(False, timeout)

    def _wait(self, active, timeout):
        start = time.time()
        while self.is_active != active:
            if timeout is not None and time.time() - start >= timeout:
                return False
            time.sleep(0.001)
        return True

    def close(self):
        _sim.unwatch(self.pin)
        super().close()


class Button(DigitalInputDevice):
    def __init__(self, pin, pull_up=True, active_state=None, bounce_time=None, hold_time=1, hold_repeat=False):
        super().__init__(pin, pull_up, active_state, bounce_time)

    is_pressed = DigitalInputDevice.is_active
    when_pressed = DigitalInputDevice.when_activated
    when_released = DigitalInputDevice.when_deactivated
    wait_for_press = DigitalInputDevice.wait_for_active
    wait_for_release = DigitalInputDevice.wait_for_inactive


class MotionSensor(DigitalInputDevice):
    def __init__(self, pin, pull_up=False, active_state=None, queue_len=1, sample_rate=10, threshold=0.5, partial=False):
        super().__init__(pin, pull_up, active_state)

    motion_detected = DigitalInputDevice.is_active
    when_motion = DigitalInputDevice.when_activated
    when_no_motion = DigitalInputDevice.when_deactivated
    wait_for_motion = DigitalInputDevice.wait_for_active
    wait_for_no_motion = DigitalInputDevice.wait_for_inactive


class LineSensor(DigitalInputDevice):
    def __init__(self, pin, pull_up=False, active_state=None, queue_len=5, sample_rate=100, threshold=0.5, partial=False):
        super().__init__(pin, pull_up, active_state)

    line_detected = property(lambda self: not self.is_active)
    when_line = DigitalInputDevice.when_deactivated
    when_no_line = DigitalInputDevice.when_activated
    wait_for_line = DigitalInputDevice.wait_for_inactive
    wait_for_no_line = DigitalInputDevice.wait_for_active


class DistanceSensorNoEcho(Warning):
    pass


# The module answers in well under 1 ms and holds ECHO for at most 38 ms (SPEC 9, HC-SR04).
_ECHO_WAIT_S = 0.05
# gpiozero reads a distance sensor every 0.06 s, which is also the module's shortest cycle.
_SAMPLE_WAIT_S = 0.06


class DistanceSensor:
    """An HC-SR04: a 10 us pulse on trigger, then the time echo stays high is the distance."""

    speed_of_sound = 343.26

    def __init__(self, echo, trigger, queue_len=9, max_distance=1, threshold_distance=0.3, partial=False):
        if max_distance <= 0:
            raise ValueError("invalid maximum distance (must be positive)")
        self.echo = _pin(echo)
        self.trigger = _pin(trigger)
        self._max_distance = max_distance
        self.threshold_distance = threshold_distance
        self._reading = None
        self._read_at = None
        self._active = None
        self._in_range_cb = None
        self._out_of_range_cb = None
        self._poller = None
        _sim.setup(self.trigger, "out", "off", False)
        _sim.setup(self.echo, "in", "down", False)

    def _measure(self):
        """One reading in metres, timed in virtual time call by call, as the module's datasheet describes."""
        _sim.output(self.trigger, True)
        _sim.sleep(10e-6)
        _sim.output(self.trigger, False)
        waited = _sim.now()
        while not _sim.input(self.echo):
            if _sim.now() - waited > _ECHO_WAIT_S:
                warnings.warn("no echo received, check the wiring", DistanceSensorNoEcho)
                return self._max_distance
        rise = _sim.now()
        while _sim.input(self.echo):
            if _sim.now() - rise > _ECHO_WAIT_S:
                return self._max_distance
        return min((_sim.now() - rise) * self.speed_of_sound / 2, self._max_distance)

    @property
    def distance(self):
        """The distance in metres, from the latest reading (a new one at most every 0.06 s)."""
        if self._read_at is None or _sim.now() - self._read_at >= _SAMPLE_WAIT_S:
            self._read_at = _sim.now()
            self._reading = self._measure()
        return self._reading

    @property
    def value(self):
        return self.distance / self._max_distance

    @property
    def max_distance(self):
        return self._max_distance

    @max_distance.setter
    def max_distance(self, v):
        if v <= 0:
            raise ValueError("invalid maximum distance (must be positive)")
        self._max_distance = v

    @property
    def is_active(self):
        """True when the object is farther than threshold_distance (gpiozero's out of range)."""
        return self.distance > self.threshold_distance

    @property
    def in_range(self):
        return not self.is_active

    def _poll(self):
        active = self.is_active
        previous, self._active = self._active, active
        # The first reading only sets the state: there is no edge to run a callback for.
        if previous is None or previous == active:
            return
        _call(self._out_of_range_cb if active else self._in_range_cb, self)

    def _watch(self):
        wanted = self._in_range_cb is not None or self._out_of_range_cb is not None
        if wanted and self._poller is None:
            self._poller = _prelude.add_poller(_SAMPLE_WAIT_S, self._poll)
        elif not wanted and self._poller is not None:
            _prelude.remove_poller(self._poller)
            self._poller = None

    def _set_callback(self, name, f):
        setattr(self, name, f)
        self._watch()

    when_in_range = property(
        lambda self: self._in_range_cb, lambda self, f: self._set_callback("_in_range_cb", f)
    )
    when_out_of_range = property(
        lambda self: self._out_of_range_cb, lambda self, f: self._set_callback("_out_of_range_cb", f)
    )

    def wait_for_in_range(self, timeout=None):
        return self._wait(False, timeout)

    def wait_for_out_of_range(self, timeout=None):
        return self._wait(True, timeout)

    def _wait(self, active, timeout):
        start = time.time()
        while self.is_active != active:
            if timeout is not None and time.time() - start >= timeout:
                return False
            time.sleep(_SAMPLE_WAIT_S)
        return True

    def close(self):
        if self._poller is not None:
            _prelude.remove_poller(self._poller)
            self._poller = None
        _sim.cleanup(self.trigger)
        _sim.cleanup(self.echo)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
