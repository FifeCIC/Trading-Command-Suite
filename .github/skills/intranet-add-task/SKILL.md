---
name: intranet-add-task
description: "Add a new server task to the Intranet task runner. Use when: adding a project to the Intranet controls, registering a new server for start/stop management, adding a task to api-tasks.php, or wiring a new project into the local development infrastructure."
---
# Intranet Add Task

## When to Use
- User wants to add a project server to the Intranet controls dashboard
- Registering a new npm script as a managed task
- Adding start/stop capability for a new project

## Architecture
The Intranet uses `api-tasks.php` as the single source of truth for all managed server tasks. Each task has:
- A unique ID (convention: `project:role` or `project:role:port`)
- A working directory, command, and port for health checking
- PID tracking via `task-runner/` directory

## Procedure

### 1. Add Task Definition
Edit `C:\wamp64\www\intranet\api-tasks.php`. Add to the `$tasks` array:

**Standard single-process task:**
```php
'project-id:role' => [
    'label'   => 'Human-Readable Name',
    'cwd'     => 'C:\\wamp64\\www\\project-folder',
    'command' => 'npm run script-name',
    'port'    => 1234,
],
```

**Multi-service launcher task (e.g., TCS all-in-one):**
```php
'project-id:all' => [
    'label'       => 'Project Name (All Services)',
    'cwd'         => 'C:\\wamp64\\www\\project-folder',
    'command'     => 'pwsh -File scripts/launch.ps1',
    'stopCommand' => 'pwsh -File scripts/stop.ps1',
    'port'        => 3201,          // primary health-check port
    'linkUrl'     => 'http://localhost:5173',  // frontend URL for "Open" button
    'type'        => 'launcher',
],
```
- `type: 'launcher'` triggers special handling: fire-and-forget start with port polling, custom stopCommand instead of PID kill
- `linkUrl` overrides the auto-generated `http://localhost:{port}` link
- Use double backslashes in Windows paths
- The port is used for health checking — the task runner polls it
- Set `cwd` and `command` to `null` if it's a manual-only service (like MailHog)

### 2. Verify Task ID Convention
- Use lowercase, colon-separated: `project:role` or `project:role:port`
- Examples: `tradercore:all`, `streamerops:dev`, `omnicore:server:3101`

### 3. Test the Task
```powershell
# Check it appears in the list
Invoke-RestMethod "http://localhost/intranet/api-tasks.php?action=list"

# Test status
Invoke-RestMethod "http://localhost/intranet/api-tasks.php?action=status&task=project-id:role"

# Test start
Invoke-RestMethod -Method POST "http://localhost/intranet/api-tasks.php?action=start&task=project-id:role"
```

### 4. Update Trading Command Suite Server Controls (if applicable)
If the task is a Trading Command Suite service, add its ID to the `TRADING_TASKS` array in `src/pages/ServerControlsPage.jsx`:
```js
const TRADING_TASKS = ['tradercore:all', 'new-task-id'];
```

## Key Files
- `C:\wamp64\www\intranet\api-tasks.php` — Task whitelist and execution logic
- `C:\wamp64\www\intranet\js\controls.js` — Frontend task card UI
- `C:\wamp64\www\trading-command-suite\src\pages\ServerControlsPage.jsx` — In-app server controls
