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

### Push schema and seed

```bash
cd nest
npx prisma db push
npx prisma db seed
cd ..
```

This creates all tables and seeds 3 test symbols (AAPL, NVDA, TSLA).

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

If no Alpaca credentials are set, the backend runs in **fallback mode** with deterministic (hash-based) scores. It still works — scores just aren't from real market data.

---

## 4. Run

### Backend (NestJS)

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
