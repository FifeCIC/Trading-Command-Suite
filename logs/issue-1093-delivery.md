## #1093 delivered — the in-app prompt + button, and what the first live runs actually measured

### What now exists

| Layer | What | Where |
|---|---|---|
| Bridge | `POST /history/recover` — re-asks the range, then per ticket (`position=` **and** `ticket=` probes), with bounded retries | `scripts/mt5-bridge/mt5_bridge_v2.py` |
| API | `GET /api/providers/exit-data/gaps` · `POST /api/providers/exit-data/recover` | `providers.controller.ts` → `position-sync.service.ts` → `mt5.adapter.ts` |
| UI | **Optional prompt + button on the Trade Journal** (`/trading/trade-journal`): renders only when gaps exist, "Try to recover", honest result, dismissible | `src/components/ExitDataRecoveryNotice.jsx` |

This replaces R48's manual terminal ritual (Toolbox → History → right-click → Period → Custom) — the owner's direction was *"an optional prompt with button where/when there is a gap in the information"*, and the ritual is now a **last resort** the app names when relevant, not the mechanism.

### The measured journey — four answers, three of them wrong until fixed

| Run | Reported | What was actually true |
|---|---|---|
| probes | 0 of 3 | partly true (old deals do vanish) — but see below |
| 1st live | **0 of 81** | ⚠️ **bridge 2 was never asked.** It ran an older script, answered 404, and the fan-out ABORTED — while the note still spoke for it. `bridgePost` throws by design (order paths must not read a refusal as silence); the fan-out needed a per-target catch. **Fixed.** |
| 2nd live | **34 of 81** re-finalised | with both bridges asked AND order-id tickets resolved: **21 gaps closed immediately** (81 → 60 `broker:unknown`; 192 → 171 total). ⚠️ Second latent defect: the served check compared tickets against **position-id** keys — measured, `trade.brokerTicket` matched a deal's **ORDER id** in 20 of 20 sampled rows (only 8 of 20 also matched a position id), so most served rows were silently skipped. **Fixed** (bridge indexes both, returns `recoveredIds` keyed by the ids sent). |
| repeat press | "Recovered 13 of 60" | ⚠️ **the counter counted re-finalisations, not closed gaps** — the gap list did not move by a single row (171 → 171). Those 13 rows do have their deals; the deal carries **no reason the enum can map**, so they stay unattributed. **Fixed**: the count is read back from the rows, and the note says exactly this instead of re-advertising 13. |

### The honest state now (live)

```text
Recovered 0 of the 60 requested exit records. The terminals served 13 of them, but those
closing deals carry no reason the app can map, so they stay unattributed (their prices and
P&L are refreshed). 47 were not served — some accounts keep only a few days of deal history.
A further 111 closed trades have no broker ticket recorded, so there is nothing to chase for
them. New closes are unaffected.
```

| Bucket | Count | Can the app fix it? |
|---|---|---|
| Gaps closed by one press | **21** | done |
| Served, deal reason unmappable | 13 | no — the data says nothing; prices/P&L ARE refreshed |
| Not served (terminal retention) | 47 | only by deepening terminal history (R48 last resort) |
| No ticket at all (pre-#1014 rows) | 111 | no — nothing to ask any terminal about |

"New closes are unaffected" held throughout: three closes landed after the #1089 deploy and all three attributed.

### Guard work

- Rule 5 of `validate-single-bridge-position-io.cjs` extended to `recoverDeals` (must enumerate `brokerIds`, address every call with a route). ⚠️ Extending it exposed a defect in the guard's own `methodBody` helper: it sliced at the first `\n  }`, which matched the **multi-line return type** of the new method — the real adapter read as broken. Fixed; both shapes pinned by self-test (**30/30**).
- `mt5-adapter-multibroker.spec.ts` — new case: **one broker refusing does not stop the others being asked**, and the refusal is recorded (`failed`), never absorbed. Canary M2 now fails 2 tests when mutated.
- `position-sync-exit-recovery.spec.ts` (new, 4 cases) — pins the corrected counting (4 re-finalised, 2 gaps closed → reports 2), the unserved row never reaching the finaliser, the unasked-broker wording, and the no-contradiction repeat-press note.
- `logs/canary-1093-recovery.ps1` — M1 + M2, both directions, restore byte-for-byte: **CANARY PASS**.

### Deploy state

- Both bridges restarted on the updated script, account identity verified after restart (the #1035 lesson): `:5000` → MetaQuotes-Demo `10011309743`, `:5001` → PepperstoneUK-Demo `62148195`.
- API rebuilt and restarted; both endpoints exercised live (numbers above).
- ⚠️ **The API deploy used a documented bypass.** `npm run build:api` still fails on the `validate-notices` prebuild gate — not on this work, but on another agent's **untracked** `src/components/RegisterSymbolOverlay.jsx` (2 raw error renders; its CSS also references an undefined `--panel-2` token). The gates this change affects were run individually (typecheck, pipeline-contracts, close-attribution, single-bridge rule 5, decisions, docs-facts; pipeline map regenerated) and the emit used `tsc -p tsconfig.build.json` directly. Worth noting for whoever next sees the red build: it is that file, not this change.

### UI verification (live, this session)

Banner renders with real numbers (171 + top symbols) → **Try to recover** shows "Asking the terminals…" (~3 min: 13 finalisers each re-read deal history) → result renders verbatim from the server note → button becomes "Try again" → **Dismiss** hides it and stores the count (a NEW gap count re-surfaces it — optional, not a nag). ⚠️ One UI defect found and fixed during verification: the first dismissal guard kept the banner up while a result was on screen (`!result && …`), so the button looked dead. Dismissal now works unconditionally.

**Decision recorded:** register row **72** (`broker:unknown` is absence-of-evidence → repair paths may overwrite it; named reasons stay sacred) + `DECISION` marker at the site; canaried via M1.

**Residual, deliberately not chased:** the 47 unserved rows need terminal-side history depth — the old manual step — which is now R48's *last resort* entry, reframed. The 13 unmappable and 111 unticketed are data limits, not defects; both are stated in the button's own note so nobody re-opens them as bugs.
