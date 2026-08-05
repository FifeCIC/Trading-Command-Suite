## Problem

EURCAD, GBPCAD, and USDCAD currently use `forex-session-v1` or `usdcad-oil-v1`. CAD pairs are uniquely driven by:
- **Oil (WTI/USOIL)** — Canada's top export; CAD strengthens with oil, weakens when oil drops
- **Canadian economic data** — GDP, employment, BoC rate decisions
- **USD/CAD inverse correlation** — CAD often moves opposite to broad USD

`usdcad-oil-v1` exists (6 dirs) but only covers USDCAD. The approach should be extended to cross-CAD pairs.

## Proposed protocol: `cad-crosses-v1`

Extend from `usdcad-oil-v1` (6 dirs) + add:
- Oil price correlation overlay (WTI candle data → CAD directional bias)
- Commodity-bloc weighting (AUD, NZD, CAD tend to move together against USD)
- CAD-specific economic calendar hooks (BoC rate decisions, employment data)
- Cross-pair spread awareness (EURCAD/GBPCAD wider spreads than USDCAD)

## Pairs covered
- EURCAD, GBPCAD (Tier 1 — already in auto)
- USDCAD (existing, currently on forex-session-v1)
- AUDCAD, NZDCAD, CADCHF, CADJPY (Tier 2)

## Tasks

- [ ] Review `usdcad-oil-v1` as starting template
- [ ] Add oil correlation directive that reads USOIL/WTI candles
- [ ] Add commodity-bloc momentum directive
- [ ] Build protocol, seed to DB
- [ ] Switch USDCAD, EURCAD, GBPCAD strategies to new protocol
- [ ] A/B compare vs baseline

## Acceptance
- [ ] `cad-crosses-v1` protocol registered with 10+ directives
- [ ] EURCAD, GBPCAD, USDCAD switched
- [ ] Oil sensitivity confirmed (CAD scores shift directionally with WTI)
