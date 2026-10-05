## Phase 2 — D as the derived dataset. FALSIFIER ANSWERED.

**Phase 1 falsifier:** *can the generated graph answer question 1 (`marketbar` writers) or question 2 (no consumer)?* → **yes**, so Phase 2 proceeded.

**Phase 2 falsifier:** *can it answer question 3 — a value produced in more than one place?* → **yes, and it found more than the manual audit did.**

---

### Q3 answered mechanically

| Tier | Question | Result |
|---|---|---|
| `exact` | Is this the *identical* computation? | 43 groups. The #1069 group has **4 sites** and is flagged **`divergent`** |
| `coarse` | Same **shape**, different constants? | 40 groups — where divergent maths hides |
| `idiom` | `(A-B)` **and** `(B-A)` in one expression? | **1 group, 5 sites** |

The single idiom group is the #1069 family:

```
nest/src/automation/stop-guardian.service.ts:1541   observeSimulatedTsl()   isBuy
nest/src/automation/stop-guardian.service.ts:1659   observeExhaustion()     isBuy
nest/src/scoring/exit-consensus.service.ts:373      assessOne()             side==='buy'  guard: entry>0
nest/src/scoring/exit-consensus.service.ts:374      assessOne()             side==='buy'  guard: peak==null||entry<=0
nest/src/common/trading/peak.ts:96                  profitPctFor()  ← CANONICAL
```

**The fifth site is new information.** `exit-consensus.service.ts:374` (`peakProfitPct`) applies the same arithmetic to the **peak** price. #1069's manual audit lists four sites and this is not one of them. It was verified by reading the source, not inferred from the tool.

### ⚠️ The exact tier finds 4; the canonical is NOT one of them — and that is the design

`peak.ts:96` writes the same maths with a **different shape**: the division sits inside each ternary branch and `* 100` is a separate statement.

```
the three copies :  ((C ? V1-V2 : V2-V1) / V2) * 100
the canonical    :  C ? (V1-V2)/V1 : (V2-V1)/V1        then a separate `raw * 100`
```

So an **exact-only** scan reports the canonical as unrelated — a wrong answer to the owner's question. The **idiom tier** is what makes it right. Both halves are asserted in the self-test:

- `idiom tier: the CANONICAL (peak.ts) is among them — a re-derived copy, not a text match` → **passes**
- `CANARY — the exact tier CANNOT see the canonical, which is why the idiom tier exists` → **passes**

### `divergent` — the flag that is the actual finding

A group whose sites apply the **same conditions** is a copy, and a copy is usually harmless. A group whose sites **disagree** about their conditions or guards is #1069 exactly: identical arithmetic, different edges. Computed from the data and asserted:

> `the #1069 group is flagged DIVERGENT — same maths, different edges` → **passes**

The report prints this section **first**, because the #1069 group has 3–4 sites and ten other groups have more — ordered by size alone it is buried.

---

### ⚠️ Two silent under-reports, both found inside the tool

Same failure signature as the Phase 1 silent zero — **plausible output, no error**.

| # | Symptom | Cause | Measured |
|---|---|---|---|
| 1 | `Mt5TradingService.placeOrder` reported with **0 consumers** against **11 call sites** | call sites resolve to a **Transient Method** symbol (`flags 33562624`); the declaration is a **Method** symbol (`8192`). `===` matched none | bridging by **declaration node** fixed it |
| 2 | **Every interface implementation looked dead** — six members of `trading212.adapter.ts` | a caller holding `ProviderAdapter` resolves to the interface's `MethodSignature`, not to the class method | implemented interfaces now credited |

**Both were caught by naming a function we know is called.** The generic floor — *"at least one function has a consumer"* — passed while both were broken. `unreferenced` went **422 → 129**, and of those **78 have no same-name call anywhere**.

The same measurement produced a fact worth keeping: **`placeOrder` is declared five times** in this backend (two adapters, a paper-trading service, an interface, and `mt5-trading.service.ts`). A text search finds 11 call sites and attributes all 11 to one name. The five stay apart here, and that is asserted.

---

### Also filtered, from measurement

The first run's largest `exact` group was **`V1/V2` with 93 sites** — `posFlow/negFlow` grouped with `volumes[i]/scaleFactor`. A false positive by construction, and 93 of them buried the four real ones. A bare ratio is now rejected: a computation whose edges can diverge needs an operator to diverge in.

**Known limits, stated rather than implied:** the scan covers **ratios** (`size * riskPct` is not reported); and `unreferenced` is a **candidate list** — a method reached only through a dynamic lookup will appear in it and is not dead.

---

### What Phases 3–4 now have to work with

`docs/PIPELINE-MAP.json` (694 KB, compact) and `.md` (47 KB), both `--check`ed in `prebuild`.

- **Phase 3** — `/development/pipeline-graph-lab` gains input/output lines per node, reading **D**. The dataset now carries what a renderer needs: inputs, resolved return type, consumer list, and the maths groups.
- **Phase 4** — the score is now measurable on all three questions: **1 yes, 2 yes, 3 yes**. What is *not* yet measured is **how fast** each approach answers them, which the phase plan asks for.

**One risk to watch, flagged not solved:** this gate stales far more often than `docs-facts` or `tools-index` — those fire on a count changing, this fires whenever **any** file starts or stops touching one of the eleven resources, or when a ratio is added anywhere. Observed once already during this phase. If it becomes noisy it wants to be report-only; that is Phase 4's call, made on frequency rather than on this note.
