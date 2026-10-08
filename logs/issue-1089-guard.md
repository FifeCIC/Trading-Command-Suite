## Class guard closed (2026-10-08) — rule 5 in `validate-single-bridge-position-io.cjs`, canaried on the tree

The gate that owns this class (INV-POSITION-IO-IS-BROKER-ADDRESSED — built for #1030, extended for #1033) **could not see the adapter**: rule 1 is scoped to `automation/`, rule 2 matches a `.getUrl()` CALL while the adapter reads its own field, and rules 3/4 match position reads by receiver. **Rule 5** closes that:

| Guarded shape | Fails when |
|---|---|
| `getDeals()` must not call the bridge directly | the single-URL call is reverted |
| the fan-out must enumerate `brokerIds` | the helper is deleted |
| the fan-out must pass a `route` on its `/history` call | someone drops `, route` and silently asks one URL N times |

- 5 new self-test cases (reverted shape flags · fixed shape passes · route-removed flags · scoped to the adapter · the real file passes) — **28/28 self-test**.
- **Tree canary, both directions, measured:** mutated adapter → gate exits **1** naming the defect; restored → exits **0**; byte-for-byte restore verified.
- The guard's header now carries the correction (its blind-spot list missed this site), and the marker/register/handoff all cite the gate.

## Adjacent single-URL reads — two named, neither is this defect

- `KNOWN_BLIND_SPOTS` already declared `mt5.controller.ts`'s `GET /history` (module `BRIDGE_URL`, display endpoint) — unchanged.
- ⚠️ The #1033 exception claimed the `bridgeUrl` getter had **two** consumers; measured today it has **three**: `getAccount()`, `getPrimaryPositions()`, and `getHistory()` — a raw bridge-history read whose UI caller is **unreachable** (`fetchMt5History()` has no frontend reference). The exception text now names it so the count is not quietly wrong; the read itself is left unchanged (display-only, no caller).
