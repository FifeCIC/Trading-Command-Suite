## Problem

119 forex pairs on MetaQuotes-Demo are tradeable but uncovered by META.Stacks. Building individual strategies for all of them is impractical. Many are exotic/emerging-market pairs with wide spreads, but a subset have enough volume to trade meaningfully — particularly USD-denominated EM pairs (USDZAR, USDTRY, USDMXN, USDCNH) and some regional crosses.

This issue groups the viable ones by theme so they can be covered with a small number of themed protocols rather than 119 individual issues.

## Tier 2 — USD EM pairs (highest volume, widest spreads)

| Pair | Why | Risk |
|---|---|---|
| **USDZAR** | South African Rand — high carry, volatile | Wide spreads, political risk |
| **USDTRY** | Turkish Lira — extreme carry, intervention risk | Very wide spreads, central bank interference |
| **USDMXN** | Mexican Peso — oil correlation, NAFTA/USMCA | Moderate spreads |
| **USDCNH** | Offshore Yuan — PBOC managed, trade-war sensitive | Moderate spreads |
| **USDHKD** | Hong Kong Dollar — pegged, low vol | Very tight spreads (pegged) |
| **USDSGD** | Singapore Dollar — MAS managed, Asia proxy | Moderate spreads |

## Tier 3 — Regional / exotic crosses (lower priority)

| Theme | Pairs | Approach |
|---|---|---|
| Scandinavian | USDNOK, USDSEK, EURNOK, EURSEK, NOKSEK | `forex-scandi-v1` — oil-sensitive (NOK), EU-tied (SEK) |
| Eastern European | USDPLN, EURPLN, USDHUF, EURHUF, USDCZK | `forex-ee-v1` — EU convergence, rate differentials |
| Asian EM | USDINR, USDKRW, USDIDR, USDTHB, USDPHP, USDMYR | `forex-asian-em-v1` — growth differentials, trade flows |
| LATAM | USDBRL, USDCLP, USDCOP, USDARS | `forex-latam-v1` — commodity-driven, political risk |
| Middle East/Africa | USDILS, USDNGN, USDGEL, USDZAR (already listed) | Wide spreads on MetaQuotes-Demo |
| RUB pairs | USDRUB, EURRUB | Geopolitical risk, sanctions volatility |

## Approach

- [ ] **Phase 1**: Create `forex-em-usd-v1` protocol covering the 6 Tier 2 USD EM pairs
- [ ] **Phase 2+**: Create regional protocols as trading volume on a new broker permits
- [ ] Use `forex-session-v1` as a temporary baseline where possible (same pattern as Tier 1)

## General principles for EM protocols

- Wider SL/TP defaults (2-3% vs 1%) to accommodate higher volatility
- Session weighting favors local market hours (e.g., USDZAR active during London/Johannesburg overlap)
- Lower max position count (1 per EM pair, tighter overall exposure limits)
- Political/event risk awareness (election dates, central bank meetings)

## Acceptance

- [ ] Tier 2 USD EM pairs have at least a baseline META.Stack (even if `forex-session-v1`)
- [ ] Regional protocol gaps identified and tracked
- [ ] EM-specific risk parameters documented (wider SL, lower position limits)
