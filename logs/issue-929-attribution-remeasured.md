## Re-measurement: the ATTRIBUTION blocker does not hold. The constraint is SAMPLE SIZE.

`maths-change-requires-ab.instructions.md` recorded the binding constraint as:

> *"the binding constraint is not capacity — it is ATTRIBUTION: A/B arms trade the same symbol on the same netting account, the positions merge, and the volume split is not resolving, so a verdict has nothing readable to stand on."*

That sentence was carried from a single 2026-10-01 observation. Per the rule's own text two sections up — *"a rule that cites a blocker must re-measure that blocker, not inherit it"* — it was re-measured today. **It is wrong as stated.**

### Measured 2026-10-06 — `GET /api/automation/ab-tests/:id/results`

| Test | `unattributed` | attribution counters | verdict |
|---|---|---|---|
| `b50727ee` (running) | **0** | attributed **104** · counted **13** · excludedRejected **91** | `insufficient-data` — **8 vs 5** closed |
| `a1bfc533` (complete) | **0** | 1 trade per arm | `insufficient-data` — **0 vs 0** closed |

- **Attribution RESOLVES.** Every tagged row carries a side, and `computeResults()` attributes by `trade.abTestSide` — not by the mutable `brokerComment` (this issue's own fix). Arms hold separate tickets.
- **The 91 `excludedRejected` rows are HISTORICAL** — dated **09-28 and 09-30 only**, i.e. before #1039's write-side fix. **No rejected A/B row has been written since 2026-09-30.**
- **The verdict machine works and behaves correctly.** On 8 vs 5 it returns `insufficient-data` and prints exactly why — *"noise wearing a result's clothes"*. That is the runner declining to over-claim, not failing.
- `arms` for `b50727ee`: `changedFields: ['tradeThreshold']`, `inertFields: []`, **`measurable: true`**.

### What is NOT re-opened here

The **identical-arms** observation is **already settled** — R40 recorded it, and it was traced to **R18 / #1054**: that pair's two stacks differ only in `weightStrategy`, which `protocol-gating.service.ts` (`DECISION`, register row 32) declares **INERT**. **No sample size could have produced a difference**, which is a different and more fundamental limit than throughput — and it applies to that pair only. #1054 was closed 2026-10-06 on that arms diff.

### One observation, left explicitly UNEXPLAINED

The variant (`tradeThreshold` **10**, clears ~70% of scores) holds **fewer** closed trades than the control (**55**, clears ~10.7%) — **5 vs 8**, the opposite of what signal frequency alone predicts.

A candidate explanation is that the two arms' orders net against each other on the same symbol and netting account, so only one position exists at a time. **That is a hypothesis and has NOT been measured — do not cite it as the cause.** It is named so the next reader starts from the right question instead of re-deriving the wrong one.

### Corrected in

- `maths-change-requires-ab.instructions.md` — the precondition section now carries the table above
- `src/data/theories.js` — the Theory Registry entry read *"A/B cannot report yet (#929)"*; corrected to say it needs a large sample
