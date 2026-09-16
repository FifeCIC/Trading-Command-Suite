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

### Create the schema

> 🛑 **Do NOT run `prisma db push` in this repo.** It is a declarative diff with destructive
> defaults: every table with no model in `schema.prisma` is dropped. This repo has **13**
> such tables (4 live + 9 backup, measured 2026-09-16), including `strategy_signal_queue`
> (the trade execution queue) and the #750 timestamp-repair backups. See
> `.github/instructions/database-schema.instructions.md` and issue **#769**.
>
> ⚠️ That count **grows** — every migration backup adds a table. Re-derive it with
> `npm --prefix nest run db:check` rather than trusting this number.
>
> `npm run db:push` is deliberately **blocked** and explains why.

For a **fresh database**, create the schema from `schema.prisma` without letting Prisma
choose the diff — generate the SQL, **read it**, then apply it:

```powershell
$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
cd C:\wamp64\www\trading-command-suite\nest

# 1. Generate the DDL from the schema to an empty target and REVIEW it
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script

# 2. Apply it (pipe to mysql), then load the raw-managed tables
#    prisma/schema.prisma cannot create these — they are raw-SQL managed:
#      nest/prisma/raw-managed/{strategy_signal_queue,paper_trade,
#                               signal_outcome_log,signal_outcome_meta}.sql
#    They MUST exist before the app runs; see nest/prisma/raw-managed/README.md

# 3. Regenerate the client
npx prisma generate

# 4. Verify nothing non-empty is unmanaged
npm run db:check
```

On an **existing** database, add columns with a targeted `ALTER TABLE` and then
`npx prisma generate`. Stop the API first — it locks the query-engine DLL and `prisma
generate` will fail with `EPERM`.

### Seed initial data

```powershell
$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
npm --prefix C:\wamp64\www\trading-command-suite\nest run prisma db seed
```

This seeds initial reference data. Seed contents are maintained in the `nest` codebase and have grown
well beyond the original "3 test symbols" — see the seed modules for the current list (symbols,
protocols via `POST /api/scoring/gated/protocols/seed`, trading bots via
`POST /api/trading/strategies/seed`, FAQ entries, historical data).

> ⚠️ **Schema drift — and it is dangerous, not just untidy.**
>
> Four **live** tables (`strategy_signal_queue`, `paper_trade`, `signal_outcome_log`,
> `signal_outcome_meta`) plus nine backup tables (**13** in total, measured 2026-09-16) were
> created via raw SQL and are **not** in `schema.prisma`. They have no `CREATE TABLE` in the
> repo — they exist only in the database.
>
> This means `prisma db push` does not merely fail to create them: **it would DROP them**, because
> Prisma treats every unmodelled table as garbage. `strategy_signal_queue` is the trade execution
> queue. This repo also has **no migration history**, so drift cannot be reconciled.
>
> The checked-in DDL that restores them lives in `nest/prisma/raw-managed/`. Verify the current
> state with `npm --prefix nest run db:check`. Tracked in issue **#769**.

### Regenerate Prisma client (after schema changes)

⚠️ **Stop the API first.** `prisma generate` cannot replace the query-engine DLL while the API
holds it, and fails with `EPERM`. Forgetting this also leaves `dist/` empty after `rimraf`.

```powershell
$env:DATABASE_URL = "mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs"
npm --prefix C:\wamp64\www\trading-command-suite\nest run prisma:generate
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
  "version": "0.15.0",
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

🛑 **Do not reach for `prisma db push --force-reset`.** It wipes the database, and on this
repo it also removes the trade execution queue and the #750 timestamp-repair backups — the
one thing that makes a bad repair recoverable.

Seed ordering issues are almost always a missing parent row, not a broken schema. Check the
seed module's dependency order first (`nest/prisma/seed*.ts`), and confirm the tables it
depends on exist with `npm --prefix nest run db:check`.

If a genuine full reset is needed on a **throwaway** database, take a dump first:

```powershell
$env:MYSQL_PWD='tradingcs_dev_2026'
& "C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe" -u tradingcs tradingcs `
  -e "SHOW TABLES" | Out-File tables-before-reset.txt
mysqldump -u tradingcs -p tradingcs > backup-before-reset.sql
```

Never on the dev database, which holds the timestamp-repair rollback path.

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
3. Find work in **GitHub Issues** (`gh issue list`) — the old `.agenticmemory/SPRINT.md` board is archived
4. Read `docs/scoring-architecture.md` and the live registry (`GET /api/directives`) before touching directive code

---

> **Questions?** Check `.github/AGENT-ATTENTION.md` for blockers and `docs/SETTLED-DECISIONS.md` for settled areas.
