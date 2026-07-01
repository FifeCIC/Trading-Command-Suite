# GitHub Issue: Keyboard Speed Trading

## Why
Speed trading on 1m-5m charts requires split-second decisions. Mouse clicks are too slow. Keyboard shortcuts make the difference between catching a move and watching it pass.

## Shortcut Map

### Execution Keys (one-hand, left side)
| Key | Action | Rationale |
|---|---|---|
| `B` | BUY market (default size) | Index finger, natural position |
| `S` | SELL market (default size) | Next to B, easy |
| `Shift+B` | BUY 2x size | Aggressive entry |
| `Shift+S` | SELL 2x size | Aggressive entry |
| `C` | Close ALL positions | Panic button — easy reach |
| `Shift+C` | Close half of each position | Scale out |
| `X` | Close worst performer | Pain reduction |
| `Z` | Reverse position (close + opposite) | Quick flip |

### Risk Keys
| Key | Action |
|---|---|
| `[` | Reduce position size preset |
| `]` | Increase position size preset |
| `1`-`5` | Instant size preset ($50, $100, $250, $500, $1000) |
| `T` | Toggle take-profit on/off |
| `Y` | Cycle TP distance (10/20/50/100 pips) |
| `L` | Toggle stop-loss |

### Navigation Keys
| Key | Action |
|---|---|
| `Tab` | Cycle active symbol |
| `` ` `` | Cycle timeframe |
| `←` `→` | Scroll chart left/right |
| `↑` `↓` | Zoom chart in/out |
| `Space` | Pause/resume data stream |

### Safety Keys
| Key | Action |
|---|---|
| `Esc` | Lock out trading (30s timeout) |
| `P` | Pause all trading (manual override) |
| `F1` | Show/hide shortcut overlay |

## Requirements
1. Global keyboard listener on speed trading page
2. Keyboard shortcut overlay (F1 to toggle)
3. Customizable shortcuts (settings page)
4. Visual feedback on keypress (brief flash on button)
5. Audio confirmation (configurable on/off)
6. Conflict with browser shortcuts handled (preventDefault)
7. Only active when speed trading page is focused

Labels: trading, UX, speed-trading, P0
