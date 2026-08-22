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
$DB_PASS     = "tradingcs_dev_2026"
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
& $mysqldump @credArgs --no-data --no-tablespaces --routines --triggers --events $DB_NAME 2>&1 | Out-File $schemaFile -Encoding UTF8
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
$src = New-Object System.IO.FileStream @("$backupDir\temp.sql", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
$dst = New-Object System.IO.FileStream @($dataFile, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$gzip = New-Object System.IO.Compression.GZipStream @($dst, [System.IO.Compression.CompressionMode]::Compress, $false)
$src.CopyTo($gzip)
$gzip.Close()
$src.Close()
$dst.Close()
Remove-Item "$backupDir\temp.sql"

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
