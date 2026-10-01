# :5002 canary for #1000 criterion 1.
#
# Starts a throwaway bridge on a port with NO live terminal behind it, and measures the two things
# the issue asks for:
#   1. the log ADVANCES PAST `Initializing MT5`   (i.e. the bounded connect RETURNS)
#   2. the port ANSWERS while that is happening   (i.e. something can be asked what is wrong)
#
# ⚠️ It runs on 5002 and never touches 5000/5001 — the live bridges are deliberately left alone.
# ⚠️ A pythonw-free start: stdout/stderr are redirected to files so the measurement is the log.

$ErrorActionPreference = 'Stop'
$root = 'C:\wamp64\www\trading-command-suite'
$bridge = Join-Path $root 'scripts\mt5-bridge'
$port = 5002
$log = Join-Path $root 'logs\canary-5002.log'
$errLog = Join-Path $root 'logs\canary-5002-err.log'
$python = 'C:\Users\squee\AppData\Local\Python\bin\python.exe'

# A server name that cannot resolve, and a slot that has no MT5_ACCOUNT_<slot> entry, so the
# credential fallbacks below are what is used.
$env:BRIDGE_PORT = "$port"
$env:MT5_ACTIVE_ACCOUNT = '99'
$env:MT5_ACCOUNT = '99999999'
$env:MT5_PASSWORD = 'not-a-password'
$env:MT5_SERVER = 'NO-SUCH-SERVER-INVALID'
$env:MT5_PATH = 'C:\does-not-exist\terminal64.exe'
$env:MT5_INIT_TIMEOUT_MS = '8000'
$env:MT5_WATCHDOG_POLL_SECONDS = '5'

Remove-Item $log, $errLog -ErrorAction SilentlyContinue

Write-Host "=== starting a throwaway bridge on :$port against an unreachable server ==="
$proc = Start-Process -FilePath $python -ArgumentList 'mt5_bridge_v2.py' -WorkingDirectory $bridge `
    -RedirectStandardOutput $log -RedirectStandardError $errLog -PassThru -WindowStyle Hidden

$portEverAnswered = $false
$answeredAt = -1
$state = ''
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    for ($i = 1; $i -le 30; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5 -UseBasicParsing
            if ($r.StatusCode -eq 200) {
                $body = $r.Content | ConvertFrom-Json
                $state = "$($body.connectionState) / $($body.remedy)"
                if (-not $portEverAnswered) { $portEverAnswered = $true; $answeredAt = $sw.Elapsed.TotalSeconds }
            }
        } catch { }
    }
} finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}

# ⚠️ READ **BOTH** STREAMS. The first run of this canary read only the stdout log and reported
# "never reached Initializing MT5" — while the stderr log showed the exact opposite. The bridge's
# `logger` writes to stderr, so a check that reads one file reports a FAIL for a working bridge.
# That is the "a verifier that cannot read its input must ERROR, never pass" defect in its mirror
# image: it must not FAIL on input it never read either.
$outText = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
$errText = if (Test-Path $errLog) { Get-Content $errLog -Raw } else { '' }
$text = "$outText`n$errText"
if (-not $text.Trim()) {
    Write-Host 'CANARY INVALID — neither log has any content, so nothing was measured.'
    exit 2
}
$passedInitialize = $text -match 'Initializing MT5'
$advancedPastInitialize = $false
if ($passedInitialize) {
    $idx = $text.IndexOf('Initializing MT5')
    $after = $text.Substring($idx)
    # The connect RETURNED if anything was logged after the initialize line, or the port answered.
    $advancedPastInitialize = ($after -match '(?m)^.*(IPC timeout|initialization failed|reconnect FAILED|not connected|Risk limits|listening)') -or $portEverAnswered
}

Write-Host ''
Write-Host "reached 'Initializing MT5'        : $passedInitialize"
Write-Host "advanced PAST it (connect RETURNED): $advancedPastInitialize"
Write-Host "port :$port answered /health      : $portEverAnswered  (after ${answeredAt}s)"
Write-Host "reported state                    : $state"
Write-Host ''
Write-Host '--- log tail ---'
if (Test-Path $log) { Get-Content $log -Tail 12 } else { '(no log)' }
if (Test-Path $errLog) { $e = Get-Content $errLog -Raw; if ($e) { Write-Host '--- err tail ---'; Get-Content $errLog -Tail 6 } }

$ok = $advancedPastInitialize -and $portEverAnswered
Write-Host ''
Write-Host $(if ($ok) { 'CRITERION 1: PASS' } else { 'CRITERION 1: FAIL' })
exit $(if ($ok) { 0 } else { 1 })
