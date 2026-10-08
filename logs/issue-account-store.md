## Summary

There is **no store for trading accounts**. Broker *capability* is data (`broker_config`), what a broker
can *trade* is data (`broker_symbol`), and which broker serves a symbol is data (`symbol_route`) — but the
**accounts themselves are numbered environment variables**, including terminal paths hardcoded to one
machine.

Owner direction, 2026-10-07: *"You might take an approach to hardcode these accounts but that doesn't work
for a new user… prepare for many users that will input different accounts."*

**Priority: owner-deferred (P7 of #965).** The rule is in place; this is the store and the UI behind it.

---

## Measured 2026-10-07

| Concern | Store | Status |
|---|---|---|
| Broker capability (`supportedStyles`, `supportedAssetTypes`, `tradingEnabled`) | `broker_config` | ✅ exists — **capability only, no account/server/credential column** |
| What a broker can actually trade | `broker_symbol` (synced) | ✅ |
| Symbol → broker + broker-native name | `symbol_route` | ✅ |
| **Accounts, servers, credentials, terminal paths** | 🛑 **none anywhere in the schema** | ❌ |

Current state in `nest/.env`:

```
MT5_ACCOUNT_1..4=…   MT5_PASSWORD_1..4=…   MT5_SERVER_1..4=…
MT5_PATH_1..4=C:\Program Files\…            # one machine's install paths
MT5_ACTIVE_ACCOUNT=2
MT5_ACTIVE_BROKERS=2,3                      # a comma-separated list, edited by hand
```

`.env` is gitignored, so no secret is in git — **that is not the defect.** The defect is that **adding a
user's account requires editing a file on the server**, and that the bridge binding is a hand-maintained
list rather than a record. #1035 already showed the consequence: a bridge can attach to an account it was
not configured for and report `success: true`.

## What "done" looks like

1. **A table** holding an account: broker, account number, server, terminal/app reference, credential
   reference, enabled, label, owner. Credentials are referenced, never selected by a caller with no
   business seeing them.
2. **A UI**: add / test / enable / disable / remove, per user — "Add my broker" is a form, not a deploy.
3. **`MT5_ACTIVE_BROKERS` becomes a query**, not an env list.
4. **A viability check**: selecting an account for a job verifies it can do that job **for this symbol**.
   ⚠️ Owner's own reason this matters: *"both current accounts I have will not trade the same symbols on
   each."* Consumed first by the A/B profile (see below).

## The A/B application (the first consumer)

Per #965 P0, a live A/B pair may place orders **only** when it holds two bound, distinct, accessible
accounts — so the pair needs the binding, and the UI needs to set it.

**Required on the A/B profile:**

- **Mode**: `backtest` (default) | `live`
- **Arm A account** and **arm B account** — chosen from the user's own accounts
- **Validation on save and on enable**: two accounts, distinct, both accessible, both viable **for the
  pair's symbol**. Otherwise the pair refuses — and per the owner, *"else both strategies shouldn't run."*

⚠️ **Do not hardcode "A → broker 2, B → broker 3"** while this is unbuilt. It is one machine's
arrangement. Until the binding exists, the live path places nothing (already the state — the running test
was stopped 2026-10-07).

## Related

- **#965** — the sprint this sits in, as **P7**
- **`.github/instructions/external-systems-are-data.instructions.md`** — the rule (written 2026-10-07)
- **#1035** — a bridge on the wrong account reported success
- **#1002** — `MT5_ASSET_BROKER_DEFAULTS` removed; the same hardcoded-map defect
- **#963** — the pair LOCK (the experiment identity that will consume the account binding)
