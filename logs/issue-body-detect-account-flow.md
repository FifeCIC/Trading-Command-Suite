# Detected-account acceptance flow — surface the MT5 terminal's live login on the UI and register it in the DB on acceptance

**Owner request, 2026-10-06:** *"Do we have a process to detect a new account in MT5 and Pepperstone then present it somewhere on the UI such as accounts page, for the user's acceptance, as a way to acknowledge its detection? Acceptance would then register the account within our apps database. I think this is a new concept and agents have been handling registration."*

**Answer today: the sensor exists; the presentation, acceptance and registration do not.**

## Current state (measured 2026-10-06)

- **Registration = hand-edited `nest/.env`** (`MT5_ACCOUNT_x` / `MT5_PASSWORD_x` / `MT5_SERVER_x` / `MT5_PATH_x`) + a bridge restart. The bridges read that file directly (`scripts/mt5-bridge/mt5_bridge_v2.py` loads `nest/.env` at import; each instance targets one slot via `BRIDGE_PORT` / `BRIDGE_ACCOUNT`).
- **No account entity in the DB**: `node scripts/db-schema.cjs --pattern '%account%'` → 0 tables. `trade.accountId` is a loose string, mostly NULL. (`broker_config` is broker *capabilities*, not accounts.)
- **No accounts UI**: the old Accounts Dashboard page no longer exists. The live broker surfaces are Automation settings → Brokers (per-broker `enabled` / `tradingEnabled` toggles from `/api/automation/status`) and `/research/broker-catalogue` (instrument capability, #958). The "Accounts" hub in the nav currently holds the portfolio (Trading212) pages.
- **The sensor EXISTS**: on every (re)connect the bridge compares the **requested** account/server (from `.env`) with the **actual** session (`mt5.account_info()`) — `verify_connection_identity()` at `mt5_bridge_v2.py:643` — and publishes a `credentialMismatch` dict (`requestedAccount`, `requestedServer`, `actualAccount`, `actualServer`, `activeSlot`, `reasons`) on `/health`; the API maps it onto `GET /api/providers/mt5/brokers` (#1035). ⚠️ While mismatched, the bridge **refuses ORDERS** (`TCS-TRADE-021`) and deliberately keeps all READS open, so the app can still see the account it is wrongly attached to.
- ⚠️ **What MT5 can and cannot tell us**: the Python API exposes only the account the terminal **is logged into** (`account_info()`), NOT the list of saved accounts. So "detect a new account" can only ever mean *"the terminal is logged into an account the app has not registered"* — the trigger is the user logging the terminal in (which they must do anyway, on the broker's side).

## Proposed phase 1 (first slice of #514's "DB-Driven Account Management")

1. **`broker_account` table** (name/shape aligned with #514): `login`, `server`, `brokerSlot`, `label`, `status` (`detected` | `accepted` | `ignored`), `detectedAt`, `acceptedAt`, `lastSeenAt`, `repeatCount` — reuse the acknowledged-first-sighting pattern the alerts table already uses (createdAt = first sighting, never overwritten).
2. **Detection**: each health poll compares the terminal's live `account@server` to the registry; an unknown login upserts one `detected` row (repeatCount++, no spam).
3. **Presentation**: a "Detected accounts" card — login @ server, which slot's terminal it came from, [Accept] / [Ignore]. Home TBD; candidates are the Automation settings → Brokers section (where per-broker flags already live) or a new card in the accounts/portfolio hub.
4. **Acceptance**: sets `status = accepted` (+ slot binding). **No credentials stored in this phase** — passwords stay in `nest/.env`; encryption is #514 / #588 territory. The card then shows the remaining step ("credentials missing for this account").
5. **Later**: acceptance provisions config and triggers the supervised bridge restart; #514 eventually replaces `.env` credentials with the DB registry.

## Related

- **#1035** — the mismatch sensor this builds on, and its open half: the order-refusal policy.
- **#514** — phase-10 "DB-Driven Account Management" (this is its first, near-term slice).
- **#588** — security / credential storage.

## Why the pain is live

Replacing demo 62148195 on 2026-10-06 required an agent-side edit of `nest/.env` + a manual bridge restart (review-queue row R44). The owner should not need an agent in the loop to register an account they just created.
