"""
test_credential_binding.py — #1035 canary for the bridge's credential-binding check.
====================================================================================

WHAT THIS GUARDS. `POST /reconnect` can attach a bridge to an account it was NOT configured for
and report `success: true`. Measured 2026-09-30 on a canary bridge started with
`MT5_ACCOUNT_9=99999999` / `MT5_SERVER_9=NoSuchServer-Demo`:

    16:04:57 Initializing MT5: server=NoSuchServer-Demo, account=99999999 (account #9)
    16:04:59 MT5 connected: 62135531 @ PepperstoneUK-Demo, balance=1065.04

The bridge asked for one account and attached to a different, LIVE one. A bridge bound to the wrong
account is worse than a bridge that is down: the down one refuses orders, the wrong one ACCEPTS them.

⚠️ CANARY DIRECTIONS (run before trusting this file):
  1. Delete the `if account and str(info.login) != str(account)` branch → the account tests FAIL.
  2. Delete the `if server and ...` branch → the server test FAILS.
  3. Make the server comparison case-SENSITIVE → `test_case_difference_is_not_a_mismatch` FAILS.
  4. Drop the `if account` guard → `test_blank_request_is_not_a_mismatch` FAILS (every path-based
     connect, which passes no credentials, would be reported as a mismatch).
  5. Move `return mt5.order_send(req)` ABOVE the `if credential_mismatch is not None` check in
     `order_send_checked` → the three gate tests FAIL (the order is sent, then nothing refuses).
  6. Change `raise BridgeRefusal(...)` to `return None` → the refusal tests FAIL (nothing raises).

Run:  python scripts/mt5-bridge/test_credential_binding.py
"""

import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt5_bridge_v2 as bridge  # noqa: E402


class CredentialBindingTest(unittest.TestCase):
    def setUp(self):
        bridge.credential_mismatch = None
        bridge._last_mismatch_key = None
        # Silence the module logger so a canary run does not spray ERROR lines.
        bridge.logger.disabled = True

    def tearDown(self):
        bridge.logger.disabled = False

    @staticmethod
    def info(login, server):
        return SimpleNamespace(login=login, server=server)

    # ── the defect direction ────────────────────────────────────────────────────────────────
    def test_wrong_account_is_a_mismatch(self):
        """THE MEASURED CASE, verbatim: asked for 99999999, attached to 62135531."""
        out = bridge.verify_connection_identity('99999999', 'NoSuchServer-Demo', '9', self.info(62135531, 'PepperstoneUK-Demo'))
        self.assertIsNotNone(out, 'a different account than the one requested MUST be reported')
        self.assertEqual(out['requestedAccount'], '99999999')
        self.assertEqual(out['actualAccount'], '62135531')
        self.assertTrue(any('account' in r for r in out['reasons']))
        self.assertTrue(any('server' in r for r in out['reasons']))

    def test_wrong_server_alone_is_a_mismatch(self):
        out = bridge.verify_connection_identity('10011309743', 'NoSuchServer-Demo', '2', self.info(10011309743, 'MetaQuotes-Demo'))
        self.assertIsNotNone(out)
        self.assertFalse(any('account' in r for r in out['reasons']))
        self.assertTrue(any('server' in r for r in out['reasons']))

    def test_mismatch_is_cleared_when_the_binding_is_restored(self):
        bridge.verify_connection_identity('99999999', 'NoSuchServer-Demo', '9', self.info(62135531, 'PepperstoneUK-Demo'))
        self.assertIsNotNone(bridge.credential_mismatch)
        out = bridge.verify_connection_identity('62135531', 'PepperstoneUK-Demo', '9', self.info(62135531, 'PepperstoneUK-Demo'))
        self.assertIsNone(out)
        self.assertIsNone(bridge.credential_mismatch, 'a good connect must clear a previous mismatch')

    # ── must NOT fire: the false positives that would make this noise ───────────────────────
    def test_the_live_binding_is_not_a_mismatch(self):
        """Both running bridges, with their real values. If this fires, the check is noise."""
        self.assertIsNone(bridge.verify_connection_identity('10011309743', 'MetaQuotes-Demo', '2', self.info(10011309743, 'MetaQuotes-Demo')))
        self.assertIsNone(bridge.verify_connection_identity('62135531', 'PepperstoneUK-Demo', '3', self.info(62135531, 'PepperstoneUK-Demo')))

    def test_case_difference_is_not_a_mismatch(self):
        """The terminal reports its own casing; comparing it literally would cry wolf every connect."""
        self.assertIsNone(bridge.verify_connection_identity('10011309743', 'metaquotes-demo', '2', self.info(10011309743, 'MetaQuotes-Demo')))

    def test_blank_request_is_not_a_mismatch(self):
        """A path-based connect passes NO credentials — it targets a terminal that is already logged
        in. There is nothing to compare against, so there is nothing to report."""
        self.assertIsNone(bridge.verify_connection_identity('', '', '1', self.info(51866583, 'ICMarketsSC-Demo')))

    def test_no_account_info_is_not_a_mismatch(self):
        """`account_info()` returns None while the terminal is unreachable — that is #992's
        `terminal-down`, a different condition with a different remedy."""
        self.assertIsNone(bridge.verify_connection_identity('99999999', 'NoSuchServer-Demo', '9', None))

    # ── THE GATE — order_send_checked (#1035) ───────────────────────────────────────────────
    #
    # Verification alone would only LOG the problem. These cover the refusal that makes it matter:
    # a reported mismatch must stop the order being placed at all.

    def _bind_wrong(self):
        """The measured state: asked for 99999999 @ NoSuchServer-Demo, attached to a live account."""
        bridge.credential_mismatch = {
            'requestedAccount': '99999999', 'requestedServer': 'NoSuchServer-Demo',
            'actualAccount': '62135531', 'actualServer': 'PepperstoneUK-Demo',
            'activeSlot': '9', 'reasons': ['account: asked 99999999, got 62135531'],
        }

    def test_an_order_is_REFUSED_when_bound_to_the_wrong_account(self):
        """The whole point: a bridge on the wrong account must not place a real order on it."""
        self._bind_wrong()
        with self.assertRaises(bridge.BridgeRefusal) as ctx:
            bridge.order_send_checked({'action': 1, 'symbol': 'EURUSD'})
        body = ctx.exception.body
        self.assertFalse(body['success'])
        self.assertEqual(body['code'], bridge.NOTICE_ACCOUNT_MISMATCH)
        self.assertEqual(body['code'], 'TCS-TRADE-021', 'the code must match the registry entry')
        self.assertEqual(ctx.exception.status, 409)
        # ⚠️ All four params are REQUIRED: the registry message interpolates every one, so a missing
        # key renders the refusal with blanks in the UI — the refusal would look like a glitch.
        for key in ('requestedAccount', 'requestedServer', 'actualAccount', 'actualServer'):
            self.assertIn(key, body['params'])
        self.assertEqual(body['params']['actualAccount'], '62135531')

    def test_a_refusal_never_reaches_the_terminal(self):
        """⚠️ A refusal that still called order_send would ALREADY have placed the order.
        Asserted by instrumenting the real call, not by inspecting the branch."""
        self._bind_wrong()
        sent = []
        original = bridge.mt5.order_send
        bridge.mt5.order_send = lambda req: sent.append(req) or SimpleNamespace(retcode=10009)
        try:
            with self.assertRaises(bridge.BridgeRefusal):
                bridge.order_send_checked({'symbol': 'EURUSD'})
        finally:
            bridge.mt5.order_send = original
        self.assertEqual(sent, [], 'the terminal must NOT be contacted when the binding is wrong')

    def test_a_CORRECT_binding_still_delegates(self):
        """The other direction: the gate must be invisible when nothing is wrong."""
        bridge.credential_mismatch = None
        sentinel = SimpleNamespace(retcode=10009, order=555)
        original = bridge.mt5.order_send
        bridge.mt5.order_send = lambda req: sentinel
        try:
            self.assertIs(bridge.order_send_checked({'symbol': 'EURUSD'}), sentinel,
                          'a clean binding must return the terminal result UNCHANGED')
        finally:
            bridge.mt5.order_send = original

    def test_the_surfaces_report_orderReady(self):
        """⚠️ SOURCE-LEVEL, not live. The payloads are built inline in `do_GET`, so they cannot be
        called without a socket; this asserts the surface exists rather than dropping it silently.
        `connected: true` + `orderReady: false` is the honest reading — it can SEE, it must not ACT.
        The live check belongs to the issue's QA entry.
        """
        src_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mt5_bridge_v2.py')
        with open(src_path, encoding='utf-8') as fh:
            src = fh.read()
        self.assertEqual(src.count("'orderReady': credential_mismatch is None"), 2,
                         '/health AND /broker must both expose orderReady')
        self.assertIn('ORDERS ARE REFUSED', src,
                      'the mismatch remedy must say orders are refused, not just name the account')


if __name__ == '__main__':
    unittest.main(verbosity=2)
