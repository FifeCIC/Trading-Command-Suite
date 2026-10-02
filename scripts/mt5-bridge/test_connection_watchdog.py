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
        # #1036 — lets a test drive a FAILED reconnect. `initialize()` returning False is how MT5
        # reports the canary's real error (`-10003 IPC initialize failed, Process create failed`),
        # and without this switch the failure path could only be read, never exercised.
        self.initialize_ok = True

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
        return self.initialize_ok


def _terminal(connected):
    return types.SimpleNamespace(connected=connected)


def _account():
    # ⚠️ `server` is REQUIRED, not decoration. `connect_mt5()`'s success path logs
    # `info.login @ info.server`, so a fixture without it raises AttributeError the moment a test
    # drives a SUCCESSFUL reconnect — which no test did before #1036 added one.
    return types.SimpleNamespace(
        login=10011309743, balance=1272.22, equity=1272.22, server='MetaQuotes-Demo',
    )


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


class ReconnectOutcomeRecordTest(unittest.TestCase):
    """#1036 — a failed reconnect must leave the bridge's own state TRUTHFUL.

    ⚠️ WHY THIS IS TESTED AT ALL, AND WHY IT IS NOT TESTED BY READING THE CODE.

    `reconnect_mt5()` calls `mt5.shutdown()` FIRST, then `connect_mt5()`. When that second call
    fails, the shutdown has already happened and nothing replaced it — so the bridge is now
    `terminal-down` **because of its own reconnect attempt**, which is a different fact from the
    terminal having gone away. Both render as the same `/health`, and that is exactly the
    plausible-output-no-error shape this repo keeps re-finding.

    ⚠️ HOW TO CANARY THIS CLASS (do it before trusting it).
      1. Delete the `_RECONNECT_STATE['sessionLeftDown'] = True` line in `reconnect_mt5`.
         `test_failed_reconnect_records_that_the_session_was_left_down` must FAIL.
      2. Delete the `= False` reset on the success path.
         `test_successful_reconnect_clears_session_left_down` must FAIL.
      Restore byte-for-byte and confirm all pass again.

    ⚠️ WHAT THIS CLASS DOES NOT CLAIM. It says nothing about whether a sibling bridge is affected.
    #1036's co-outage did NOT reproduce on 2026-10-02, so the record publishes `UNMEASURED` — and
    the last test pins that, so a later edit cannot quietly turn it into a claim.
    """

    @classmethod
    def setUpClass(cls):
        cls.bridge, cls.fake = load_bridge()

    def setUp(self):
        for key, value in (
            ('attempts', 0), ('failures', 0), ('lastAttemptAt', None), ('lastResult', None),
            ('lastError', None), ('lastReason', None), ('sessionLeftDown', False),
        ):
            self.bridge._RECONNECT_STATE[key] = value
        self.fake.initialize_ok = True
        self.fake.terminal = _terminal(True)
        self.fake.account = _account()
        # A tripped breaker short-circuits connect_mt5() before initialize(), which would make the
        # FAILED case pass for the wrong reason.
        self.bridge.reset_circuit_breaker()

    def test_failed_reconnect_records_that_the_session_was_left_down(self):
        self.fake.initialize_ok = False
        ok, err = self.bridge.reconnect_mt5('canary: forced failure')
        self.assertFalse(ok)
        state = self.bridge._RECONNECT_STATE
        self.assertEqual(state['lastResult'], 'failed')
        self.assertEqual(state['failures'], 1)
        self.assertEqual(state['attempts'], 1)
        self.assertTrue(state['lastError'])
        self.assertTrue(
            state['sessionLeftDown'],
            'a failed reconnect leaves the session down — shutdown() already ran and was not '
            'replaced; this flag is the only place that connection is recorded',
        )

    def test_successful_reconnect_clears_session_left_down(self):
        # Start from a previous FAILURE, so this proves a RESET rather than merely a default.
        self.bridge._RECONNECT_STATE['sessionLeftDown'] = True
        self.bridge._RECONNECT_STATE['lastResult'] = 'failed'
        self.fake.initialize_ok = True
        ok, _ = self.bridge.reconnect_mt5('canary: forced success')
        self.assertTrue(ok)
        state = self.bridge._RECONNECT_STATE
        self.assertEqual(state['lastResult'], 'ok')
        self.assertEqual(state['lastError'], None)
        self.assertFalse(state['sessionLeftDown'])

    def test_attempt_is_recorded_even_when_the_reason_is_the_watchdog(self):
        # The watchdog calls the SAME function (#992 extracted it for exactly this reason), so an
        # unattended reconnect must be as visible as a manual one. Otherwise "who asked for this?"
        # is unanswerable — which is half of what #1036 is about.
        self.fake.initialize_ok = False
        self.bridge.reconnect_mt5('watchdog: 3 consecutive bad polls')
        state = self.bridge._RECONNECT_STATE
        self.assertIn('watchdog', state['lastReason'])
        self.assertTrue(state['lastAttemptAt'], 'the attempt must be timestamped')

    def test_the_blast_radius_stays_unmeasured_and_is_never_a_claim(self):
        # ⚠️ A guard against a FUTURE well-meaning edit. `siblingEffect: False` would read as
        # "measured safe", which is not something anyone has measured — the co-outage did not
        # reproduce, which is not the same as proving it cannot happen.
        self.fake.initialize_ok = False
        self.bridge.reconnect_mt5('canary')
        self.assertEqual(self.bridge._RECONNECT_STATE['siblingEffect'], 'UNMEASURED')


if __name__ == '__main__':
    unittest.main(verbosity=2)
