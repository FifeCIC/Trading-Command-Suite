# =============================================================================
#  TCS Restore Drill — prove a backup RESTORES, not just that it exists
#  Usage: pwsh -File scripts/restore-drill.ps1 [-Archive <path>] [-Keep]
#
#  WHY THIS EXISTS (2026-11-13)
#  ----------------------------
#  `backup-db.ps1` had been writing archives that printed `DONE` and were never opened. The
#  measured shape: three archives across four weeks against a DAILY schedule, the last scheduled
#  run reporting `LastResult=0x800710E0`. Nothing was wrong with the files — the schedule was
#  dropping runs — but nothing would have told us if a file HAD been wrong either, because no
#  step ever read one back.
#
#  The repo's own rule (`database-seed-discipline` §4): **"A seeder that RUNS is not a seeder that
#  RESTORES."** The same sentence applies verbatim to a backup, and this is the only thing that
#  tests it.
#
#  WHAT IT DOES
#  1. picks the newest archive (or `-Archive`)
#  2. extracts it and drops/recreates the scratch database `tcs_clone_test`
#  3. imports schema + data exactly as the manifest tells a human to
#  4. compares row counts against the LIVE database, table by table
#  5. reports the differences and exits non-zero if any CONFIG table is short
#
#  ⚠️ It restores into a SEPARATE database, never over `tradingcs`. The credential file grants
#  ALL PRIVILEGES on `tcs_clone_test` precisely so this is possible without touching the real one.
#  ⚠️ `-Keep` leaves the scratch database in place for inspection; the default drops it.
# =============================================================================

param(
  [string]$Archive = "",
  [switch]$Keep
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\lib\mysql-credential.ps1"
$dbCred = Get-TcsDbCredential
$DB_PASS = $dbCred.Password
$MYSQL_BIN = "C:\wamp64\bin\mysql\mysql9.1.0\bin"
$mysql  = Join-Path $MYSQL_BIN "mysql.exe"
$LIVE   = "tradingcs"
$SCRATCH = "tcs_clone_test"
$BACKUP_ROOT = "G:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\backups\db"

# Config tables: if ANY of these is short, the restored copy is not the system we traded with.
# ⚠️ This is the list that answers the owner's actual worry — "we do not want to give my bots away".
$CONFIG_TABLES = @(
  'trading_strategy', 'strategy_protocol', 'scoring_strategy', 'protocol',
  'protocol_directive_entry', 'protocol_directive_group', 'directive',
  'symbol', 'symbol_route', 'watchlist', 'watchlist_item', 'appsetting', 'global_setting',
  'broker_config', 'broker_symbol'
)

if (-not (Test-Path "G:\My Drive")) { Write-Error "Google Drive not mounted at G:\My Drive\."; exit 1 }

if (-not $Archive) {
  $newest = Get-ChildItem $BACKUP_ROOT -Filter "*.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest) { Write-Error "No archives in $BACKUP_ROOT"; exit 1 }
  $Archive = $newest.FullName
}
if (-not (Test-Path $Archive)) { Write-Error "Archive not found: $Archive"; exit 1 }

Write-Host "=== TCS restore drill ===" -ForegroundColor Cyan
Write-Host "  archive : $Archive" -ForegroundColor DarkGray
Write-Host "  size    : $([math]::Round((Get-Item $Archive).Length/1MB,1)) MB" -ForegroundColor DarkGray
Write-Host "  target  : $SCRATCH  (the LIVE database is never touched)" -ForegroundColor DarkGray

$work = Join-Path $env:TEMP ("tcs-restore-drill-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
  # ── 1. Extract ────────────────────────────────────────────────
  Write-Host "Extracting..." -ForegroundColor Cyan
  Expand-Archive -Path $Archive -DestinationPath $work -Force
  $schemaFile = Join-Path $work 'schema.sql'
  $dataFile = Get-ChildItem $work -Filter 'data-*.sql.gz' | Select-Object -First 1
  if (-not (Test-Path $schemaFile)) { Write-Error "archive has no schema.sql"; exit 1 }
  if (-not $dataFile) { Write-Error "archive has no data-*.sql.gz"; exit 1 }

  # ── 2. Fresh scratch database ─────────────────────────────────
  Write-Host "Recreating $SCRATCH ..." -ForegroundColor Cyan
  & $mysql -u tradingcs "-p$DB_PASS" -e "DROP DATABASE IF EXISTS ``$SCRATCH``; CREATE DATABASE ``$SCRATCH``;" 2>&1 |
    Where-Object { $_ -notmatch 'Warning' }
  if ($LASTEXITCODE -ne 0) { Write-Error "could not recreate $SCRATCH"; exit 1 }

  # ── 3. Import, exactly as the manifest tells a human to ───────
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Write-Host "Importing schema..." -ForegroundColor Cyan
  cmd /c "`"$mysql`" -u tradingcs -p$DB_PASS $SCRATCH < `"$schemaFile`"" 2>&1 | Where-Object { $_ -notmatch 'Warning' }
  if ($LASTEXITCODE -ne 0) { Write-Error "schema import FAILED (exit $LASTEXITCODE)"; exit 1 }

  Write-Host "Importing data ($([math]::Round($dataFile.Length/1MB,1)) MB gz)..." -ForegroundColor Cyan
  # ⚠️ gzip is NOT a Windows built-in, so the stream is decompressed in-process and fed to mysql
  # over stdin. That also means the pipeline never writes 690 MB of intermediate .sql to disk.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $mysql
  $psi.Arguments = "-u tradingcs -p$DB_PASS $SCRATCH"
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $mp = [System.Diagnostics.Process]::Start($psi)
  $errTask = $mp.StandardError.ReadToEndAsync()
  $fs = [System.IO.File]::OpenRead($dataFile.FullName)
  $gz = New-Object System.IO.Compression.GZipStream @($fs, [System.IO.Compression.CompressionMode]::Decompress)
  $gz.CopyTo($mp.StandardInput.BaseStream)
  $mp.StandardInput.BaseStream.Flush()
  $mp.StandardInput.Close()
  $gz.Dispose(); $fs.Dispose()
  $mp.WaitForExit()
  $stderr = $errTask.Result
  $sw.Stop()

  if ($mp.ExitCode -ne 0) {
    Write-Host $stderr -ForegroundColor Red
    Write-Error "data import FAILED (exit $($mp.ExitCode))"
    exit 1
  }
  $importErrors = ($stderr -split "`n" | Where-Object { $_ -match '^ERROR' })
  if ($importErrors) {
    Write-Host "⚠️ mysql reported errors during import:" -ForegroundColor Yellow
    $importErrors | Select-Object -First 8 | ForEach-Object { Write-Host "   $_" -ForegroundColor Yellow }
  }
  Write-Host "  imported in $([math]::Round($sw.Elapsed.TotalSeconds,1))s" -ForegroundColor DarkGray

  # ── 4. Compare against the LIVE database ──────────────────────
  #
  # ⚠️ REAL COUNTS, NOT `information_schema.table_rows`. This check first used the estimate and
  # reported `trading_strategy — live ~75, restore 0` while an actual `COUNT(*)` said 75 = 75.
  # The estimate is stale for freshly imported InnoDB tables (it needs ANALYZE), so the drill
  # FAILED A GOOD BACKUP. A verifier that misreads its input is worse than no verifier: the
  # obvious repair for "the backup is broken" is to make another backup, and the backup was fine.
  #
  # Only the CONFIG tables are counted exactly — 15 tables, sub-second — which is exactly the set
  # whose loss the owner is worried about. The 1.3 GB of market data is not counted: its restore is
  # proven by the import exiting 0 and by the table count matching.
  Write-Host "`nComparing row counts (restored vs live)..." -ForegroundColor Cyan
  $tableCountLive = (& $mysql -u tradingcs "-p$DB_PASS" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$LIVE';" 2>&1 | Where-Object { $_ -notmatch 'Warning' } | Select-Object -First 1).Trim()
  $tableCountScratch = (& $mysql -u tradingcs "-p$DB_PASS" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$SCRATCH';" 2>&1 | Where-Object { $_ -notmatch 'Warning' } | Select-Object -First 1).Trim()
  Write-Host "  tables live=$tableCountLive restored=$tableCountScratch" -ForegroundColor DarkGray

  $countExact = {
    param($schema, $table)
    $r = & $mysql -u tradingcs "-p$DB_PASS" -N -e "SELECT COUNT(*) FROM ``$schema``.``$table``;" 2>&1 |
      Where-Object { $_ -notmatch 'Warning' -and $_ } | Select-Object -First 1
    if (-not $r) { return $null }
    return [int]$r.Trim()
  }

  $problems = @()
  if ([int]$tableCountScratch -lt [int]$tableCountLive) {
    $problems += "table count — live $tableCountLive, restored $tableCountScratch"
  }

  # ⚠️ THE COMPARISON TARGET IS THE ARCHIVE'S OWN CLAIM, not the live database. Live moves on:
  # the first run of this drill reported `symbol — live 262, restored 263` because a symbol had been
  # created after the backup was taken. That is drift, not loss, and a drill that calls drift a
  # failure gets muted. `counts-<stamp>.json` is written beside the archive by `backup-db.ps1` and
  # records what the dump held at the moment it was taken.
  $stamp = [System.IO.Path]::GetFileNameWithoutExtension((Split-Path $Archive -Leaf)) -replace '-compact$|-full$', ''
  $countsFile = Join-Path $BACKUP_ROOT "counts-$stamp.json"
  $claimed = $null
  if (Test-Path $countsFile) {
    $claimed = (Get-Content $countsFile -Raw | ConvertFrom-Json).tables
    Write-Host "  comparing against the archive's own claim: $(Split-Path $countsFile -Leaf)" -ForegroundColor DarkGray
  } else {
    Write-Host "  ⚠️ no counts-$stamp.json beside this archive — falling back to a non-empty check" -ForegroundColor Yellow
  }

  foreach ($t in $CONFIG_TABLES) {
    $s = & $countExact $SCRATCH $t
    if ($null -eq $s) { $problems += "$t — MISSING from the restore"; continue }
    if ($claimed -and $null -ne $claimed.$t) {
      $want = [int]$claimed.$t
      if ($s -ne $want) { $problems += "$t — archive claims $want row(s), restore has $s" }
    } elseif ($s -eq 0 -and (& $countExact $LIVE $t) -gt 0) {
      $problems += "$t — restored EMPTY while live is not (no claim file to compare against)"
    }
  }

  # ── 5. The one number that matters ───────────────────────────
  $botsLive = (& $mysql -u tradingcs "-p$DB_PASS" -N -e "SELECT COUNT(*) FROM ``$LIVE``.trading_strategy;" 2>&1 |
    Where-Object { $_ -notmatch 'Warning' } | Select-Object -First 1).Trim()
  $botsRestored = (& $mysql -u tradingcs "-p$DB_PASS" -N -e "SELECT COUNT(*) FROM ``$SCRATCH``.trading_strategy;" 2>&1 |
    Where-Object { $_ -notmatch 'Warning' } | Select-Object -First 1).Trim()
  Write-Host "  BOTS: live=$botsLive  restored=$botsRestored" -ForegroundColor Green
  if ("$botsLive" -ne "$botsRestored") { $problems += "trading_strategy — live $botsLive, restored $botsRestored" }

  if ($problems.Count -gt 0) {
    Write-Host "`n✖ DRILL FAILED — the archive does not restore the configuration:" -ForegroundColor Red
    foreach ($p in $problems) { Write-Host "   $p" -ForegroundColor Red }
    exit 1
  }

  Write-Host "`n✅ DRILL PASSED — $($CONFIG_TABLES.Count) config tables restored, $botsRestored bot(s) recovered" -ForegroundColor Green
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  if (-not $Keep) {
    & $mysql -u tradingcs "-p$DB_PASS" -e "DROP DATABASE IF EXISTS ``$SCRATCH``;" 2>&1 | Where-Object { $_ -notmatch 'Warning' }
  } else {
    Write-Host "  $SCRATCH left in place (-Keep)" -ForegroundColor DarkGray
  }
}
