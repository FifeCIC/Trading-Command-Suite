# MT5 scale-ins: we store the ORDER ticket where the reconciler needs the POSITION id — 13 trades falsely "vanished"

Found 2026-09-28 by comparing our `trade` table against MT5's own deal history at the
owner's request ("this matter needs to fully understood").

## Symptom

13 closed rows carry `pnlInvalid: 1` with the reason
`exit-unknown: position vanished; no broker deal history and no last price`, all with
`pnl NULL`, `exitPrice NULL` and a `brokerTicket` that **looks** valid.

⚠️ **The first reading of this was wrong and is recorded here so it is not repeated.** The
~115s lifetime of the newest three was read as "a 2-minute trade", then as "the app lost a
position that is still open". **Both are wrong.** MT5 held no such positions (9 live, none
XAUUSD) and the positions genuinely closed.

## Root cause — a ticket-namespace mismatch

MT5's own deal history for those tickets:

```
posId=152690675067  buy 0.01 @4146.30  reason=3  'TCS AB-A 929 measurable run'  08:52:17
posId=152690675067  buy 0.01 @4145.83  reason=3  'TCS AB-A 929 measurable run'  09:35:55
posId=152690675067  buy 0.01 @4145.83  reason=3  'TCS AB-B 929 measurable run'  09:35:55
posId=152690675067  buy 0.01 @4151.32  reason=3  'TCS AB-A 929 measurable run'  09:43:53
posId=152690675067  sell 0.04 @4157.11 reason=4  '[sl 4157.11]'                 12:28:00
```

**All four orders belong to ONE position.** Our DB stored a *different* `brokerTicket` per
order (`152690940846`, `152690940848`, `152690988172`), and
`position-sync.service.ts` looks up closing deals by
`deal.positionId === dbPos.brokerTicket`:

- `order.ticket` and `position_id` are **different namespaces** in MT5.
- They never intersect → zero closing deals → `exitPrice` null → `pnlUnknown` →
  the row is finalised as `position vanished`.

So the message is a **label for "closed with no computable result"**, not an observation.
The phrase "position vanished" is the message author's interpretation.

### Compounding: the account is NETTING

All four orders share one `positionId`, so every order on a symbol merges into one
position. **Our book creates a separate `trade` row per order**, so one real position
became four rows — three of which could never reconcile. The primary open path stores the
**position** id correctly (`152690675067`); the scale-in path stores the **order** id.

## Consequences

1. **13 rows are falsely closed**, with `closedAt = new Date()` — the time the *app noticed*,
   not the time the broker closed. Every "lifetime" derived from `closedAt` is app latency.
2. **Book divergence on netting accounts**: N rows for one position, N−1 unreconcilable.
3. **The outcome was hidden.** The real position closed by a *trailed* stop at 4157.11 above
   its ~4147.3 blended entry — roughly **+$39**. The owner believed it had bled; the app
   could not have told them either way because `pnl` was NULL.

## Also found: a now-stale comment that suppresses attribution

`position-sync.service.ts` (~line 578) states *"The running bridge does not forward that
field yet, so this yields `broker:unknown` — deliberately."* **The bridge does forward it** —
`/history/deals` returns `reason`, and a real stop-loss measured `reason=4`. So a
cause that is available is being reported as unknown.

## Measured population

| group | tickets | lifetime (`closedAt − openedAt`) |
|---|---|---|
| XAUUSD A/B pairs (6) | 12-digit (order ids) | 48s, 48s, 113s, 113s, 115s, 115s, 116s |
| XAGUSD / FRA40 / UK100 / VIX (7) | 8-digit | 4,076s … 256,163s (71h) |

All 13 have a non-null `brokerTicket` — none were missing an id, they were missing the
*right kind* of id.

## Not done

- No fix applied. The correct shape is a decision: whether a netting account's position
  should be **one row with fills**, or many rows carrying a shared `positionId`. That
  affects the trade journal, per-bot attribution (#894) and every P&L the owner reads.
- The 13 rows are left as-is rather than swept — a sweep would destroy the only evidence.
- `closedAt` was not corrected.
