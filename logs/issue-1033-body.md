## What is wrong

`#1030` fixed post-entry **exit management** (stop guardian, position time-stop) so it addresses the
bridge that holds the position. The same defect remains on the **read path**, which `#1030`
deliberately did not touch because it changes behaviour for a different set of consumers.

`Mt5ConnectionManager.getUrl()` with **no argument returns the PRIMARY bridge**. With
`MT5_ACTIVE_BROKERS=2,3` that is MetaQuotes `:5000`; Pepperstone `:5001` is a second, live account
that the following reads never mention.

## Measured live 2026-09-30

| bridge | positions | symbols |
|---|---|---|
| `:5000` (broker 2) | **7** | GOOGL, AAPL, MSFT, NZDJPY, GBPCAD, GBPUSD, XAUUSD |
| `:5001` (broker 3) | **2** | US500, GER40 |

Any read bound to the primary returns **7 of 9**.

## Instances

| File | Site |
|---|---|
| `nest/src/modules/providers/mt5.controller.ts` | `GET /api/mt5/positions` (L393) |
| `nest/src/modules/providers/mt5.controller.ts` | close-all loop (L509) |
| `nest/src/modules/trading/mt5-trading.service.ts` | `getPositions()` via the bare `bridgeUrl` getter (L87, L146) |
| `nest/src/modules/trading/mt5-trading.controller.ts` | `GET /api/trading/positions` (L28) |

## ÔÜá´©Å Why this is NOT a two-line fix

`Mt5TradingService.getPositions()` has **at least nine consumers**, several of them money-adjacent:

```
mt5-trading.service.ts        459, 572, 608, 626   (close-all, partial close, lookups)
trade-history.controller.ts   237, 942
trading-strategy.service.ts   1607, 1822, 1912
exit-consensus.service.ts     255
signal-envelope.service.ts    1427
```

Changing it to `getAllPositions()` would change behaviour in **every one of them at once** ÔÇö and
some of them then act on what they read. A position on broker 3 surfaced to a close path that
addresses broker 2 is worse than the current gap: the current gap is silent absence, that would be
a wrong-account action.

**So this needs a per-consumer decision, not a swap.** That is the reason it is a separate issue
rather than part of `#1030`.

## Acceptance

- `GET /api/mt5/positions` returns a broker-3 position, each row stating which account it came from.
- Each of the nine consumers is **named** and classified: read-only display, or acts on the result.
  For any consumer that acts, the action is broker-addressed (see `#1030` for the pattern).
- The `bridgeUrl` getter's remaining legitimate use is stated (`getAccount()` is genuinely a
  primary-account read) or the getter is removed.
- `INV-POSITION-IO-IS-BROKER-ADDRESSED` (`nest/scripts/validate-single-bridge-position-io.cjs`)
  covers this path once it is correct, so the exception it currently carries can be deleted.

## Related

- `#1030` ÔÇö the exit-management fix (landed). Same class, management half.
- `nest/scripts/validate-single-bridge-position-io.cjs` ÔÇö the build gate, which carries a
  line-anchored exception naming this issue.

