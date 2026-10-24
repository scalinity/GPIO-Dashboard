"""Runs before the user's code: time follows the simulator's clock (ADR-0017)."""
import time

import _sim

_EPOCH = time.time()


def _sleep(seconds):
    if seconds < 0:
        raise ValueError("sleep length must be non-negative")
    _sim.sleep(seconds)


time.sleep = _sleep
time.time = lambda: _EPOCH + _sim.now()
time.monotonic = _sim.now
time.perf_counter = _sim.now
