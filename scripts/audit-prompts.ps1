$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$donesDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\agent-updates"
$prompts = Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }
$dones = Get-ChildItem "$donesDir\DONE__*" -Name
$missing = @()
foreach ($p in $prompts) {
  $base = [System.IO.Path]::GetFileNameWithoutExtension($p)
  $short = ($base -split '-')[0]
  $hasDone = $dones | Where-Object { $_ -match $short }
  if (-not $hasDone) { $missing += $base }
}
Write-Output "Total prompts: $($prompts.Count)"
Write-Output "Have DONE: $(($prompts.Count - $missing.Count))"
Write-Output "Missing DONE: $($missing.Count)"
Write-Output ""
Write-Output "=== ALL MISSING ==="
$missing | Sort-Object | ForEach-Object { Write-Output "  $_" }
