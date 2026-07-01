# RUI016 — HOTAS Trading Interface (Gamepad API)

**Agent:** tcs-dev
**Area:** Trading / UI
**Priority:** P3 — exploration / prototype
**Depends on:** Browser Gamepad API, OmniCore HOTAS patterns (reference only)

## Vision

Use flight HOTAS hardware as a physical trading interface. Throttle scrolls data. Hats navigate UI. Rotary dials adjust trade size. Buttons execute trades.

## Reference: OmniCore Patterns

`C:\wamp64\www\OmniCore` has patterns we can reuse:
- **XML Rebind Engine** — maps game actions to physical controls
- **Mapping Integrity Checker** — validates all mapped features have targets
- **Action Map Registry** — feature ID → control mapping

Pattern: `Physical Device → Action Registry → Event Dispatch → UI`

## Task

### Phase 1: Gamepad API Proof of Concept
```javascript
window.addEventListener('gamepadconnected', (e) => {
  console.log('HOTAS connected:', e.gamepad.id);
});
const gamepad = navigator.getGamepads()[0];
// axes[0..5] — throttle, stick X/Y, rotary, slider
// buttons[0..31] — triggers, hats, switches
```

- Detect HOTAS as gamepad via Browser Gamepad API
- Map axes and buttons to trading actions
- Create `TradingActionRegistry` (like OmniCore's action map)

### Phase 2: Trading Action Map
- **Throttle axis**: Scroll SEES stack (0% = top, 100% = bottom)
- **Stick X/Y**: Navigate chart / move crosshair
- **Rotary dials**: Adjust trade size, zoom chart
- **Buttons**: Buy, sell, close position, next symbol
- **Hats**: Switch panels, toggle timeframes

### Phase 3: UI Integration
- Show HOTAS connection status in header
- Visual button mapping overlay
- Configurable bindings per user preference
- Persist mappings to UserPreferences
