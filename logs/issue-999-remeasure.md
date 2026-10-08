## Re-measured 2026-10-07 — the reachable ceiling has MOVED: **380 of 910 (41.8%)**, not 145 (15.9%)

Not re-opening the issue — **correcting its arithmetic**, because the figure it is built on is no longer what the
database shows, and a stale number here sends the next reader to the wrong fix.

### Declared capacity — `xau-speed-m15` (unchanged, and matches this issue's 910)

```sql
SELECT e.directiveId, e.maxScore, g.isRiskGate FROM protocol_directive_group g
JOIN protocol_directive_entry e ON e.groupId=g.id
JOIN protocol p ON p.id=g.protocolId
WHERE p.slug='xau-speed-m15' AND e.active=1;
```

`rsi-oversold` 140 · `speed-momentum` 120 · `gold-macro-correlation` 100 · `volume-confirmation` 100 ·
`support-resistance-levels` 95 · `gold-session-profile` 90 · `bollinger-band-squeeze` 90 · `volatility-tools` 90 ·
`session-open-effect` 60 · `gold-round-numbers` 25 · **total 910**. (`liquidity-check` 100 is the risk gate.)

### Which directives actually emit a DIRECTIONAL class — last 24h, per `signalClass`

```sql
SELECT s.strategyId, jt.directiveId, jt.signalClass, COUNT(*), ROUND(AVG(jt.score),1)
FROM score s, JSON_TABLE(s.breakdown,'$.breakouts.*[*]' COLUMNS (
  directiveId VARCHAR(60) PATH '$.directiveId', signalClass VARCHAR(20) PATH '$.signalClass',
  score DOUBLE PATH '$.score')) jt
WHERE s.timestamp >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) AND s.strategyId='xau-speed-m15' GROUP BY 1,2,3;
```

| directive | maxScore | classes seen (ticks) | **reachable?** |
|---|---|---|---|
| `rsi-oversold` | 140 | **bullish 107** @ avg **89.3** · neutral 139 | ✅ **140** |
| `speed-momentum` | 120 | **bearish 119** · **bullish 50** · neutral 77 | ✅ **120** |
| `support-resistance-levels` | 95 | **bearish 239** @ avg 9.6 | ✅ **95** |
| `gold-round-numbers` | 25 | **bullish 134** · **bearish 112** | ✅ **25** |
| `gold-macro-correlation` | 100 | neutral only, avg 38.1 | ❌ |
| `volume-confirmation` | 100 | neutral only, avg 19.8 | ❌ |
| `gold-session-profile` | 90 | neutral only, avg **69.2** | ❌ |
| `bollinger-band-squeeze` | 90 | neutral only, avg 41.6 | ❌ |
| `volatility-tools` | 90 | neutral only, avg 36.1 | ❌ |
| `session-open-effect` | 60 | neutral only, avg 0.1 (3 scored) | ❌ |

**Reachable = 140 + 120 + 95 + 25 = 380 of 910 = 41.8%.**

### What changed, and why it matters

⚠️ **This issue's table recorded `rsi-oversold` as neutral on 549 of 549 ticks and `support-resistance-levels`
as 0 of 516. Both now emit directional classes.** So the *"8 of 11 permanently neutral"* framing no longer
describes the protocol: **6 of the 10 counted directives are still neutral-only; 4 are not.**

⚠️ **The conclusion is unchanged but the distance has moved, and that changes which issue owns the fix.**
This issue frames the problem as *"the denominator counts capacity that is unreachable by construction"*.
At **380 reachable**, the denominator is no longer the binding problem — **380/910 = 41.8% is within reach of
#761's measured "reachable is ~44%"**, and #761 is the issue that says the **thresholds** were calibrated
against the old inflated scale and now sit above what any protocol can score (`STRONG_PCT` 80 against a
best-ever of 32%).

**So: the reachable `380` and #761's `~44%` agree, independently.** Two issues describing the same wall from
different sides. #761 is the live one.

### Not done here

⚠️ **No threshold, weight or denominator was changed** — that is the maths, and it needs a copied
configuration and a backtest comparison (`maths-change-requires-ab`), not an edit. This comment only
corrects a measurement.

⚠️ **The four neutral-only directives above are NOT all broken** — `gold-session-profile` scores **69.2 of 90**
and contributes nothing, which is the same buried-ability shape as #1075/#1077. Whether each *should* be
directional is a per-directive question, not a denominator one, and is not answered here.
