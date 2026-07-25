$file = "c:\wamp64\www\trading-command-suite\src\pages\DiagramsPage.jsx"
$lines = [System.IO.File]::ReadAllLines($file, [System.Text.Encoding]::UTF8)
$inTarget = $false; $inCode = $false; $codeStart = -1; $codeEnd = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "id:\s*'scoring-gating'") { $inTarget = $true }
    if ($inTarget -and $lines[$i] -match "^\s*code:\s*") { $codeStart = $i; $inCode = $true; continue }
    if ($inCode) {
        if ($lines[$i] -match '^\s*`\s*,?\s*$' -or $lines[$i] -match '^\s*`\s*$') { $codeEnd = $i; break }
    }
}
Write-Output "codeStart: $codeStart, codeEnd: $codeEnd"
if ($codeStart -ge 0 -and $codeEnd -gt $codeStart) {
    Write-Output "Code block: lines $codeStart-$codeEnd"
    Write-Output "Total code lines: $($codeEnd - $codeStart + 1)"
}
