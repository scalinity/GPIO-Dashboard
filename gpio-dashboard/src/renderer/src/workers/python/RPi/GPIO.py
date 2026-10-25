"""RPi.GPIO for the simulator (SPEC 13.2): the same names and behaviour, on the simulated circuit."""
import _sim
from pyodide.ffi import create_proxy

VERSION = "0.7.1 (simulated)"
BCM = 11
BOARD = 10
OUT = 0
IN = 1
LOW = 0
HIGH = 1
PUD_OFF = 20
PUD_DOWN = 21
PUD_UP = 22
RISING = 31
FALLING = 32
BOTH = 33

_EDGES = {RISING: "rising", FALLING: "falling", BOTH: "both"}
_PULLS = {PUD_UP: "up", PUD_DOWN: "down", PUD_OFF: "off"}
_mode = None
_watched = {}


def setmode(mode):
    global _mode
    if mode not in (BCM, BOARD):
        raise ValueError("An invalid mode was passed to setmode()")
    _mode = mode


def getmode():
    return _mode


def setwarnings(flag):
    pass


def _bcm(channel):
    if _mode is None:
        raise RuntimeError(
            "Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)"
        )
    if _mode == BOARD:
        bcm = _sim.board_to_bcm(channel)
        if bcm is None:
            raise ValueError("The channel sent is invalid on a Raspberry Pi")
        return bcm
    if not isinstance(channel, int) or not 0 <= channel <= 27:
        raise ValueError("The channel sent is invalid on a Raspberry Pi")
    return channel


def _list(value):
    return list(value) if isinstance(value, (list, tuple)) else [value]


def setup(channel, direction, pull_up_down=PUD_OFF, initial=-1):
    for ch in _list(channel):
        if direction == OUT:
            _sim.setup(_bcm(ch), "out", "off", initial == HIGH)
        elif direction == IN:
            _sim.setup(_bcm(ch), "in", _PULLS.get(pull_up_down, "off"), False)
        else:
            raise ValueError("An invalid direction was passed to setup()")


def output(channel, value):
    channels = _list(channel)
    values = _list(value) if isinstance(value, (list, tuple)) else [value] * len(channels)
    if len(values) != len(channels):
        raise RuntimeError("Number of channels != number of values")
    for ch, v in zip(channels, values):
        _sim.output(_bcm(ch), bool(v))


def input(channel):
    return HIGH if _sim.input(_bcm(channel)) else LOW


def add_event_detect(channel, edge, callback=None, bouncetime=None):
    bcm = _bcm(channel)
    _watched[bcm] = [callback] if callback else []

    def fire(_):
        for cb in list(_watched.get(bcm, [])):
            cb(channel)

    _sim.watch(bcm, _EDGES[edge], create_proxy(fire))


def add_event_callback(channel, callback):
    bcm = _bcm(channel)
    if bcm not in _watched:
        raise RuntimeError("Add event detection using add_event_detect first before adding a callback")
    _watched[bcm].append(callback)


def remove_event_detect(channel):
    bcm = _bcm(channel)
    _watched.pop(bcm, None)
    _sim.unwatch(bcm)


def event_detected(channel):
    return bool(_sim.event_detected(_bcm(channel)))


def wait_for_edge(channel, edge, bouncetime=None, timeout=None):
    seconds = None if timeout is None else timeout / 1000
    return channel if _sim.wait_for_edge(_bcm(channel), _EDGES[edge], seconds) else None


def cleanup(channel=None):
    if channel is None:
        _watched.clear()
        _sim.cleanup(None)
    else:
        for ch in _list(channel):
            _watched.pop(_bcm(ch), None)
            _sim.cleanup(_bcm(ch))


class PWM:
    def __init__(self, channel, frequency):
        if frequency <= 0.0:
            raise ValueError("frequency must be greater than 0.0")
        self._bcm = _bcm(channel)
        self._frequency = frequency
        self._duty = 0.0
        self._running = False

    def start(self, dutycycle):
        self._check(dutycycle)
        self._duty = dutycycle
        self._running = True
        _sim.pwm(self._bcm, self._frequency, dutycycle / 100)

    def ChangeDutyCycle(self, dutycycle):
        self._check(dutycycle)
        self._duty = dutycycle
        if self._running:
            _sim.pwm(self._bcm, self._frequency, dutycycle / 100)

    def ChangeFrequency(self, frequency):
        if frequency <= 0.0:
            raise ValueError("frequency must be greater than 0.0")
        self._frequency = frequency
        if self._running:
            _sim.pwm(self._bcm, frequency, self._duty / 100)

    def stop(self):
        self._running = False
        _sim.pwm_stop(self._bcm)

    @staticmethod
    def _check(dutycycle):
        if not 0.0 <= dutycycle <= 100.0:
            raise ValueError("dutycycle must have a value from 0.0 to 100.0")
