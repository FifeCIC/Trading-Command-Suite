## Repair round (2026-10-08) — 4 of 48 resolved, the residual is a bridge-history availability limit, plus one tool defect found and fixed

### The pass, executed

`POST /api/providers/repair-pnl?provider=mt5&limit=250` → **examined 182 · repaired 69 · notRepairable 113** (the 48 staged rows + the pre-existing `pnlInvalid=1` pool).

**Exactly the four rows traced yesterday resolved**, and the repair produced their true deal values:

| row | now |
|---|---|
| GER40 `a68ea856` | exit **25073.9** (= deal price), pnl **−8.18** (= real net), reason **`broker:sl`**, closedAt **13:43:32** (= deal time) |
| US30 `932d9d23` | reason `broker:sl`, pnl **−14.17** |
| VIX `b40a6a00` / `d50220d7` | reason `broker:sl`, pnl −0.02 / −0.02 |

### ⭐ Live proof the #1089 fix works

While this work was in flight, the owner manually closed **GER40 `a0d5c70e`** and **FRA40 `4c2cf8c3`** (08:38Z). The fixed reconciler recorded:

```
Closed trade a0d5c70e (GER40) exit=24953.7 PnL=2.60 why=user:manual
Closed trade 4c2cf8c3 (FRA40) exit=7715.9 PnL=2.03 why=user:manual
```

**These are the first broker-3 closes ever recorded with a reason and a deal-derived price** — before #1089 every one of the six broker-3 families was 48/48 `broker:unknown` with snapshot pricing. ("First ever" is checkable: the pre-fix split is in the measurement table at the top of this issue.)

### The residual — 44 rows, characterised

The other 44 rows remain `broker:unknown` after the repair. The pass asked the RIGHT bridge (fan-out live) — the deals are simply **not returned by `/history` any more**: the four resolved rows are the recent ones (2026-10-06/07); the 35 merged rows date to 2026-09-16–10-02. Working hypothesis (⚠️ **not yet measured**): the terminal's history does not carry those older deals for the bulk `history_deals_get` window, so no code path can re-read them today. Next step, if wanted: probe `:5001/history?days=30` against a known Sep-16 position id to confirm, then decide whether a targeted per-ticket `history_deals_get(position=…)` call is worth adding — **this is a new question, tracked here, not silently dropped**.

### ⚠️ Tool defect found mid-run, fixed and guarded → new issue

The pass re-stamped **50 rows' `closedAt`** with the run time (rows it could not re-price get `closedAt: closedAt ?? new Date()`). All 50 restored from the pre-run snapshot (`logs/restore-1089-closedat.ps1`; 50/50, 0 uncovered, 0 left in the window). The write is fixed — `closedAt: closedAt ?? trade.closedAt ?? new Date()` — with a spec case and a two-direction canary (mutation → 1 failed; restored → 9 passed). Refiled as **#1091** for the record.

### Bookkeeping

- The TSV snapshot (`logs/backup-1089-repair-pool-*.tsv`, 148 rows, pre-run) and the restore script are kept in `logs/` as the evidence trail.
- One honest note: my staging UPDATE briefly nulled the two manual-close rows' reasons (they matched the six-symbol filter); recovered verbatim from the API log (`why=user:manual`) and restored the same minute.
