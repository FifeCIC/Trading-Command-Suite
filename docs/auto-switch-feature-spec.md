# Auto-Switch: Automatic Symbol Switching for Speed Trading

**Status:** ❌ Not yet implemented  
**Type:** Feature Spec  
**Depends on:** speed-scanner (SpeedScanService — ✅ exists)

## Goal

Enable "Auto-Pilot" mode on the Speed Trading page where the active trading symbol automatically switches to the highest-scoring opportunity from the SpeedScanService.

## Design (for future implementation)

### Behavior Rules
1. User toggles "Auto-Switch" ON
2. Every scan cycle (5s), the scanner ranks all symbols
3. Switch to new symbol if:
   - Its composite exceeds current by ≥10 points
   - It held #1 for ≥2 consecutive scans (10 seconds)
   - Current symbol held for ≥15 seconds (prevents flip-flopping)
4. Log: "🔄 Auto-switched from XAUUSD (62) → BTCUSD (78)"

### Controls
- Toggle: Auto-Switch ON/OFF (keyboard: `A` or `Shift+A`)
- Threshold slider: 5–25 points (default: 10)
- Confirmation scans: 1–5 (default: 2)
- Min hold time: 5s–60s (default: 15s)
- Cooldown: 30s after manual override

### Safety Rules
- Does NOT close existing positions — only changes symbol for NEXT trade
- Disabled while position is open on current symbol
- Emergency lockout (Esc) disables immediately
- Manual symbol selection disables for 30s

### Implementation Notes
- Builds on `SpeedScanService` (`nest/src/modules/scoring/speed-scan.service.ts`)
- New state in `SpeedTradingPage`: `autoSwitch`, `switchThreshold`, `confirmationScans`, `minHoldTime`
- New keyboard shortcuts: `A` (toggle), `Shift+A` (force switch now)

## Related Files
- `src/pages/SpeedTradingPage.jsx` — target for implementation
- `nest/src/modules/scoring/speed-scan.service.ts` — backend dependency (✅ done)
