## Follow-up measurements — scope confirmed, and why the existing guard misses it

Four measurements after filing. One new finding, one alarm checked and **not** confirmed.

### 1. `atr-trailing-stop` is EXIT-ONLY — it is in no protocol at all

`protocol_directive_entry` ⋈ `protocol_directive_group` ⋈ `protocol`:

| Directive | Protocols referencing it |
|---|---|
| `atr-trailing-stop` | **0** |
| `supertrend` | **0** |
| `chandelier-exit` | **0** |
| `wick-filter` | **0** |

All four are **guardian-only** inputs. So this is purely an **exit-path** defect — nothing in the scoring path is affected, and the `>= 55` consensus is the only consumer. That sharpens the impact statement in the issue body and is worth not having to re-derive.

### 2. ⚠️ Why `directive-guard.cjs` does NOT catch it — the fixture is a strong trend

`node nest/scripts/directive-guard.cjs --db` → **`0 error(s), 88 warning(s)`**, and `atr-trailing-stop` is **not named anywhere in it**, although `supertrend` (same source file) is.

Ran its compiled class against the guard's own two synthetic inputs (`logs/probe-guard-mode1.cjs`, fixture copied verbatim from `makeInput`, L207):

| Input | Result |
|---|---|
| `makeInput(0, 0.1)` (120 bars, gentle uptrend) | score **60** `bullish` — *"4.6% above long trailing stop"* |
| `makeInput(3, -0.6)` (120 bars, downtrend) | score **75** `bullish` — *"15.9% above long trailing stop"* |

Different scores → MODE 1's "identical output" test does not fire. **But `4.6%` and `15.9%` are exactly what the synthetic fixture manufactures** — a monotonic drift over 120 bars puts price far from the 20-bar extreme. On **real** 5m bars the same quantity measures **0.0001–0.0015** (0.01–0.15%), i.e. **30–100× smaller**.

So the guard's PASS is not evidence for this class: its fixture exercises the branch that live data cannot reach. ⚠️ **This is a property of synthetic fixtures generally, not a bug in MODE 1** — recorded so the next reader does not read `0 error(s)` as "no inert directives".

### 3. ⚠️ An alarm I checked and am NOT raising

MODE 7 reports five `ready` directives as *"CONSTANT in production"*. All five **are** reachable by active protocols — including `btc-halving-cycle`, whose `maxScore` is **200**, the largest single weight in the system:

| Directive | Active protocols | maxScore |
|---|---|---|
| `btc-halving-cycle` | 1 | **200** |
| `crypto-weekend-effect` | 2 | 50 |
| `earnings-momentum` | 1 | 100 |
| `sp500-regime` | 2 | 100 |
| `social-buzz` | 2 | 70 |

That looked like the same defect class at scale — so it was measured rather than filed. `directiveoutcome`, full history:

| Directive | rows | distinct scores | values |
|---|---|---|---|
| `btc-halving-cycle` | **1451** | **2** | **59 × 211, 60 × 1240** |

**It varies** — between two adjacent values, over a 4-day window, which is what a slow cycle directive should do. **MODE 7's "CONSTANT" is a suspicion and this one does not confirm a defect.** No issue filed.

⚠️ **Honest partial:** only `btc-halving-cycle` was measurable this way — the other four have **no rows** in `directiveoutcome` (MODE 7 reads a different source, `Score.breakdown`), so they remain **unmeasured**. `social-buzz` (715 sampled scores, 1 distinct value) is the one I would look at first if anyone picks this up.

### 4. The `--db` half reports 88 warnings and exits 0

Not a finding about this directive, but it is why §2 went unnoticed: findings at WARN level are advisory by design (`exit 1` only on a MODE 1 **static** error or a stale `dist/`). A detector whose output nothing consumes is the decoration the repo warns about — noted here rather than filed, because acting on it means deciding **which** warnings should gate a build, and that is a policy call, not a measurement.
