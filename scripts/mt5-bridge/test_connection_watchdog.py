"""
test_connection_watchdog.py — #992 canary for the bridge's connection watchdog.

⚠️ WHY THIS FILE EXISTS, AND WHAT IT IS FOR.

The defect: a dropped MT5 session halted trading for ~1 hour. The bridge logged
`terminal not connected` 4,325 times and attempted nothing, because `ensure_mt5()`
correctly refuses to reinitialise from a request handler — leaving NO component
responsible for recovery.

The watchdog is that component. Its whole value is in WHEN it fires and when it
deliberately does NOT, and that cannot be verified by reading it:

  * it must NOT rebuild the session on a single blip,
  * it MUST rebuild after N consecutive bad polls,
  * it MUST also try on `terminal-down`, but ONLY so many times — a genuinely-absent terminal
    must not be fought forever, while a STALE IPC LINK must not be abandoned (2026-09-27: the
    blanket skip left broker 2 dead for hours with 71 connection errors, and `/reconnect`
    repaired it on the first call — see the DECISION beside WATCHDOG_TERMINAL_DOWN_MAX_ATTEMPTS),
  * it must back off after a FAILED reconnect rather than hammering.

⚠️ HOW TO CANARY THIS FILE (do it before trusting it).
  1. Delete the `if state == STATE_TERMINAL_DOWN:` bound inside connection_watchdog.
     `test_terminal_down_stops_escalating_after_the_bound` must FAIL.
  2. Restore the old unconditional `if state == STATE_TERMINAL_DOWN: continue`.
     `test_terminal_down_does_reconnect_bounded` must FAIL.
  3. Change `if failures < WATCHDOG_FAILURES_BEFORE_RECONNECT: continue` to `<=`.
     `test_waits_for_the_failure_threshold` must FAIL.
  Restore byte-for-byte and confirm all pass again.

Run:  python -m unittest scripts.mt5-bridge.test_connection_watchdog
  or: python scripts/mt5-bridge/test_connection_watchdog.py
"""

import importlib.util
import os
import sys
import types
import unittest

BRIDGE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mt5_bridge_v2.py')


class _FakeMT5:
    """A controllable stand-in for the MetaTrader5 package.

    `terminal` / `account` are set per test; `None` means "the call returned None",
    which is how MT5 reports both "terminal absent" and "not connected".
    """

    def __init__(self):
        self.terminal = None
        self.account = None
        self.raise_on_terminal_info = False

    def terminal_info(self):
        if self.raise_on_terminal_info:
            raise RuntimeError('simulated terminal_info failure')
        return self.terminal

    def account_info(self):
        return self.account

    def shutdown(self):  # pragma: no cover - recorded, not asserted here
        pass

    def last_error(self):
        return (1, 'simulated')

    def initialize(self, *a, **k):
        return True


def _terminal(connected):
    return types.SimpleNamespace(connected=connected)


def _account():
    return types.SimpleNamespace(login=10011309743, balance=1272.22, equity=1272.22)


def load_bridge():
    """Import the bridge with a FAKE MetaTrader5 injected.

    ⚠️ Injection must happen BEFORE the import: the module imports MetaTrader5 at
    module level, so a real MT5 install would be driven by an import of this test.
    """
    fake = _FakeMT5()
    stub = types.ModuleType('MetaTrader5')
    for name in ('terminal_info', 'account_info', 'shutdown', 'last_error', 'initialize'):
        setattr(stub, name, getattr(fake, name))
    sys.modules['MetaTrader5'] = stub

    spec = importlib.util.spec_from_file_location('mt5_bridge_under_test', BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, fake


class ProbeConnectionStateTest(unittest.TestCase):
    """The classification #992 asks for: lost session vs absent terminal."""

    @classmethod
    def setUpClass(cls):
        cls.bridge, cls.fake = load_bridge()

    def test_ok(self):
        self.fake.terminal = _terminal(True)
        self.fake.account = _account()
        self.assertEqual(self.bridge.probe_connection_state()[0], self.bridge.STATE_OK)

    def test_session_lost_when_terminal_runs_but_is_not_connected(self):
        # ⚠️ THE REAL OUTAGE. The terminal WAS running (it had connected at startup),
        # so `terminal_info()` is an object and only `connected` is False. This is the
        # state `/reconnect` fixes.
        self.fake.terminal = _terminal(False)
        self.fake.account = _account()
        state, detail = self.bridge.probe_connection_state()
        self.assertEqual(state, self.bridge.STATE_SESSION_LOST)
        self.assertIn('session is not connected', detail)

    def test_terminal_down_when_terminal_info_is_none(self):
        # Reconnecting cannot help; the remedy is to start the terminal.
        self.fake.terminal = None
        state, _ = self.bridge.probe_connection_state()
        self.assertEqual(state, self.bridge.STATE_TERMINAL_DOWN)

    def test_terminal_down_when_the_call_raises(self):
        self.fake.terminal = _terminal(True)
        self.fake.raise_on_terminal_info = True
        try:
            state, detail = self.bridge.probe_connection_state()
        finally:
            self.fake.raise_on_terminal_info = False
        self.assertEqual(state, self.bridge.STATE_TERMINAL_DOWN)
        self.assertIn('raised', detail)

    def test_account_unavailable_is_its_own_state(self):
        self.fake.terminal = _terminal(True)
        self.fake.account = None
        self.assertEqual(
            self.bridge.probe_connection_state()[0], self.bridge.STATE_ACCOUNT_UNAVAILABLE
        )


class WatchdogDecisionTest(unittest.TestCase):
    """WHEN it fires. This is the part that cannot be judged by reading it."""

    def setUp(self):
        self.bridge, self.fake = load_bridge()
        self.reconnects = []
        self.bridge.reconnect_mt5 = lambda reason: (self.reconnects.append(reason) or True, None)

    def _run(self, states, max_iterations=None):
        """Drive the watchdog over a scripted list of states, then stop it.

        `time.sleep` is replaced so the loop becomes a for-loop over `states`. The
        watchdog is an infinite loop by design; the test bounds it rather than
        changing it.
        """
        seq = list(states)
        limit = max_iterations if max_iterations is not None else len(seq)

        def fake_sleep(_seconds):
            if not seq:
                raise StopIteration('scripted states exhausted')

        def fake_probe():
            if not seq:
                raise StopIteration('scripted states exhausted')
            return seq.pop(0)

        self.bridge.time.sleep = fake_sleep
        self.bridge.probe_connection_state = fake_probe
        calls = {'n': 0}
        orig_reconnect = self.bridge.reconnect_mt5

        def counting_reconnect(reason):
            calls['n'] += 1
            return orig_reconnect(reason)

        self.bridge.reconnect_mt5 = counting_reconnect
        try:
            self.bridge.connection_watchdog()
        except StopIteration:
            pass
        self.assertLessEqual(calls['n'], limit)

    def test_waits_for_the_failure_threshold(self):
        # One bad poll is a blip, not a reason to tear down a live session.
        threshold = self.bridge.WATCHDOG_FAILURES_BEFORE_RECONNECT
        lost = (self.bridge.STATE_SESSION_LOST, 'x')
        self._run([lost] * (threshold - 1) + [(self.bridge.STATE_OK, None)])
        self.assertEqual(self.reconnects, [], 'reconnected before the threshold was reached')

    def test_reconnects_at_the_threshold(self):
        threshold = self.bridge.WATCHDOG_FAILURES_BEFORE_RECONNECT
        lost = (self.bridge.STATE_SESSION_LOST, 'x')
        self._run([lost] * threshold + [(self.bridge.STATE_OK, None)])
        self.assertEqual(len(self.reconnects), 1, 'did not reconnect at the threshold')
        self.assertIn('watchdog', self.reconnects[0])

    def test_terminal_down_does_reconnect_bounded(self):
        """`terminal-down` is NOT abandoned — the stale-IPC-link case needs a reconnect.

        ⚠️ This test REPLACES `test_does_not_reconnect_when_the_terminal_is_absent`, whose
        premise was measured false on 2026-09-27: broker 2 sat in `terminal-down` with 71
        connection errors and `POST /reconnect` restored it (`balance: 1252.59`) on the first
        call. `terminal_info() is None` means the IPC link is stale far more often than it
        means the terminal is absent.
        """
        down = (self.bridge.STATE_TERMINAL_DOWN, 'terminal_info() is None')
        self._run([down] * (self.bridge.WATCHDOG_FAILURES_BEFORE_RECONNECT + 1))
        self.assertEqual(
            len(self.reconnects), 1,
            'terminal-down was abandoned — a stale IPC link is recoverable and must be tried',
        )

    def test_terminal_down_stops_escalating_after_the_bound(self):
        """The anti-thrash rule SURVIVES, as a bound rather than a blanket refusal.

        A genuinely-absent terminal cannot be reconnected. Fire far more polls than the bound and
        assert the attempts stop there — otherwise a closed terminal is hammered forever, which is
        the restart-thrash this repo already paid for once.
        """
        bound = self.bridge.WATCHDOG_TERMINAL_DOWN_MAX_ATTEMPTS
        down = (self.bridge.STATE_TERMINAL_DOWN, 'terminal absent')
        self._run(
            [down] * (self.bridge.WATCHDOG_FAILURES_BEFORE_RECONNECT * (bound + 4)),
            max_iterations=bound,
        )
        self.assertEqual(
            len(self.reconnects), bound,
            f'expected exactly {bound} bounded attempts against an absent terminal',
        )

    def test_recovers_and_resets(self):
        threshold = self.bridge.WATCHDOG_FAILURES_BEFORE_RECONNECT
        lost = (self.bridge.STATE_SESSION_LOST, 'x')
        ok = (self.bridge.STATE_OK, None)
        self._run([lost] * threshold + [ok] + [lost] * (threshold - 1) + [ok])
        # One reconnect for the first outage; the second outage never reaches threshold
        # because the OK poll in between RESETS the counter.
        self.assertEqual(len(self.reconnects), 1)


class LogOnceTest(unittest.TestCase):
    """Criterion: 'logged once WITH the remedy, not 4,325 times without it'."""

    def setUp(self):
        self.bridge, self.fake = load_bridge()
        self.lines = []

    def test_state_change_names_the_remedy(self):
        self.bridge.logger.error = lambda msg: self.lines.append(msg)
        self.bridge._log_state_change(
            self.bridge.STATE_SESSION_LOST, 'terminal is running but its session is not connected'
        )
        self.assertEqual(len(self.lines), 1)
        self.assertIn('/reconnect', self.lines[0], 'the remedy is missing from the log line')

    def test_terminal_down_names_a_remedy_that_is_actually_attempted(self):
        """The line must not tell the reader the opposite of what the code does.

        It used to say "reconnecting cannot help" while the code declined to reconnect — and the
        remedy it named was the one that worked. Now it states what the watchdog WILL do.
        """
        self.bridge.logger.error = lambda msg: self.lines.append(msg)
        self.bridge._log_state_change(self.bridge.STATE_TERMINAL_DOWN, 'terminal_info() is None')
        self.assertIn('/reconnect', self.lines[0])
        self.assertNotIn('cannot help', self.lines[0])
        self.assertIn('START THE MT5 TERMINAL', self.lines[0])

    def test_offset_probe_warns_once_not_every_call(self):
        # ⚠️ The 4,325-line defect itself: the probe runs on EVERY request.
        self.fake.terminal = _terminal(False)
        warnings = []
        self.bridge.logger.warning = lambda msg: warnings.append(msg)
        self.bridge._OFFSET_PROBE_WARNED = False
        for _ in range(50):
            self.bridge.detect_server_utc_offset(force=True)
        self.assertEqual(len(warnings), 1, f'expected 1 throttled warning, got {len(warnings)}')
        self.assertIn('/reconnect', warnings[0])

    def test_offset_probe_reports_again_after_recovery(self):
        # The throttle must clear, or the NEXT outage is silent — a worse failure than
        # the spam it replaced.
        self.fake.terminal = _terminal(False)
        warnings = []
        self.bridge.logger.warning = lambda msg: warnings.append(msg)
        self.bridge._OFFSET_PROBE_WARNED = False
        self.bridge.detect_server_utc_offset(force=True)
        self.fake.terminal = _terminal(True)  # recovery clears the flag
        self.bridge.detect_server_utc_offset(force=True)
        self.fake.terminal = _terminal(False)  # outage again
        self.bridge.detect_server_utc_offset(force=True)
        self.assertEqual(len(warnings), 2, 'the second outage was suppressed')


if __name__ == '__main__':
    unittest.main(verbosity=2)
