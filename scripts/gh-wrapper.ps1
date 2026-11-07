#Requires -Version 5
<#
.SYNOPSIS
    gh wrapper that silences PowerShell parser noise from gh's stdin piping.
    Use this instead of raw `gh` to avoid hundreds of lines of cosmetic parser errors.

.EXAMPLE
    pwsh -File scripts\gh-wrapper.ps1 issue create --title "Hello" --body "World"
    pwsh -File scripts\gh-wrapper.ps1 issue close 1 --comment "Done"
    pwsh -File scripts\gh-wrapper.ps1 issue view 1 --json title,body

.NOTES
    ⚠️ 2026-11-07 — this wrapper passes args through cmd /c, so a GRAPHQL STRING LITERAL loses its
    quotes. A query containing login:"FifeCIC" arrives with the quotes stripped and fails with
    "Argument 'login' has an invalid value". Use RAW gh for any GraphQL query containing a string
    literal; use this wrapper for everything else (its JSON and encoding handling is the point).
    A literal-free query such as {viewer{projectsV2(first:1){totalCount}}} works through either.

    Projects v2 also needs the project / read:project scope, which the machine login does NOT have.
    This wrapper loads GITHUB_TOKEN from C:\wamp64\www\.secrets\credentials.env when that file
    carries a real token, and prints the fix when a Projects call is refused.
#>

# ── 2026-11-07 — PROJECTS v2 NEEDS A SCOPED TOKEN, so load one if the owner has provided it ─────
# Agents authenticate as ONE gh login on this machine (keyring). Its scopes are fixed by the gh CLI
# OAuth app and do NOT include `project`/`read:project`, so `gh project` and every GraphQL
# projectsV2 query fail — measured 2026-11-07: "The 'projectsV2' field requires one of the following
# scopes: ['read:project']". Two ways out, and this block supports the second:
#
#   A. gh auth refresh -s project,read:project     (one browser approval, widens the SHARED login)
#   B. put a token in C:\wamp64\www\.secrets\credentials.env as  GITHUB_TOKEN=...   (this block)
#
# ⚠️ The env var is only set when the file actually carries a token. Setting GH_TOKEN to an empty
# string would OVERRIDE the working keyring login and break every issue/PR command that works today.
# ⚠️ GH_TOKEN is checked first by gh; GITHUB_TOKEN is the fallback, so the file may use either name.
$__creds = Join-Path 'C:\wamp64\www\.secrets' 'credentials.env'
if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN -and (Test-Path $__creds)) {
    foreach ($__line in Get-Content $__creds -ErrorAction SilentlyContinue) {
        if ($__line -match '^\s*(?:export\s+)?(GH_TOKEN|GITHUB_TOKEN)\s*=\s*(.+?)\s*$') {
            $__val = $Matches[2].Trim('"').Trim("'")
            # ⚠️ Do NOT break on a rejected value: the file may carry a placeholder FIRST and the
            # real token later, and stopping at the placeholder would look like "no token provided".
            if ($__val -and $__val -notmatch '^<') { $env:GH_TOKEN = $__val; break }
        }
    }
}
# ⚠️ #942 — decode this process's output as UTF-8 so the gh→cmd→PowerShell hop never
# converts em dashes etc. into mojibake on the way IN.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Quote arguments containing whitespace so cmd /c doesn't split them.
# (Previously `$args -join ' '` broke any arg with spaces, e.g. issue titles/body text.)
$ghArgs = ($args | ForEach-Object {
    if ($_ -match '\s') { '"' + ($_ -replace '"', '""') + '"' } else { $_ }
}) -join ' '
if (-not $ghArgs) {
    Write-Host "Usage: pwsh -File scripts\gh-wrapper.ps1 <gh args>" -ForegroundColor Yellow
    Write-Host "Example: pwsh -File scripts\gh-wrapper.ps1 issue create --title ""Foo"" --body ""Bar""" -ForegroundColor DarkGray
    exit 1
}

# Run gh through cmd /c to bypass PowerShell's parser
$result = cmd /c "gh $ghArgs 2>&1"
$exitCode = $LASTEXITCODE

# ⚠️ 2026-09-21 — the noise filter used to run on EVERY line, and a valid single-line
# `--json` payload can match these broad patterns (e.g. a body text containing
# "Missing ... after ...("), which silently deleted the whole JSON result:
# `issue view 913 --json title,body,comments` returned 0 chars while direct gh returned 9,463.
# Found by the independent verification pass on #913.
# Fix, two layers:
#   1. If the output STARTS with { or [ it is a JSON payload — handle it separately.
#   2. Per-line, keep anything that starts with { [ or " — noise lines never do.
$joined = ($result -join "`n").TrimStart()
$isJsonPayload = $joined.StartsWith('{') -or $joined.StartsWith('[')

if ($isJsonPayload) {
    # #942 — emit PURE ASCII: every non-ASCII char (em dash, emoji, box chars) becomes a
    # \uXXXX escape, which JSON parsers unescape exactly. A child process cannot fix the
    # CALLER's console codepage, so instead we give the caller nothing that codepage can
    # mis-decode. Any read-modify-write of an issue body through --json is now safe.
    $payload = $result -join "`n"
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $payload.ToCharArray()) {
        $code = [int][char]$ch
        if ($code -lt 128) { [void]$sb.Append($ch) }
        else { [void]$sb.AppendFormat('\u{0:X4}', $code) }
    }
    $sb.ToString()
} else {
    $filtered = $result | Where-Object {
        $_ -match '^\s*[\[\{]' -or $_ -notmatch 'ParserError|ParentContainsErrorRecordException|ExpectedExpression|Missing condition|Missing type name|Unexpected token|Missing expression after unary operator|Missing.*after.*\(|term.*not recognized'
    }
    if ($filtered) {
        $filtered -join "`n"
    }
}

# ── 2026-11-07 — ONE actionable line instead of a wall of GraphQL noise ─────────────────────────
# A projectsV2 call without the scope returns the SAME three-paragraph error once per requested
# field, which reads as a broken command rather than "your token is missing a permission". The
# detail is worth keeping (it names the exact scope), so this appends a diagnosis rather than
# replacing it.
if (($result -join "`n") -match 'INSUFFICIENT_SCOPES|requires one of the following scopes') {
    Write-Host ""
    Write-Host "  ⚠️ This token cannot manage GitHub Projects. It needs the project scope." -ForegroundColor Yellow
    Write-Host "     Fix A (one browser approval, widens the shared gh login):" -ForegroundColor Yellow
    Write-Host "        gh auth refresh -s project,read:project" -ForegroundColor DarkGray
    Write-Host "     Fix B (per-machine token, no browser): put a token with Projects read/write into" -ForegroundColor Yellow
    Write-Host "        C:\wamp64\www\.secrets\credentials.env   as   GITHUB_TOKEN=..." -ForegroundColor DarkGray
    Write-Host "     This wrapper loads GITHUB_TOKEN from that file automatically when the file has one." -ForegroundColor DarkGray
}

exit $exitCode
