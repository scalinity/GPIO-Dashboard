"""smbus for the simulator: transactions with the I2C devices on the circuit's bus 1 (SPEC 13.2).
A device that does not answer raises OSError 121, as Linux does."""
import _sim

# Linux's EREMOTEIO, which the Pi raises; Pyodide's own errno table (Emscripten) says 147.
_EREMOTEIO = 121


def _nack():
    return OSError(_EREMOTEIO, "Remote I/O error")


class SMBus:
    def __init__(self, bus=None):
        self.bus = bus
        if bus is not None and bus != 1:
            raise FileNotFoundError(2, f"No such file or directory: '/dev/i2c-{bus}'")

    def _write(self, addr, data):
        if not _sim.i2c_write(addr, list(data)):
            raise _nack()

    def _read(self, addr, count):
        data = _sim.i2c_read(addr, count)
        if data is None:
            raise _nack()
        return list(data)

    def write_quick(self, addr):
        self._write(addr, [])

    def write_byte(self, addr, value):
        self._write(addr, [value & 0xFF])

    def read_byte(self, addr):
        return self._read(addr, 1)[0]

    def write_byte_data(self, addr, register, value):
        self._write(addr, [register & 0xFF, value & 0xFF])

    def read_byte_data(self, addr, register):
        self._write(addr, [register & 0xFF])
        return self._read(addr, 1)[0]

    def write_word_data(self, addr, register, value):
        self._write(addr, [register & 0xFF, value & 0xFF, (value >> 8) & 0xFF])

    def read_word_data(self, addr, register):
        self._write(addr, [register & 0xFF])
        low, high = self._read(addr, 2)
        return low | (high << 8)

    def write_i2c_block_data(self, addr, register, data):
        self._write(addr, [register & 0xFF] + [d & 0xFF for d in data])

    def read_i2c_block_data(self, addr, register, length=32):
        self._write(addr, [register & 0xFF])
        return self._read(addr, length)

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
