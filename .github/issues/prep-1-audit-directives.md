## Problem

We keep saying "~25 real directives" but nobody has actually counted. Before Layer A (marking readiness on every directive), someone needs to open each of the 104 directive files and classify them. Without this audit, every task in #516 starts with "well, which directives do I touch?"

## Task

Open every directive implementation file in `nest/src/modules/directives/implementations/` and classify it:

| Classification | Criteria |
|---------------|----------|
| **READY** | Real math on real bar data. Deterministic output. No mock/stub fallback. |
| **BETA** | Real math but uses proxy/indirect data (e.g. EURUSD proxy for DXY). Document the limitation. |
| **ALPHA** | Returns mock-neutral (score=50), stub (score=0), or placeholder. Not connected to real data. |

## Deliverable

A markdown table committed to `docs/directive-readiness-audit.md`:

```markdown
| Directive ID | Readiness | Notes |
|-------------|-----------|-------|
| rsi-oversold | READY | Real RSI math on bars |
| bollinger-band-squeeze | READY | Real bandwidth calculation |
| dxy-regime | BETA | Real math, uses EURUSD proxy (~0.85 correlation to DXY) |
| news-sentiment-positive | ALPHA | Returns mock-neutral, no API keys |
| support-resistance-levels | ALPHA | STUBBED, returns 0 |
| ... | ... | ... |
```

## Acceptance

- [ ] All 104 directive files audited
- [ ] Classification table committed to `docs/directive-readiness-audit.md`
- [ ] Each directive has a 1-line note explaining the classification
- [ ] Directive files NOT modified — this is an audit only

## Related

- #516 (Layer A: Readiness Tiers)
