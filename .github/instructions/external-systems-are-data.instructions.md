---
description: "MANDATORY before wiring ANY third-party system — broker, account, bridge, exchange, API, or desktop app. External systems are DATA discovered at runtime, never constants in code or environment variables for one user. Read before adding an account, a bridge, an integration, a port, a host, or a symbol route."
applyTo: "**"
---

# External Systems Are Data — Never Hardcoded

**Owner direction, 2026-10-07:**

> *"You might take an approach to hardcode these accounts but that doesn't work for a new user. I need you
> to create a strong agentic AI rule regarding external/third-party accounts/apps/bridges etc to be
> managed through dynamic systems based on data. The engineering needs to prepare for many users that
> will input different accounts."*

---

## The rule

> **Anything outside this repository — an account, a bridge, a terminal, a host, a port, a credential, a
> symbol mapping — is a RECORD, discovered at runtime. It is never a literal in code and never a
> per-user value in an environment file.**

There is one deployment today and there will be many. **A value that encodes one user's world does not
degrade gracefully into a second user's — it silently points at the wrong place.** That is the same
failure class this repo keeps re-finding: plausible output, no error.

**The test to apply before writing any integration:**

> *"If a second user registered tomorrow with different accounts, brokers and apps, would this line
> still be correct?"*

If the answer is no, the value belongs in the database with a lifecycle, not in the source.

---

## What this forbids

| Forbidden | Because |
|---|---|
| A broker id, account number, server name, or terminal path as a literal | It is one user's configuration. #1035's canary proved a bridge can attach to an account it was not configured for and report `success: true` |
| A per-account variable in `.env` (`MT5_ACCOUNT_2`, `MT5_PASSWORD_2`, …) | Env is per-DEPLOYMENT, not per-user. A second user's accounts cannot be added without editing a file on the server |
| `localhost:5000` / `:5001` as a symbol→broker assumption | Ports are an implementation detail of *this* machine. The account, not the port, is the identity |
| An allowlist of "supported" brokers/symbols maintained by hand | It drifts, and its absence reads as a capability fact. #1002 removed exactly this (`MT5_ASSET_BROKER_DEFAULTS`) because it returned early and bypassed the capability check |
| A role name, a bot name, or a strategy name that must match a string in another system | A name is not an identifier. #1018 established that attribution must come from a recorded id (magic), because comments are editable |
| "It works on my machine" as a design | The second user's machine is the requirement |

⚠️ **A credential in a file is a second problem on top of this one.** Where accounts are stored, they are
records with an access boundary — never committed, never read by a caller that has no business seeing
them.

---

## What this requires

**1. A record with a lifecycle.** An external system is CRUD: create, test, enable, edit, disable,
delete — driven from the UI by the user who owns it. "Add my broker" must be a form, not a deploy.

**2. Discovery, not assumption.** Ask the external system what it can do and record the answer.
`broker_symbol` and `symbol_route` already work this way — routing reads what a broker *reports* it can
trade, rather than a list someone typed.

**3. A viability check before use.** Selecting an account for a job must verify that account can do the
job *for this symbol* — the owner's example: *"both current accounts I have will not trade the same
symbols on each."* A check that is absent is a promise nobody made.

**4. "Cannot judge" is a state, not a default.** If an external system's capability cannot be
determined, the answer is a refusal that names why — never a fallback to whatever was configured first.

**5. The failure is reported, never absorbed.** An unreachable or mismatched external system must
surface. A bridge that is *down* refuses; a bridge on the *wrong account* accepts — the second is
worse, and only a comparison of request against result catches it (#1035).

---

## Where the dynamic stores live

| Concern | Store | Status |
|---|---|---|
| Broker capability (which assets/styles it supports, is trading on) | **`broker_config`** | ✅ exists |
| What a broker can actually trade, per symbol | **`broker_symbol`** (synced) | ✅ exists |
| Which broker serves a symbol, and under what broker-native name | **`symbol_route`** | ✅ exists |
| **Accounts and credentials** (number, server, terminal, secret) | 🛑 **NONE — they are `MT5_ACCOUNT_n` / `MT5_PASSWORD_n` env vars** | ❌ **the gap** |

**Measured 2026-10-07:** `broker_config` has `id, displayName, supportedStyles, supportedAssetTypes,
tradingEnabled, note, isActive, sortOrder` — **capability only. No account, server, or credential
column exists anywhere in the schema.** Four accounts live as numbered env vars in `nest/.env`,
including terminal paths hardcoded to this machine (`C:\Program Files\…`).

⚠️ **Closing that gap is tracked work, not licence to invent a second mechanism.** Until the store
exists, a new integration must **not** add another `MT5_*_n` variable — that deepens the thing being
replaced. Say so in the issue instead.

---

## Applying this to A/B

An A/B pair is the sharpest case, because it needs **two** external systems at once:

- The pair's arms bind to **accounts**, and those accounts are **the user's**, chosen on the A/B profile.
- The pair **must refuse to run** when it cannot get two distinct, viable accounts — never fall back to
  one, and never assume the primary.
- The binding is a **record on the pair**, so a second user creates their own pair with their own
  accounts and nothing in the code changes.

⚠️ **Do not hardcode "A → broker 2, B → broker 3"**, however convenient it is on this machine. It is one
user's arrangement, and it would be wrong for the next one.

---

## Related

- **#1035** — a bridge attached to an account it was not configured for, and reported success
- **#1002** — `MT5_ASSET_BROKER_DEFAULTS` removed: a hand-maintained map that bypassed a capability check
- **#1018** — attribution by recorded magic, because a comment is editable
- **#963 / #965** — the A/B pair LOCK, and the decision that the measurement is the backtest
- `database-seed-discipline.instructions.md` — a direct DB write that is not in the seed is lost on reinstall
- `development-status.instructions.md` — the app is pre-release, single machine, **no users**. This rule
  is the one place where the second user is the requirement *now*: an integration written for one
  deployment is the most expensive thing to un-write later
