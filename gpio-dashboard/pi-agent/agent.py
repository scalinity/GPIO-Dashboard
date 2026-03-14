#!/usr/bin/env python3
"""GPIO Dashboard Pi Agent - WebSocket server for GPIO monitoring and code execution."""

import asyncio
import json
import logging
import os
import signal
import sys

import websockets

from gpio_monitor import GpioMonitor
from code_executor import CodeExecutor
from system_info import get_info

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("agent")

GPIO_POLL_HZ = 10
SYSINFO_INTERVAL = 5

clients: dict[websockets.WebSocketServerProtocol, dict] = {}


async def broadcast_gpio(monitor: GpioMonitor):
    """Send GPIO state to all connected clients at ~10 Hz."""
    loop = asyncio.get_running_loop()
    while True:
        try:
            state = await loop.run_in_executor(None, monitor.read_all)
            msg = json.dumps({"type": "gpio_state", "pins": state})
            for ws, meta in list(clients.items()):
                try:
                    pins_filter = meta.get("subscribe")
                    if pins_filter is not None:
                        filtered = {k: v for k, v in state.items() if k in pins_filter}
                        await ws.send(json.dumps({"type": "gpio_state", "pins": filtered}))
                    else:
                        await ws.send(msg)
                except websockets.ConnectionClosed:
                    pass
        except Exception:
            log.exception("Error in GPIO broadcast")
        await asyncio.sleep(1 / GPIO_POLL_HZ)


async def broadcast_sysinfo():
    """Send system info to all connected clients every 5 seconds."""
    while True:
        try:
            info = get_info()
            msg = json.dumps({"type": "system_info", "data": info})
            for ws in list(clients):
                try:
                    await ws.send(msg)
                except websockets.ConnectionClosed:
                    pass
        except Exception:
            log.exception("Error in sysinfo broadcast")
        await asyncio.sleep(SYSINFO_INTERVAL)


async def handle_client(ws: websockets.WebSocketServerProtocol, monitor: GpioMonitor):
    """Handle a single WebSocket client connection."""
    clients[ws] = {}
    executor = CodeExecutor()
    remote = ws.remote_address
    log.info("Client connected: %s", remote)

    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send(json.dumps({"type": "error", "message": "Invalid JSON"}))
                continue

            msg_type = msg.get("type")

            if msg_type == "ping":
                await ws.send(json.dumps({"type": "pong"}))

            elif msg_type == "execute":
                filename = os.path.basename(msg.get("file", "script.py"))
                code = msg.get("code", "")
                work_dir = "/tmp/gpio_dashboard"
                os.makedirs(work_dir, exist_ok=True)
                file_path = os.path.join(work_dir, filename)
                with open(file_path, "w") as f:
                    f.write(code)
                log.info("Executing %s", file_path)
                async for output in executor.execute(file_path):
                    try:
                        await ws.send(json.dumps(output))
                    except websockets.ConnectionClosed:
                        await executor.stop()
                        return

            elif msg_type == "stop":
                await executor.stop()
                await ws.send(json.dumps({"type": "stopped"}))

            elif msg_type == "subscribe":
                pins = msg.get("pins")
                if pins is not None:
                    clients[ws]["subscribe"] = set(str(p) for p in pins)
                    log.info("Client %s subscribed to pins: %s", remote, pins)
                else:
                    clients[ws].pop("subscribe", None)
                    log.info("Client %s unsubscribed from pin filter", remote)

            else:
                await ws.send(json.dumps({"type": "error", "message": f"Unknown type: {msg_type}"}))

    except websockets.ConnectionClosed:
        pass
    finally:
        await executor.stop()
        clients.pop(ws, None)
        log.info("Client disconnected: %s", remote)


async def main():
    host = os.environ.get("AGENT_HOST", "0.0.0.0")
    port = int(os.environ.get("AGENT_PORT", "8765"))

    monitor = GpioMonitor()

    loop = asyncio.get_running_loop()
    stop_event = asyncio.Event()

    def _shutdown():
        log.info("Shutdown signal received")
        stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _shutdown)

    gpio_task = asyncio.create_task(broadcast_gpio(monitor))
    sysinfo_task = asyncio.create_task(broadcast_sysinfo())

    async with websockets.serve(
        lambda ws: handle_client(ws, monitor),
        host,
        port,
        ping_interval=20,
        ping_timeout=60,
    ):
        log.info("Agent listening on ws://%s:%d", host, port)
        await stop_event.wait()

    gpio_task.cancel()
    sysinfo_task.cancel()
    log.info("Agent stopped")


if __name__ == "__main__":
    asyncio.run(main())
