#!/usr/bin/env python3
"""System information reader for Raspberry Pi."""

import os
import socket


def _read_file(path: str, default: str = "") -> str:
    try:
        with open(path, "r") as f:
            return f.read().strip("\x00").strip()
    except (FileNotFoundError, PermissionError):
        return default


def _get_cpu_temp() -> float | None:
    raw = _read_file("/sys/class/thermal/thermal_zone0/temp")
    if raw:
        try:
            return round(int(raw) / 1000.0, 1)
        except ValueError:
            pass
    return None


def _get_memory() -> dict:
    info = {}
    raw = _read_file("/proc/meminfo")
    if not raw:
        return info
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            key = parts[0].rstrip(":")
            try:
                val_kb = int(parts[1])
            except ValueError:
                continue
            if key == "MemTotal":
                info["total_mb"] = round(val_kb / 1024, 1)
            elif key == "MemAvailable":
                info["available_mb"] = round(val_kb / 1024, 1)
    if "total_mb" in info and "available_mb" in info:
        used = info["total_mb"] - info["available_mb"]
        info["used_mb"] = round(used, 1)
        info["percent"] = round((used / info["total_mb"]) * 100, 1)
    return info


def _get_uptime() -> str:
    raw = _read_file("/proc/uptime")
    if not raw:
        return "unknown"
    try:
        seconds = int(float(raw.split()[0]))
    except (ValueError, IndexError):
        return "unknown"
    days, remainder = divmod(seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, _ = divmod(remainder, 60)
    parts = []
    if days > 0:
        parts.append(f"{days}d")
    if hours > 0:
        parts.append(f"{hours}h")
    parts.append(f"{minutes}m")
    return " ".join(parts)


def _get_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        return "unknown"


def _get_disk() -> dict:
    try:
        st = os.statvfs("/")
        total = st.f_frsize * st.f_blocks
        free = st.f_frsize * st.f_bavail
        used = total - free
        return {
            "total_gb": round(total / (1024 ** 3), 1),
            "used_gb": round(used / (1024 ** 3), 1),
            "free_gb": round(free / (1024 ** 3), 1),
            "percent": round((used / total) * 100, 1) if total > 0 else 0,
        }
    except Exception:
        return {}


def get_info() -> dict:
    """Collect system information from the Raspberry Pi."""
    return {
        "cpu_temp": _get_cpu_temp(),
        "memory": _get_memory(),
        "uptime": _get_uptime(),
        "model": _read_file("/sys/firmware/devicetree/base/model", "Unknown"),
        "hostname": socket.gethostname(),
        "ip": _get_ip(),
        "disk": _get_disk(),
    }
