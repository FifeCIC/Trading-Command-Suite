# MT5 bridge offset-probe REJECTED path re-logs per list ITEM while ticks are stale — ~130K lines / 30 MB per bridge, both bridges, ends at the FX open

Measured 2026-10-04 → 10-05 while investigating a Pepperstone demo failure (owner question: "has TCS spammed Pepperstone?"). The broker side was clean — **this flooding is TCS → its own bridge, locally.**

## What happened

During the pre-open stale-tick window (weekend close), both bridges flooded their own logs:

| bridge | retained storm volume |
|---|---|
| broker 3 (`bridge-broker3.log.5` → `.1` + live-file tail) | **~129,000 lines / ~30 MB** (5 × 5 MB full + 20,891 lines) |
| broker 2 | **~110,000 lines / ~27 MB** (5 × 5 MB + 2,030 lines) |

- Rate varied **78–500 lines/s** (fastest: 21,664 lines in **43 s**).
- Window: earliest surviving line **21:38:19 BST**, ends **~22:02 BST** — exactly when the FX weekend open freshens the ticks (probe succeeds → 1800 s TTL starts → silence). Earlier rotated files are gone, so the total start is ≥ what is retained; the rotation budget (6 × 5 MB) was fully consumed by this storm.
- Every line: `Server UTC offset probe REJECTED — freshest tick (EURUSD) is NNNNNs old, beyond the 450s tolerance budget of the 900s rounding step. Retaining 0s rather than applying a biased measurement (#845).`
- **Zero order/modify traffic** in the window (weekend — market closed).

## Mechanism (code-read: `scripts/mt5-bridge/mt5_bridge_v2.py`)

- `utc_iso()` (**line 248**) calls `detect_server_utc_offset()` **once per list ITEM** — its 12 call sites are candles / positions / orders / deals / calendar rows. A `/candles?limit=200` can log up to 200 warnings from ONE request.
- On rejection (**lines 229–236**) the function returns **without setting `_SERVER_OFFSET_MEASURED_AT`**, so the 1800 s TTL never starts — **the next item re-probes AND re-logs**. That is the flood.
- Guard 1 (disconnected terminal, lines 185–192) got once-per-state-change suppression in **#992**; Guard 2 (rejected measurement) has no equivalent. The Python bridge logger has no repeat-collapse (#1023 covered the NestJS side only).
- Each rejected probe also calls `mt5.terminal_info()` + up to 4× `mt5.symbol_info_tick()` — **~5 native MT5 calls per list item**, on the single-threaded bridge that serves orders.

## Impact

- Recurs on every weekend / holiday stale-tick window while the terminal stays connected.
- ~30 MB/bridge/occurrence of disk + continuous CPU burn on the order-serving process; drowns real bridge log lines and makes the bridge *look* busy.
- **Not broker-facing** — `terminal_info` / `symbol_info_tick` read the terminal's local cache. Pepperstone and MetaQuotes see nothing from this.

## Fix options

1. On rejection set `_SERVER_OFFSET_MEASURED_AT = now - TTL + HOLD` (e.g. HOLD = 60 s) → re-probes rate-limited to once/min. Correctness unchanged: the retained value is still the last known-good offset (#845 untouched).
2. Warn-once-per-state like #992, with a periodic re-emit.
3. Both of the above.

## Repro / canary

With the market closed (weekend), one `GET /positions` (or any list endpoint) on `:5001` / `:5000` → one REJECTED warning **per item**. A canary should assert: N list calls in a stale window produce O(1) warnings, not O(items).

Evidence retained in-repo: `scripts/mt5-bridge/bridge-broker3.log.1–.5`, `bridge-broker2.log.1–.5` (~56 MB; will rotate out).

Cross-refs: #845 (the guard this is a side-effect of), #992 (the suppression pattern it needs), #1023 (NestJS-side collapse), #866.
