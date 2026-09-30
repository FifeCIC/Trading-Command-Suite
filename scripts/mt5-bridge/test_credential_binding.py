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


if __name__ == '__main__':
    unittest.main(verbosity=2)
