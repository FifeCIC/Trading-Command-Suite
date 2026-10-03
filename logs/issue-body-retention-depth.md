# The bar retention window is declared at 60 days, is not being applied, and is too shallow for an ACTIVE directive

**Raised by the owner, 2026-10-03:** *"Is there a known advantage to holding 60 days of data?"*

**Answer: yes — and 60 days is below what an active directive already needs.**

## The measurement

| Fact | Value | Source |
|---|---|---|
| `marketbar` retention window **declared** | **60 days** | `retention.config.ts` |
| `marketbar` **oldest row present** | **295 days** | `SELECT MIN(timestamp)` 2026-10-03 |
| Daily bars held per traded symbol | **206** | 12 symbols with bots |
| `btc-halving-cycle` declares | **`'1d': 365`** | `btc-halving-cycle.directive.ts:45` |
| `bollinger-squeeze` declares | **`'1d': 72`** | `bollinger-squeeze.directive.ts:30` |
| `ema-structure` declares | `'1d': 51` | `ema-structure.directive.ts:25` |

**Two separate findings, and they point in opposite directions.**

### 1. The window is not being applied

295 days of data exist against a declared 60-day bound, so **nothing is pruning `marketbar`**. This
is *fortunate*, not correct — it is the same class as the `directiveoutcome` check on the same day
(which **did** hold to its 3-day window, ~3.9 days of data), so the prune runs for some tables and
not this one. **A declared bound that is not enforced is a buried ability**, and it is what makes
the next finding invisible.

### 2. Enforcing 60 days would starve an ACTIVE directive

`protocol_directive_entry` → `protocol_directive_group` → `protocol`:

| directive | declares | in protocol | protocol active |
|---|---|---|---|
| `btc-halving-cycle` | **365 daily bars** | `btc-speed-v1` | **YES** |
| `ema-structure` | 51 daily bars | `gold-macro-v1`, `forex-session-v1`, `hourly-3dir-v1`, `spy-day-v1`, `qqq-day-v1`, `momentum-stock-v1` (+2 inactive) | **YES** |

⚠️ **`btc-halving-cycle` is ALREADY starved: it declares 365 and we hold 206.** Nothing errors,
because a short bar array is a legitimate state (a new symbol has no history) — the same
"plausible result, no error" signature as the rest of this repo's expensive defects.

**So the current 60-day declaration, if enforced, would take `bollinger-squeeze` (72) below its
declared need as well.**

## What this means

- **Do not treat 60 days as the bar-retention policy.** For `1d` bars the binding requirement is
  **365 days**, from an active directive.
- The window should be **raised to ≥365 days for `marketbar`**, or `btc-halving-cycle`'s declaration
  should be reduced to what is actually attainable — **the two must agree, and today they do not.**
- ⚠️ **A per-timeframe window is the more correct shape.** A 365-day bound is needed for `1d`; it is
  not needed for `1m`, which is the bulk of the table. One number cannot serve both, which is
  probably why 60 was chosen.

## Not done — deliberately

- **Nothing changed.** Raising the window and changing a directive declaration are both decisions,
  and the second is maths (`maths-change-requires-ab.instructions.md`).
- **Not measured:** which of `marketbar`'s 265 MB is `1m` vs `1d`, which is what a per-timeframe
  window would need to be sized against.

## Related

- R37 core set — the 89,818 rows erased the same day were the **deactivated** symbols, which have no
  consumer, so none of the above applies to them. That erase was safe and verified.
- `retention.config.ts` — `marketbar: { dateCol: 'timestamp', defaultDays: 60 }`
- `nest/scripts/validate-retention-columns.cjs` — passes; it checks the *declaration* is sound, and
  cannot see whether the bound is applied or deep enough.
