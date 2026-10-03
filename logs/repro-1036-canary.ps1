# repro-1036-canary.ps1 — start a CANARY MT5 bridge on its own port, for #1036.
#
# WHY: #1036 asks whether a failed reconnect on ONE bridge can take down ANOTHER bridge's session.
# This starts a throwaway bridge process with an explicit slot, so the experiment is reproducible
# by a stated command rather than by memory.
#
# ⚠️ IT IS A CANARY. It is expected to FAIL its MT5 initialize. It is NOT part of the stack.
# ⚠️ THE WATCHDOG IS NEUTERED ON PURPOSE. The production bridge's `connection_watchdog()` POSTs
#    /reconnect by itself after 3 bad polls (mt5_bridge_v2.py L2175, #992). Left armed, the canary
#    would reconnect on its own and the experiment would have no control over WHEN the reconnect
#    happened — which is the whole measurement. So the poll interval is pushed beyond the run and
#    the failure threshold is set absurdly high.
#
# Usage:
#   pwsh -File logs/repro-1036-canary.ps1 -Port 5002 -Path 'C:\Program Files\MetaTrader 5' `
#        -Server 'NoSuchServer-Demo' -Account '99999999' -Tag 'shared-terminal'
#
# -Path '' (empty) means "no terminal path", which makes connect_mt5() use
# credentials-only initialize. Passing a path that does NOT contain terminal64.exe makes
# initialize fail fast with -10004 ('No IPC connection') — the exact error the original
# 2026-09-30 canary logged.
param(
  [int]$Port = 5002,
  [string]$Path = '',
  [string]$Server = 'NoSuchServer-Demo',
  [string]$Account = '99999999',
  [string]$Tag = 'canary',
  [int]$InitTimeoutMs = 6000
)

$ErrorActionPreference = 'Stop'
$root = 'C:\wamp64\www\trading-command-suite'
$bridgeDir = Join-Path $root 'scripts\mt5-bridge'
$python = 'C:\Users\squee\AppData\Local\Python\bin\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }

$outLog = Join-Path $root "logs\canary-$Tag-out.log"
$errLog = Join-Path $root "logs\canary-$Tag-err.log"

# ⚠️ Set as REAL process env, not .env entries. The bridge calls dotenv.load_dotenv(nest/.env) at
# import (L20-23), and python-dotenv does NOT override variables that already exist — so these win,
# and nothing here needs to be written into the repository's .env.
$env:BRIDGE_PORT                 = "$Port"
$env:MT5_ACTIVE_ACCOUNT           = '9'
$env:MT5_ACCOUNT_9                = $Account
$env:MT5_PASSWORD_9               = 'canary-not-a-real-password'
$env:MT5_SERVER_9                 = $Server
$env:MT5_PATH_9                   = $Path
$env:MT5_INIT_TIMEOUT_MS          = "$InitTimeoutMs"
$env:MT5_WATCHDOG_FAILURES        = '999999'
$env:MT5_WATCHDOG_POLL_SECONDS    = '3600'

$p = Start-Process -FilePath $python `
  -ArgumentList (Join-Path $bridgeDir 'mt5_bridge_v2.py') `
  -WorkingDirectory $bridgeDir `
  -RedirectStandardOutput $outLog -RedirectStandardError $errLog `
  -PassThru -WindowStyle Hidden

Write-Output "canary tag=$Tag port=$Port pid=$($p.Id) path='$Path' server=$Server"
Write-Output "logs: $outLog | $errLog"
