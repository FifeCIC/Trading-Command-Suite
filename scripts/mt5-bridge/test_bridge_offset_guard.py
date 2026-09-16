"""test_bridge_offset_guard.py — canary for the #845 offset-probe guards.

WHY A CANARY AND NOT A PLAIN UNIT TEST
--------------------------------------
`detect_server_utc_offset()` previously ran unconditionally and happily overwrote a
correct 10800s offset with a measured 9900s, because the tick it probed came from a
DISCONNECTED terminal and was therefore not fresh. The bug was not a wrong formula —
it was the ABSENCE of a guard. A test that only asserts the happy path would have
passed against the broken code.

So each guard is exercised in the direction that must FAIL, with a control:

  1. disconnected  -> retains the previous offset (and is not re-measured)
  2. stale tick    -> measurement rejected, previous offset retained
  3. fresh tick    -> measurement applied (the CONTROL — proves the guard is not
                      simply blocking everything, which would "pass" 1 and 2)

Guard 3 is the important one. Without it, a function that always returns the previous
value would pass this file completely while being useless.

`mt5` is stubbed: this runs with no terminal, no credentials and no network.

Run: python -m pytest scripts/mt5-bridge/test_bridge_offset_guard.py -q
  or: python scripts/mt5-bridge/test_bridge_offset_guard.py
"""
import importlib.util
import os
import sys
import time
import types

BRIDGE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mt5_bridge_v2.py')


class _Tick:
    def __init__(self, t):
        self.time = t


def _load_bridge(monkeypatch_env=None):
    """Import the bridge module with a stub `MetaTrader5` in sys.modules.

    The bridge does real work at import time (log handlers, `mt5` symbols), so the
    stub has to exist BEFORE the module is executed — hence the loader rather than a
    plain import.
    """
    if monkeypatch_env:
        os.environ.update(monkeypatch_env)

    stub = types.ModuleType('MetaTrader5')

    # Mutable knobs the tests drive.
    stub._connected = True
    stub._tick_time = None
    stub._tick_calls = []

    def terminal_info():
        return types.SimpleNamespace(connected=stub._connected)

    def account_info():
        return types.SimpleNamespace(login=1) if stub._connected else None

    def symbol_info_tick(symbol):
        stub._tick_calls.append(symbol)
        if stub._tick_time is None:
            return None
        return _Tick(stub._tick_time)

    stub.terminal_info = terminal_info
    stub.account_info = account_info
    stub.symbol_info_tick = symbol_info_tick
    stub.last_error = lambda: (0, 'ok')
    stub.initialize = lambda **kw: True
    # Attribute names the module references at import time.
    stub.TRADE_RETCODE_DONE = 10009
    stub.TRADE_RETCODE_DONE_PARTIAL = 10010
    stub.TIMEFRAME_M1 = 1
    stub.ORDER_TYPE_BUY = 0
    stub.ORDER_TYPE_SELL = 1
    stub.TRADE_ACTION_DEAL = 1
    stub.ORDER_TIME_GTC = 0
    stub.SYMBOL_TRADE_EXECUTION_INSTANT = 0

    sys.modules['MetaTrader5'] = stub

    spec = importlib.util.spec_from_file_location('mt5_bridge_v2_under_test', BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, stub


def _reset(module, offset=10800):
    module.SERVER_UTC_OFFSET_SECONDS = offset
    module._SERVER_OFFSET_MEASURED_AT = 0.0


def test_disconnected_retains_previous_offset():
    """GUARD 1 — a probe with no live feed must not overwrite a good offset."""
    module, stub = _load_bridge()
    _reset(module, 10800)
    stub._connected = False
    # If it DID probe, this stale tick would drag the offset to one step short.
    stub._tick_time = int(time.time()) + 9900

    got = module.detect_server_utc_offset(force=True)

    assert got == 10800, f'disconnected probe changed the offset to {got}'
    assert stub._tick_calls == [], (
        f'probe queried the broker while disconnected: {stub._tick_calls}'
    )
    assert module._SERVER_OFFSET_MEASURED_AT == 0.0, 'measurement timestamp advanced while disconnected'
    print('  ✅ guard 1: disconnected -> retains 10800s, does not even query a tick')


def test_stale_tick_is_rejected():
    """GUARD 2 — a tick older than half the rounding step is out of tolerance."""
    module, stub = _load_bridge()
    _reset(module, 10800)
    stub._connected = True
    # Tick age = 20 min, beyond the 450s tolerance budget of a 900s step.
    stub._tick_time = int(time.time()) + 10800 - 1200

    got = module.detect_server_utc_offset(force=True)

    assert got == 10800, f'stale tick was applied, offset became {got}'
    assert stub._tick_calls, 'probe did not attempt a measurement at all'
    print('  ✅ guard 2: tick 1200s stale -> measurement rejected, retains 10800s')


def test_fresh_tick_is_applied():
    """CONTROL for guards 1 and 2 — the probe must still WORK when it can.

    Without this, a function that always returned the previous offset would pass
    both guards above while being entirely useless. This is the direction that
    proves the guards discriminate rather than blanket-block.
    """
    module, stub = _load_bridge()
    _reset(module, 0)
    stub._connected = True
    # A 3h-offset broker, tick 5s old — well inside the tolerance budget.
    stub._tick_time = int(time.time()) + 10800 - 5

    got = module.detect_server_utc_offset(force=True)

    assert got == 10800, f'fresh tick was NOT applied — offset stayed {got}'
    assert module._SERVER_OFFSET_MEASURED_AT != 0.0, 'measurement timestamp did not advance'
    print('  ✅ control: tick 5s old -> offset correctly measured as 10800s')


def test_no_tick_retains_previous_offset():
    """GUARD 2b — no tick at all is an absence of information, not a zero reading.

    An empty result and a failed query must never be treated the same. Returning 0
    here would silently claim "broker is on UTC", which is the worst possible answer.
    """
    module, stub = _load_bridge()
    _reset(module, 10800)
    stub._connected = True
    stub._tick_time = None

    got = module.detect_server_utc_offset(force=True)

    assert got == 10800, f'absent tick produced {got} instead of retaining the previous value'
    print('  ✅ guard 2b: no tick available -> retains 10800s (not 0)')


if __name__ == '__main__':
    print('Canary: bridge offset guards (#845)')
    print('')
    failures = 0
    for fn in (
        test_disconnected_retains_previous_offset,
        test_stale_tick_is_rejected,
        test_fresh_tick_is_applied,
        test_no_tick_retains_previous_offset,
    ):
        try:
            fn()
        except AssertionError as e:
            failures += 1
            print(f'  [FAIL] {fn.__name__}: {e}')
        except Exception as e:  # noqa: BLE001 - report, do not mask
            failures += 1
            print(f'  [FAIL] {fn.__name__}: unexpected {type(e).__name__}: {e}')
    print('')
    if failures:
        print(f'CANARY FAILED - {failures} check(s) did not hold')
        sys.exit(1)
    print('CANARY PASSED - 4/4 (3 guards + 1 control)')
