---
description: "Register the NestJS backend as a start/stop-managed task in the Intranet task runner. Use when: the NestJS backend can't be restarted via Intranet controls, the task 'tradercore:api:3201' is missing from the task list, or after adding a new server that needs lifecycle management."
argument-hint: "Server details (port, project path, start command)?"
---
Register the NestJS backend (port 3201) as a managed task in the Intranet task runner so it can be started, stopped, and monitored through the dashboard.

## Problem
The Intranet task list shows `tradercore:api:3201` for monitoring but the stop/start/force-stop actions fail with "Unknown task." The NestJS backend runs on PID 41724 (often as a service) and can't be killed from the terminal. This means:
- Environment variable changes require manual process killing
- No hot-reload of .env changes
- Can't restart after code changes from this chat

## Solution

### 1. Add Task Definition
Add to the Intranet's task configuration. The exact location depends on how tasks are registered:

**Option A**: If tasks are in `api-tasks.php`:
```php
'tradercore:api:3201' => [
    'label' => 'Trading Command Suite (API)',
    'port' => 3201,
    'cwd' => 'C:\\wamp64\\www\\trading-command-suite\\nest',
    'startCmd' => 'npm run start:dev',
    'stopCmd' => 'taskkill /PID {pid} /F',
    'logFile' => 'C:\\wamp64\\www\\trading-command-suite\\nest\\logs\\nest.log',
    'env' => [
        'NODE_ENV' => 'development',
    ],
],
```

**Option B**: If tasks are in a database or JSON config file — add equivalent entry.

### 2. Verify Registration
```bash
curl -X POST http://localhost/intranet/api-tasks.php \
  -d "action=status&project=tradercore:api:3201"
```

Should return: `{"running": true, "pid": 41724, "port": 3201}`

### 3. Test Restart
```bash
# Stop
curl -X POST http://localhost/intranet/api-tasks.php \
  -d "action=stop&project=tradercore:api:3201"

# Start  
curl -X POST http://localhost/intranet/api-tasks.php \
  -d "action=start&project=tradercore:api:3201"
```

## Why This Matters
- **Today**: Changed .env, couldn't restart — Alpha Vantage adapter still uses old config
- **Future**: Any .env change (API keys, feature flags) requires Intranet restart
- **Automation**: The `trading-watchdog` agent could auto-restart degraded providers via Intranet

## Related Files
- `C:\wamp64\www\intranet\api-tasks.php` — task runner API
- Intranet task configuration (may be in `data/` or `includes/`)

## 🏗️ Post-Implementation: Update Architecture

Using the `update-architecture-framework` skill, update `/builder/architecture-framework`:

1. **STATUS_SNAPSHOT** — Add: `[DATE]: NestJS backend registered in Intranet task runner — start/stop/restart via controls page.`
2. **SYSTEM_SPINE** — Add: `Intranet Task Runner → tradercore:api:3201 → NestJS start/stop/restart`
3. **REVISION_LOG** — Add entry: `NestJS backend registered for Intranet lifecycle management`
