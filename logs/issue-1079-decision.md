## Decision recorded — owner chose **A**: the pair stays PARKED; the measurement path is the backtest

Asked in chat on 2026-10-08 (options A/B/C presented), answered **"A"**. Recorded in all three homes:

| Home | What |
|---|---|
| Code site | `DECISION` marker on `ab-test.service.ts` `start()` — "a live pair is not restarted as routine business; a live pair is a decision the OWNER makes" |
| Register | `docs/SETTLED-DECISIONS.md` **row 74** (🟡 partial — the two-account refusal is guarded; the parked posture is deliberately unenforced) |
| Queue | **R49** in the DONE block |

### Why this is the cheap, correct answer

- The settled route for #929-class measurement is the **backtest** (#965) — the live pair was never the only way to get the number.
- ⚠️ **A restart today would place NOTHING anyway.** The arms' stacks both read `brokerId='mt5'` (queried 2026-10-08 against `controlStackId`/`variantStackId`), and the shipped two-account fix refuses every dispatch unless the arms resolve two distinct accounts. "Just restart it" was never available.

### This issue stays OPEN — and these items are now explicitly the GATE for any future restart

- **#2 — duplicate guard locks the bot family out of the pair's symbol.** Unchanged and correctly so (the pre-close check already reasoned this); it would fire the moment a restarted pair holds a symbol a bot trades.
- **#4 — safety-chain bypass** (cooldowns / portfolio gate): extracted to **#1082**, open. The choke point is the fix, not this call site.
- **#5 — pair positions cannot be time-stopped** (attribution by exact strategy name; `TCS AB-A …` matches no bot). Still owned here.

**If the owner ever authorises a restart (the REVERSE BY on row 74), the prerequisites are:** arms reconfigured to two distinct accounts (2 and 3), #1082 landed, the time-stop attribution fixed — and, if the symbol overlaps a bot family, #2's guard interplay settled first.
