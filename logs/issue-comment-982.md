Evidence from a whole-strategy audit (2026-10-06, bot "Tokyo EURJPY Session" + `forex-session-v1`).

**The same city resolves two ways across twin bots** — the NULL ambiguity this issue names is not only "unfilled vs deliberately all-hours"; it is *inconsistent between twins inside one protocol*:

| city in the name | gated twin | window | ungated twin |
|---|---|---|---|
| Tokyo | USDJPY | `["asian"]` | EURJPY — NULL |
| Sydney | AUDUSD | `["asian"]` | AUDJPY — NULL |
| Wellington | NZDUSD | `["asian"]` | NZDJPY — NULL |
| Zurich | USDCHF | `["london"]` | EURCHF — NULL |

Plus 4 session-named bots ungated with no city word: EURCAD/GBPCAD "Macro Session", GBPUSD "Session", USDCAD "Forex Session".

`session-window.ts` (#759) records that the SEEDED city names meant the **news-flow** reading ("driven by Sydney news", not "the Sydney clock") — the same reading that made parenting them to a clock "the opposite of a fix". If that holds, the four GATED twins are enforcing a clock the name never meant; if the names meant clocks, the four NULL twins are unfilled. Either way the audit half (#981) should surface the **twin disagreement**, not only the per-bot "ungated" note — an operator reading one row cannot see that its sibling answers differently.

No trading hours were changed: the window is the owner's intent to declare, per #759's own rule ("report the question; do not answer it by editing the bot's trading hours"). Data source: `trading_strategy` (read 2026-10-06 ~20:30 UTC, all 40 active bots).
