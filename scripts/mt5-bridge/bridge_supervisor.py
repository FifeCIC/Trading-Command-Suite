#!/usr/bin/env python
"""
bridge_supervisor.py — keep ONE MT5 bridge alive (#866 acceptance 2).

WHY THIS EXISTS
===============
The bridge can now EXIT itself when a request wedges its mt5 lock for too long
(`http_wedge_monitor` in `mt5_bridge_v2.py` — a blocked native call cannot be
interrupted, so `os._exit` is the only way to free it). But an exit with nothing to
restart it trades "silently wedged" for "down" — this supervisor is the other half:
it relaunches the bridge when it dies, so the WEDGE class becomes self-healing.

CONTRACT WITH THE LAUNCHER (scripts/tcs-launch.ps1 / tcs-stop.ps1)
==================================================================
- tcs-launch starts THIS script instead of the bridge, and deletes stop-sentinels first.
- tcs-stop writes `logs/mt5-bridge/supervisor-<port>.stop` BEFORE killing processes.
  The supervisor checks the sentinel before every (re)launch, so a deliberate stop is
  never resurrected. No sentinel → a dead bridge is an accident, and accidents restart.

⚠️ SCOPE, STATED HONESTLY: this supervises ONE bridge process on THIS machine and can
only ever re-launch its own child — it cannot touch a sibling bridge, POST /reconnect,
or bind an account. That containment is deliberate: the reconnect blast-radius questions
(#1035, #1036, #1046) live OUTSIDE this file and are not answered by it.

Exit codes are passed through in the log; the child's wedge exit is 75.

Usage (the launcher sets BRIDGE_PORT / BRIDGE_ACCOUNT in the environment first):
    python bridge_supervisor.py
"""
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRIDGE = HERE / 'mt5_bridge_v2.py'
STOP_DIR = HERE.parent.parent / 'logs' / 'mt5-bridge'
RESTART_BACKOFF_S = 5
THRASH_WINDOW_S = 120          # restarts counted inside this window…
THRASH_MAX = 6                 # …and this many is treated as a crash loop, not an accident


def log(msg: str) -> None:
    stamp = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f'{stamp} [supervisor:{os.environ.get("BRIDGE_PORT", "?")}] {msg}'
    print(line, flush=True)
    try:
        STOP_DIR.mkdir(parents=True, exist_ok=True)
        path = STOP_DIR / f'supervisor-{os.environ.get("BRIDGE_PORT", "0")}.log'
        # #703 — cap this file. It is append-only across every launch and nothing pruned it;
        # the same class as the 436 MB stderr runaway. Keep the most recent 500 lines once
        # it passes 2 MB — events are sparse, so this trigger is rare and the rewrite cheap.
        if path.exists() and path.stat().st_size > 2_000_000:
            try:
                tail = path.read_text(encoding='utf-8', errors='replace').splitlines()[-500:]
                path.write_text('\n'.join(tail) + '\n', encoding='utf-8')
            except OSError:
                pass
        with open(path, 'a', encoding='utf-8') as fh:
            fh.write(line + '\n')
    except OSError:
        pass


def sentinel_path() -> Path:
    return STOP_DIR / f'supervisor-{os.environ.get("BRIDGE_PORT", "0")}.stop'


def main() -> int:
    port = os.environ.get('BRIDGE_PORT', '0')
    if sentinel_path().exists():
        # tcs-stop ran (or is running) — a deliberate stop. Nothing to supervise.
        log('stop sentinel present — not starting (deliberate stop)')
        return 0

    restarts: list[float] = []
    while True:
        log(f'launching bridge: {sys.executable} {BRIDGE}')
        started = time.time()
        try:
            proc = subprocess.Popen([sys.executable, str(BRIDGE)], cwd=str(HERE))
            code = proc.wait()
        except OSError as err:  # python missing, ACL, …— retrying forever would hide it
            log(f'CRITICAL: could not launch bridge: {err}')
            return 1

        ran_for = time.time() - started
        if sentinel_path().exists():
            log(f'bridge exited (code {code}) and the stop sentinel is present — supervisor exiting')
            return 0

        if code == 0 and ran_for > THRASH_WINDOW_S:
            # A long, clean run ending — treat as an external stop too (someone pressed
            # Ctrl-C on the child). Restarting here would fight an operator.
            log(f'bridge exited cleanly after {int(ran_for)}s — supervisor exiting (treat as stop)')
            return 0

        now = time.time()
        restarts = [t for t in restarts if now - t < THRASH_WINDOW_S]
        restarts.append(now)
        if len(restarts) > THRASH_MAX:
            log(f'CRITICAL: {len(restarts)} restarts in {THRASH_WINDOW_S}s — crash loop, giving up. '
                f'Last exit code {code}. The bridge log says why.')
            return 1

        wedge = ' (WEDGE EXIT)' if code == 75 else ''
        log(f'bridge died: code {code}{wedge}, ran {int(ran_for)}s — restarting in {RESTART_BACKOFF_S}s '
            f'(restart {len(restarts)}/{THRASH_MAX} in window)')
        time.sleep(RESTART_BACKOFF_S)


if __name__ == '__main__':
    sys.exit(main())
