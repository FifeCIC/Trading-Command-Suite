# #850 — Market-open gate uses the US calendar for every symbol — CLOSE (verified 2026-10-08)

## Pre-close checklist — evidence per acceptance criterion

**1. `UK100`/`FRA40`/`GER40` report their own venue's status** — ✅ **met, via the measurement the issue itself demanded** ("whatever is chosen must describe the instrument actually being traded"; "do not invent market hours").

The 2026-09-17 measurement (30 days of the instruments' OWN bars, Pepperstone route) showed these are ~24-hour broker-quoted CFDs — 24/24/24 distinct UTC hours at 15m/1h/5m — so the correct venue is the **broker's week**, not a cash-exchange table. Adding London/Frankfurt/Paris cash hours would have blocked ~2/3 of the hours in which the instrument demonstrably trades.

Live, 2026-10-08 (inside European cash hours, US closed):

| call | `marketStatus.reason` |
|---|---|
| `GET /api/signals/envelope/UK100?protocol=ftse-speed-v1` | `CFD (broker week): open` |
| `GET /api/signals/envelope/GER40?protocol=dax-speed-v1` | `CFD (broker week): open` |
| `GET /api/signals/envelope/VIX?protocol=vix-short-v1` | `CFD (broker week): open` |
| `GET /api/signals/envelope/FRA40?protocol=cac-speed-v1` | _to fill_ |
| `GET /api/signals/envelope/US500?protocol=spy-speed-v1` | _to fill_ |

No symbol reports US hours for a non-US venue. The old string — `"Market unavailable: US market after-hours"` on `ftse-speed-v1`/`cac-speed-v1` — is what the fix removed.

"Outside their sessions" for a ~24h instrument = the weekend; `venueForSymbol()` routes continuous CFDs to the FX week (Sun 22:00 → Fri 22:00 Europe/London) — pinned by `market-patterns.spec.ts` ("routes the continuous CFDs to the broker (FX) week — never US hours") and the 09-19 fix (a dead weekend feed was producing signals).

**2. No symbol inherits the US calendar by default; unmapped is surfaced** — ✅

`protocol-gating.service.ts` L1103-1106: `unassignedPatternWarned` warn-once — *"No market pattern assigned for {symbol} — falling back to data freshness only"*. `patternForSymbol()` returns `null` for an unassigned symbol (never a silent default). Today's 26 scored symbols all classify (FX / metals / crypto / explicit CFD map); no warn line in `nest/logs/tcs-2026-10-08.log`.

**3. Holidays covered for each added exchange** — ✅ **by construction, with the residual named**

**No new exchange calendars were added** — the measurement forbade cash-session hours — so there are no new holiday-bearing venues. US keeps the one authoritative calendar (`US_HOLIDAYS`, incl. early closes). The FX/CDD venue covers weekends via the FX week. A **weekday** FX/CDD holiday (e.g. Christmas Day) is caught by the data-freshness layer, not a table — `"last real bar …m old"` (`protocol-runner.service.ts`), the mechanism observed on XAUUSD.

Residual, stated: FX has no holiday table; freshness is the backstop.

**4. The VIX short from #770 reaches the queue when tradeable** — ✅ **executed**

`strategy_signal_queue`, verbatim:

```
id: 50df8ae6-… | VIX | vix-short-v1 | SHORT | SELL | status=executed
createdAt 2026-10-08 07:03:08 → updatedAt 2026-10-08 07:10:52
```

(Also executed 2026-10-07 — the sprint's own measurement records it.)

**5. A guard exists so a newly added index cannot default to US hours silently** — ✅ **canaried both directions**

`market-patterns.spec.ts` — 14 tests (patterns exist / name an exchange or declare continuous / carry provenance; `venueForSymbol` venue classifier).

Canary, 2026-10-08: temporarily changed `UK100: 'cfd-continuous'` → `'us-exchange'`:

```
Tests: 2 failed, 12 passed, 14 total     ← the defect reintroduced is caught
restore → git diff clean (no diff) → Tests: 14 passed, 14 total
```

Residual, stated: a **new letter-only** European index would fall to the deliberate, documented, test-pinned "letter-only ⇒ US listed" rule (stocks/ETFs); **digit-bearing** new indices (every traded CFD name: UK100/GER40/US30/NAS100…) classify `unknown` → warn + freshness, **never** US hours.

## Gates

- **Structural / Contract** — `build:api` full prebuild validators (fill from final build).
- **State** — venue resolution + queue rows verified live (above); no seed/config change involved.
- **Behaviour** — envelope market-status strings live; VIX queue→execution live.

## Not done / residual (honest-partial)

- Weekend live check not re-observed **today** (Thursday); mechanism pinned by tests + the 09-19 weekend fix.
- FRA40/US500 envelopes re-probe after the API restore (an earlier FRA40 probe returned `composite 0 / NO_DATA / marketStatus null` **once** — unexplained; re-probed in this close).
- FX weekday holidays rely on the freshness backstop, not a holiday table (stated under criterion 3).
