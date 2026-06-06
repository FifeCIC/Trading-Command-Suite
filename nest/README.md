# Trading Command Suite - Backend API

NestJS backend for the Trading Command Suite application, providing SEES (Scoring Engine Execution System), MT5 integration, and real-time trading analysis.

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Optional: PostgreSQL 14+ (for persistent data)
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
# Version check
curl http://localhost:3201/api/version

# Provider health
curl http://localhost:3201/api/providers/health

# Import runs (last 5)
curl http://localhost:3201/api/imports/runs?limit=5
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

# Database (Optional - falls back to in-memory)
DATABASE_URL=postgresql://user:password@localhost:5432/tradingcs

# Redis (Optional - queue disabled without it)
REDIS_HOST=localhost
REDIS_PORT=6379

# Queue Mode
QUEUE_MODE=off                    # off | local

# Feature Flags
ENABLE_DATABASE=false             # Enable PostgreSQL
ENABLE_REDIS=false                # Enable Redis queues
ENABLE_MT5=false                  # Enable MT5 integration
```

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

| Endpoint | Method | Description | Fallback Mode |
|----------|--------|-------------|---------------|
| `/api/version` | GET | API version and status | ✅ Yes |
| `/api/providers/health` | GET | Provider health status | ✅ Yes (demo) |
| `/api/imports/runs` | GET | Recent import runs | ✅ Yes (demo) |
| `/api/symbols` | GET | Symbol list | ✅ Yes (in-memory) |
| `/api/strategies` | GET | Trading strategies | ✅ Yes (in-memory) |
| `/api/scoring/execute` | POST | Execute scoring | ✅ Yes (in-memory) |

### WebSocket Events (Full Mode Only)

- `score:updated` - New scores calculated
- `signal:generated` - Trading signal generated
- `import:completed` - Data import finished

## Database Setup (Optional)

### Install PostgreSQL

See `../scripts/setup-local-infra.ps1` for automated setup.

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

### Install Redis

See `../scripts/setup-local-infra.ps1` for automated setup.

Manual setup:
```bash
# Windows (Memurai)
choco install memurai-developer

# Start Redis
redis-server
```

### Enable Queue Processing

Update `.env`:
```bash
QUEUE_MODE=local
ENABLE_REDIS=true
```

Queue jobs:
- `fetch-market-data` - Import market data
- `calculate-scores` - Run scoring engine
- `generate-signals` - Generate trading signals

## Architecture Integration

This backend integrates with the **Architecture Framework** page in the React frontend. The page displays:

- API connection status
- Provider health
- Recent import runs
- System diagnostics

Endpoint contracts are documented in:
- `../docs/data/DATA-ARCHITECTURE.md`
- `../docs/AMAZONQ-HANDOFF.md`

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

Queue processing is disabled if Redis is unavailable. Set:
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
- **Architecture**: `../docs/README.md`
- **Handoff Plan**: `../docs/AMAZONQ-HANDOFF.md`
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
