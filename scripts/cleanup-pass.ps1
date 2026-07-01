$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$updatesDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\agent-updates"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

# 1. Move CLAIM files to agent-updates
$claims = Get-ChildItem "$promptsDir\CLAIM__*" -ErrorAction SilentlyContinue
foreach ($c in $claims) {
  Move-Item $c.FullName (Join-Path $updatesDir $c.Name) -Force
  Write-Output "FIXED: $($c.Name) → agent-updates/"
}

# 2. Move blog/design docs to docs
$metaPatterns = @('BLOG-*','CAD-USD-OIL-*','CONVICTION-GROWTH*','CORRELATION-EXPOSURE*','CANDLE-PATTERN-TRAINING*','CHART-LIBRARY-INTEGRATION*')
foreach ($pattern in $metaPatterns) {
  $files = Get-ChildItem "$promptsDir\$pattern" -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    Move-Item $f.FullName (Join-Path $docsDir $f.Name) -Force
    Write-Output "MOVED: $($f.Name) → docs/"
  }
}

# 3. Move already-complete duplicates
$done = @('computed-portfolio-endpoint.md','create-data-tables.md','create-protocols-conflict-detection.md','btc-speed-protocol-implementation.md')
foreach ($d in $done) {
  $path = Join-Path $promptsDir $d
  if (Test-Path $path) {
    $name = $d -replace '\.md$',''
    "# $name - Archived`n`nFeature is complete in codebase." | Out-File (Join-Path $docsDir $d) -Encoding utf8 -Force
    Remove-Item $path -Force
    Write-Output "DONE: $d → docs/"
  }
}

$remain = (Get-ChildItem "$promptsDir\*.md" -Name | Where-Object { $_ -notmatch '^PREFLIGHT' }).Count
Write-Output ""
Write-Output "Remaining prompts: $remain"
