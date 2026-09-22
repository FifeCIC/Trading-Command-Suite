# Notice codes — the catalogue

**Status:** active
**Category:** C (reference)
**Created:** 2026-09-15
**Last updated:** generated — see `git log docs/NOTICE-CODES.md`
**Owner:** generated — do NOT edit by hand

> Generated from `src/core/notices/registry.js` by `node scripts/validate-notices.cjs --md --out=docs/NOTICE-CODES.md`.
> Editing this file changes nothing: the backend `prebuild` fails if it does not match the registry.

## Why codes exist

The **code** identifies a condition and never changes. The **wording** explains it and may be reworded or translated at any time. Before this, the identity of a message *was* its wording — so a log line, a UI card, a test and a GitHub issue could not be correlated, and fixing a typo orphaned every reference to it. Same principle as Windows `HRESULT`, PostgreSQL `SQLSTATE` and the MetaTrader retcodes this app already consumes.

**Reporting a problem:** quote the code shown in the message. It is greppable here, in the API log and in the issue tracker.

**Adding a code:** add the entry to the registry, emit it at the call site, then run the gate. Retire codes; never renumber one — renumbering is the same defect as rewording.

## Index

| Code | Severity | Area | Title |
|---|---|---|---|
| `TCS-DATA-001` | error | DATA | Text encoding corrupted (mojibake) |
| `TCS-DATA-002` | warning | DATA | No bars at all |
| `TCS-DATA-003` | warning | DATA | Feed stopped |
| `TCS-DATA-004` | error | DATA | Feed freshness unknown |
| `TCS-DATA-005` | warning | DATA | Symbols have stopped producing bars |
| `TCS-DATA-006` | success | DATA | All feeds fresh |
| `TCS-INTEG-001` | critical | INTEG | MT5 bridge not connected |
| `TCS-INTEG-002` | critical | INTEG | MT5 circuit breaker open |
| `TCS-RISK-001` | warning | RISK | Trade blocked by a safety gate |
| `TCS-RISK-002` | warning | RISK | Directives disagree |
| `TCS-RISK-003` | warning | RISK | Risk gate warning |
| `TCS-SCORE-001` | info | SCORE | Not enough data to judge edge |
| `TCS-SIG-001` | error | SIG | Signals list unavailable |
| `TCS-SIG-002` | error | SIG | Signal not dismissed |
| `TCS-SIG-003` | success | SIG | Signal dismissed |
| `TCS-SYS-001` | error | SYS | Unknown notice code |
| `TCS-SYS-002` | error | SYS | Request failed |
| `TCS-SYS-003` | error | SYS | Request timed out |
| `TCS-SYS-004` | error | SYS | Request rejected before it ran |
| `TCS-SYS-005` | error | SYS | API request exceeded its deadline |
| `TCS-SYS-006` | error | SYS | Unexpected server error |
| `TCS-SYS-007` | error | SYS | Action failed |
| `TCS-SYS-008` | error | SYS | Verification probe failed |
| `TCS-SYS-009` | error | SYS | API did not respond |
| `TCS-TRADE-001` | error | TRADE | Order rejected — unsupported filling mode |
| `TCS-TRADE-002` | warning | TRADE | Order not sent — market closed |
| `TCS-TRADE-003` | error | TRADE | Not enough margin at the broker |
| `TCS-TRADE-004` | error | TRADE | Symbol not tradeable |
| `TCS-TRADE-005` | error | TRADE | Order was not placed |
| `TCS-TRADE-006` | warning | TRADE | A plan already exists |
| `TCS-TRADE-007` | error | TRADE | Plan was not created |
| `TCS-TRADE-008` | success | TRADE | Order placed |
| `TCS-TRADE-009` | success | TRADE | Draft plan created |
| `TCS-TRADE-010` | error | TRADE | No price available |
| `TCS-TRADE-011` | error | TRADE | Size below the symbol minimum |
| `TCS-TRADE-012` | error | TRADE | Size above the symbol maximum |
| `TCS-TRADE-013` | error | TRADE | Spread too wide to trade |
| `TCS-TRADE-014` | error | TRADE | Position not found |
| `TCS-TRADE-015` | warning | TRADE | Duplicate order suppressed |
| `TCS-TRADE-016` | error | TRADE | Blocked by the bridge size cap |
| `TCS-TRADE-017` | error | TRADE | Blocked by the bridge position count |
| `TCS-TRADE-018` | error | TRADE | Bot is still active |
| `TCS-TRADE-019` | success | TRADE | A/B copy created |
| `TCS-TRADE-020` | info | TRADE | Bot deleted |

**44 codes** — 2 critical, 26 error, 9 warning, 2 info, 5 success.

## Codes by area

### TRADE — Trading and execution

#### `TCS-TRADE-001` — Order rejected — unsupported filling mode

- **Severity:** error
- **Message:** The broker rejected {symbol} (filling={mode}).
- **Cause:** The order asked for a filling mode this instrument does not allow. MT5 defaults to FOK when the mode is not set, and {broker} does not accept FOK for {symbol}.
- **Action:** The bridge now selects a supported mode from symbol_info().filling_mode. Modes the broker allows: {allowed}.
- **Params:** `symbol`, `mode`, `broker`, `allowed`
- **Call:** `notice('TCS-TRADE-001', { symbol, mode, broker, allowed })`
- **External:** MetaTrader 5 10030 (TRADE_RETCODE_INVALID_FILL)
- **Related:** #824

#### `TCS-TRADE-002` — Order not sent — market closed

- **Severity:** warning
- **Message:** The market for {symbol} is closed, so the trade was blocked.
- **Cause:** {reason}
- **Action:** Wait for the session to open, or trade a symbol whose market is open. The signal is not lost — it stays on the board.
- **Params:** `symbol`, `reason`
- **Call:** `notice('TCS-TRADE-002', { symbol, reason })`
- **Related:** *none*

#### `TCS-TRADE-003` — Not enough margin at the broker

- **Severity:** error
- **Message:** The broker refused {symbol}: {required} margin required, {free} free.
- **Cause:** Open positions and pending orders already consume the free margin.
- **Action:** Reduce the size, close a position, or use a larger account.
- **Params:** `symbol`, `required`, `free`
- **Call:** `notice('TCS-TRADE-003', { symbol, required, free })`
- **Related:** *none*

#### `TCS-TRADE-004` — Symbol not tradeable

- **Severity:** error
- **Message:** {symbol} cannot be traded on this account right now.
- **Cause:** The broker reports the symbol as close-only or disabled (trade mode {tradeMode}).
- **Action:** Check the symbol is enabled in Market Watch and that the account permits this instrument type.
- **Params:** `symbol`, `tradeMode`
- **Call:** `notice('TCS-TRADE-004', { symbol, tradeMode })`
- **Related:** *none*

#### `TCS-TRADE-005` — Order was not placed

- **Severity:** error
- **Message:** The order for {symbol} was not placed.
- **Cause:** {detail}
- **Action:** Broker refusals carry a retcode — the bridge reports the symbol, the filling mode it tried and the modes the broker does allow. Nothing was sent to the market.
- **Params:** `symbol`, `detail`
- **Call:** `notice('TCS-TRADE-005', { symbol, detail })`
- **Related:** #824

#### `TCS-TRADE-006` — A plan already exists

- **Severity:** warning
- **Message:** A draft plan for {symbol} already exists, so none was created.
- **Cause:** Signals hand over to Trading as one draft plan per signal.
- **Action:** Open Trading Plans to review the existing draft rather than creating a second one.
- **Params:** `symbol`
- **Call:** `notice('TCS-TRADE-006', { symbol })`
- **Related:** #702

#### `TCS-TRADE-007` — Plan was not created

- **Severity:** error
- **Message:** The draft plan for {symbol} could not be created.
- **Cause:** {detail}
- **Action:** Retry, or queue it from the Trading area instead.
- **Params:** `symbol`, `detail`
- **Call:** `notice('TCS-TRADE-007', { symbol, detail })`
- **Related:** #702

#### `TCS-TRADE-008` — Order placed

- **Severity:** success
- **Message:** Order placed for {symbol} — ticket {orderId}.
- **Action:** Click the order to open it in the Positions Monitor.
- **Params:** `symbol`, `orderId`
- **Call:** `notice('TCS-TRADE-008', { symbol, orderId })`
- **Related:** *none*

#### `TCS-TRADE-009` — Draft plan created

- **Severity:** success
- **Message:** {symbol} was queued as a draft plan.
- **Action:** Open it in Trading Plans to add size, stops and a threshold.
- **Params:** `symbol`
- **Call:** `notice('TCS-TRADE-009', { symbol })`
- **Related:** #702

#### `TCS-TRADE-010` — No price available

- **Severity:** error
- **Message:** No quote for {symbol}, so the order could not be priced.
- **Cause:** The bridge could not read a tick for this symbol — it is usually not selected in Market Watch, or the market data feed is down.
- **Action:** Open the symbol in Market Watch (or check the feed), then retry. No order was sent.
- **Params:** `symbol`
- **Call:** `notice('TCS-TRADE-010', { symbol })`
- **Related:** *none*

#### `TCS-TRADE-011` — Size below the symbol minimum

- **Severity:** error
- **Message:** {volume} lots is below the {symbol} minimum of {minimum}.
- **Cause:** Each symbol declares a minimum tradable volume; the broker rejects anything smaller.
- **Action:** Increase the size to at least {minimum}, or pick a symbol whose minimum your size can meet.
- **Params:** `symbol`, `volume`, `minimum`
- **Call:** `notice('TCS-TRADE-011', { symbol, volume, minimum })`
- **Related:** *none*

#### `TCS-TRADE-012` — Size above the symbol maximum

- **Severity:** error
- **Message:** {volume} lots is above the {symbol} maximum of {maximum}.
- **Cause:** The broker caps volume per order for this symbol.
- **Action:** Reduce the size to {maximum} or less, or split the position across orders.
- **Params:** `symbol`, `volume`, `maximum`
- **Call:** `notice('TCS-TRADE-012', { symbol, volume, maximum })`
- **Related:** *none*

#### `TCS-TRADE-013` — Spread too wide to trade

- **Severity:** error
- **Message:** The spread on {symbol} is {spread}% — too wide to place this order.
- **Cause:** A spread above 5% of price means the quote is unreliable (thin liquidity, rollover, or a market open). Entering here would start the trade at a large loss.
- **Action:** Wait for liquidity to return. No order was sent.
- **Params:** `symbol`, `spread`
- **Call:** `notice('TCS-TRADE-013', { symbol, spread })`
- **Related:** *none*

#### `TCS-TRADE-014` — Position not found

- **Severity:** error
- **Message:** No open position with ticket {ticket} on this account.
- **Cause:** It may already be closed, or it belongs to a different account slot.
- **Action:** Refresh the Positions Monitor. If it still appears there, the two brokers are out of step — check which account the position is on.
- **Params:** `ticket`
- **Call:** `notice('TCS-TRADE-014', { ticket })`
- **Related:** *none*

#### `TCS-TRADE-015` — Duplicate order suppressed

- **Severity:** warning
- **Message:** This order was already sent — reusing ticket {ticket} instead of placing a second one.
- **Cause:** The bridge keeps a short idempotency window keyed by clientOrderId, so a retry after a timeout cannot double the position.
- **Action:** Nothing to fix. If you intended a second trade, change the size or wait for the window to pass.
- **Params:** `ticket`
- **Call:** `notice('TCS-TRADE-015', { ticket })`
- **Related:** *none*

#### `TCS-TRADE-016` — Blocked by the bridge size cap

- **Severity:** error
- **Message:** {volume} lots exceeds the bridge’s own maximum position size of {maximum}.
- **Cause:** This is a safety cap in the bridge, not a broker limit — it applies before any order is sent.
- **Action:** Reduce the size, or raise the BRIDGE’s copy of the cap: MT5_MAX_POSITION_SIZE in nest/.env, then RESTART the MT5 bridges. The app setting (risk.maxPositionSize) is enforced live by the backend, but it cannot move the bridge’s own cap (#901).
- **Params:** `volume`, `maximum`
- **Call:** `notice('TCS-TRADE-016', { volume, maximum })`
- **Related:** *none*

#### `TCS-TRADE-017` — Blocked by the bridge position count

- **Severity:** error
- **Message:** Already holding {open} position(s) — the bridge cap is {maximum}.
- **Cause:** This is a safety cap in the bridge, not a broker limit.
- **Action:** Close a position, or raise the BRIDGE’s copy of the cap: MT5_MAX_OPEN_POSITIONS in nest/.env, then RESTART the MT5 bridges. The app setting (risk.maxOpenPositions) is enforced live by the backend, but it cannot move the bridge’s own cap — the lower of the two binds (#901).
- **Params:** `open`, `maximum`
- **Call:** `notice('TCS-TRADE-017', { open, maximum })`
- **Related:** *none*

#### `TCS-TRADE-018` — Bot is still active

- **Severity:** error
- **Message:** {name} is still active, so it was not deleted.
- **Cause:** Deleting an active bot removes the configuration mid-flight: live orders can arrive with nothing left to receive them, and the queue would keep producing decisions for a row that no longer exists.
- **Action:** Deactivate the bot first (the toggle on this page), then delete it. Deactivating never refuses.
- **Params:** `name`
- **Call:** `notice('TCS-TRADE-018', { name })`
- **Related:** *none*

#### `TCS-TRADE-019` — A/B copy created

- **Severity:** success
- **Message:** Created “{name}” as the B of this pair — a copy of the protocol and the bot.
- **Cause:** The copy owns its own protocol, so editing either side cannot change the other.
- **Action:** It starts INACTIVE. Edit B (its protocol and policy), then activate it when the pair is ready to run.
- **Params:** `name`
- **Call:** `notice('TCS-TRADE-019', { name })`
- **Related:** *none*

#### `TCS-TRADE-020` — Bot deleted

- **Severity:** info
- **Message:** Deleted {name}.
- **Cause:** {detail}
- **Action:** If it was part of a pair, the other side is untouched. Deletion never touches trades or history.
- **Params:** `name`, `detail`
- **Call:** `notice('TCS-TRADE-020', { name, detail })`
- **Related:** *none*

### SCORE — Scoring and signals

#### `TCS-SCORE-001` — Not enough data to judge edge

- **Severity:** info
- **Message:** Only {trades} closed trade(s) over {days} day(s) — too few to call this an edge.
- **Cause:** Below about 30 trades a single outlier moves the average more than any property of the strategy.
- **Action:** Keep collecting, or read the ratio as a tail observation rather than a diagnosed problem.
- **Params:** `trades`, `days`
- **Call:** `notice('TCS-SCORE-001', { trades, days })`
- **Related:** #805

### SIG — Signals workbench

#### `TCS-SIG-001` — Signals list unavailable

- **Severity:** error
- **Message:** The ranked signals could not be loaded.
- **Cause:** {detail}
- **Action:** Retry. If it persists, confirm the API is running and that /api/signals/best responds.
- **Params:** `detail`
- **Call:** `notice('TCS-SIG-001', { detail })`
- **Related:** #684

#### `TCS-SIG-002` — Signal not dismissed

- **Severity:** error
- **Message:** The signal could not be hidden.
- **Cause:** {detail}
- **Action:** Retry, or use the Show dismissed toggle to confirm nothing was hidden.
- **Params:** `detail`
- **Call:** `notice('TCS-SIG-002', { detail })`
- **Related:** *none*

#### `TCS-SIG-003` — Signal dismissed

- **Severity:** success
- **Message:** Hidden for the next {hours}h.
- **Action:** Use Show dismissed to bring it back early.
- **Params:** `hours`
- **Call:** `notice('TCS-SIG-003', { hours })`
- **Related:** *none*

### DATA — Data, import and integrity

#### `TCS-DATA-001` — Text encoding corrupted (mojibake)

- **Severity:** error
- **Message:** {count} character sequence(s) in {file} are corrupted.
- **Cause:** UTF-8 text was read or written as CP1252 or CP850, so multi-byte characters were stored as several wrong ones. The usual culprit is a SQL seed applied without --default-character-set=utf8mb4.
- **Action:** Run `node scripts/fix-mojibake.cjs {file}` (dry run first), then fix whatever consumed the file.
- **Params:** `count`, `file`
- **Call:** `notice('TCS-DATA-001', { count, file })`
- **Related:** #815

#### `TCS-DATA-002` — No bars at all

- **Severity:** warning
- **Message:** {symbol} has no bars on any timeframe.
- **Cause:** The symbol is being scored, but nothing has ever been ingested for it. Its absence from the ladder therefore looks like "no signal today" rather than "no data at all".
- **Action:** Check that the symbol is routed to a live provider feed. Until bars exist it cannot produce a prediction, however healthy the protocol is.
- **Params:** `symbol`
- **Call:** `notice('TCS-DATA-002', { symbol })`
- **Related:** #827, #841

#### `TCS-DATA-003` — Feed stopped

- **Severity:** warning
- **Message:** {symbol} last produced a bar {hours} hours ago.
- **Cause:** Bars stopped arriving while the symbol stayed on the scoring watchlist, so it silently drops off the ladder. Nightly session breaks and weekends are normal; a gap beyond the cadence tolerance is not.
- **Action:** Check the provider for {symbol}. Scoring is suppressed until its bars are fresh again, so no signal is being lost while it is quiet.
- **Params:** `symbol`, `hours`
- **Call:** `notice('TCS-DATA-003', { symbol, hours })`
- **Related:** #827, #841

#### `TCS-DATA-004` — Feed freshness unknown

- **Severity:** error
- **Message:** Could not check which symbols have stopped producing bars.
- **Cause:** {detail}
- **Action:** This is NOT an all-clear — the feed may have stalled. An empty list and a failed query must never look the same, which is exactly why {ref} is surfaced rather than swallowed.
- **Params:** `detail`, `ref`
- **Call:** `notice('TCS-DATA-004', { detail, ref })`
- **Related:** #841

#### `TCS-DATA-005` — Symbols have stopped producing bars

- **Severity:** warning
- **Message:** {count} scored symbol(s) are not producing fresh bars — {noData} with no data at all and {stopped} that stopped part-way.
- **Cause:** A stale symbol returns no score, which is indistinguishable from "no signal right now". The count is the only thing that makes the difference visible.
- **Action:** Work through the rows below — a "no bars at all" row is a routing fault, a "feed stopped" row is a provider fault.
- **Params:** `count`, `noData`, `stopped`
- **Call:** `notice('TCS-DATA-005', { count, noData, stopped })`
- **Related:** #827, #841

#### `TCS-DATA-006` — All feeds fresh

- **Severity:** success
- **Message:** All {count} scored symbol(s) have bars inside their cadence tolerance.
- **Params:** `count`
- **Call:** `notice('TCS-DATA-006', { count })`
- **Related:** #841

### RISK — Risk and safety gates

#### `TCS-RISK-001` — Trade blocked by a safety gate

- **Severity:** warning
- **Message:** The trade was blocked: {reason}
- **Cause:** A pre-trade safety gate rejected the order before it reached the broker.
- **Action:** Clear the blocker named above, or adjust the strategy so it does not trip this gate.
- **Params:** `reason`
- **Call:** `notice('TCS-RISK-001', { reason })`
- **Related:** *none*

#### `TCS-RISK-002` — Directives disagree

- **Severity:** warning
- **Message:** {description}
- **Cause:** The protocol’s directives conflict: type {type}, severity {severity}.
- **Action:** Expect lower conviction while directives conflict — the aggregate is averaging opposing views.
- **Params:** `description`, `type`, `severity`
- **Call:** `notice('TCS-RISK-002', { description, type, severity })`
- **Related:** *none*

#### `TCS-RISK-003` — Risk gate warning

- **Severity:** warning
- **Message:** {warning}
- **Cause:** The risk gate raised this warning. Warnings modify the composite; they do not veto it.
- **Action:** Review it before sizing. A warning that repeats across signals is worth investigating at the gate, not on the card.
- **Params:** `warning`
- **Call:** `notice('TCS-RISK-003', { warning })`
- **Related:** *none*

### INTEG — Broker and provider integrations

#### `TCS-INTEG-001` — MT5 bridge not connected

- **Severity:** critical
- **Message:** The MT5 bridge could not reach the terminal, so the request was not sent.
- **Cause:** {detail}
- **Action:** Confirm the MT5 terminal is running and logged in, then check the bridge is listening (ports 5000/5001) and /health reports connected. Nothing was sent to the market.
- **Params:** `detail`
- **Call:** `notice('TCS-INTEG-001', { detail })`
- **Related:** *none*

#### `TCS-INTEG-002` — MT5 circuit breaker open

- **Severity:** critical
- **Message:** Requests to MT5 are paused after repeated failures, so the order was not sent.
- **Cause:** {detail}
- **Action:** The breaker closes itself after the cooldown. If it keeps tripping, the terminal or bridge is genuinely down — fix that first rather than retrying.
- **Params:** `detail`
- **Call:** `notice('TCS-INTEG-002', { detail })`
- **Related:** *none*

### SYS — System and platform

#### `TCS-SYS-001` — Unknown notice code

- **Severity:** error
- **Message:** Notice code {code} is not registered, so it cannot be explained.
- **Cause:** A caller emitted a code that is missing from src/core/notices/registry.js.
- **Action:** Register the code, or correct the caller. The code is shown deliberately — an unknown code is never blanked.
- **Params:** `code`
- **Call:** `notice('TCS-SYS-001', { code })`
- **Related:** *none*

#### `TCS-SYS-002` — Request failed

- **Severity:** error
- **Message:** The request to the API failed (HTTP {status}).
- **Cause:** {detail}
- **Action:** Check the API is running, then retry. The status identifies the class: 400 request rejected, 404 not found, 409 conflict, 5xx server fault.
- **Params:** `status`, `detail`
- **Call:** `notice('TCS-SYS-002', { status, detail })`
- **Related:** *none*

#### `TCS-SYS-003` — Request timed out

- **Severity:** error
- **Message:** The API did not answer within {seconds}s, so the request was abandoned.
- **Cause:** The CLIENT gave up. Its timeout is set just below the server’s 30s deadline, so a slow query usually surfaces here rather than hanging the page. If the server gave up first the code is TCS-SYS-005 instead — the difference tells you which side was still waiting.
- **Action:** Retry. If it keeps timing out, the backend is busy or the query is slow — check the API logs.
- **Params:** `seconds`
- **Call:** `notice('TCS-SYS-003', { seconds })`
- **Related:** *none*

#### `TCS-SYS-004` — Request rejected before it ran

- **Severity:** error
- **Message:** The request was rejected before it reached the endpoint: {count} field(s) are not valid.
- **Cause:** Fields rejected: {fields}
- **Action:** Correct the named field(s) and send the request again. Field paths use dot notation for nested objects, so `body.volume` means the `volume` property of the request body.
- **Params:** `count`, `fields`
- **Call:** `notice('TCS-SYS-004', { count, fields })`
- **Related:** #826

#### `TCS-SYS-005` — API request exceeded its deadline

- **Severity:** error
- **Message:** The API abandoned this request after {seconds}s without producing an answer.
- **Cause:** The SERVER gave up. The endpoint did not return inside its own deadline (TimeoutInterceptor). A slow query, an unresponsive provider, or a missing await is the usual cause.
- **Action:** Retry once. If it repeats, the API log names the route that timed out, against this same code.
- **Params:** `seconds`
- **Call:** `notice('TCS-SYS-005', { seconds })`
- **Related:** #826

#### `TCS-SYS-006` — Unexpected server error

- **Severity:** error
- **Message:** The API hit an unexpected error while handling this request (HTTP {status}).
- **Cause:** {detail}
- **Action:** This is a bug, not a condition you can clear. Report the code shown above with what you were doing — the API log holds the stack against the same code.
- **Params:** `status`, `detail`
- **Call:** `notice('TCS-SYS-006', { status, detail })`
- **Related:** #826

#### `TCS-SYS-007` — Action failed

- **Severity:** error
- **Message:** The request to {operation} failed.
- **Cause:** {detail}
- **Action:** Retry. If it keeps failing, the API log names the route against this same code. Nothing was changed by the attempt.
- **Params:** `operation`, `detail`
- **Call:** `notice('TCS-SYS-007', { operation, detail })`
- **Related:** #826

#### `TCS-SYS-008` — Verification probe failed

- **Severity:** error
- **Message:** The claim could not be verified — the probe did not complete.
- **Cause:** {detail}
- **Action:** Check the API is running, then re-run the check. An unprobed claim is reported as UNVERIFIED, never as passing.
- **Params:** `detail`
- **Call:** `notice('TCS-SYS-008', { detail })`
- **Related:** #938

#### `TCS-SYS-009` — API did not respond

- **Severity:** error
- **Message:** The API did not respond — the request never reached it.
- **Cause:** No HTTP response arrived at all: {detail}. A service restart, a stopped API or a dropped connection looks exactly like this, and none of them produces a status code to report.
- **Action:** Check the API is running, then retry. The view recovers on its own once the service answers.
- **Params:** `detail`
- **Call:** `notice('TCS-SYS-009', { detail })`
- **Related:** *none*
