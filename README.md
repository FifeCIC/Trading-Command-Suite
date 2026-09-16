# Trading Command Suite

![Status](https://img.shields.io/badge/status-alpha-orange)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

**Algorithmic trading & portfolio management platform.** Multi-broker, multi-session scoring engine with protocol-gated directive pipelines, automation loop, and decision-trail audit chain.

Built by [FifeCIC](https://fifecic.scot) | [Ryan Bayne](https://github.com/RyanBayne)

---

## What It Does

- **META.Stack Scoring** (**M**odular **E**xpert **T**rading **A**rchitecture) — protocols built from inspirable directives across technical, sentiment, and risk groups. Protocol-gated scoring (~14 directives per protocol) is ~7× cheaper than flat scoring.
- **Automation Loop** — 120s tick cycle. Scores strategy symbols, gates through risk chains, dispatches trades, covering Tokyo, London, and US sessions.

> 🔢 **The counts are deliberately not written here.** Every number this README used to quote
> (protocols, directives, adapters, active strategies) had gone stale, because a count in prose is a
> second copy of something the system already knows — and the second copy is the one that rots.
> Current totals live in **[`docs/GENERATED-FACTS.md`](docs/GENERATED-FACTS.md)**, which is generated
> and **fails the build if it disagrees with the repo**. Nothing in this file should quote a number
> that file owns.
- **Decision Trail** — Full audit chain from trade → dispatch → gate → score → directive → market data. Queryable via `GET /api/automation/decision-trail`.
- **Multi-Broker** — a provider-adapter layer spanning FX, equities, crypto and macro data (MT5, Alpaca, Trading212, Capital.com, Interactive Brokers, Binance, Polygon, Finnhub, FMP, Twelve Data, Alpha Vantage, ECB, FRED and others). The current adapter total is in [`docs/GENERATED-FACTS.md`](docs/GENERATED-FACTS.md) — it changes, so it is generated, not listed here.
- **A/B Testing Foundation** — Protocol variants with `derivedFrom` lineage. LONG vs SHORT comparison stored per tick. Ready for side-by-side protocol evaluation.

## Architecture

```
React 18 + Vite (5173)     ← PWA frontend
NestJS (3201)              ← API + scoring engine
MT5 Bridge (5000)          ← Python bridge to MetaTrader 5
MySQL + Prisma             ← Persistent state
```

## Tech Stack

- **Frontend**: React 18, Vite, TanStack Query, Zustand, Zod, PWA plugin
- **Backend**: NestJS, Prisma ORM, MySQL
- **Trading**: MT5 Python bridge, multi-provider adapter layer, protocol-gated scoring
- **Dev Tools**: Dev Overlay with inspect-to-open-in-VS-Code, feature flags, bundle budget checker

## Quick Start

```bash
git clone <repo-url> trading-command-suite
cd trading-command-suite
npm install
cd nest && npm install && cd ..

# Start the full stack (MT5 Bridge → NestJS → Vite)
pwsh -File scripts/tcs-launch.ps1

# Or individual services
npm run dev                  # Vite frontend (5173)
npm --prefix nest run start  # NestJS API (3201)
```

## Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | System health (DB, providers, queue) |
| `GET /api/scoring/gated/protocols` | List all protocols with directive groups |
| `POST /api/scoring/gated/batch` | Protocol-gated scoring (canonical META.Stack) |
| `GET /api/scoring/ranked` | Flat scoring overview (dashboards) |
| `GET /api/automation/status` | Loop state, active strategies, broker states |
| `GET /api/automation/decision-trail` | Full audit chain for any trade |
| `POST /api/system/reload-config` | Hot-reload directives + protocols (~20ms) |

## Available Scripts

- `npm run dev` — Vite dev server (5173)
- `npm run build` — Production build
- `npm run lint` — ESLint
- `pwsh -File scripts/tcs-launch.ps1` — Start full stack
- `pwsh -File scripts/tcs-stop.ps1` — Stop full stack

## Ops Notes

- Central docs: `G:/My Drive/Project Management/Live/Trading-Command-Suite-Documentation/DOCUMENTATION-INDEX.md`
- Agent rules: `.github/instructions/`
- Active sprint: `G:/My Drive/Project Management/Live/Trading-Command-Suite-Documentation/.agenticmemory/SPRINT.md`
- **Prisma — 🛑 never run `db push` here.** It drops every table with no Prisma model (**13** at present,
  including `strategy_signal_queue`, the trade execution queue) and does **not** error. For a **fresh**
  database use the `prisma migrate diff` recipe in `SETUP.md`; to change a column use `ALTER TABLE`
  followed by `npx prisma generate`. Full rules: `.github/instructions/database-schema.instructions.md`.
- **Re-deriving the counts.** Volatile numbers in any doc should be measured, not trusted:
  `npm run docs:facts` prints them, `npm run docs:facts:check` fails if the published copy is stale,
  and `GET /api/architecture/facts` returns the same facts as JSON. For live row counts (symbols,
  bars, scores) query the API — those are never published. A doc that quotes a count without one of
  these is a claim, not a fact.

## Licence

GPL-3.0 — see [LICENSE](LICENSE) for details.
