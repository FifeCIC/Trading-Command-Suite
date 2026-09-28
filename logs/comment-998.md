## Evidence for this issue, at a larger sample

Measured 2026-09-28 with the same method this issue describes — peak reconstructed from `marketbar` highs between `openedAt` and `closedAt` — but over **21 closed XAUUSD trades** rather than 9 (`abTestId IS NULL`, usable `exitPrice`).

| Metric | Value |
|---|---|
| Avg peak unrealised | **+0.424%** |
| Avg final | **−0.116%** |
| Avg give-back | **0.540%** |
| Reached profit | **20 / 21 — 95%** |
| Peaked, then ended flat or loss | **12 / 21 — 57%** |

**This confirms the pattern in the issue at roughly double the sample, and sharpens it:** it is not a handful of unlucky positions — **95% of XAUUSD entries go into profit**, and **more than half hand the whole move back.** The average trade peaks at +0.42% and finishes at −0.12%.

Worst individual give-backs:

| opened | side | final | peak | gave back |
|---|---|---|---|---|
| 2026-09-10 | buy | −2.007% | +0.252% | **2.258pp** |
| 2026-08-12 | buy | −0.686% | +1.077% | **1.763pp** |
| 2026-09-16 | buy | −0.165% | +0.761% | 0.926pp |
| 2026-09-17 | buy | −0.474% | +0.235% | 0.710pp |

## ⚠️ Method note — a clock trap that produced a wrong answer first

`trade.openedAt/closedAt` are **UTC**, and `marketbar.timestamp` is **also UTC** — verified by price alignment: the 5m bar price at each trade's open sits beside its real `entryPrice` at offset 0, and nowhere near it at +3h.

| entryPrice | bar price @ offset 0 | bar price @ +3h |
|---|---|---|
| 4154.50 | **4153.03** ✓ | 4122.12 |
| 4312.13 | **4312.29** ✓ | 4303.61 |

The **MT5 terminal display is UTC+3**, which invites the assumption that the bar store is too. My first pass assumed `+3h` without checking, and it still returned believable averages (avgPeak 0.339) while pairing every trade with price action from three hours *after* it closed. Anyone re-running this measurement should align on `entryPrice` first.

## ⚠️ The sample is limited by P&L coverage, not by bars

`trade`, closed XAUUSD, A/B excluded: **49 trades — 26 of them have `pnl = 0`**, only 23 carry a usable figure.

So the running −127.81 total **understates** the loss, and any analysis of XAUUSD outcomes is working from about half the ledger. The cause is the one in **#1014** (a close the reconciler cannot match to a deal leaves `exitPrice` NULL and `pnl` 0). Fixing that roughly doubles the sample available to this issue.

Bars are not a constraint at all: `marketbar` holds 11,678 × 5m, 11,561 × 1m, 3,945 × 15m, 1,045 × 1h, 495 × 4h and 208 × 1d for XAUUSD, back to 2026-07-29.
