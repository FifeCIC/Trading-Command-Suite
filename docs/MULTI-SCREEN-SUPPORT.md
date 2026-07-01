# GitHub Issue: Multi-Screen & Cross-Display Support

## Why
Traders often use 2-3 monitors. The ability to send specific content (charts, SEES stack, portfolio, speed trading) to specific screens is a power-user feature that no retail trading platform offers well.

## Vision
- App is aware of all connected displays
- Right-click or long-press any page/widget → "Open on Screen 2" option
- Different screens can run different views simultaneously from the same app instance
- Hotkey to move focus between screens
- Window manager that remembers "Screen 2 always shows charts, Screen 3 always shows portfolio"

## Technical Approach

### Browser API: `window.getScreenDetails()` + `Window.open()`
- Modern browsers support `getScreenDetails()` (Chrome 100+) for multi-screen awareness
- `Window.open(url, '_blank', 'left=1920,top=0,width=1920,height=1080')` opens on specific screen
- Each popup window communicates with main window via `BroadcastChannel` or `window.opener`

### Implementation Phases

#### Phase 1: Screen Detection
- Detect available screens (count, resolution, position)
- Display screen info in settings: "Screen 1: 1920×1080 | Screen 2: 2560×1440"
- `navigator.permissions.query({ name: 'window-management' })` for multi-screen permission

#### Phase 2: Open on Screen
- Context menu on sidebar nav items: "Open on Screen 2"
- Context menu on widgets/dashboard cards: "Open on Screen 3"
- Hotkey: Ctrl+1/2/3 to move current view to screen 1/2/3
- Each opened window is a lightweight instance sharing auth/state

#### Phase 3: Screen Profiles
- Save layout: "Trading Profile" — Screen 1: Navigation, Screen 2: Charts, Screen 3: SEES + Portfolio
- One-click "Load Trading Profile" opens all windows
- Profiles stored in localStorage with export/import
- Auto-restore on app launch (configurable)

#### Phase 4: Cross-OS Streaming (future)
- WebSocket-based content streaming to other devices
- Tablet/phone as secondary display for alerts/notifications
- Raspberry Pi as dedicated chart display
- This is where "send to screen" becomes platform-agnostic

## Windows-Only First
Initial implementation targets Windows (user's primary OS). Browser-based approach works cross-platform by default, but testing priority is Windows + Chrome.

## Open Questions
- Should each screen run a full app instance or a lightweight viewer?
  → Lightweight viewer for Phase 2. Full instance for Phase 3+.
- How to handle auth across windows?
  → Shared localStorage via BroadcastChannel. Main window is auth source.
- Does this work with the HOTAS integration (Q242)?
  → Yes — HOTAS focus follows active window. Mode switch navigates between screens.

Labels: frontend, ux, multi-screen, P2
