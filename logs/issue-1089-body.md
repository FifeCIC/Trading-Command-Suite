## One un-fixed line: the deal lookup asks ONE bridge

`Mt5Adapter.getDeals()` (`nest/src/modules/providers/adapters/mt5.adapter.ts:770`) calls
`bridgeGet('/history?days=N')` **with no route**. `bridgeGet` then resolves
`route?.url ?? this.bridgeUrl` (`:314`), and `this.bridgeUrl = resolveMt5BridgeUrl()` (`:200`) —
which is `MT5_BRIDGE_URL` from `nest/.env` = **`http://localhost:5000` = broker 2**.

So every finalisation asks **broker 2's** deal history. A position on **broker 3** can never be found
there, the reconciler finds no closing deal, and `finalizeClosedPosition` writes the row from the
stale snapshot: `closeReason='broker:unknown'`, `exitPrice` = last snapshot price, `pnl` = floating
snapshot pnl, `closedAt` = now.

## Measured impact (2026-10-08)

Every symbol routed to broker 3 (`symbol_route` brokerId=3: VIX, GER40, FRA40, US30, UK100, XAGUSD):

| Symbol | closes | `broker:unknown` | any other reason |
|---|---|---|---|
| VIX | 8 | 8 | 0 |
| GER40 | 7 | 7 | 0 |
| FRA40 | 6 | 6 | 0 |
| US30 | 5 | 5 | 0 |
| UK100 | 4 | 4 | 0 |
| XAGUSD | 4 | 4 | 0 |
| **All-time incl. invalid rows** | **48** | **48** | **0 sl / 0 tp / 0 terminal / 0 time-stop / 0 null** |

Meanwhile every broker-2 (FX/gold) family carries real `broker:sl` attributions — the split is by
broker, not by accident.

### Four rows traced to their real deals on `:5001` — all present today

| trade | stored | real deal (`:5001`) |
|---|---|---|
| GER40 `93621464` (10-07 13:43) | `broker:unknown`, exit 25085.6, pnl −7.19 | sell @ 25073.9, **reason 4 (SL)** `[sl 25073.9]`, profit **−8.18** |
| US30 `93517113` (10-07 09:53) | `broker:unknown`, exit 51412, pnl −12.18 | sell @ 51394.7, **reason 4 (SL)** `[sl 51394.7]`, profit **−13.49** |
| VIX `93527728` (10-07 09:31) | `broker:unknown` | buy @ 16.58, **reason 4 (SL)**, profit −0.02 |
| VIX `93622601` (10-07 11:31) | `broker:unknown` | buy @ 17.02, **reason 4 (SL)**, profit −0.02 |

⚠️ **Not a timing race.** The VIX `93527728` row was written **6.5 hours after** its closing deal
existed (deal 02:56:17, row 09:31:58) — the evidence was long present on the right bridge, and was
never asked for there.

## What this corrupts downstream

- **Realised P&L** on these rows is the floating snapshot, not the fill (GER40 −7.19 vs −8.18).
- **Exit reason** is unrecorded — feeding the `broker:unknown` bucket (−337 net) that #916's
  re-measurement flagged as the blocker.
- **stop_adjustment absence (#1056)** shares three of these symbols (FRA40/GER40/US30) — the
  attribute-anything-about-a-close path is demonstrably blind for broker 3.

## Precedent — this class has been fixed THREE times; `getDeals` is the un-fixed twin

- `fetchAllBrokerPositions()` (`mt5.adapter.ts:704`, #883) — positions now fan out across
  `symbolRouter.brokerIds()`; its docblock documents this exact single-URL defect.
- `stop-guardian.service.ts:998` / `:1114` — "that URL was always the primary broker (`:5000`), so a
  position on broker 3 was never evaluated".
- `position-time-stop.service.ts:366` — same.

`getDeals` is the last single-URL deal reader in the exit path.

## Fix (this issue)

Mirror the #883 pattern: `getDeals` fans out across every active broker
(`symbolRouter.brokerIds()` → `routeForBroker(id)` → `/history`), merges, and warns when a broker
answers nothing. The no-router path (tests, single-bridge installs) is unchanged.

## NOT done here (explicit)

- **Repairing the 48 existing rows** from their real deals — possible via the `allowClosed` repair
  pass (#1014 pattern); separate decision once the lookup is fixed.
- **Refusing finalisation when a broker's deal history is unavailable** — the "authoritative"
  analogue of #883 for this path. Behaviour is preserved (warn + proceed) deliberately; a decision
  is needed on whether a missing broker's deals should defer the close.
- **XAUUSD's 19 `broker:unknown` rows are NOT this defect** — they are all A/B rows (11 A + 8 B)
  from the netting threads (#1079/#1080).

## QA Test Entry

- **area:** Trading / Position sync
- **name:** `getDeals` asks every active bridge
- **procedure:** with two brokers configured, run the multi-broker adapter spec
  (`mt5-adapter-multibroker.spec.ts`) — the `getDeals` cases stub `:5000` and `:5001` with distinct
  deals; canary by reverting the fan-out to the single URL and re-running.
- **expected:** both URLs are asked and both brokers' deals are returned (canary: the single-URL
  version fails the test).
