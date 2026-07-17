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

$ghArgs = $args -join ' '
if (-not $ghArgs) {
    Write-Host "Usage: pwsh -File scripts\gh-wrapper.ps1 <gh args>" -ForegroundColor Yellow
    Write-Host "Example: pwsh -File scripts\gh-wrapper.ps1 issue create --title ""Foo"" --body ""Bar""" -ForegroundColor DarkGray
    exit 1
}

# Run gh through cmd /c to bypass PowerShell's parser
$result = cmd /c "gh $ghArgs 2>&1"
$exitCode = $LASTEXITCODE

# Filter out the noise lines that PowerShell injects
$filtered = $result | Where-Object {
    $_ -notmatch 'ParserError|ParentContainsErrorRecordException|ExpectedExpression|Missing condition|Missing type name|Unexpected token|Missing expression after unary operator|Missing.*after.*\(|term.*not recognized'
}

if ($filtered) {
    $filtered -join "`n"
}

exit $exitCode
