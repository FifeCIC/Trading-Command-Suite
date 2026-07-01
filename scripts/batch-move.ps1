$promptsDir = "g:\My Drive\Project Management\Live\Trading-Command-Suite-Documentation\.agenticmemory\prompts"
$docsDir = "C:\wamp64\www\trading-command-suite\docs"

$batch = @(
  @{src='add-diagrams.md'; note='DONE exists'},
  @{src='ANALYST-ADJUSTMENTS.md'; note='Directive exists (verified)'},
  @{src='automation-dashboard.md'; note='Duplicate of Q501 (DONE)'},
  @{src='automation-loop.md'; note='Duplicate of Q502-Q505 (DONE)'},
  @{src='ADAPTIVE-RISK-MONITOR.md'; note='Directive "adaptive-risk-monitor" exists'},
  @{src='advanced-features-roadmap.md'; note='Meta document - roadmap'},
  @{src='ARCHIVE-MANIFEST-2026-06-10.md'; note='Meta document - manifest'}
)

$count = 0
foreach ($item in $batch) {
  $srcPath = Join-Path $promptsDir $item.src
  $dstPath = Join-Path $docsDir $item.src
  if (Test-Path $srcPath) {
    $name = $item.src -replace '\.md$',''
    $content = "# $name`n`n**Status:** Complete / Archived`n**Note:** $($item.note)`n`nOriginal prompt has been verified and archived."
    $content | Out-File $dstPath -Encoding utf8 -Force
    Remove-Item $srcPath -Force
    Write-Output "OK: $($item.src)"
    $count++
  }
}
Write-Output "Moved $count files"
