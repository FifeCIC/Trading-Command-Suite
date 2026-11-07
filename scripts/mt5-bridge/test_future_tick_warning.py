#!/usr/bin/env python3
"""#1214 — warn_future_tick() fires ONCE per symbol per state, and re-arms on recovery.

The point of the once-per-symbol rule is #992: the offset probe logged the same line **4,325 times**
in one outage and never said what to do. A per-request warning on a symbol that may be probed every
few seconds would reproduce that exactly.

Run: py -3 scripts/mt5-bridge/test_future_tick_warning.py
"""
import importlib.util
import io
import logging
import sys
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def load_bridge():
    """Import the bridge module without starting its HTTP server."""
    buf = io.StringIO()
    with redirect_stdout(buf):
        spec = importlib.util.spec_from_file_location("mt5_bridge_v2", HERE / "mt5_bridge_v2.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    return mod


def iso(delta_seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_seconds)).isoformat().replace("+00:00", "Z")


class Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


def main():
    bridge = load_bridge()

    capture = Capture()
    bridge.logger.addHandler(capture)
    bridge.logger.setLevel(logging.WARNING)

    failures = 0

    def check(label, condition):
        nonlocal failures
        print(f"  {'[OK]  ' if condition else '[FAIL]'} {label}")
        if not condition:
            failures += 1

    bridge._FUTURE_TICK_WARNED.clear()

    # 1. The measured EURCAD shape: 10.7 days ahead -> one warning, naming the symbol and the remedy.
    bridge.warn_future_tick("EURCAD", iso(10.7 * 86400))
    check("a 10.7-day-ahead tick warns once", len(capture.lines) == 1)
    check("the line names the symbol", "EURCAD" in capture.lines[0])
    check("the line says the offset is NOT suspect", "NOT suspect" in capture.lines[0])
    check("the line names the remedy (the audit tool)", "audit-future-rows" in capture.lines[0])

    # 2. Still bad -> still ONE line (this is the #992 guard).
    for _ in range(50):
        bridge.warn_future_tick("EURCAD", iso(10.7 * 86400))
    check("50 more bad ticks add no lines", len(capture.lines) == 1)

    # 3. A different symbol is a different state.
    bridge.warn_future_tick("GBPUSD", iso(10.7 * 86400))
    check("a second symbol warns separately", len(capture.lines) == 2)

    # 4. Recovery re-arms, and a recurrence warns again.
    bridge.warn_future_tick("EURCAD", iso(-5))
    check("a good tick does not warn", len(capture.lines) == 2)
    bridge.warn_future_tick("EURCAD", iso(10.7 * 86400))
    check("a recurrence after recovery warns again", len(capture.lines) == 3)

    # 5. Inside tolerance must never warn (120s is the same tolerance the API uses).
    bridge._FUTURE_TICK_WARNED.clear()
    before = len(capture.lines)
    bridge.warn_future_tick("USDJPY", iso(100))
    check("100s ahead is inside tolerance -> silent", len(capture.lines) == before)

    # 6. Junk must not crash a quote response.
    bridge.warn_future_tick("USDJPY", "not-a-date")
    bridge.warn_future_tick("USDJPY", None)
    check("an unparseable or absent tick time is ignored, not raised", True)

    bridge.logger.removeHandler(capture)

    print()
    if failures:
        print(f"[FAIL] {failures} check(s) failed")
        return 1
    print("CANARY PASSED - the future-tick warning is bounded and re-arms")
    return 0


if __name__ == "__main__":
    sys.exit(main())
