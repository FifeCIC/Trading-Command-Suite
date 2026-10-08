# Restore closedAt on rows the #1089 repair run re-stamped with the run time.
#
# THE DEFECT (found while running the repair, 2026-10-08): position-sync writes
# `closedAt: closedAt ?? new Date()` — correct for a LIVE close, wrong for the #1014 repair pass,
# which re-finalises rows that were closed long ago. For every candidate whose deal could not be
# re-read, closedAt was rewritten to the RUN TIME (2026-10-08 08:45-08:50 window).
#
# SOURCES OF THE ORIGINAL VALUES:
#   A) logs/backup-1089-repair-pool-*.tsv — taken BEFORE the run, covers the pnlInvalid=1 pool.
#   B) the six-symbol listing captured before the run (transcribed below) — covers the rows I had
#      newly flagged, which were pnlInvalid=0 at snapshot time and so are not in the TSV.
#
# ONLY rows stamped in the run window are restored. Rows the run RESOLVED now carry their real
# deal times (second-aligned) — those are improvements and are left alone.

$ErrorActionPreference = 'Stop'
Set-Location 'c:\wamp64\www\trading-command-suite'
$my = 'C:\wamp64\bin\mysql\mysql9.1.0\bin\mysql.exe'
$pw = 'tradingcs_dev_2026'

# ── A) TSV-backed originals ─────────────────────────────────────────────────────────────────
$tsvFile = Get-ChildItem 'logs\backup-1089-repair-pool-*.tsv' | Sort-Object Name | Select-Object -Last 1
$tsvMap = @{}
Get-Content $tsvFile.FullName | Select-Object -Skip 1 | Where-Object { $_ -match '\S' } | ForEach-Object {
  $p = $_ -split "`t"
  if ($p.Count -ge 10) { $tsvMap[$p[0]] = $p[9] }
}

# ── B) six-symbol listing captured before the run (id = original closedAt) ───────────────────
$listing = @{
  '09c6a21e-f494-470c-93ae-1db9a916a83d' = '2026-09-22 06:17:00.000'
  'c8998025-047f-4adc-9215-aef92cb4514d' = '2026-09-23 09:49:43.413'
  '20bf0a6f-68a6-4347-bca1-42459f3fed7a' = '2026-09-24 15:29:20.179'
  '1b99b442-97de-4c80-a4a4-2073c3739d52' = '2026-09-28 12:27:54.353'
  'ba576b45-43b8-4d59-ac0f-1c952a04cbd1' = '2026-09-29 12:59:22.575'
  '037fcf47-c92a-434a-bd0b-f91720c6d384' = '2026-09-30 09:30:04.914'
  'df94410a-19da-4379-a27e-2e20db7dba5e' = '2026-10-01 08:31:13.635'
  '0f9c8bfe-b618-42ce-a963-84c43b8e12f8' = '2026-09-16 07:27:29.000'
  'fc847043-94f9-478d-8f8c-d8228551ee3c' = '2026-09-24 15:29:20.169'
  'b199a035-ec72-4f53-b569-4b52164e5409' = '2026-09-28 13:25:13.772'
  '0f636e75-40b6-438e-96bf-9c2946e25597' = '2026-09-29 12:59:24.002'
  'e1e9f5dd-92cd-42d1-becf-45915ca47a64' = '2026-09-29 15:23:16.050'
  'ba8b2827-9c29-4f21-b940-fd432705b4c1' = '2026-09-30 08:57:48.182'
  '3062ec03-b171-49c3-99d5-2fe67bbe44f3' = '2026-09-30 12:18:28.176'
  'ee98b308-0d68-4ed1-abca-e1d03fa777c1' = '2026-10-01 09:17:15.197'
  '49fde24c-92a7-403c-88c0-d052e50d5431' = '2026-09-22 06:16:59.000'
  '7e772e5e-90ac-4d97-8670-e84fb21d81c6' = '2026-09-23 11:24:03.865'
  '4eeb6696-f212-4efb-be13-d9b046f47f57' = '2026-09-25 08:48:05.585'
  'd35e98fc-f543-4da1-97f9-f5b48a2739c4' = '2026-09-29 12:59:23.289'
  'fff654fa-7900-440a-b5b4-12a38f954450' = '2026-09-29 15:23:13.175'
  'd3b0f1aa-3867-47c7-9663-f9d4d097df3e' = '2026-09-30 08:57:47.815'
  'e37d7c3a-deda-4365-8289-05ac3616ad53' = '2026-10-01 09:17:15.711'
  '5f0e8353-1468-4cac-8910-cfffdd1d3daf' = '2026-09-29 12:59:22.239'
  'ffba4310-9873-45b3-84fe-9f5bd9c603f2' = '2026-09-29 15:09:13.739'
  'bdc29b10-efc7-4ff0-a099-f790abd94ce8' = '2026-09-29 15:57:13.895'
  '0c4db463-e373-4c2e-aadd-0cd7b87b4a4a' = '2026-10-01 13:42:49.291'
  '67bd6936-5c03-4428-92ff-29247237683d' = '2026-10-02 13:56:13.117'
  'c9a52e0d-6368-4332-b5ff-f0fafab4dceb' = '2026-10-02 15:35:17.510'
  'e87974c4-8e80-40c0-89a2-d51ec66f01ea' = '2026-09-16 12:29:50.000'
  'b47173c7-0b69-4f10-92a1-580a7d50e315' = '2026-09-21 10:49:14.401'
  'f843184b-34d7-424f-96e9-4af79d2c4e0b' = '2026-09-21 10:49:14.752'
  'eb628953-f9a2-4b12-ad71-0edf6018c362' = '2026-09-28 09:05:03.653'
  '4aaab553-2ede-47d9-8ed8-76a9e2f5a7d2' = '2026-09-29 07:16:30.856'
  'b4f50eed-13b1-4f2a-9019-43ffccba5947' = '2026-09-29 17:00:13.035'
  'ab34b398-ad80-4f72-8345-961af345b727' = '2026-10-01 07:24:08.574'
  '6dbbc758-c5a0-4ed2-9642-fd8be8329557' = '2026-10-01 13:33:11.120'
  '6215083d-675d-4695-8e32-15ad7632f7e5' = '2026-10-06 17:17:16.293'
  '015c6557-9bec-4638-b90b-6c5bb925150d' = '2026-09-21 11:54:25.000'
  '1cf8fe9e-7167-4713-aef4-4a8518b80469' = '2026-09-22 08:33:18.000'
  '19f45637-4e75-4ac8-abef-f8d1aa4e558a' = '2026-09-23 13:10:36.873'
  'a18999c2-e561-4e95-8b74-ffe9f1fd5f82' = '2026-09-29 12:59:23.280'
  '5462275b-1e11-4268-b346-459c8452c36f' = '2026-09-30 08:57:47.466'
  '978a5a97-2a52-4e0d-bce7-5b81267b13f9' = '2026-10-01 08:21:15.166'
  '8c723d29-7f6c-42aa-a7b1-5882f381005d' = '2026-10-01 13:42:48.693'
}

# ── The damage set: everything stamped in the repair run's window ────────────────────────────
$rows = & $my -utradingcs "-p$pw" tradingcs -e "SELECT id, symbol, closedAt FROM trade WHERE closedAt >= '2026-10-08 08:45:00' AND closedAt < '2026-10-08 08:50:00';" --batch 2>$null | Select-Object -Skip 1
$sql = New-Object System.Collections.Generic.List[string]
$uncovered = @()
foreach ($r in $rows) {
  $p = $r -split "`t"
  if ($p.Count -lt 3) { continue }
  $id = $p[0]
  if ($tsvMap.ContainsKey($id)) { $was = $tsvMap[$id] }
  elseif ($listing.ContainsKey($id)) { $was = $listing[$id] }
  else { $uncovered += "$id ($($p[1]))"; continue }
  $sql.Add("UPDATE trade SET closedAt='$was' WHERE id='$id';")
}
Write-Output "damaged rows found: $($rows.Count) · restorable: $($sql.Count) · uncovered: $($uncovered.Count)"
if ($uncovered.Count) { Write-Output 'UNCOVERED:'; $uncovered | ForEach-Object { Write-Output "  $_" } }
if ($sql.Count -eq 0) { Write-Output 'nothing to restore'; exit 0 }

$sqlFile = 'logs\restore-1089-closedat.sql'
$sql -join "`n" | Out-File -Encoding ascii $sqlFile
Get-Content $sqlFile | & $my -utradingcs "-p$pw" tradingcs

$check = & $my -utradingcs "-p$pw" tradingcs -e "SELECT COUNT(*) remaining FROM trade WHERE closedAt >= '2026-10-08 08:45:00' AND closedAt < '2026-10-08 08:50:00';" --batch 2>$null | Select-Object -Skip 1
Write-Output "remaining in run window after restore: $check"
