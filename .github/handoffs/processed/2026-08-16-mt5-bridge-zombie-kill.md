---
date: 2026-08-16
area: data
type: bugfix
---

## What Changed

Fixed zombie MT5 bridge processes (issue #643). `tcs-launch.ps1` / `tcs-stop.ps1` previously killed only the process holding the LISTEN socket on each port, so bridges that crashed-but-didn't-exit (or raced to bind) survived and kept serving **stale candles** — masking fixes until all zombies were killed by hand.

Both scripts now also kill MT5 bridges **by process identity** (command-line match on `mt5_bridge_v2.py`) before the port-based kill:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*mt5_bridge_v2.py*' } | Stop-Process -Force
```

`tcs-stop.ps1` also gained port `5001` (broker #2) in its port list — it previously only killed 5000, so the second bridge would survive a stop.

## Files Changed

- scripts/tcs-launch.ps1 — added identity-based bridge kill in the "Stopping existing services" step (before port kill + bridge start).
- scripts/tcs-stop.ps1 — added identity-based bridge kill; port list now includes 5001.

## Result

Every launch/stop now removes ALL bridge processes regardless of socket state, so an old bridge with stale code can no longer hold 5000 while a new bridge takes 5001.

## Capability Map Entry

- **name:** MT5 bridge zombie-process cleanup
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** data (mt5-bridge)
- **completion:** complete

## QA Test Entry

- **area:** Data / MT5 bridge
- **name:** No zombie bridge processes after relaunch
- **procedure:** Run `tcs-launch.ps1` twice; run `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*mt5_bridge_v2.py*' }` and confirm exactly one process per active broker.
- **expected:** One bridge per broker; no zombie bridge holding a stale socket.

## Architecture Framework Entry

- **section:** data
- **summary:** MT5 bridge start/stop now kills bridge processes by command-line identity in addition to port, preventing zombie bridges from serving stale candles across relaunches.
