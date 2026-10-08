# The FX venue has NO holidays — so every index CFD and FX pair reads as OPEN on Christmas Day

**Split out of #850, criterion 3** (*"Holidays are covered for each added exchange"*), which could not be met and is why that issue closes on 4 of its 5 criteria.

---

## The measurement

`GET /api/calendar/holidays?exchange=…` on 2026-10-08:

| exchange | holidays |
|---|---|
| `US` | **36** |
| **`FX`** | **0** |

And the session definition has no holiday axis at all — `market-calendar.service.ts`:

```ts
const FX_SESSION: SessionInfo = {
  exchange: 'FX',
  timezone: 'Europe/London',
  regularOpen: '00:00',
  regularClose: '24:00',
  daysOfWeek: [0, 1, 2, 3, 4, 5],
  weekly: { openDay: 0, openTime: '22:00', closeDay: 5, closeTime: '22:00' },  // weekends only
};

const SESSIONS: Record<string, SessionInfo> = { US: US_SESSION, FX: FX_SESSION };
```

Every entry in the holiday table carries `exchange: 'US'`. **`weekly` covers weekends; nothing covers a weekday holiday.**

## Why it matters more than it looks

⚠️ **The FX venue is not only forex.** `venueForSymbol()` routes **every continuous CFD** to it — measured with the deployed build:

| symbol | venue |
|---|---|
| `UK100`, `FRA40`, `GER40`, `US500`, `US30`, `VIX` | `FX` — "CFD (broker week)" |
| `XAUUSD` | `FX` — "Metals (FX week)" |
| `EURUSD` | `FX` — "FX week" |

So **Christmas Day 2026 falls on a Friday** — inside the weekly window — and the gate would report **open** for a market that is shut, for every index, metal and FX pair in the app. `mt5-disconnected` would not fire (the bridges are up); nothing else watches for it.

⚠️ **This is the fail-OPEN direction, which is the opposite of the #850 defect it sits beside** — #850 was instruments wrongly *refused*; this is instruments wrongly *admitted*.

## ⚠️ The first task is the SOURCE, not the table

#850's own constraint applies verbatim here:

> **Do not invent market hours.** A guessed session table is worse than the current bug: it would trade at confidently wrong times, and it would look correct in review.

FX closure is a *convention*, not an exchange calendar — brokers differ on 24 Dec, 31 Dec and the early-January reopen, and **the instrument the app trades is a broker CFD, not the interbank market**. So the honest options are:

1. **Broker session data from the bridge** — the bridge already reports instrument specs; if a CFD's tradability can be read per-day, that is the authoritative answer and needs no table.
2. **A documented convention** — a static table with its source named in a comment, and a deliberate decision about who owns it when brokers differ.
3. **Both** — broker first, static fallback.

**Do not add a table before deciding which**, and do not add dates this issue guesses.

## Acceptance criteria

- [ ] Decide the source of truth for FX/CFD holidays, and record the **reason** (broker-reported vs documented convention)
- [ ] A weekday holiday on the FX venue reports **closed**, verified with a live clock at a date inside the window (25 Dec 2026 is a Friday and is the natural test)
- [ ] The correction is **fail-closed** in spirit: an unknown holiday state must not read as "open"
- [ ] Leave any early-close handling explicit — a half-day that reads as a full day is the same defect at smaller scale
- [ ] Guard: a canary proving the FX venue CAN report a weekday holiday as closed

---

**Related:** #850 (venue mapping — fixed) · #851 (session/market-hours consolidation — three files claim to be the source of truth) · #770 (the VIX short) · `external-systems-are-data.instructions.md`
