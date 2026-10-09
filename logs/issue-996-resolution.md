## RESOLVED 2026-10-09 — cause ISOLATED (option c), and `scoreIntervalMs` is refuted *and dead*

**One sentence:** the five index protocols are already evaluated on the fastest cadence in the system — every loop tick — but a tick with no **direction-eligible** reading is `NO_DATA` and **persists nothing** (by design, #758). Their persisted-score frequency is low because their directional capacity is thin, not because scoring is slow.

### The evidence chain (each step measured, not inferred)

| # | Finding | Evidence (primary source) |
|---|---|---|
| 1 | **Every ready protocol × symbol is scored every tick — including these five.** | `protocol_score_status` (written by the loop each tick) shows `lastTickAt` advancing for **all** protocols together: `16:29:29 → 16:33:16 → 16:34:42`, with the five reading `state=no-data, symbolsResolved=1, symbolsScored=0`. The loop is configured at `tickIntervalMs: 120000`. |
| 2 | **A no-direction tick is an ABSENCE that persists nothing.** | `scoreWithGating` returns `signal: 'NO_DATA'` (composite 0, `noData: true`): *"No directional evidence this tick — no direction-eligible directive produced a reading. This is data absence, not a neutral score (#758)."* Callers skip persisting it. |
| 3 | **For these five, bearish evidence cannot express — they are `LONG_ONLY`.** | Live verdict on them: all five are `directionMode: LONG_ONLY` (DB). Today's UK100 drilldown shows `support-resistance-levels` **bearish 5** present — and the score is still `NO_DATA`, because only *bullish* readings are direction-eligible in a LONG_ONLY protocol (gating header). |
| 4 | **Their designed directional voice is dead/absent.** | `analyst-adjustments` (the sentiment group's only member, 80 pts): *"…no analyst feed is available. Reporting UNMEASURED rather than fabricating a sentiment score."* — the whole protocol's direction depends on `rsi-oversold`/`speed-momentum` firing bullish (today RSI 49.3 → neutral). |
| 5 | **The declared `5s–30s` was never an evaluation clock.** | It feeds `selectBaseTimeframe('5s–30s') → '1m'` — *which bars* are fetched (pinned by `timeframe.spec.ts`). Nothing runs a 5–30s scheduler. The issue compared **data cadence** against **persisted directional scores**: different quantities. |
| 6 | **`scoreIntervalMs` is not the cause — it is read by nothing.** | Case-insensitive grep of all of `nest/src`: every reference is a declaration, a default, or the settings *setter* (loop L169/818/864; controller L790/809/826). **No reader.** The frontend's only references are Architecture-page field lists. Lowering it would change **nothing**; it is a stored-and-editable control that executes nothing. |

### What the fix is NOT, and what it would be

- **NOT a cadence fix** — options (a) and (b) from the issue are both dead ends: (a) `scoreIntervalMs` is inert; (b) correcting the declaration changes bar resolution, not the clock.
- **The lever is directional capacity / eligibility** (protocol design, not scheduling): an analyst feed (#912 family), and/or the LONG_ONLY choice — a "speed scalp" that declines to short in a bearish tape produces `NO_DATA` **by construction**. Raised as review-queue **R51** for the owner; not changed here.

### Not done / deliberately

- **Nothing was changed** — no cadence, bars, settings, or protocol config. `scoreIntervalMs` was left in place deliberately (removing-or-wiring a dead control is its own call; recorded here with the measurement).
- The remaining work is a protocol-design fork, not this issue.

🤖 Closed by primary — 2026-10-09. Handoff: `2026-10-09-996-cadence-cause-isolated.md`
