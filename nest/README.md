# Trading Command Suite - Backend API

NestJS backend for the Trading Command Suite application, providing SEES (Scoring Engine Execution System), MT5 integration, and real-time trading analysis.

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Optional: MySQL (for persistent data — WAMP already provides this)
- Optional: Redis 6+ (for queue management)

### Local Development (Fallback Mode)

The backend runs in **fallback mode** without PostgreSQL or Redis, using in-memory storage for development:

```bash
cd nest
npm install
npm run start:dev
```

Backend will start on **http://localhost:3201**

### Verify Backend

Test the endpoints used by the Architecture Framework page:

```bash
# Version check (includes mode info)
curl http://localhost:3201/api/version

# Provider health (includes mode info)
curl http://localhost:3201/api/providers/health

# Import runs (includes mode info)
curl http://localhost:3201/api/imports/runs?limit=5
```

Expected response includes `mode` field:
```json
{
  "mode": "fallback",
  "services": {
    "database": false,
    "queue": false,
    "redis": false
  }
}
```

## Project Structure

```
nest/
├── src/
│   ├── app.module.ts          # Main application module
│   ├── main.ts                # Application entry point
│   ├── modules/               # Feature modules
│   │   ├── symbols/           # Symbol management
│   │   ├── strategies/        # Trading strategies
│   │   ├── scoring/           # SEES scoring engine
│   │   ├── providers/         # Data provider integrations
│   │   └── imports/           # Data import management
│   ├── common/                # Shared utilities
│   └── config/                # Configuration
├── test/                      # Tests
└── docs/                      # API documentation
```

## Available Scripts

### Development
```bash
npm run start:dev      # Start with hot-reload
npm run start:debug    # Start with debugging enabled
```

### Production
```bash
npm run build         # Build for production
npm run start:prod    # Run production build
```

### Testing
```bash
npm run test          # Unit tests
npm run test:e2e      # End-to-end tests
npm run test:cov      # Test coverage
```

## Configuration

### Environment Variables

Create `.env` file in the `nest/` directory:

```bash
# Server
PORT=3201
NODE_ENV=development

# Database (Optional - falls back to no-connection mode)
DATABASE_URL=mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs

# Redis (Optional - queue disabled without it)
REDIS_HOST=localhost
REDIS_PORT=6379

# Queue Mode (Required for queue processing)
QUEUE_MODE=off                    # off (default) | local
# off = no Redis connection, no queue initialization
# local = enable queue if Redis is available
```

### Queue Mode Configuration

**QUEUE_MODE=off** (Default):
- No Redis connection attempted
- No BullMQ initialization
- No background job processing
- Import jobs logged but not queued
- Minimal resource usage for local development

**QUEUE_MODE=local**:
- Redis connection required (checks REDIS_HOST)
- BullMQ queue initialization
- Background job processing enabled
- Import jobs queued and processed
- Requires Redis running on configured port

### Local Mode vs Full Mode

#### Fallback Mode (Default)
- ✅ In-memory storage
- ✅ HTTP REST API
- ✅ Basic provider health checks
- ✅ Demo data responses
- ❌ No persistent database
- ❌ No queue processing
- ❌ No Redis caching

#### Full Mode (PostgreSQL + Redis)
- ✅ Persistent PostgreSQL storage
- ✅ Redis-backed queue processing
- ✅ Real-time WebSocket updates
- ✅ Background job processing
- ✅ Distributed caching
- ✅ MT5 integration ready

### Safely Changing Ports

To change the backend port from 3201:

1. Update `nest/.env`:
   ```bash
   PORT=3201  # Change to your preferred port
   ```

2. Update frontend API base in `trading-command-suite/`:
   - Check `src/core/api/client.js` or similar config
   - Update `VITE_API_BASE_URL` in frontend `.env`

3. Update any task trackers or documentation references

## API Endpoints

### Core Endpoints

All responses include system mode information:
```json
{
  "mode": "fallback" | "full",
  "services": {
    "database": boolean,
    "queue": boolean,
    "redis": boolean
  }
}
```

| Endpoint | Method | Description | Fallback Mode |
|----------|--------|-------------|---------------|
| `/api/version` | GET | API version and mode | ✅ Yes |
| `/api/providers/health` | GET | Provider health + mode | ✅ Yes (demo) |
| `/api/imports/runs` | GET | Recent import runs + mode | ✅ Yes (demo) |
| `/api/symbols` | GET | Symbol list | ✅ Yes (in-memory) |
| `/api/strategies` | GET | Trading strategies | ✅ Yes (in-memory) |
| `/api/scoring/execute` | POST | Execute scoring | ✅ Yes (in-memory) |

### WebSocket Events (Full Mode Only)

- `score:updated` - New scores calculated
- `signal:generated` - Trading signal generated
- `import:completed` - Data import finished

## Database Setup

The backend uses **MySQL** via Prisma 5. Your WAMP stack already provides MySQL 9.1.

### First-Time Setup (already done for this machine)

```bash
# 1. Create the database and user (run once via WAMP MySQL CLI)
"C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe" -u root -e "CREATE DATABASE IF NOT EXISTS tradingcs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS 'tradingcs'@'localhost' IDENTIFIED BY 'tradingcs_dev_2026'; GRANT ALL PRIVILEGES ON tradingcs.* TO 'tradingcs'@'localhost'; GRANT CREATE ON *.* TO 'tradingcs'@'localhost'; FLUSH PRIVILEGES;"

# 2. Push schema to database
cd nest
npx prisma db push

# 3. Seed test data
npx prisma db seed
```

### Credentials (local dev only)

| Setting | Value |
|---|---|
| Host | localhost:3306 |
| Database | tradingcs |
| User | tradingcs |
| Password | tradingcs_dev_2026 |
| DATABASE_URL | `mysql://tradingcs:tradingcs_dev_2026@localhost:3306/tradingcs` |

### Prisma Version Note

We use **Prisma 5.22.0**. Prisma 7+ requires driver adapters for MySQL. To upgrade later:

1. Install a MySQL adapter: `npm install @prisma/adapter-libsql @libsql/client`
2. Update `PrismaService` constructor to pass the adapter
3. One dependency, one constructor change — not a major refactor

This is tracked here intentionally so it doesn't become a forgotten surprise.

### Repeat Installation

To set up from scratch on a new machine:

1. Install WAMP (provides MySQL)
2. Run the SQL commands in "First-Time Setup" above
3. `cd nest && npm install && npm run start:dev`
4. Check http://localhost:3201/api/version confirms `databaseConnected: true`

No other services are required for basic operation.

Manual setup:
```bash
# Create database
createdb tradingcs

# Run migrations (when implemented)
npm run prisma:migrate
```

### Database Schema

Core entities:
- `symbols` - Financial instruments
- `strategies` - Trading strategies
- `directives` - Scoring directives
- `scores` - Calculated scores
- `signals` - Generated signals

## Queue Setup (Optional)

### Prerequisites

Queue processing requires:
1. Redis 6+ installed and running
2. `REDIS_HOST` configured in `.env`
3. `QUEUE_MODE=local` in `.env`

### Install Redis

See `../scripts/setup-local-infra.ps1` for automated setup.

Manual setup:
```bash
# Windows (Memurai)
choco install memurai-developer

# Start Redis
redis-server

# Verify connection
redis-cli ping
```

### Enable Queue Processing

Update `.env`:
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
QUEUE_MODE=local
```

Restart backend:
```bash
npm run start:dev
```

Check startup logs:
```
[QueueConfigService] Queue mode: local
[QueueConfigService] Queue enabled: true
[QueueConfigService] Redis configured: true
```

### Queue Jobs

When `QUEUE_MODE=local`:
- `fetch-market-data` - Import market data from providers
- `calculate-scores` - Run scoring engine on symbols
- `generate-signals` - Generate trading signals from scores

### Disable Queue Processing

To disable without uninstalling Redis:
```bash
QUEUE_MODE=off
```

Backend will skip Redis connection and queue initialization entirely.

## Architecture Integration

This backend integrates with the **Architecture Framework** page in the React frontend. The page displays:

- API connection status
- Provider health
- Recent import runs
- System diagnostics

Endpoint contracts are documented in:
- `../docs/data/DATA-ARCHITECTURE.md`
- `G:/My Drive/Project Management/Live/Trading-Command-Suite-Documentation/DOCUMENTATION-INDEX.md`

## Development Workflow

### Adding a New Endpoint

1. Create or update module in `src/modules/`
2. Add controller method with `@Get()` or `@Post()`
3. Implement service logic
4. Add tests in `test/`
5. Update this README if endpoint is public-facing

### Testing Changes

```bash
# Run tests
npm run test

# Test endpoint manually
curl http://localhost:3201/api/your-endpoint

# Check from frontend
# Architecture page: http://localhost:5188 (React app)
```

## Migration from WordPress

This backend replaces the WordPress/PHP TradePress plugin. Key changes:

### What Changed
- ❌ WordPress/PHP → ✅ NestJS/TypeScript
- ❌ MySQL → ✅ PostgreSQL
- ❌ WP-Cron → ✅ Bull Queues
- ❌ WordPress REST API → ✅ NestJS REST + WebSockets

### What Stayed the Same
- ✅ SEES scoring concepts
- ✅ Strategy architecture
- ✅ Directive patterns
- ✅ Business logic

See `G:\My Drive\Project Management\Live\TradePress-Documentation\exit-wordpress\` for full migration strategy.

## Performance Targets

- API response < 50ms for queries
- Scoring 100 symbols < 10 seconds
- WebSocket latency < 100ms
- Database queries < 10ms average

## Troubleshooting

### Backend Won't Start

```bash
# Check port availability
netstat -ano | findstr :3201

# Clear node_modules
rm -rf node_modules
npm install
```

### Database Connection Failed

Backend automatically falls back to in-memory mode if PostgreSQL is unavailable. Check logs for:
```
[NestApplication] Database connection failed, using fallback mode
```

### Redis Connection Failed

Queue processing is disabled if Redis is unavailable. Check startup logs:

```
[QueueConfigService] Queue mode: off
[QueueConfigService] Queue processing is disabled. Set QUEUE_MODE=local to enable.
```

Or if mode is local but Redis is missing:

```
[QueueConfigService] QUEUE_MODE=local but Redis configuration is missing. Queue will not initialize.
```

To fix:
1. Verify Redis is running: `redis-cli ping` (should return PONG)
2. Check `.env` has `REDIS_HOST=localhost`
3. Set `QUEUE_MODE=local`
4. Restart backend

To disable queue without errors:
```bash
QUEUE_MODE=off
```

### API Endpoints Return 404

Verify backend is running on correct port:
```bash
curl http://localhost:3201/api/version
```

Check frontend API base URL configuration.

## Related Documentation

- **Frontend**: `../README.md` (React app)
- **Architecture**: `../docs/scoring-architecture.md` + `../src/core/architecture-reference.js`
- **Execution Rules**: `G:/My Drive/Project Management/Live/Trading-Command-Suite-Documentation/.agent-rules.md`
- **Exit WordPress**: `G:\My Drive\Project Management\Live\TradePress-Documentation\exit-wordpress\`

## Technology Stack

- **Framework**: NestJS
- **Language**: TypeScript
- **Database**: PostgreSQL (optional)
- **Cache**: Redis (optional)
- **Queues**: Bull/BullMQ
- **WebSockets**: Socket.io
- **ORM**: Prisma (when enabled)

## Support

- **GitHub**: https://github.com/FifeCIC/trading-command-suite
- **Issues**: https://github.com/FifeCIC/trading-command-suite/issues

## License

GPL-3.0 - See LICENSE file for details
