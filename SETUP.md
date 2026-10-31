# Trading Command Suite — Setup Guide

> ## ⚠️ Read this first — what you are actually installing
>
> 🛑 **This software is not configured to profit by default.** No strategy it ships with has been
> shown to be profitable, and it is not financial advice. **Start on a demo account.** The full
> financial disclaimer is [`DISCLAIMER.md`](DISCLAIMER.md) — it applies from the moment you run the
> app, and connecting a funded account is taken as accepting it.
>
> **This is a SOURCE install, not an application package.** There is no installer, no `setup.exe` and
> no one-click download. You clone the repository and run the stack yourself. Packaging is planned,
> not built — tracked in issue **#808**.
>
> ### Two ways to install — decide before you start
>
> | | **Track A — Web + API** | **Track B — Full stack** |
> |---|---|---|
> | Adds | MySQL, Node.js | + Windows, MetaTrader 5 terminal, a broker account |
> | Time | ~10 minutes | considerably longer |
> | You get | every page, the database, scoring, Lab, backtesting, charts | all of the above **plus** live prices, positions and order placement |
> | You do **not** get | bridging to a broker, portfolio positions, order placement | — |
>
> **MetaTrader 5 is not required to run the app.** It is required to *trade* through it, and to see
> the positions and account state that only a broker can supply. Measured 2026-10-31 with the MT5
> terminal deliberately down: `/api/health` returned `status: ok`, `database: connected` (3 ms), and
> `providers: total 10, healthy 2, degraded 8, failed 0`. So a Track A install is a working
> application, not a broken one.
>
> **Platform note:** the MT5 bridge is a Python process that drives the MetaTrader 5 terminal, so it
> is Windows only. Linux and macOS can run Track A in full and cannot run the bridge.
>
> ### What you must have either way
>
> | Requirement | Why | Without it |
> |---|---|---|
> | **MySQL 8+** | every table the app uses | nothing persists |
> | **Node.js 18+** | runs the Vite front end and the NestJS API | nothing runs |
> | **Git** | this is a source install | you cannot get the code |
>
> ⚠️ **There is no sample or demo data.** The app reads live provider data — from direct HTTP
> providers, or through the MT5 bridge once that is configured. A fresh install with nothing
> connected shows an empty application — deliberately. This project does not ship fabricated numbers
> to make a screenshot look full.
>
> ### ⛔ NEVER run `prisma db push` in this repository
>
> `schema.prisma` is **not** the complete schema. Several tables are managed outside Prisma — the
> trade execution queue among them — so `db push` treats them as unknown and **drops them, with your
> data still in them.** It does not error; it warns and waits for a `y`.
>
> Create tables with the SQL under `nest/prisma/`, then run `npx prisma generate` (types only).
> Not sure? Run `npm --prefix nest run db:check` first — it is read-only and names any table that
> exists in the database but not in the schema.
>
> ### Time and what to prepare
>
> - **~10 minutes** for Track A (web app, API, database).
> - **Considerably longer** for Track B: install the MetaTrader 5 terminal, open a brokerage account
>   (demo is fine), and log in once by hand so the terminal is configured. Note the **account
>   number** and **server name** — the bridge needs both, and so does the variables block in §3.

Get the web app and the API running locally in about 10 minutes. Live prices, positions and order
placement need MetaTrader 5 as well — that is Track B, and it needs considerably longer.

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
git clone https://github.com/FifeCIC/trading-command-suite.git
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

> If `npm --prefix nest install` fails, run `cd nest && npm install` directly.

---

## 2. Database Setup

### Create the MySQL database and user

Run in MySQL (via WAMP phpMyAdmin, MySQL Workbench, or CLI):

```sql
CREATE DATABASE IF NOT EXISTS tradingcs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'tradingcs'@'localhost'
  IDENTIFIED BY 'YOUR_PASSWORD';   -- choose your own strong password, do not copy this

GRANT ALL PRIVILEGES ON tradingcs.* TO 'tradingcs'@'localhost';
FLUSH PRIVILEGES;
```

Substitute your own database name, user and password if you prefer. Wherever this guide writes
`tradingcs` for the user or the database, use the names you just created.

### Configure connection

The connection string lives in `nest/.env`:

```env
# ⚠️ Replace YOUR_PASSWORD with the password you set above — and substitute your own database
#    and user names if you chose different ones.
#    Do not copy example credentials from any guide, and note this repository is PUBLIC, so no
#    real value belongs in a committed file. `nest/.env` is git-ignored; this is the only copy.
DATABASE_URL="mysql://tradingcs:YOUR_PASSWORD@localhost:3306/tradingcs"
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
$env:DATABASE_URL = "mysql://tradingcs:YOUR_PASSWORD@localhost:3306/tradingcs"
cd nest

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
$env:DATABASE_URL = "mysql://tradingcs:YOUR_PASSWORD@localhost:3306/tradingcs"
npm --prefix nest run prisma db seed
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
$env:DATABASE_URL = "mysql://tradingcs:YOUR_PASSWORD@localhost:3306/tradingcs"
npm --prefix nest run prisma:generate
```

---

## 3. Environment Variables

All backend env vars are in `nest/.env`. Start from the template: `cp nest/.env.example nest/.env`.

**Check the name before you set it.** The adapter reads the key the template declares — a variable
with a near-miss name is silently ignored, and the provider simply reports as degraded.

| Variable | Track | Notes |
|---|---|---|
| `DATABASE_URL` | both ✅ | MySQL connection string |
| `PORT` | both | defaults to `3201` |
| `MT5_BRIDGE_URL` | B | where the bridge listens (default `http://localhost:5000`) |
| `MT5_PYTHON_PATH` | B | Python interpreter the bridge is launched with |
| `MT5_ACTIVE_BROKERS` | B | comma-separated **account numbers** to bridge, e.g. `2,3` — one port per entry, `:5000`, `:5001`, … |
| `MT5_ACCOUNT_<n>` / `MT5_PASSWORD_<n>` / `MT5_SERVER_<n>` / `MT5_PATH_<n>` | B | one set per bridged account |
| `FINNHUB_API_KEY`, `POLYGON_API_KEY`, `TWELVE_DATA_API_KEY`, `FMP_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `ALPACA_API_KEY` + `ALPACA_API_SECRET`, `TRADING212_DEMO_API_KEY` | optional | additional data providers — **14** adapters exist (`docs/GENERATED-FACTS.md`), none required |
| `QUEUE_MODE` / `REDIS_*` | optional | `redis` enables BullMQ; leave off for local dev |
| `TELEGRAM_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`, `NOTIFICATION_EMAIL_*` | optional | notifications only |

⚠️ **Every key is optional except `DATABASE_URL`.** With none set, the keyless providers still
answer — measured 2026-10-31: `providers: total 10, healthy 2, failed 0` on a fresh install.

**Fallback mode** (shown as `"mode":"fallback"` in `/api/health`) means Redis/queue is unavailable —
this is NORMAL for local dev. The MySQL database stays connected and the API works.
Do not restart NestJS to "fix" fallback mode.

---

## 4. Run

### Quickstart — full stack (Track B, needs MetaTrader 5)

The whole stack (MT5 Bridge → NestJS → Vite) starts/stops as one unit:

```powershell
pwsh -File scripts\tcs-launch.ps1    # start all three services
pwsh -File scripts\tcs-stop.ps1      # stop all three services
```

Frontend lands on **http://localhost:5173**, API on **http://localhost:3201**.

### Track A — no MetaTrader 5 (two terminals, no bridge)

Do **not** use `tcs-launch.ps1` here; it also starts the bridge, which will fail without the
terminal. Start the two web services instead:

```powershell
# terminal 1 — API
npm --prefix nest run start:dev

# terminal 2 — front end
npm run dev
```

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

MySQL isn't running. Start WAMP (or `mysqld`), then verify — `-p` alone prompts for the password
so it never lands in your shell history:

```bash
mysql -u tradingcs -p -e "SELECT 1" tradingcs
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

If a genuine full reset is needed, take a dump first. `mysqldump` must be on your `PATH` — with
WAMP on Windows it lives in `...\bin\mysql\<version>\bin`, so add that folder to `PATH` rather
than typing a version-pinned absolute path that will be wrong after the next MySQL upgrade.

```bash
mysqldump -u tradingcs -p tradingcs > backup-before-reset.sql
```

Safe on a first install against a throwaway database. Once real positions or trade history exist,
the dump is mandatory, not optional.

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

1. Open **`/status/setup`** in the app — the first-run wizard reports what is configured and what is not
2. Track B only: configure the MT5 variables (§3), then check `GET :5000/health` on the bridge
3. Add one data-provider key (§3) if the dashboard shows every provider as degraded
4. Run `pwsh -File scripts\setup-local-infra.ps1` for automated infrastructure checks (Windows)
5. Find work in **GitHub Issues** (`gh issue list`)
6. Read `docs/scoring-architecture.md` and the live registry (`GET /api/directives`) before touching directive code

---

> **Questions?** Check `.github/AGENT-ATTENTION.md` for blockers and `docs/SETTLED-DECISIONS.md` for settled areas.
