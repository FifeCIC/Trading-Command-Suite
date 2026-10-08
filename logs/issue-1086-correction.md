## Correction — the alert message OVERSTATED what the daily-loss cap does

⚠️ **The first version of this alert said the daily-loss cap was *"a LATCH — it cannot clear until local midnight"*. That is FALSE, and it was in an operator-facing message.** Corrected and redeployed.

### What is actually true

`trading-strategy.service.ts` recomputes the figure on every attempt:

```ts
const trades = await this.prisma.trade.findMany({
  where: { provider: 'mt5', closedAt: { gte: today }, pnl: { not: null } },
});
const dailyPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
```

It sums **every trade closed today** — so a **green** close today *raises* the total. At −£178.02, one **+£79** close brings it back above the cap and the gate **reopens mid-day**. It is not a latch.

What *is* true is narrower, and still worth attending:

> **it cannot be cleared by trading out of it, because opening a position is the very thing it blocks.** It clears only via a position **already open** closing green enough, or at local midnight.

### Deployed wording, verified

```
⚠️ This does NOT clear by trading out of it — opening a position is the very thing it
blocks. It clears only when a position ALREADY OPEN closes green enough to bring the
day back above the cap, or at local midnight.
```

Confirmed in the running build (`nest/dist/.../alert-trigger.service.js`): the corrected
phrase is present, and **neither** `cannot clear until` **nor** `LATCH` appears.

### The overstatement is now GUARDED

`alert-risk-cap-breach.spec.ts` asserts the old wording **absent** —
`not.toContain('cannot clear until')`, `not.toContain('LATCH')` — so it cannot return silently.
Canary **F** proves it: restoring *"a LATCH — it cannot clear until local midnight"* fails the suite.
**6 mutations, all 6 observed to fail, tree byte-for-byte on restore.**

### How it was found, and the lesson

The owner asked a plain question — **"what is a latch?"** Answering it required defining the term,
and the definition exposed that the thing I had called a latch does not meet it.

⚠️ **I reached for a familiar word because it made the two caps sound appropriately different, and a
familiar word carries an unexamined claim.** The alert's actual distinguishing property — *you cannot
trade your way out of it* — was available and accurate the whole time.

Corrected in: the alert message · the code `DECISION` marker · register **row 68** · the handoff.
The issue body is left as-filed; this comment is the correction.

⚠️ **Separately, and worth its own line: the Windows toast WORKED.** `nest/logs/console-build-api.log`
recorded, unprompted, at 21:23:00:

```
LOG [WindowsChannel] Toast sent: Trading blocked by the daily-loss cap
LOG [NotificationService] Notification sent via windows: Trading blocked by the daily-loss cap
```

So the attended half of the change is confirmed end-to-end on the live condition, not only in the suite.
