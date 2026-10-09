## Close verification — #1035 (verification close: no code changed today)

Everything the issue asked for was implemented on 2026-10-02; this session re-ran the acceptance canary **live** and observed all five items. No code was changed for #1035 today — that is the point of this comment.

### Acceptance — observed 2026-10-09 22:34Z (canary: `BRIDGE_PORT=5002`, `BRIDGE_ACCOUNT=9`, `MT5_ACCOUNT_9=99999999`, `MT5_SERVER_9=NoSuchServer-Demo`, `MT5_PATH_9` → the running MetaQuotes terminal logged into 10011309743)

| # | Criterion | Observed |
|---|---|---|
| 1 | Requested vs actual compared after every connect/reconnect, mismatch reported naming BOTH | Startup connect AND `/reconnect` both set it: `"reasons":["account: asked 99999999, got 10011309743","server: asked NoSuchServer-Demo, got MetaQuotes-Demo"]` |
| 2 | `POST /reconnect` returns a distinct non-success outcome | `{"success": false, "state": "account-mismatch", "connectionState": "ok", "error": "Reconnect bound this bridge to 10011309743 @ MetaQuotes-Demo, not its configured 99999999 @ NoSuchServer-Demo — ORDERS ARE REFUSED (#1035)", "credentialMismatch": {…}}` |
| 3 | Visible on `/health` so `answered`/`reachable` can carry it | `/health` → `connected: true, orderReady: false, credentialMismatch: {requested 99999999 @ NoSuchServer-Demo, actual 10011309743 @ MetaQuotes-Demo}` |
| 4 | Reproduced as a canary | Above — terminal at the configured path logged into a DIFFERENT account; bridge asked for an unreachable server and stayed bound; mismatch reported (not `success: true`) |
| 5 | Decide: refuse orders on mismatch? | **REFUSED, live:** `POST /order` → `{"success": false, "code": "TCS-TRADE-021", "params": {requested/actual accounts+servers}}`; bridge log `Refused POST /order: Bridge is attached to …`. Decision recorded at SETTLED-DECISIONS row 49 + the `DECISION` marker above `order_send_checked()`. |

### Notes

- **Attach-to-running-terminal needs the terminal PATH to be reachable.** A bare canary with no `MT5_PATH_9` got `(-10005, 'IPC timeout')` — a clean `terminal-down` refusal, no silent binding. The wrong-account binding reproduces when the configured path holds a running terminal logged in elsewhere — which is the real-world shape (a human re-logs the terminal; the config still names the old account).
- **One observed roughness, left as-is:** a malformed JSON body to `/order` returns HTTP 500 with a logged traceback (JSONDecodeError) rather than 400. It is pre-existing and outside this issue; recorded here so the next reader does not re-file it as new.
- The refusal fires **before** `order_send` — nothing reaches the broker, verified by the TCS-TRADE-021 params being echoed from the guard's own state.

*Canary cleaned down: port 5002 free, env cleared.*
