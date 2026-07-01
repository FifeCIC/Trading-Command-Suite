# Discussion: HOTAS Trading Interface

## Status: EXPLORATION — design phase

## The Vision
Use flight HOTAS (Hands On Throttle And Stick) hardware as a trading interface. Throttle scrolls through data. Hats navigate UI. Rotary dials adjust trade size. Buttons execute trades. The result: a physical, intuitive interface that no trading platform has ever offered.

## What OmniCore Already Has
Located at `C:\wamp64\www\OmniCore`:
- **XML Rebind Engine** (`server/peripherals/hotas/xmlRebind.js`): Modifies Star Citizen XML keybinding files — maps game actions to physical controls
- **Mapping Integrity Checker** (`scripts/check-hotas-mapping-integrity.mjs`): Validates all mapped features have targets
- **Action Map** (`app/utils/starCitizenActionMap.js`): Registry of all mappable features → feature IDs
- **Keybinding Data** (`app/data/starcitizen-keybindings.js`): Canonical list of game keybindings

These are Star Citizen-specific but the **pattern** is what matters.

## Architecture Pattern We Can Reuse

```
OmniCore:                Trading Command Suite:
Physical HOTAS           Physical HOTAS
     │                        │
     ▼                        ▼
Star Citizen XML         Browser Gamepad API
     │                        │
     ▼                        ▼
Action Map Registry      Trading Action Registry
(feature ID → control)   (trading action → control)
     │                        │
     ▼                        ▼
XML rebind injection     Event dispatch to UI
```

The registry pattern, integrity checking, and mapping validation are directly transferable.

## Browser Gamepad API
Modern browsers support the Gamepad API:
```javascript
window.addEventListener('gamepadconnected', (e) => {
  console.log('HOTAS connected:', e.gamepad.id);
});

// Poll axes and buttons each frame
const gamepad = navigator.getGamepads()[0];
// gamepad.axes[0..5] — throttle, stick X/Y, rotary, etc.
// gamepad.buttons[0..31] — triggers, hats, buttons
```

HOTAS devices appear as standard gamepads. A HOTAS like the Thrustmaster Warthog or VKB Gladiator will expose:
- 6-8 axes (throttle, stick X/Y, rotary dials, slider)
- 20-32 buttons (triggers, hats, switches)
- Hats appear as digital buttons (4-way or 8-way)

## Proposed Trading Action Map

### Throttle Axis
- **Forward/back**: Scroll through SEES stack symbols
- **At 0%**: Lock to highest scoring symbol
- **At 100%**: Scroll to bottom
- **Center detent**: Pause scroll, focus current

### Stick Axes
- **X-axis (left/right)**: Move between dashboard widgets
- **Y-axis (forward/back)**: Zoom chart in/out
- **Twist (if available)**: Adjust timeframe

### Rotary Dials
- **Rotary 1**: Increase/decrease trade size
- **Rotary 2**: Adjust stop-loss distance
- **Rotary 3**: Adjust take-profit distance

### Hat Switches (8-way)
- **Hat 1 (POV)**: Navigate chart — pan left/right/up/down
- **Hat 2**: Navigate between pages/areas
- **Hat 3**: Cycle through strategy timeframes
- **Hat 4**: Scroll through open positions

### Buttons (triggers, thumb buttons)
- **Trigger 1 (primary)**: BUY market
- **Trigger 2 (secondary)**: SELL market
- **Thumb button 1**: Close position
- **Thumb button 2**: Reverse position
- **Pinky button**: Lock-out (safety)
- **Pinky shift**: Modifier for secondary actions

## Implementation Phases

### Phase 1: Gamepad API Prototype (Q242)
- Detect HOTAS via Gamepad API
- Display connected device info
- Map axes/buttons to debug display
- Test with actual HOTAS hardware
- No trading execution — read-only mapping test

### Phase 2: Action Registry
- Define `TradingAction` interface
- Build mapping registry (similar to OmniCore's pattern)
- Configurable per device (different HOTAS have different layouts)
- Calibration page at `/settings/hotas`

### Phase 3: Trading Execution
- Wire actions to actual trade execution
- Visual feedback on screen when HOTAS action fires
- Safety interlocks (two-button confirm for trades)
- Mode switching (navigate vs trade mode)

## Open Questions
1. Should HOTAS control be a separate "mode" from mouse/keyboard, or always active?
   → Separate mode. Toggle on/off. Prevents accidental trades.
2. Which HOTAS devices to support? 
   → Any HID-compliant device. Test with what you own first.
3. Should the OmniCore HOTAS code be shared as a library?
   → Yes — extract the registry pattern into a shared `@fife/hotas-core` package.
4. Can we use the browser Gamepad API for all devices or need native WebHID?
   → Gamepad API covers most HOTAS. WebHID for exotic devices with custom protocols.

## Related
- OmniCore: HOTAS XML rebinding (`server/peripherals/hotas/`)
- GitHub: KEYBOARD-SPEED-TRADING.md
- GitHub: SPEED-TRADING-SAFETY.md
