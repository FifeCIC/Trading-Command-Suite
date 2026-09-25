<#
  install.ps1 — stage 0 (preflight) and stage 1 (install) of the first-run procedure.
  ================================================================================
  Stage 0 · CHECK   What this machine has, and what it is missing — each with the fix.
  Stage 1 · INSTALL Frontend packages, backend packages, Prisma client, backend build.

  ── WHY THIS EXISTS, AND WHY IT IS NOT JUST A SCRIPT ──────────────────────────────
  C1 (FREE-EDITION-PLAN.md §7) requires installation to be "user-oriented and guided,
  not a developer checklist". The previous in-app setup page was exactly that
  checklist; this is the other half — the part that runs BEFORE the app exists.

  ⚠️ IT PRINTS REAL OUTPUT, NEVER A TIMED BAR. A progress bar advanced on a timer is
  a fabricated number — the failure mode development-philosophy.instructions.md §7
  names. Every duration here is MEASURED, and a step reported "already installed"
  was skipped because it is genuinely present.

  ⚠️ IT IS IDEMPOTENT. Re-running converges; it never reinstalls what is already
  there. This matters because the repo has already paid for the opposite: the bot
  seeder (#833) reverted deliberate database-only edits on its first live run.

  ⚠️ NO CREDENTIALS ARE HARDCODED. The database connection is READ FROM nest/.env
  (DATABASE_URL), which is where the app reads it from. This script never sets it.

  ⚠️ IT CHECKS THE SCHEMA AGAINST THE *LIVE* DATABASE, because in this repo the
  running database is the only source of truth — schema.prisma is documentation and
  prisma db push is banned (#769). That check is how #997 was found: the live
  database has 130 tables, the app creates 9 at boot, and there is no migration path,
  so a fresh install cannot complete. This script NAMES that rather than failing
  somewhere confusing later.

  Usage:
    pwsh -File scripts\install.ps1                 # check, then install
    pwsh -File scripts\install.ps1 -Check          # preflight only, change nothing
    pwsh -File scripts\install.ps1 -Detailed       # stream the real sub-process output
    pwsh -File scripts\install.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
    [switch]$Check,       # preflight only
    [switch]$Detailed,    # stream raw output of each step
    [switch]$SkipBuild,
    [string]$LogPath = (Join-Path $env:TEMP 'tcs-install.log')
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$script:Warnings = 0
$script:Failures = 0
$script:StartTime = Get-Date

# ⚠️ The step lines rewrite themselves in place with an ANSI cursor-up. Windows
# PowerShell 5.1 has no ANSI support by default, so without this guard it would print
# the escape sequence as literal text on every step. On 5.1 we simply skip the
# in-place rewrite and let the step print once, on completion.
$script:AnsiOk = $PSVersionTable.PSVersion.Major -ge 7

# ── Presentation ────────────────────────────────────────────────────────────────
# Write-Host -ForegroundColor rather than $PSStyle: this must run under Windows
# PowerShell 5.1 as well as pwsh 7, and $PSStyle does not exist in 5.1.

function Write-Rule {
    param([string]$Title)
    Write-Host ''
    Write-Host "  $Title" -ForegroundColor White
}

function Write-Check {
    param(
        [string]$Label,
        [string]$Detail,
        [ValidateSet('ok', 'note', 'fail')][string]$State = 'ok',
        [string]$Fix
    )
    $glyph = switch ($State) { 'ok' { '✓' } 'note' { '!' } 'fail' { '✗' } }
    $colour = switch ($State) { 'ok' { 'Green' } 'note' { 'Yellow' } 'fail' { 'Red' } }

    Write-Host '   ' -NoNewline
    Write-Host "$glyph  " -NoNewline -ForegroundColor $colour
    Write-Host "$($Label.PadRight(22))" -NoNewline -ForegroundColor Gray
    Write-Host $Detail -ForegroundColor DarkGray

    if ($Fix) {
        Write-Host "         → $Fix" -ForegroundColor DarkYellow
    }

    if ($State -eq 'fail') { $script:Failures++ }
    if ($State -eq 'note') { $script:Warnings++ }
}

function Write-Step {
    param(
        [int]$N, [int]$Total, [string]$Label, [string]$Result,
        [ValidateSet('ok', 'skip', 'fail', 'running')][string]$State = 'ok'
    )
    $glyph = switch ($State) { 'ok' { '✓' } 'skip' { '·' } 'fail' { '✗' } 'running' { '›' } }
    $colour = switch ($State) { 'ok' { 'Green' } 'skip' { 'DarkGray' } 'fail' { 'Red' } 'running' { 'Cyan' } }

    Write-Host '   ' -NoNewline
    Write-Host "$glyph  " -NoNewline -ForegroundColor $colour
    Write-Host "$N/$Total  " -NoNewline -ForegroundColor DarkGray
    Write-Host "$($Label.PadRight(24))" -NoNewline -ForegroundColor Gray
    Write-Host $Result -ForegroundColor DarkGray
}

# ── Helpers ─────────────────────────────────────────────────────────────────────

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-RepoRoot {
    # $PSScriptRoot is .../scripts — the repo root is its parent.
    return (Split-Path -Parent $PSScriptRoot)
}

function Read-DatabaseUrl {
    <#
      Parse DATABASE_URL out of nest/.env. Deliberately does NOT set it: the app loads
      that file itself (ConfigModule envFilePath), and the repo's rules forbid an agent
      or a script from setting DATABASE_URL in the shell.
      Returns a hashtable, or $null when it cannot be read.
    #>
    param([string]$EnvFile)
    if (-not (Test-Path $EnvFile)) { return $null }
    $line = Select-String -Path $EnvFile -Pattern '^\s*DATABASE_URL\s*=\s*(.+)$' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $line) { return $null }
    $raw = $line.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
    if ($raw -match '^mysql://(?<user>[^:]+):(?<pass>[^@]*)@(?<host>[^:/]+):?(?<port>\d+)?/(?<db>[^?]+)') {
        return @{
            User = $Matches['user']
            Pass = $Matches['pass']
            Host = $Matches['host']
            Port = if ($Matches['port']) { [int]$Matches['port'] } else { 3306 }
            Db   = $Matches['db']
        }
    }
    return $null
}

function Find-MySqlClient {
    # PATH first, then the WAMP location this machine actually uses. Returns $null when absent,
    # and the caller reports that honestly rather than pretending the check passed.
    $onPath = Get-Command 'mysql.exe' -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $wamp = 'C:\wamp64\bin\mysql'
    if (Test-Path $wamp) {
        $found = Get-ChildItem $wamp -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'bin\mysql.exe' } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($found) { return $found }
    }
    return $null
}

function Get-TableCount {
    param([hashtable]$Db, [string]$Client)
    if (-not $Db -or -not $Client) { return $null }
    $prev = $env:MYSQL_PWD
    $env:MYSQL_PWD = $Db.Pass
    try {
        $out = & $Client -u $Db.User -h $Db.Host -P $Db.Port -N -B -e `
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$($Db.Db)'" 2>&1
        if ($LASTEXITCODE -ne 0) { return $null }
        return [int]($out | Select-Object -First 1)
    } finally {
        $env:MYSQL_PWD = $prev
    }
}

function Get-FreePort {
    param([int]$Port)
    $inUse = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return (-not $inUse)
}

function Invoke-Step {
    <#
      Runs one install step. Returns $true on success.
      The real output is CAPTURED (so a failure can always show it) and additionally
      STREAMED when -Detailed is set. A failure is never silent: the tail of the output
      is printed and the log path is named.
    #>
    param([int]$N, [int]$Total, [string]$Label, [scriptblock]$Action, [string]$SkipWhen)

    if ($script:AnsiOk) {
        Write-Step -N $N -Total $Total -Label $Label -Result 'working…' -State 'running'
    }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    $out = & $Action 2>&1
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
    $sw.Stop()
    $text = ($out | Out-String)

    # Always keep the full output; a failure must be diagnosable.
    Add-Content -Path $LogPath -Value "`n===== $Label (exit $code) =====`n$text" -ErrorAction SilentlyContinue

    if ($Detailed -and $text.Trim()) {
        Write-Host $text -ForegroundColor DarkGray
    }

    # Erase the in-place 'working…' line. Only possible where ANSI works.
    if ($script:AnsiOk) {
        Write-Host "`e[1A`e[2K" -NoNewline -ErrorAction SilentlyContinue
    }
    if ($code -ne 0) {
        Write-Step -N $N -Total $Total -Label $Label -Result "FAILED (exit $code)" -State 'fail'
        $tail = ($text -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 8)
        foreach ($l in $tail) { Write-Host "        $l" -ForegroundColor DarkRed }
        Write-Host "        → full output: $LogPath" -ForegroundColor DarkYellow
        $script:Failures++
        return $false
    }

    Write-Step -N $N -Total $Total -Label $Label -Result ("{0:N1}s" -f $sw.Elapsed.TotalSeconds) -State 'ok'
    return $true
}

# ── Start ───────────────────────────────────────────────────────────────────────

$repo = Get-RepoRoot
$nestEnv = Join-Path $repo 'nest\.env'
$nestExample = Join-Path $repo 'nest\.env.example'

Set-Content -Path $LogPath -Value "Trading Command Suite install — $(Get-Date -Format o)" -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '  Trading Command Suite' -ForegroundColor Cyan
Write-Host '  ─────────────────────' -ForegroundColor DarkCyan
Write-Host '  Checking this machine, then installing anything missing.' -ForegroundColor DarkGray
Write-Host "  Repo: $repo" -ForegroundColor DarkGray

# ── Stage 0 · CHECK ─────────────────────────────────────────────────────────────

Write-Rule 'Checking your machine'

# Node
$nodeOk = Test-CommandExists 'node'
$nodeVersion = if ($nodeOk) { (& node --version 2>$null) } else { $null }
$nodeMajor = if ($nodeVersion -match 'v(\d+)') { [int]$Matches[1] } else { 0 }
if ($nodeOk -and $nodeMajor -ge 18) {
    Write-Check 'Node.js' $nodeVersion 'ok'
} elseif ($nodeOk) {
    Write-Check 'Node.js' "$nodeVersion — too old" 'fail' 'Install Node.js 18 or newer from https://nodejs.org'
} else {
    Write-Check 'Node.js' 'not found' 'fail' 'Install Node.js 18 or newer from https://nodejs.org'
}

# npm
if (Test-CommandExists 'npm') {
    Write-Check 'npm' ((& npm --version 2>$null) | Select-Object -First 1) 'ok'
} else {
    Write-Check 'npm' 'not found' 'fail' 'npm ships with Node.js — reinstall Node.js'
}

# Database — credentials come FROM nest/.env, they are never set here.
$db = Read-DatabaseUrl -EnvFile $nestEnv
$mysqlClient = Find-MySqlClient
if (-not (Test-Path $nestEnv)) {
    Write-Check 'Configuration' 'nest/.env is missing' 'fail' "Copy nest\.env.example to nest\.env, then set DATABASE_URL"
} elseif (-not $db) {
    Write-Check 'Configuration' 'DATABASE_URL not readable in nest/.env' 'fail' 'Set DATABASE_URL to mysql://user:password@localhost:3306/tradingcs'
} else {
    Write-Check 'Configuration' "nest/.env present — database '$($db.Db)' on $($db.Host):$($db.Port)" 'ok'
}

# Schema — the check that makes #997 visible instead of mysterious.
$tableCount = Get-TableCount -Db $db -Client $mysqlClient
if (-not $mysqlClient) {
    Write-Check 'Database schema' 'cannot verify — no mysql client found' 'note' 'Put mysql.exe on PATH, or use the WAMP install, then re-run'
} elseif ($null -eq $tableCount) {
    Write-Check 'Database schema' 'could not connect' 'fail' 'Check MySQL is running and DATABASE_URL is correct in nest/.env'
} elseif ($tableCount -eq 0) {
    Write-Check 'Database schema' 'empty database' 'fail' 'This build cannot create its tables yet — see issue #997. Install into a database that already has the schema.'
} elseif ($tableCount -lt 50) {
    Write-Check 'Database schema' "$tableCount tables — far fewer than the 130 the app expects" 'fail' 'This looks like a partial schema. See issue #997 before continuing.'
} else {
    Write-Check 'Database schema' "$tableCount tables" 'ok'
}

# Ports — report only. In use may simply mean the app is already running.
$ports = 3201, 5000, 5173
$busy = @($ports | Where-Object { -not (Get-FreePort $_) })
if ($busy.Count -eq 0) {
    Write-Check 'Ports free' ($ports -join ', ') 'ok'
} else {
    Write-Check 'Ports in use' ($busy -join ', ') 'note' 'Usually means the app is already running. Run scripts\tcs-stop.ps1 first if you want a clean start.'
}

# MetaTrader 5 — advisory. Needed for live prices, not for the app to start.
$mt5Paths = @(
    "$env:ProgramFiles\MetaTrader 5\terminal64.exe",
    "${env:ProgramFiles(x86)}\MetaTrader 5\terminal64.exe"
)
$mt5Found = $mt5Paths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($mt5Found) {
    Write-Check 'MetaTrader 5' 'detected' 'ok'
} else {
    Write-Check 'MetaTrader 5' 'not detected in the usual locations' 'note' 'Needed for live prices. You can install it later — the app still starts.'
}

# Repo state
if (Test-Path (Join-Path $repo 'nest\node_modules')) {
    Write-Check 'Backend packages' 'already installed' 'ok'
} else {
    Write-Check 'Backend packages' 'not installed yet' 'note' 'This run will install them'
}
if (Test-Path (Join-Path $repo 'node_modules')) {
    Write-Check 'Frontend packages' 'already installed' 'ok'
} else {
    Write-Check 'Frontend packages' 'not installed yet' 'note' 'This run will install them'
}

# ── Verdict ─────────────────────────────────────────────────────────────────────

if ($script:Failures -gt 0) {
    Write-Host ''
    Write-Host "  ✗  $($script:Failures) thing(s) must be fixed first." -ForegroundColor Red
    Write-Host '     Each is listed above with what to do about it.' -ForegroundColor DarkGray
    Write-Host "     Log: $LogPath" -ForegroundColor DarkGray
    if ($Check) { exit 1 }

    Write-Host ''
    Write-Host '  Stopping here rather than installing into a broken setup.' -ForegroundColor DarkYellow
    exit 1
}

if ($Check) {
    Write-Host ''
    Write-Host '  ✓  This machine is ready. Re-run without -Check to install.' -ForegroundColor Green
    exit 0
}

# ── Stage 1 · INSTALL ───────────────────────────────────────────────────────────

Write-Rule 'Installing'

$total = if ($SkipBuild) { 3 } else { 4 }
$n = 0

# 1 — frontend packages
$n++
if (Test-Path (Join-Path $repo 'node_modules')) {
    Write-Step -N $n -Total $total -Label 'Frontend packages' -Result 'already installed' -State 'skip'
} else {
    if (-not (Invoke-Step -N $n -Total $total -Label 'Frontend packages' -Action {
                Set-Location $repo
                & npm install 2>&1
            })) { exit 1 }
}

# 2 — backend packages
$n++
if (Test-Path (Join-Path $repo 'nest\node_modules')) {
    Write-Step -N $n -Total $total -Label 'Backend packages' -Result 'already installed' -State 'skip'
} else {
    if (-not (Invoke-Step -N $n -Total $total -Label 'Backend packages' -Action {
                & npm --prefix (Join-Path $repo 'nest') install 2>&1
            })) { exit 1 }
}

# 3 — Prisma client
# ⚠️ prisma generate cannot run while the API holds node_modules/.prisma/client/query_engine-windows.dll.node.
# build:preflight names the holding PID; prebuild runs it automatically, so a failure here is explained.
$n++
if (-not (Invoke-Step -N $n -Total $total -Label 'Prisma client' -Action {
            & npm --prefix (Join-Path $repo 'nest') run prisma:generate 2>&1
        })) {
    Write-Host '        → If this says EPERM, the API is running and holds the query engine DLL.' -ForegroundColor DarkYellow
    Write-Host '          Stop it first: pwsh -File scripts\tcs-stop.ps1' -ForegroundColor DarkYellow
    exit 1
}

# 4 — backend build
if (-not $SkipBuild) {
    $n++
    if (-not (Invoke-Step -N $n -Total $total -Label 'Backend build' -Action {
                & npm --prefix (Join-Path $repo 'nest') run build 2>&1
            })) {
        Write-Host '        → If this says EPERM, the API is running. Stop it: pwsh -File scripts\tcs-stop.ps1' -ForegroundColor DarkYellow
        exit 1
    }
}

# ── Done ────────────────────────────────────────────────────────────────────────

$elapsed = (Get-Date) - $script:StartTime
Write-Host ''
Write-Host '  ✓  Ready.' -ForegroundColor Green
Write-Host ("     Finished in {0:N1}s." -f $elapsed.TotalSeconds) -ForegroundColor DarkGray
if ($script:Warnings -gt 0) {
    Write-Host "     $($script:Warnings) note(s) above — none of them stop the app from starting." -ForegroundColor DarkGray
}
Write-Host ''
Write-Host '     Start it with:' -ForegroundColor DarkGray
Write-Host '       pwsh -File scripts\tcs-launch.ps1' -ForegroundColor Cyan
Write-Host '     Then open:' -ForegroundColor DarkGray
Write-Host '       http://localhost:5173' -ForegroundColor Cyan
Write-Host ''
Write-Host "     Log: $LogPath" -ForegroundColor DarkGray
