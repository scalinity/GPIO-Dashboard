"""Runs before the user's code: time follows the simulator's clock (ADR-0017)."""
import signal
import time

import _sim

_EPOCH = time.time()

# gpiozero runs some of its devices from a background thread (a distance sensor's range events);
# there are no threads here. Such a device adds a poller, and a sleep runs it each period of
# virtual time, which is what the thread would have done meanwhile.
_pollers = []
_polling = False


def add_poller(period, poll):
    entry = [_sim.now() + period, period, poll]
    _pollers.append(entry)
    return entry


def remove_poller(entry):
    if entry in _pollers:
        _pollers.remove(entry)


def _sleep(seconds):
    global _polling
    if seconds < 0:
        raise ValueError("sleep length must be non-negative")
    if not _pollers or _polling:
        _sim.sleep(seconds)
        return
    end = _sim.now() + seconds
    while _pollers:
        entry = min(_pollers, key=lambda e: e[0])
        if entry[0] > end:
            break
        _sim.sleep(max(entry[0] - _sim.now(), 0))
        entry[0] += entry[1]
        _polling = True
        try:
            entry[2]()
        finally:
            _polling = False
    _sim.sleep(max(end - _sim.now(), 0))


# signal.pause() waits for a signal, and none arrives here, so Pyodide's returns at once and a
# program that sets callbacks and then pauses would end at t = 0. It waits in virtual time
# instead, for as long as the run lasts: Ctrl+C, Stop and the end of the run's time all arrive as
# KeyboardInterrupt, as they do on the Pi. The step is how soon after an input changes a
# callback runs.
_PAUSE_STEP_S = 0.01


def _pause():
    while True:
        _sleep(_PAUSE_STEP_S)


time.sleep = _sleep
time.time = lambda: _EPOCH + _sim.now()
time.monotonic = _sim.now
time.perf_counter = _sim.now
signal.pause = _pause
