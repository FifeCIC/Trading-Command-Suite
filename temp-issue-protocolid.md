## Summary

`trading_strategy.protocolId` holds **either a protocol slug or a protocol UUID**, with no rule and no constraint. Any lookup that assumes one form silently sees the other bots as non-existent.

Found while working #772. This is a **latent trap**, not currently a live outage — recorded so the next investigator does not draw a false conclusion from it.

## Evidence (2026-09-11)

| Protocol | bots storing **slug** | bots storing **UUID** |
|---|---|---|
| `forex-session-v1` | **14** | 0 |
| `xau-speed-1h` / `4h` / `m5` / `m15` | 1 each | 0 |
| `cac-speed-v1` | 0 | **1** |
| `dax-speed-v1` | 0 | **1** |
| `ftse-speed-v1` | 0 | **1** |
| `hourly-3dir-v1` | 0 | **1** |

So `WHERE protocolId = 'cac-speed-v1'` returns 0 bots, while the bot exists — and `WHERE protocolId = 'd6386512-acfc-11f1-951d-9c6b00b28963'` finds it. Either query alone gives a **wrong answer with no error**.

## Why it is dangerous

`ProtocolDbService.resolveSymbols()` already had to defend against this — its own comment says:

> *"The id passed in may be a protocol SLUG (automation loop / control config) or a UUID. Resolve to the canonical Protocol row so the DB lookups below match either way — otherwise every symbol silently falls back to the hard-coded hints in Path 3 (#747)."*

That defensive pattern was added in **one** place. Everywhere else that joins on `protocolId` is exposed to it. And the failure mode is the dangerous kind flagged repeatedly in `change-completion.instructions.md`: **plausible output, no error.**

## Consequence I hit

I initially concluded 9 active protocols had "no bot" and therefore could never dispatch. That was **wrong** — 4 of them were invisible only because their bot stores a UUID. The conclusion was an artifact of my own query, not a property of the system. That is exactly how a wrong diagnosis gets written down as fact.

## Scope of the fix

1. **Measure** — count bots whose `protocolId` is a UUID vs a slug, and check every join site.
2. **Normalise** — pick one form (slug appears to be the majority and matches `score.strategyId`), migrate the outliers.
3. **Guard** — a validator that fails the build if a `trading_strategy.protocolId` does not resolve to a `Protocol` row under the canonical form.
4. **Check** — audit other tables storing `protocolId` for the same ambiguity (`strategy_signal_queue`, `score`, `scoring_strategy`, `symbol_protocol_assignment`, `protocol_score_status`).

## Acceptance

- [ ] Count reported: bots by slug form vs UUID form
- [ ] One canonical form chosen and documented
- [ ] Outliers migrated (targeted `UPDATE` — **never** `db push`, see #769)
- [ ] Build-time guard added, and it fails on a non-canonical `protocolId`
- [ ] Other `protocolId` columns audited and reported
- [ ] No code change to the scoring engine (this is a data/consistency defect, not a scoring one)

## Related

- **#772** — where this was found (VIX short wiring)
- **#770** — short-side epic
- **#769** — schema drift / no migration history
- **#747** — the earlier `resolveSymbols` fallback bug this defence was added for
