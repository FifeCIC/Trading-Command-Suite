# Protocol Consensus Engine

**Status:** active
**Category:** C — reference / contract
**Created:** 2026-07-06
**Last updated:** 2026-07-06
**Owner:** TCS team


Runs **all 47 protocols** against a single symbol and produces an ensemble vote. Instead of picking one protocol, this is "wisdom of the crowd" — a large majority of protocols agreeing on BUY is far stronger than any single protocol's output.

---

## API Endpoint

```
POST /api/scoring/arena/consensus
```

### Single Symbol

```json
{ "symbol": "XAUUSD" }
```

### Batch Mode

```json
{ "symbols": ["XAUUSD", "EURUSD", "AAPL"] }
```

Capped at 20 symbols to avoid timeout.

---

## Response Structure

```json
{
  "symbol": "XAUUSD",
  "totalProtocols": 32,
  "scoredProtocols": 28,
  "votes": {
    "bullish": 18,
    "bearish": 6,
    "neutral": 4
  },
  "consensus": {
    "dominantSignal": "bullish",
    "agreementPct": 64.3,
    "weightedScore": 68,
    "conviction": "moderate"
  },
  "topProtocols": [
    { "protocolId": "mtf-conservative-v1", "score": 82, "signal": "bullish", "confidence": 0.85 },
    ...
  ],
  "dissentingProtocols": [
    { "protocolId": "divergence-suite-v1", "score": 28, "signal": "bearish", "confidence": 0.72 },
    ...
  ],
  "recommendation": "MODERATE confidence BUY: 64% of protocols agree (18B/6S/4N). Weighted score: 68. ⚠️ Dissenters: Divergence Suite V1."
}
```

---

## How to Read the Results

### Dominant Signal
- **bullish:** ≥65 composite from the majority
- **bearish:** <35 composite from the majority
- **neutral:** 35–65 range
- **mixed:** Equal bullish/bearish counts — no edge

### Agreement Percentage
What % of protocols (that produced a valid score) agree with the dominant signal.

| Agreement | Meaning |
|-----------|---------|
| ≥75% | **Strong conviction** — the crowd is aligned |
| 55–74% | **Moderate conviction** — decent agreement, check dissenters |
| 35–54% | **Weak conviction** — fragmented views, wait for clarity |
| <35% | **No consensus** — market is undecided, stay out |

### Weighted Score
Confidence-weighted average across all protocols. A protocol with 90% confidence counts more than one with 40% confidence.

### Dissenting Protocols
The strongest protocols that **disagree** with the dominant signal. Pay attention to these — they're the smart contrarians. If a high-weight protocol like `mtf-conservative-v1` is a dissenter, that's significant.

---

## When to Use

| Scenario | Action |
|----------|--------|
| **Pre-trade check** | Run consensus on your candidate symbol. Only enter if conviction is moderate or strong. |
| **Portfolio review** | Batch-consensus all your positions. Flag any with "weak" or "none" conviction for review. |
| **Protocol comparison** | Check `topProtocols` to see which protocols are driving the consensus — these are your best-fit protocols for current conditions. |
| **Conflict detection** | Check `dissentingProtocols` — if your favorite protocol is a dissenter, your thesis may be wrong. |

---

## Technical Notes

- Requires ≥30 hourly bars in the database per symbol
- Protocol scoring failures (insufficient bars, calculation errors) are silently skipped — a protocol that can't score doesn't vote
- Scoring happens in real-time, no caching — allow 2–5 seconds per symbol
- Uses the full `ProtocolGatingService.scoreWithGating()` pipeline including risk gating
