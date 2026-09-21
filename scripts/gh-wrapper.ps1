#Requires -Version 5
<#
.SYNOPSIS
    gh wrapper that silences PowerShell parser noise from gh's stdin piping.
    Use this instead of raw `gh` to avoid hundreds of lines of cosmetic parser errors.

.EXAMPLE
    pwsh -File scripts\gh-wrapper.ps1 issue create --title "Hello" --body "World"
    pwsh -File scripts\gh-wrapper.ps1 issue close 1 --comment "Done"
    pwsh -File scripts\gh-wrapper.ps1 issue view 1 --json title,body
#>

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

exit $exitCode
