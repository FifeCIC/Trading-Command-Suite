# auto-switch: Automatic Symbol Switching for Speed Trading

**Prompt ID:** auto-switch
**Date:** 2026-06-23
**Status:** ready
**Depends on:** speed-scanner

## Goal

Enable an "Auto-Pilot" mode on the Speed Trading page where the active trading symbol automatically switches to the highest-scoring opportunity from the Best Symbol Scanner. The system continuously monitors all Tier A/B symbols and shifts the trader to the best opportunity in real time.

## Behavior

1. User toggles "Auto-Switch" ON
2. Every scan cycle (5s), the scanner ranks all symbols
3. If the top pick differs from the current active symbol AND:
   - Its composite score exceeds the current symbol's score by a threshold (default: 10 points)
   - It has held the #1 position for N consecutive scans (default: 2, i.e., 10 seconds)
   - The current position has been held for at least minimum hold time (default: 15 seconds to prevent flip-flopping)
4. → Automatically switch the active symbol
5. Log the switch: "🔄 Auto-switched from XAUUSD (62) → BTCUSD (78)"

## Controls

- **Toggle:** Auto-Switch ON/OFF (keyboard shortcut: `A` or `Shift+A`)
- **Threshold slider:** 5–25 point minimum score difference (default: 10)
- **Confirmation scans:** 1–5 consecutive scans at #1 (default: 2)
- **Min hold time:** 5s–60s before allowing another switch (default: 15s)
- **Cooldown:** 30s after a manual override before auto-switch resumes

## Visual Indicators

- Auto-Switch indicator in the symbol selector area (green pulsing dot)
- "Next pick queued" indicator when top pick differs but hasn't met confirmation threshold yet
- Transition animation when symbol switches
- Sound cue (optional) on switch

## Safety

- Auto-switch does NOT close existing positions — it only changes the symbol for the NEXT manual trade
- If a position is open on the current symbol, auto-switch is disabled until position is closed
- Emergency lockout (Esc) disables auto-switch immediately
- Manual symbol selection disables auto-switch for 30s cooldown

## Implementation

- Builds on SpeedScanService from speed-scanner.prompt.md
- New state in SpeedTradingPage: autoSwitch, switchThreshold, confirmationScans, minHoldTime
- New keyboard shortcuts: A (toggle auto-switch), Shift+A (force switch now)
