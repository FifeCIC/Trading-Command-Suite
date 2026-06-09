param(
    [switch]$InstallPostgres,
    [switch]$InstallRedis,
    [switch]$DryRun = $true
)

$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "HH:mm:ss"
    $color = switch ($Level) {
        "SUCCESS" { "Green" }
        "WARN" { "Yellow" }
        "ERROR" { "Red" }
        "DRY" { "Cyan" }
        default { "White" }
    }
    Write-Host "[$timestamp][$Level] $Message" -ForegroundColor $color
}

function Test-CommandExists {
    param([string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Invoke-Action {
    param(
        [string]$Description,
        [scriptblock]$Action
    )
    if ($DryRun) {
        Write-Log "[DRY-RUN] $Description" -Level "DRY"
    } else {
        Write-Log $Description
        & $Action
    }
}

Write-Log "Trading Command Suite - Local Infrastructure Setup" -Level "INFO"
Write-Log "Mode: $(if ($DryRun) { 'DRY-RUN (no changes will be made)' } else { 'EXECUTION' })" -Level $(if ($DryRun) { "DRY" } else { "WARN" })
Write-Log "InstallPostgres=$InstallPostgres | InstallRedis=$InstallRedis" -Level "INFO"
Write-Log ""

if (-not $InstallPostgres -and -not $InstallRedis) {
    Write-Log "No installation flags provided. Use -InstallPostgres and/or -InstallRedis" -Level "WARN"
    Write-Log ""
    Write-Log "Examples:" -Level "INFO"
    Write-Log "  .\scripts\setup-local-infra.ps1 -InstallPostgres -DryRun" -Level "INFO"
    Write-Log "  .\scripts\setup-local-infra.ps1 -InstallRedis -DryRun:`$false" -Level "INFO"
    Write-Log "  .\scripts\setup-local-infra.ps1 -InstallPostgres -InstallRedis -DryRun:`$false" -Level "INFO"
    exit 0
}

# PostgreSQL Installation
if ($InstallPostgres) {
    Write-Log "--- PostgreSQL Setup ---" -Level "INFO"
    
    if (Test-CommandExists "psql") {
        Write-Log "PostgreSQL already installed (psql found in PATH)" -Level "SUCCESS"
    } elseif (Test-CommandExists "winget") {
        Invoke-Action "Install PostgreSQL 16 via winget" {
            winget install --id PostgreSQL.PostgreSQL.16 --silent --accept-package-agreements --accept-source-agreements
        }
        Write-Log "PostgreSQL installation complete" -Level "SUCCESS"
        Write-Log "Default credentials: user=postgres, password set during install" -Level "INFO"
    } elseif (Test-CommandExists "choco") {
        Invoke-Action "Install PostgreSQL via Chocolatey" {
            choco install postgresql16 -y
        }
        Write-Log "PostgreSQL installation complete" -Level "SUCCESS"
    } else {
        Write-Log "No package manager found (winget/choco). Install manually from https://www.postgresql.org/download/windows/" -Level "ERROR"
    }
    
    if (-not $DryRun) {
        Write-Log "Configure in nest/.env: DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=<your_password> DB_NAME=tradingcs" -Level "INFO"
    }
    Write-Log ""
}

# Redis Installation
if ($InstallRedis) {
    Write-Log "--- Redis Setup ---" -Level "INFO"
    
    if (Test-CommandExists "redis-cli") {
        Write-Log "Redis already installed (redis-cli found in PATH)" -Level "SUCCESS"
    } elseif (Test-CommandExists "winget") {
        Invoke-Action "Install Memurai (Redis-compatible for Windows) via winget" {
            winget install --id Memurai.MemuraiDeveloper --silent --accept-package-agreements --accept-source-agreements
        }
        Write-Log "Memurai installation complete" -Level "SUCCESS"
        Write-Log "Memurai runs on default Redis port 6379" -Level "INFO"
    } elseif (Test-CommandExists "choco") {
        Invoke-Action "Install Memurai via Chocolatey" {
            choco install memurai-developer -y
        }
        Write-Log "Memurai installation complete" -Level "SUCCESS"
    } else {
        Write-Log "No package manager found. Install Memurai from https://www.memurai.com/ or use WSL/Docker for Redis" -Level "ERROR"
    }
    
    if (-not $DryRun) {
        Write-Log "Configure in nest/.env: REDIS_HOST=localhost REDIS_PORT=6379 QUEUE_MODE=local" -Level "INFO"
    }
    Write-Log ""
}

Write-Log "--- Summary ---" -Level "INFO"
if ($DryRun) {
    Write-Log "This was a dry-run. No changes were made." -Level "DRY"
    Write-Log "Run with -DryRun:`$false to execute installation." -Level "DRY"
} else {
    Write-Log "Installation complete. Verify services are running:" -Level "SUCCESS"
    if ($InstallPostgres) {
        Write-Log "  PostgreSQL: pg_ctl status or check Windows Services" -Level "INFO"
    }
    if ($InstallRedis) {
        Write-Log "  Memurai: check Windows Services or run 'redis-cli ping'" -Level "INFO"
    }
    Write-Log "Update nest/.env with connection details before running backend." -Level "INFO"
}
