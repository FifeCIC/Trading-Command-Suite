# Trading Command Suite — Setup Guide

Get the full stack running locally in under 10 minutes.

---

## Prerequisites

| Component | Required | Version | Where |
|---|---|---|---|
| Node.js | ✅ | 18+ | [nodejs.org](https://nodejs.org) |
| npm | ✅ | 9+ | Ships with Node.js |
| MySQL | ✅ | 8.0+ | WAMP (already on Windows), [mysql.com](https://mysql.com), or Docker |
| Redis | Optional | 6+ | For BullMQ queue processing |
| Git | ✅ | 2.x+ | [git-scm.com](https://git-scm.com) |

> **MySQL note**: This project runs on **MySQL** via Prisma 5.22.0. The database connection uses `DATABASE_URL` in `nest/.env`.

---

## 1. Clone & Install

```bash
git clone <repo-url> trading-command-suite
cd trading-command-suite
```

### Frontend
```bash
npm install
```

### Backend (NestJS)
```bash
cd nest
npm install
cd ..
```

> If `npm --prefix c:/wamp64/www/trading-command-suite/nest install` fails, run `cd nest && npm install` directly.

---

## 2. Database Setup

### Create the MySQL database and user

Run in MySQL (via WAMP phpMyAdmin, MySQL Workbench, or CLI):

```sql
CREATE DATABASE IF NOT EXISTS tradingcs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'tradingcs'@'localhost'
  IDENTIFIED BY 'tradingcs_dev_2026';

GRANT ALL PRIVILEGES ON tradingcs.* TO 'tradingcs'@'localhost';
FLUSH PRIVILEGES;
```

### Configure connection

The connection string lives in `nest/.env`:

```env
DATABASE_URL="mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
```

### Push schema (creates all tables)

```powershell
$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
npm --prefix C:\wamp64\www\trading-command-suite\nest run prisma db push
```

This creates all tables including:
- `symbol`, `strategy`, `directive`, `score`, `signal` — core trading
- `market_bar`, `import_run` — data pipeline
- `backtest_run`, `backtest_trade` — permanent backtest storage
- `provider_health`, `api_activity_log`, `api_trace` — monitoring
- `correlation_pair`, `symbol_calibration` — analysis
- `news_source`, `news_article`, `article_sample`, `publishing_pattern` — news pipeline
- `faq_entry` — help system

### Seed initial data

```powershell
$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
npm --prefix C:\wamp64\www\trading-command-suite\nest run prisma db seed
```

This seeds initial reference data. Seed contents are maintained in the `nest` codebase and have grown
well beyond the original "3 test symbols" — see the seed modules for the current list (symbols,
protocols via `POST /api/scoring/gated/protocols/seed`, trading bots via
`POST /api/trading/strategies/seed`, FAQ entries, historical data).

> ⚠️ **Schema drift:** some runtime tables (`paper_trade`, `strategy_signal_queue`, …) were created via
> raw SQL and are NOT in `schema.prisma`, so `prisma db push` will not (re)create them. Account for
> this when standing up a fresh database.

### Regenerate Prisma client (after schema changes)

```powershell
$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
npm --prefix C:\wamp64\www\trading-command-suite\nest run prisma generate
```

---

## 3. Environment Variables

All backend env vars are in `nest/.env`:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | MySQL connection string |
| `QUEUE_MODE` | Optional | Set to `redis` to enable BullMQ queue (default: off) |
| `REDIS_URL` | Optional | Redis connection for queue mode |
| `ALPACA_KEY` | Optional | Alpaca paper API key for real market data |
| `ALPACA_SECRET` | Optional | Alpaca paper API secret |

**Fallback mode** (shown as `"mode":"fallback"` in `/api/health`) means Redis/queue is unavailable —
this is NORMAL for local dev. The MySQL database stays connected and the API works; scores come from
real market data when providers are configured. Do not restart NestJS to "fix" fallback mode.

---

## 4. Run

### Quickstart — full stack (recommended)

The whole stack (MT5 Bridge → NestJS → Vite) starts/stops as one unit:

```powershell
pwsh -File scripts\tcs-launch.ps1    # start all three services
pwsh -File scripts\tcs-stop.ps1      # stop all three services
```

Frontend lands on **http://localhost:5173**, API on **http://localhost:3201**.

### Backend (NestJS) only

```bash
# From project root
npm --prefix nest run start:dev
```

Backend starts on **http://localhost:3201**.

Verify:
```bash
curl http://localhost:3201/api/version
```

Expected:
```json
{
  "version": "0.0.1",
  "mode": "fallback",
  "services": {
    "database": true,
    "queue": false,
    "redis": false
  }
}
```

If `database: false`, check that MySQL is running and the connection string in `nest/.env` is correct.

### Frontend (Vite + React)

```bash
# From project root (separate terminal)
npm run dev
```

Frontend starts on **http://localhost:5173**.

---

## 5. Running Tests

### Backend unit tests

```bash
npm --prefix nest run test
```

Or watch mode:
```bash
npm --prefix nest run test:watch
```

### Backend E2E tests

```bash
npm --prefix nest run test:e2e
```

### Frontend build check

```bash
npm run build
```

### Lint

```bash
npm run lint          # Frontend
npm --prefix nest run lint   # Backend
```

---

## 6. Common Issues

### `PrismaClientInitializationError: Can't reach database server`

MySQL isn't running. Start WAMP (or `mysqld`), then verify:

```bash
mysql -u tradingcs -ptradingcs_dev_2026 -e "SELECT 1" tradingcs
```

### `npm --prefix nest install` fails

Run `cd nest` then `npm install` directly. The `--prefix` flag can fail if `nest/package.json` isn't found.

### Build error: `Cannot find module '@prisma/client'`

```bash
cd nest
npx prisma generate
cd ..
```

### Frontend shows "Could not reach the scoring pipeline"

The NestJS backend isn't running. Start it with `npm --prefix nest run start:dev`.

### Port 3201 already in use

```bash
# Windows
netstat -ano | findstr :3201
taskkill /PID <pid> /F

# Mac/Linux
lsof -i :3201
kill -9 <pid>
```

### Prisma seed fails with foreign key errors

Run `npx prisma db push --force-reset` to reset and re-seed (⚠️ wipes data).

---

## 7. Project Structure

```
trading-command-suite/
├── index.html              # Vite entry
├── package.json            # Frontend deps & scripts
├── vite.config.js          # Vite config
├── eslint.config.js        # Lint rules
├── nest/                   # NestJS backend
│   ├── package.json        # Backend deps & scripts
│   ├── .env                # DB connection + API keys
│   ├── prisma/
│   │   ├── schema.prisma   # Database schema
│   │   └── seed.ts         # Seed data
│   └── src/
│       ├── main.ts         # Entry point (port 3201)
│       ├── app.module.ts   # Root module
│       └── modules/        # Feature modules
│           ├── directives/ # Scoring directives
│           ├── scoring/    # Scoring pipeline
│           ├── symbols/    # Symbol CRUD
│           └── ...
├── src/                    # React frontend
│   ├── main.jsx            # React entry
│   ├── App.jsx             # Root component
│   ├── pages/              # Page components
│   ├── components/         # Shared components
│   ├── core/               # API client, nav-tree, features
│   └── stores/             # Zustand stores
└── docs/                   # Project documentation
```

---

## 8. Next Steps

1. Set up Alpaca paper trading credentials in `nest/.env` for real market data
2. Run `setup-local-infra.ps1` for automated infrastructure checks (Windows)
3. Follow the sprint board in `.agenticmemory/SPRINT.md` for current tasks
4. Read `docs/CANONICAL-DIRECTIVE-REFERENCE.md` before touching directive code

---

> **Questions?** Check `.agenticmemory/SPRINT.md` for the current sprint board and agent inbox conventions.
