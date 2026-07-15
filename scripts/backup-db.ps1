# =============================================================================
#  TCS Database Backup Script
#  Usage: .\scripts\backup-db.ps1 [-Full] [-Compact]
#
#  -Full:     Complete dump including directiveoutcome (large, ~6GB)
#  -Compact:  Skip directiveoutcome + apiactivitylog (~5.6GB saved)
#  Default:   Compact mode (what you typically want for backtesting data)
# =============================================================================

param(
  [switch]$Full,
  [switch]$Compact
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
& $mysqldump @credArgs --no-data --routines --triggers --events $DB_NAME 2>&1 | Out-File $schemaFile -Encoding UTF8
Write-Host "  Schema saved: $schemaFile" -ForegroundColor Green

# ── Data dump ─────────────────────────────────────────────────
if ($Full) {
  Write-Host "Dumping ALL tables (full mode)..." -ForegroundColor Yellow
  $dataFile = Join-Path $backupDir "data-full.sql"
  & $mysqldump @credArgs --no-create-info --single-transaction --quick $DB_NAME 2>&1 | Out-File $dataFile -Encoding UTF8
} else {
  Write-Host "Dumping tables (compact mode — skipping $($SKIP_TABLES -join ', '))..." -ForegroundColor Yellow
  $dataFile = Join-Path $backupDir "data-compact.sql"

  # Get all table names
  $tables = & $mysql @credArgs -N -e "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_TYPE='BASE TABLE';" $DB_NAME 2>&1 |
    Where-Object { $_ -and $_ -notmatch "Warning" } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -notin $SKIP_TABLES }

  if ($tables.Count -eq 0) {
    Write-Error "No tables found"
    exit 1
  }

  $tableList = $tables -join " "
  Write-Host "  Tables: $($tables.Count) ($tableList)" -ForegroundColor DarkGray

  & $mysqldump @credArgs --no-create-info --single-transaction --quick $DB_NAME $tables 2>&1 | Out-File $dataFile -Encoding UTF8
}

if ($LASTEXITCODE -ne 0) {
  Write-Error "mysqldump failed"
  exit 1
}

# ── Compress ──────────────────────────────────────────────────
Write-Host "Compressing..." -ForegroundColor Cyan
$archive = Join-Path $BACKUP_ROOT "$timestamp-$mode.zip"
Compress-Archive -Path $backupDir\* -DestinationPath $archive -Force

# Clean up uncompressed
Remove-Item -Recurse -Force $backupDir

$sizeMB = [math]::Round((Get-Item $archive).Length / 1MB, 2)
Write-Host "Backup complete: $archive ($sizeMB MB)" -ForegroundColor Green

# ── Retention: keep last 10 backups ───────────────────────────
$allBackups = Get-ChildItem $BACKUP_ROOT -Filter "*.zip" | Sort-Object LastWriteTime -Descending
if ($allBackups.Count -gt 10) {
  $toRemove = $allBackups | Select-Object -Skip 10
  foreach ($old in $toRemove) {
    Write-Host "Removing old backup: $($old.Name)" -ForegroundColor DarkGray
    Remove-Item $old.FullName -Force
  }
}

Write-Host "Current backups: $([math]::Min($allBackups.Count, 10)) retained" -ForegroundColor DarkGray
