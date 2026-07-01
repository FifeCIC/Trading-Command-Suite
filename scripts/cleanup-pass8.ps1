$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

$done = @('Q284-First-Live-Trade.md','Q501-Automation-Dashboard-UI.md','Q502-ProtocolRunner-Backend.md','Q503-Symbol-Data-Cache.md','Q504-Execution-Queue.md','Q505-SEES-Multi-Protocol-Integration.md')
foreach ($c in $done) {
  $path = Join-Path $promptsDir $c
  if (Test-Path $path) { Move-Item $path (Join-Path $docsDir $c) -Force; Write-Output "DONE: $c" }
}

$remain = (Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }).Count
Write-Output "Remaining: $remain"
