param(
    [switch]$InstallPostgres,
    [switch]$InstallRedis,
    [switch]$StartServices,
    [switch]$DryRun = $true
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "[setup-local-infra] $Message"
}

function Invoke-Step {
    param(
        [string]$Title,
        [scriptblock]$Action
    )

    Write-Step $Title
    if ($DryRun) {
        Write-Step "Dry run enabled. Skipping execution."
        return
    }

    & $Action
}

Write-Step "Starting local infrastructure helper."
Write-Step "InstallPostgres=$InstallPostgres InstallRedis=$InstallRedis StartServices=$StartServices DryRun=$DryRun"

if (-not $InstallPostgres -and -not $InstallRedis -and -not $StartServices) {
    Write-Step "No actions selected. Use one or more switches."
    Write-Step "Examples:"
    Write-Step "  .\\scripts\\setup-local-infra.ps1 -InstallPostgres"
    Write-Step "  .\\scripts\\setup-local-infra.ps1 -InstallRedis -StartServices -DryRun:$false"
    exit 0
}

if ($InstallPostgres) {
    Invoke-Step -Title "Install PostgreSQL (placeholder)." -Action {
        throw "TODO: Add install command here (winget/choco/manual installer)."
    }
}

if ($InstallRedis) {
    Invoke-Step -Title "Install Redis (placeholder)." -Action {
        throw "TODO: Add install command here (Memurai/Redis for Windows/container option)."
    }
}

if ($StartServices) {
    Invoke-Step -Title "Start services (placeholder)." -Action {
        throw "TODO: Add service start checks for PostgreSQL and Redis."
    }
}

Write-Step "Completed."
