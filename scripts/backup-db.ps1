# =============================================================================
#  TCS Database Backup Script
#  Usage: .\scripts\backup-db.ps1 [-Full] [-KeepDaily 10] [-KeepWeekly 4] [-MaxStorageGB 20]
#
#  Default: Compact mode (skips directiveoutcome + apiactivitylog, ~50-100MB)
#  -Full:   Complete dump including all tables (~2-3GB compressed)
#
#  Retention:
#    -KeepDaily N   Compact backups to keep (default 10)
#    -KeepWeekly N  Full backups to keep (default 4)
#    -MaxStorageGB N Hard cap on backup folder (default 20). If exceeded,
#                   oldest backups (full first) are removed until under cap.
#
#  Output: G:\My Drive\...\backups\db\ → auto-synced by Google Drive
# =============================================================================

param(
  [switch]$Full,
  [int]$KeepDaily = 10,
  [int]$KeepWeekly = 4,
  [int]$MaxStorageGB = 20
)

$ErrorActionPreference = "Stop"

# ── Config ───────────────────────────────────────────────────
$BACKUP_ROOT = "G:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\backups\db"
$MYSQL_BIN   = "C:\wamp64\bin\mysql\mysql9.1.0\bin"
$DB_NAME     = "tradingcs"
$DB_USER     = "tradingcs"
# ⚠️ No literal credential. Sourced from `nest/.env` by the ONE reader — see
# scripts/lib/mysql-credential.ps1 (#1252). It throws by name rather than defaulting.
. "$PSScriptRoot\lib\mysql-credential.ps1"
$dbCred      = Get-TcsDbCredential
$DB_PASS     = $dbCred.Password
$DB_HOST     = "localhost"
$DB_PORT     = "3306"

# ── Pre-flight checks ────────────────────────────────────────
if (-not (Test-Path "G:\My Drive")) {
  Write-Error "Google Drive not mounted at G:\My Drive\. Start Google Drive sync first."
  exit 1
}

$mysqldump = Join-Path $MYSQL_BIN "mysqldump.exe"
$mysql     = Join-Path $MYSQL_BIN "mysql.exe"

if (-not (Test-Path $mysqldump)) {
  Write-Error "mysqldump not found at $mysqldump"
  exit 1
}

# Test MySQL connectivity
$testConn = & $mysql @("-u", $DB_USER, "-p$DB_PASS", "-h", $DB_HOST, "-P", $DB_PORT, "-e", "SELECT 1", "--batch", "--silent") 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "Cannot connect to MySQL: $testConn"
  exit 1
}

Write-Host "MySQL connected. Starting backup..." -ForegroundColor Cyan

# Tables to skip in compact mode
$SKIP_TABLES = @("directiveoutcome", "apiactivitylog")

# ── Setup ─────────────────────────────────────────────────────
$timestamp  = Get-Date -Format "yyyy-MM-dd_HHmm"
$mode       = if ($Full) { "full" } else { "compact" }
$backupDir  = Join-Path $BACKUP_ROOT "$timestamp-$mode"
$mysqldump  = Join-Path $MYSQL_BIN "mysqldump.exe"
$mysql      = Join-Path $MYSQL_BIN "mysql.exe"

if (-not (Test-Path $mysqldump)) {
  Write-Error "mysqldump not found at $mysqldump"
  exit 1
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

# ── Credentials ───────────────────────────────────────────────
$credArgs = @("-u", $DB_USER, "-p$DB_PASS", "-h", $DB_HOST, "-P", $DB_PORT)

# ── Schema dump (always) ──────────────────────────────────────
Write-Host "Dumping schema..." -ForegroundColor Cyan
$schemaFile = Join-Path $backupDir "schema.sql"
# ⚠️ STDOUT ONLY — `Start-Process -RedirectStandardOutput`, NOT `2>&1 | Out-File`.
#
# MEASURED 2026-11-13, and it is the reason no backup could ever be restored: this line used to be
#   & $mysqldump @credArgs ... 2>&1 | Out-File $schemaFile
# and `2>&1` folds mysqldump's STDERR into the file. mysqldump always writes this to stderr:
#
#   mysqldump: [Warning] Using a password on the command line interface can be insecure.
#
# …so line 1 of every `schema.sql` was that warning, MySQL rejected it, and the restore aborted
# before a single table was created. The data file was unaffected (it already redirected stdout
# only), which is why the archive still looked complete — 134 tables dumped, 127 MB written, `DONE`
# printed. Nothing noticed because nothing had ever restored a backup: the same
# "plausible output, no error" shape as every other defect this repo has paid for.
$schemaProc = Start-Process -FilePath $mysqldump `
  -ArgumentList (@("-u", $DB_USER, "-p$DB_PASS", "-h", $DB_HOST, "-P", $DB_PORT,
                   "--no-data", "--no-tablespaces", "--routines", "--triggers", "--events", $DB_NAME)) `
  -NoNewWindow -PassThru -Wait -RedirectStandardOutput $schemaFile
if ($schemaProc.ExitCode -ne 0) {
  Write-Error "schema dump FAILED (exit $($schemaProc.ExitCode))"
  Remove-Item -Recurse -Force $backupDir -ErrorAction SilentlyContinue
  exit 1
}
Write-Host "  Schema saved: $schemaFile" -ForegroundColor Green

# ── Data dump (compressed with .NET GZipStream) ───────────────
if ($Full) {
  $dataFile = Join-Path $backupDir "data-full.sql.gz"
  $tables = @()  # all tables
  Write-Host "Dumping ALL tables (full mode)..." -ForegroundColor Yellow
} else {
  $dataFile = Join-Path $backupDir "data-compact.sql.gz"
  Write-Host "Dumping tables (compact mode — skipping $($SKIP_TABLES -join ', '))..." -ForegroundColor Yellow

  # Get all table names except skipped ones
  $tables = & $mysql @credArgs -N -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_TYPE='BASE TABLE';" $DB_NAME 2>&1 |
    Where-Object { $_ -and $_ -notmatch "Warning" } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -notin $SKIP_TABLES }

  if ($tables.Count -eq 0) { Write-Error "No tables found"; exit 1 }
  Write-Host "  $($tables.Count) tables" -ForegroundColor DarkGray
}

# Pipe mysqldump through .NET GZipStream (no external gzip needed)
$dumpArgs = @("-u", $DB_USER, "-p$DB_PASS", "-h", $DB_HOST, "-P", $DB_PORT, "--no-create-info", "--no-tablespaces", "--single-transaction", "--quick", $DB_NAME) + $tables
$proc = Start-Process -FilePath $mysqldump -ArgumentList $dumpArgs -NoNewWindow -PassThru -RedirectStandardOutput "$backupDir\temp.sql" -Wait

if ($proc.ExitCode -ne 0) {
  Write-Error "mysqldump failed (exit code $($proc.ExitCode))"
  Remove-Item -Recurse -Force $backupDir -ErrorAction SilentlyContinue
  exit 1
}

# Compress with .NET GZipStream (leaveOpen=false on both — dispose closes underlying stream)
#
# ⚠️ `temp.sql` IS REMOVED IN A `finally`, NOT ON THE LINE AFTER THE COMPRESSION.
# Measured 2026-11-13: `temp.sql` was deleted only on the success path, so any failure between the
# dump and the cleanup left a **490 MB** uncompressed dump in the Drive-synced backup folder —
# found as a stray directory dated 2026-10-17, fifteen days of it syncing to Google Drive on every
# run that failed. A cleanup that runs only when nothing went wrong is the opposite of a cleanup.
$src = $null; $dst = $null; $gzip = $null
try {
  $src = New-Object System.IO.FileStream @("$backupDir\temp.sql", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  $dst = New-Object System.IO.FileStream @($dataFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $gzip = New-Object System.IO.Compression.GZipStream @($dst, [System.IO.Compression.CompressionMode]::Compress, $false)
  $src.CopyTo($gzip)
} finally {
  if ($gzip) { $gzip.Dispose() }
  if ($src) { $src.Dispose() }
  if ($dst) { $dst.Dispose() }
  if (Test-Path "$backupDir\temp.sql") { Remove-Item "$backupDir\temp.sql" -Force -ErrorAction SilentlyContinue }
}

$dataSizeMB = [math]::Round((Get-Item $dataFile).Length / 1MB, 2)
Write-Host "  Data saved: $dataSizeMB MB gzipped" -ForegroundColor Green

# ── Archive ───────────────────────────────────────────────────
Write-Host "Archiving..." -ForegroundColor Cyan
$archive = Join-Path $BACKUP_ROOT "$timestamp-$mode.zip"
Compress-Archive -Path @($schemaFile, $dataFile) -DestinationPath $archive -Force

# Clean up uncompressed files
Remove-Item -Recurse -Force $backupDir

$sizeMB = [math]::Round((Get-Item $archive).Length / 1MB, 2)
Write-Host "Backup complete: $archive ($sizeMB MB)" -ForegroundColor Green

# ─── VERIFY — a backup nobody opened is a file, not a backup ─────────────────────────────────
#
# ⚠️ WHY THIS EXISTS (2026-11-13). Measured before it was written: the archive set held THREE
# backups spread over four weeks — 10-17, 10-31, 11-09 — against a DAILY schedule, and the last
# scheduled run reported `LastResult=0x800710E0`. Every one of those archives reported `DONE` when
# it was created, and nothing had ever opened one. That is the defect this repo keeps re-finding:
# **plausible output, no error** — the script prints success whether or not the zip is readable.
#
# This check is deliberately CHEAP and runs on EVERY backup:
#   1. the zip opens and holds exactly the two expected entries;
#   2. the DATA stream decompresses to a plausible size (a truncated gzip throws here);
#   3. `schema.sql` carries the same number of CREATE TABLE statements as the live database.
#
# It CANNOT prove the dump restores. That is what `-RestoreDrill` is for, and it is a separate,
# heavier run — because a check that makes the nightly job slow is a check somebody disables.
$verifyErrors = @()
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
  try {
    $names = $zip.Entries | ForEach-Object { $_.Name }
    foreach ($expected in @('schema.sql', (Split-Path $dataFile -Leaf))) {
      if ($names -notcontains $expected) { $verifyErrors += "archive is missing $expected" }
    }
    $dataEntry = $zip.Entries | Where-Object { $_.Name -eq (Split-Path $dataFile -Leaf) }
    if ($dataEntry) {
      # Re-read the whole gzip stream. A truncated or corrupt member THROWS here rather than
      # returning a short read, which is exactly the difference between "verified" and "looks fine".
      $stream = $dataEntry.Open()
      try {
        $gz = New-Object System.IO.Compression.GZipStream @($stream, [System.IO.Compression.CompressionMode]::Decompress)
        $buffer = New-Object byte[] 1048576
        $total = 0
        while (($n = $gz.Read($buffer, 0, $buffer.Length)) -gt 0) { $total += $n }
        $gz.Dispose()
        $uncompressedMB = [math]::Round($total / 1MB, 1)
        if ($total -lt 1MB) { $verifyErrors += "decompressed data is only $uncompressedMB MB — the dump is effectively empty" }
        Write-Host "  Verified: data decompresses to $uncompressedMB MB" -ForegroundColor DarkGray
      } finally { $stream.Dispose() }
    }
    $schemaEntry = $zip.Entries | Where-Object { $_.Name -eq 'schema.sql' }
    if ($schemaEntry) {
      $reader = New-Object System.IO.StreamReader @($schemaEntry.Open())
      try { $schemaText = $reader.ReadToEnd() } finally { $reader.Dispose() }
      $created = ([regex]::Matches($schemaText, 'CREATE TABLE')).Count
      # ⚠️ THE HEADER CHECK — the guard for the defect above, and it is the one that would have
      # caught it on the very first run. A valid mysqldump begins with `-- MySQL dump`; anything
      # else in line 1 means something that is not SQL reached the file (a warning, a stack trace,
      # a BOM). Reported as its own failure because it makes EVERY later check meaningless.
      $firstLine = ($schemaText -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
      if ($firstLine -notmatch '^--') {
        $verifyErrors += "schema.sql does not start with a SQL comment — line 1 is '$($firstLine.Substring(0, [Math]::Min(90, $firstLine.Length)))'. Something that is not SQL got into the dump."
      }
      $liveCount = (& $mysql @credArgs -N -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_TYPE='BASE TABLE';" 2>&1 |
        Where-Object { $_ -and $_ -notmatch 'Warning' } | Select-Object -First 1).Trim()
      # ⚠️ Compared as a BAND, not equality: `--routines --triggers` can add statements and a
      # table added between the two reads moves the number. A backup with FEWER tables than the
      # database is the failure that matters, and it is reported by name.
      if ([int]$created -lt [int]$liveCount) {
        $verifyErrors += "schema.sql has $created CREATE TABLE statement(s) but the database has $liveCount tables — the dump is INCOMPLETE"
      }
      Write-Host "  Verified: schema carries $created CREATE TABLE / $liveCount live table(s)" -ForegroundColor DarkGray
    }
  } finally { $zip.Dispose() }
} catch {
  $verifyErrors += "archive could not be read: $($_.Exception.Message)"
}

if ($verifyErrors.Count -gt 0) {
  foreach ($e in $verifyErrors) { Write-Host "  ✖ VERIFY FAILED: $e" -ForegroundColor Red }
  # ⚠️ The bad archive is REMOVED, not left in place. A corrupt zip that stays in the folder is
  # counted by retention as a backup and will eventually be the only one left.
  Remove-Item $archive -Force -ErrorAction SilentlyContinue
  Write-Host "  Archive removed — a file that cannot be read is not a backup." -ForegroundColor Red
  exit 1
}

# ─── ROW COUNTS — the CLAIM that `restore-drill.ps1` tests the restore against ───────────────
#
# ⚠️ WHY A SIDECAR AND NOT A COMPARISON AGAINST LIVE. The drill first compared the restored row
# counts to the LIVE database and reported `symbol — live 262, restored 263`. Both numbers were
# right: a symbol had been deleted AFTER the backup was taken. That check measures "has anything
# changed since", which is not the question — a backup is a snapshot and is SUPPOSED to differ.
#
# So each archive now records what it holds, at the moment it is written. The drill compares the
# restore against THAT. The manifest is the claim; the restore is the evidence.
$CONFIG_TABLES = @(
  'trading_strategy', 'strategy_protocol', 'scoring_strategy', 'protocol',
  'protocol_directive_entry', 'protocol_directive_group', 'directive',
  'symbol', 'symbol_route', 'watchlist', 'watchlist_item', 'appsetting', 'global_setting',
  'broker_config', 'broker_symbol'
)
$counts = [ordered]@{ archive = (Split-Path $archive -Leaf); takenAt = $timestamp; mode = $mode; tables = [ordered]@{} }
foreach ($t in $CONFIG_TABLES) {
  $n = (& $mysql @credArgs -N -e "SELECT COUNT(*) FROM ``$DB_NAME``.``$t``;" 2>&1 |
    Where-Object { $_ -notmatch 'Warning' -and $_ } | Select-Object -First 1)
  if ($n) { $counts.tables[$t] = [int]$n.Trim() }
}
$countsFile = Join-Path $BACKUP_ROOT "counts-$timestamp-$mode.json"
($counts | ConvertTo-Json -Depth 4) | Out-File $countsFile -Encoding UTF8
Write-Host "  Counts recorded: $countsFile ($($counts.tables.Count) config tables)" -ForegroundColor DarkGray

# ── Retention ─────────────────────────────────────────────────
# Separate compact and full backups
$allBackups = Get-ChildItem $BACKUP_ROOT -Filter "*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
$compactBackups = $allBackups | Where-Object { $_.Name -match "compact" }
$fullBackups    = $allBackups | Where-Object { $_.Name -match "full" }

# Trim compact backups
if ($compactBackups.Count -gt $KeepDaily) {
  $toRemove = $compactBackups | Select-Object -Skip $KeepDaily
  foreach ($old in $toRemove) {
    Write-Host "Removing old compact: $($old.Name)" -ForegroundColor DarkGray
    Remove-Item $old.FullName -Force
  }
}

# Trim full backups
if ($fullBackups.Count -gt $KeepWeekly) {
  $toRemove = $fullBackups | Select-Object -Skip $KeepWeekly
  foreach ($old in $toRemove) {
    Write-Host "Removing old full: $($old.Name)" -ForegroundColor DarkGray
    Remove-Item $old.FullName -Force
  }
}

# Hard storage cap: if total exceeds MaxStorageGB, remove oldest (full first)
$remaining = Get-ChildItem $BACKUP_ROOT -Filter "*.zip" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime
$totalMB = ($remaining | Measure-Object -Property Length -Sum).Sum / 1MB
if ($totalMB -gt ($MaxStorageGB * 1024)) {
  Write-Host "Storage cap exceeded ($([math]::Round($totalMB,0))MB > ${MaxStorageGB}GB) — removing oldest..." -ForegroundColor Yellow
  $toRemove = $remaining | Sort-Object { if ($_.Name -match "full") { 0 } else { 1 } }, LastWriteTime
  foreach ($old in $toRemove) {
    Remove-Item $old.FullName -Force
    $totalMB = ($remaining | Where-Object { Test-Path $_.FullName } | Measure-Object -Property Length -Sum).Sum / 1MB
    if ($totalMB -le ($MaxStorageGB * 1024 * 0.8)) { break }  # stop at 80% of cap
  }
}

$final = Get-ChildItem $BACKUP_ROOT -Filter "*.zip" -ErrorAction SilentlyContinue
$finalMB = ($final | Measure-Object -Property Length -Sum).Sum / 1MB
$compactCount = ($final | Where-Object { $_.Name -match "compact" }).Count
$fullCount    = ($final | Where-Object { $_.Name -match "full" }).Count

Write-Host "Backup retention: $compactCount compact + $fullCount full = $([math]::Round($finalMB,0))MB / ${MaxStorageGB}GB cap" -ForegroundColor DarkGray

# ── Manifest ──────────────────────────────────────────────────
$tableList = if ($tables.Count -gt 0) { $tables -join ', ' } else { '(all tables)' }
$manifestFile = Join-Path $BACKUP_ROOT "BACKUP-MANIFEST.txt"
@"
TCS Database Backup Manifest
============================
Last backup:  $timestamp ($mode)
Archive:      $timestamp-$mode.zip
Size:         $sizeMB MB
Tables:       $($tables.Count) ($tableList)
Full count:   $fullCount (keep $KeepWeekly)
Compact count: $compactCount (keep $KeepDaily)
Total storage: $([math]::Round($finalMB,0))MB / ${MaxStorageGB}GB cap

To restore:
  unzip <archive>.zip
  mysql -u tradingcs -p tradingcs < schema.sql
  gunzip < data-compact.sql.gz | mysql -u tradingcs -p tradingcs

Location: $BACKUP_ROOT
Synced to: Google Drive (automatic)
"@ | Out-File $manifestFile -Encoding UTF8

Write-Host "Manifest: $manifestFile" -ForegroundColor DarkGray
Write-Host "DONE" -ForegroundColor Green
