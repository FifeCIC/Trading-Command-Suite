---
title: "HOTAS / Gamepad Integration Prototype — Detection & Mapping"
labels: ["feature", "P1", "hotas", "hardware"]
---

## Description

Prototype HOTAS (Hands On Throttle And Stick) / gamepad integration for physical trading control. Uses the Browser Gamepad API to detect devices, map controls to trading actions, and provide a debug/calibration interface.

## Dependency

⛔ **BLOCKED BY**: Multi-Screen Command Dashboard (#multi-screen-command-dashboard)
- HOTAS mode toggle (Navigate/Trade) lives in the dashboard header
- Speed Trading Panel widget in the conditional zone is the runtime target
- Widget registry pattern is needed for HOTAS action mapping

## Deliverables

### 1. Gamepad Detection Hook
`src/hooks/useGamepadControls.js`
- Listen for `gamepadconnected`/`gamepaddisconnected` events
- Poll gamepad state at 60fps via `requestAnimationFrame`
- Detect: throttle, stick X/Y, rotary dials, triggers, hats, thumb buttons
- Expose: `{ connected, deviceName, axes, buttons, mapping }`
- Handle multiple devices (throttle + stick may be separate)

### 2. Trading Action Registry
`src/hotas/TradingActionRegistry.js`
- Pattern borrowed from OmniCore's action map system
- 13 mappable actions across categories: execution, nav, risk, safety, system
- Default key/axis bindings for standard HOTAS layouts

### 3. HOTAS Debug Page
`src/pages/HotasDebugPage.jsx` — route: `/settings/hotas`
- Device info panel (name, ID, axes count, button count)
- Live axis visualization (bar graphs)
- Live button grid (32 buttons, green when pressed)
- Action mapping table (Action → Assignment → Status)
- Calibrate button (deadzone, range)
- Test mapping mode

### 4. HOTAS Mode Toggle
- Navigate mode: HOTAS controls scrolling/navigation
- Trade mode: HOTAS can execute trades (with safety)
- Visual header indicator: "🕹️ HOTAS: Navigate" / "🕹️ HOTAS: Trade"
- Mode change confirmation for Trade mode

### 5. Mapping Config Storage
- localStorage-based per-device mapping
- Export/import mapping profiles
- Calibration data per device

## References
- Discussion: `discussions/HOTAS-TRADING-INTERFACE.md`
- OmniCore pattern: `C:\wamp64\www\OmniCore` (action registry, XML rebind, integrity checking)
- Prompt: `G:\My Drive\...\.agenticmemory\prompts\Q242-HOTAS-Gamepad-Prototype.md`
