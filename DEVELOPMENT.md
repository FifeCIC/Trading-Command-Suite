# Trading Command Suite — Development Guide

## Prerequisites

- **Node.js** 18+ (tested on 24.13)
- **MySQL** 9.1 (via WAMP or standalone) with database `tradingcs`
- **npm** 10+

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/FifeCIC/trading-command-suite
cd trading-command-suite
npm install

# 2. Install NestJS backend deps
cd nest
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL and API keys

# 4. Setup database
npx prisma migrate dev
npx prisma db seed

# 5. Start backend (terminal 1)
npm run start:dev

# 6. Start frontend (terminal 2)
cd ..
npm run dev
```

## Project Structure

```
trading-command-suite/
├── src/                    # React frontend (Vite)
│   ├── pages/              # Page components
│   ├── components/         # Shared components
│   ├── core/               # API client, nav tree, features
│   ├── stores/             # Zustand state
│   ├── hooks/              # Custom hooks
│   └── utils/              # Feature flags, utilities
├── nest/                   # NestJS backend
│   ├── src/
│   │   ├── modules/        # Domain modules
│   │   │   ├── scoring/    # SEES scoring pipeline
│   │   │   ├── directives/ # 5 MVP directive implementations
│   │   │   ├── providers/  # Provider adapters (Alpaca, etc.)
│   │   │   ├── symbols/    # Symbol CRUD
│   │   │   ├── market-data/# Freshness service
│   │   │   └── system/     # Logging, metrics
│   │   ├── common/         # Middleware (rate limiter, metrics)
│   │   └── database/       # Prisma service
│   └── prisma/             # Schema + migrations
└── docs/                   # Architecture docs
```

## Available Scripts

### Frontend
| Command | Description |
|---|---|
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

### Backend
| Command | Description |
|---|---|
| `npm run start:dev` | NestJS dev server (port 3201) |
| `npm run build` | TypeScript compilation |
| `npx prisma migrate dev` | Run DB migrations |
| `npx prisma db seed` | Seed test data |

## Key URLs (Development)

| URL | Description |
|---|---|
| `http://localhost:5173` | React app |
| `http://localhost:3201/api` | NestJS API |
| `http://localhost:3201/docs` | Swagger API docs |
| `http://localhost:3201/api/health` | Health check |
| `http://localhost:3201/api/system/metrics` | Request metrics |
| `http://localhost:3201/api/system/logs/status` | Which log file is live, and its size |
| `http://localhost:3201/api/system/logs/files` | Every log file with size and path |
| `http://localhost:3201/api/system/logs/file` | The log content — **read this one** |
| `http://localhost:3201/api/system/logs` | In-memory ring buffer — the last 500 entries ONLY |
| `http://localhost:3201/api/system/logs/retention` | What a prune would remove, by name and size |
| `POST http://localhost:3201/api/system/logs/prune?dryRun=true` | Preview the prune — the default, and deletes nothing |
| `http://localhost:3201/api/system/logs/collapse-stats` | Repeated lines suppressed since boot |

> ⚠️ **The log file is `nest/logs/tcs-<date>.log`.** `/api/system/logs` (no suffix) is NOT the file —
> it is the in-memory buffer, and `/api/system/logs/recent` does not exist. Console captures now land in
> the same directory (`nest/logs/console-{api,build-api,mt5-<port>,vite}[-err].log`) with the launcher
> named in the file, so "where is the log?" has one answer. Full map:
> `.github/instructions/agent-environment.instructions.md` → *Where the logs are*.
>
> ⚠️ Retention, volume and the retention window are **settings**, not constants:
> `logging.retentionDays` (30), `logging.pruneEnabled` (true), `logging.collapseRepeats` (true),
> `logging.repeatWindowMinutes` (5). UI: `/settings/data-management` → the Log Files panel.

## Environment Variables (nest/.env)

```env
DATABASE_URL=mysql://root:@localhost:3306/tradingcs
ALPACA_API_KEY=pk_...
ALPACA_API_SECRET=...
ALPACA_BASE_URL=https://paper-api.alpaca.markets
QUEUE_MODE=off
NODE_ENV=development
```

## Common Issues

**"Database not connected" in frontend**: MySQL not running or DATABASE_URL wrong in nest/.env.

**"API Offline" badge**: Backend not started. Run `npm --prefix nest run start:dev`.

**"PrismaClientInitializationError"**: Run `npx prisma migrate dev` in nest/ folder.

**"No symbols in database"**: Run `npx prisma db seed` in nest/ folder.

**"CI / GitHub Actions runs fail at dependency install"**: Every push-triggered run of `ci.yml`, `lint.yml`, and `test.yml` can fail with `npm error code EUSAGE ... Missing: @emnapi/core@1.11.3 from lock file`. Cause: the committed `package-lock.json` files are generated on **Windows** and are incomplete for **Linux** CI — Vite 8's Rolldown native bindings depend on `@emnapi/*` (e.g. `@emnapi/core@1.11.3`) which Windows npm never locks. Fix: the workflows already use `npm install` (which tolerates the gap) instead of `npm ci`. To make `npm ci` work again, regenerate both lockfiles on Linux/WSL/Docker (`npm install` in the repo root and in `nest/`), commit them, then flip the workflows back to `npm ci`.

## Architecture

- **Frontend**: React 18 + Vite + TanStack Query + Zustand + React Router
- **Backend**: NestJS + Prisma ORM + MySQL
- **Routing**: URL-based (`/:area/:view`)
- **State**: TanStack Query (server), Zustand (client/theme)
- **CSS**: CSS variables (`:root`), theme packs (core, oceanic, scifi, terminal, void)
