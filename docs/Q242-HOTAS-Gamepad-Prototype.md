Task ID: Q242
Goal: HOTAS / Gamepad Integration Prototype — detect, map, and use HOTAS for trading

See: discussions/HOTAS-TRADING-INTERFACE.md

Context: OmniCore (C:\wamp64\www\OmniCore) already has HOTAS mapping patterns (action registry, integrity checking, XML rebinding). This task applies the same pattern using Browser Gamepad API for Trading Command Suite.

What to build (Phase 1 — Detection & Mapping Prototype):

1. Gamepad Detection Hook (src/hooks/useGamepadControls.js)
   - Listen for gamepadconnected/gamepaddisconnected events
   - Poll gamepad state at 60fps using requestAnimationFrame
   - Detect axes: throttle, stick X/Y, rotary dials
   - Detect buttons: triggers, hats, thumb buttons
   - Expose: { connected, deviceName, axes, buttons, mapping }
   - Handle multiple devices (throttle + stick may be separate)

2. Trading Action Registry (src/hotas/TradingActionRegistry.js)
   - Pattern borrowed from OmniCore's action map
   - Define all mappable trading actions:
     ```javascript
     export const TRADING_ACTIONS = {
       BUY_MARKET: { id: 'buy-market', label: 'Buy Market', category: 'execution', defaultKey: 'Trigger1' },
       SELL_MARKET: { id: 'sell-market', label: 'Sell Market', category: 'execution', defaultKey: 'Trigger2' },
       CLOSE_ALL: { id: 'close-all', label: 'Close All', category: 'execution', defaultKey: 'Btn3' },
       REVERSE: { id: 'reverse', label: 'Reverse Position', category: 'execution', defaultKey: 'Btn4' },
       SCROLL_SEES: { id: 'scroll-sees', label: 'Scroll SEES Stack', category: 'nav', defaultAxis: 'Throttle' },
       ZOOM_CHART: { id: 'zoom-chart', label: 'Zoom Chart', category: 'nav', defaultAxis: 'StickY' },
       PAN_CHART: { id: 'pan-chart', label: 'Pan Chart', category: 'nav', defaultAxis: 'Hat1' },
       ADJUST_SIZE: { id: 'adjust-size', label: 'Adjust Trade Size', category: 'risk', defaultAxis: 'Rotary1' },
       ADJUST_SL: { id: 'adjust-sl', label: 'Adjust Stop Loss', category: 'risk', defaultAxis: 'Rotary2' },
       CYCLE_TF: { id: 'cycle-tf', label: 'Cycle Timeframe', category: 'nav', defaultKey: 'Hat2Up' },
       CYCLE_SYMBOL: { id: 'cycle-symbol', label: 'Cycle Symbol', category: 'nav', defaultKey: 'Hat2Down' },
       LOCK_OUT: { id: 'lock-out', label: 'Emergency Lock', category: 'safety', defaultKey: 'Btn5' },
       TOGGLE_MODE: { id: 'toggle-mode', label: 'Toggle HOTAS Mode', category: 'system', defaultKey: 'Btn6' },
     };
     ```

3. HOTAS Debug Page (src/pages/HotasDebugPage.jsx)
   - Route: /settings/hotas
   - Device info panel: name, ID, axes count, button count
   - Live axis visualization: bar graphs for each axis
   - Live button grid: 32 buttons, green when pressed
   - Action mapping table: Trading Action → Current Assignment → Status
   - "Calibrate" button for axes (set deadzone, range)
   - "Test mapping" mode: press button → shows which action fires
   - No actual trading execution — pure debug/testing

4. HOTAS Mode Toggle
   - Button/key to toggle between "Navigate" mode and "Trade" mode
   - Navigate mode: HOTAS controls scrolling/navigation only
   - Trade mode: HOTAS can execute trades (with safety interlocks)
   - Visual indicator in header: "🕹️ HOTAS: Navigate" / "🕹️ HOTAS: Trade"
   - Mode change confirmation required for Trade mode

5. Mapping Config Storage
   - HOTAS mapping stored in localStorage
   - Export/import mapping profiles
   - Per-device mapping (different HOTAS = different layouts)
   - Calibration data per device

6. Shared Pattern Extraction (future)
   - Note: OmniCore's action registry pattern can be extracted into a shared package
   - `@fife/hotas-core` — device detection, action registry, mapping validation
   - Both OmniCore and Trading Command Suite would use it
   - This is Phase 2+ — not part of Q242

Validation:
- Connect HOTAS → debug page shows axes/buttons in real-time
- Press trigger → button lights up on debug page
- Move throttle → axis bar animates
- Mapping table shows correct assignments
- npm --prefix c:/wamp64/www/trading-command-suite run build

Priority: P1 — prototype, validates concept before buildout
Estimated: 3h
