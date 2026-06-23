$key = "31779516ZTkGWTjRnQRsrvGzKezREycuaxqgD"
$secret = "-wUh-fTq0mSEB7nqv9T5h8_YGEbPjuvAeAWB5VtNVsM"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${key}:${secret}"))
$headers = @{Authorization="Basic $b64"; "Content-Type"="application/json"}
$base = "https://demo.trading212.com/api/v0"

Write-Host "=== Existing Orders ==="
try { (Invoke-RestMethod -Uri "$base/equity/orders" -Headers @{Authorization="Basic $b64"}) | ConvertTo-Json -Depth 3 } catch { "Error: $_" }

Write-Host "`n=== direction=SELL ==="
$r = Invoke-WebRequest -Uri "$base/equity/orders/market" -Method POST -Headers $headers -Body '{"ticker":"NVDA_US_EQ","quantity":1,"direction":"SELL"}' -SkipHttpErrorCheck
Write-Host "$($r.StatusCode) — $($r.Content)"

Write-Host "`n=== side=SELL ==="
$r = Invoke-WebRequest -Uri "$base/equity/orders/market" -Method POST -Headers $headers -Body '{"ticker":"NVDA_US_EQ","quantity":1,"side":"SELL"}' -SkipHttpErrorCheck
Write-Host "$($r.StatusCode) — $($r.Content)"
