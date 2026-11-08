<#
.SYNOPSIS
  Read the database URL (and its pieces) from `nest/.env` — the ONE PowerShell credential reader.

.DESCRIPTION
  ⚠️ WHY THIS FILE EXISTS. Measured 2026-11-07 (#1252): the dev database password was a literal in
  21 tracked files in a PUBLIC repository, in five different shapes. One of those shapes was a
  PowerShell variable holding the password in plain text, beside the user and host it belonged to.

  A second PowerShell script that needed the same value would have copied that line, which is the
  repo's most-repeated defect: two implementations, both drift, only one gets the next fix. So the
  parse lives here once and both scripts dot-source it.

  ⚠️ It REFUSES rather than defaulting. A resolver that invents a fallback is how the literals spread
  in the first place — and a wrong guess connects to a different database silently, which is this
  repo's most expensive failure signature (plausible output, no error).

.EXAMPLE
  . "$PSScriptRoot\lib\mysql-credential.ps1"
  $cred = Get-TcsDbCredential
  & mysql @('-u', $cred.User, "--password=$($cred.Password)") ...

.NOTES
  `nest/.env` is gitignored and is the only place a credential may live on this machine.
#>

function Read-TcsEnvFile {
  <#
    Parse `nest/.env` into a hashtable. Deliberately does NOT evaluate the file — it is data, not
    script, and `Invoke-Expression` on a config file is an injection surface with no upside.
  #>
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path $Path)) { return @{} }
  $map = @{}
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $map[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $map
}

function Get-TcsDatabaseUrl {
  <#
    The DSN. `$env:DATABASE_URL` wins if already set (so a caller or CI can override), then
    `nest/.env`. Throws by name if neither has it — never returns a guess.
  #>
  param([string]$EnvPath)

  if ($env:DATABASE_URL) { return $env:DATABASE_URL }
  if (-not $EnvPath) {
    $repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $EnvPath = Join-Path $repoRoot 'nest/.env'
  }
  $map = Read-TcsEnvFile -Path $EnvPath
  if (-not $map['DATABASE_URL']) {
    throw "DATABASE_URL is not set and $EnvPath does not have it — refusing to guess credentials (#1252)."
  }
  return $map['DATABASE_URL']
}

function Get-TcsDbCredential {
  <#
    user / password / host / port / database, parsed from the DSN.
    ⚠️ Put the password in `MYSQL_PWD` or pass it to the client; never rely on it appearing in a
    process list. That is the rule `scripts/lib/mysql-cli.cjs` already states for the Node side.
  #>
  param([string]$EnvPath)

  $url = Get-TcsDatabaseUrl -EnvPath $EnvPath
  $m = [regex]::Match($url, '^mysql://([^:]+):([^@]*)@([^:/]+):(\d+)/([^?]+)')
  if (-not $m.Success) {
    throw "DATABASE_URL is not a mysql:// URL in the expected shape (user:password@host:port/database) — refusing to guess."
  }
  return [pscustomobject]@{
    User     = $m.Groups[1].Value
    Password = $m.Groups[2].Value
    Host     = $m.Groups[3].Value
    Port     = $m.Groups[4].Value
    Database = $m.Groups[5].Value
  }
}
