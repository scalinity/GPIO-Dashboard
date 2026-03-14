#!/usr/bin/env python3
"""Code executor - runs Python scripts and streams output over WebSocket."""

import asyncio
import logging
import os
import signal

log = logging.getLogger("code_executor")

WORK_DIR = "/tmp/gpio_dashboard"


class CodeExecutor:
    """Runs a Python script as a subprocess and streams its output."""

    def __init__(self):
        self._process: asyncio.subprocess.Process | None = None
        self._pgid: int | None = None

    async def execute(self, file_path: str):
        """Run a Python script and yield output messages.

        Yields dicts like:
            {"type": "output", "stream": "stdout", "data": "..."}
            {"type": "output", "stream": "stderr", "data": "..."}
            {"type": "execution_complete", "exit_code": 0}
        """
        os.makedirs(WORK_DIR, exist_ok=True)

        # Kill any previously running process
        await self.stop()

        try:
            self._process = await asyncio.create_subprocess_exec(
                "python3", file_path,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
                cwd=WORK_DIR,
            )
            try:
                self._pgid = os.getpgid(self._process.pid)
            except ProcessLookupError:
                pass
            log.info("Started process PID=%d PGID=%d: %s", self._process.pid, self._pgid, file_path)
        except Exception as e:
            yield {"type": "output", "stream": "stderr", "data": f"Failed to start: {e}"}
            yield {"type": "execution_complete", "exit_code": -1}
            return

        async def read_stream(stream, name):
            while True:
                line = await stream.readline()
                if not line:
                    break
                yield {"type": "output", "stream": name, "data": line.decode("utf-8", errors="replace").rstrip("\n")}

        stdout_lines = read_stream(self._process.stdout, "stdout")
        stderr_lines = read_stream(self._process.stderr, "stderr")

        # Merge stdout and stderr using tasks
        stdout_queue = asyncio.Queue()
        stderr_queue = asyncio.Queue()

        async def drain(gen, queue):
            async for item in gen:
                await queue.put(item)
            await queue.put(None)

        stdout_task = asyncio.create_task(drain(stdout_lines, stdout_queue))
        stderr_task = asyncio.create_task(drain(stderr_lines, stderr_queue))

        queues = [stdout_queue, stderr_queue]

        async def next_from(q):
            return await q.get()

        pending_tasks = {asyncio.create_task(next_from(q)): q for q in queues}

        while pending_tasks:
            done, _ = await asyncio.wait(pending_tasks.keys(), return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                q = pending_tasks.pop(task)
                result = task.result()
                if result is None:
                    pass
                else:
                    yield result
                    pending_tasks[asyncio.create_task(next_from(q))] = q

        await stdout_task
        await stderr_task

        exit_code = await self._process.wait()
        self._process = None
        self._pgid = None
        log.info("Process exited with code %d", exit_code)
        yield {"type": "execution_complete", "exit_code": exit_code}

    async def stop(self):
        """Stop the currently running process by sending SIGINT to its process group."""
        if self._process is None:
            return

        if self._process.returncode is not None:
            self._process = None
            self._pgid = None
            return

        try:
            if self._pgid is not None:
                log.info("Sending SIGINT to process group %d", self._pgid)
                os.killpg(self._pgid, signal.SIGINT)
                try:
                    await asyncio.wait_for(self._process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    log.warning("Process did not exit after SIGINT, sending SIGKILL")
                    os.killpg(self._pgid, signal.SIGKILL)
                    await self._process.wait()
        except ProcessLookupError:
            pass
        except Exception:
            log.exception("Error stopping process")
        finally:
            self._process = None
            self._pgid = None
