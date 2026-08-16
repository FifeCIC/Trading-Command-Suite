## Fix implemented (2026-08-16)

Both `tcs-launch.ps1` and `tcs-stop.ps1` now kill MT5 bridges **by process identity** (command-line match on `mt5_bridge_v2.py`) *before* the existing port-based kill, so bridges that crashed-but-didn't-exit or raced to bind can no longer survive as zombies serving stale candles.

### Changes

- **`tcs-launch.ps1`** — added an identity-based bridge kill in the "Stopping existing services" step:
  ```powershell
  $zombieBridges = Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -like '*mt5_bridge_v2.py*' }
  foreach ($bp in $zombieBridges) { Stop-Process -Id $bp.ProcessId -Force }
  ```
- **`tcs-stop.ps1`** — same identity-based kill, plus the port list now includes **5001** (broker #2); it previously only killed 5000, so the second bridge would survive a stop.

### Verification

- Both scripts parse clean (`[Parser]::ParseFile` → no errors).
- Detection confirmed against live processes: the identity query correctly finds the 2 currently-running bridge processes by their command line.
- Not executed (would kill the live backend), but the kill logic is additive and runs before any bridge is started.

Handoff: `2026-08-16-mt5-bridge-zombie-kill.md`.
