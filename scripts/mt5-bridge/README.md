# scripts/mt5-bridge — the Python side of the MT5 bridge

Python files here are **not** in `docs/TOOLS-INDEX.md` (that index scans `.cjs` / `.js` / `.mjs` /
`.ts`). That is why this file exists: an unindexed tool nothing names is lost, and the two rows below
each took a search to find.

| File | What it is | Run it when |
|---|---|---|
| `mt5_bridge_v2.py` | the bridge itself — HTTP server on :5000 / :5001, one process per broker | started by `scripts/tcs-launch.ps1`, never by hand |
| `bridge_supervisor.py` | relaunches a dead bridge (including the wedge exit, code 75); obeys the stop-sentinel `tcs-stop.ps1` writes | started by `tcs-launch.ps1` |
| **`probe-icmarkets-login.py`** | **diagnostic**: does a credential set authenticate at all, and *which account does the terminal actually bind to* (login, balance, currency, `trade_mode`, symbol count) | **a bridge reports success but trades the wrong account (#1035)**, or a login fails and you need to know whether it is the credentials or the terminal |
| `canary-5002-bounded-connect.ps1` | canary for the bounded-connect timeout on a throwaway `:5002` | after touching the bridge's connect/timeout path |
| `test_*.py` | pytest suites for the offset guard, the connection watchdog, credential binding, filling modes, future-tick warning and notice codes | after any change to the bridge |
| `requirements-mt5.txt` | the bridge's own dependency list (it is **not** a Node package) | installing the bridge on a new machine |

## ⚠️ The probe reads credentials from a file, never from argv

`probe-icmarkets-login.py` reads `c:\wamp64\www\.secrets\credentials.env` and never takes a password on
the command line, because **argv is visible in the process list**. That is the same rule
`scripts/lib/mysql-cli.cjs` and `scripts/lib/mysql-credential.ps1` apply to the database (register row
163 / #1252). Nothing in this folder may hardcode an account, a login or a password.

## Why the probe matters more than it looks

A bridge **down** refuses, which is obvious. A bridge on the **wrong account** accepts — and reports
success. The only way to tell those apart is to compare the request against what the terminal says it
is bound to, which is exactly what this probe prints. It was moved here from `logs/` on 2026-11-09
where it was invisible: `logs/` is gitignored, so a diagnostic left there is gone at the next clean.
