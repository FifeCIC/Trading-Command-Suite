## Summary

Support Capital.com's MT4 terminal alongside existing MT5 bridges. MT4 has **no official Python API** — the `MetaTrader5` package from MetaQuotes is MT5-only. This requires building a new MQL4 Expert Advisor that acts as a TCP socket server inside the MT4 terminal.

## Why MT4 is Different

| | MT5 | MT4 |
|---|---|---|
| Python package | `MetaTrader5` (official) | **None** |
| Terminal exe | `terminal64.exe` (64-bit) | `terminal.exe` (32-bit) |
| Install path | `Program Files` | `Program Files (x86)` |
| IPC protocol | Named pipes (MT5 package) | Must build our own |
| API access | `mt5.account_info()` etc. | Must write MQL4 EA |

Confirmed 2026-08-06: `mt5.initialize(path="...Capital.com MetaTrader 4/terminal.exe")` fails with `IPC initialize failed, Pipe server didn't answer in 60 sec`.

## Current Capital.com Account

- **Login:** 479878
- **Server:** Capital.com-Demo
- **Platform:** MT4 (32-bit, `C:\Program Files (x86)\Capital.com MetaTrader 4\terminal.exe`)
- **Status:** Installed, running, account logged in, yellow icon but balance displayed

## Proposed Architecture

### MQL4 EA Socket Bridge

A new MQL4 Expert Advisor compiled in MetaEditor that runs inside the Capital.com MT4 terminal:

```
Capital.com MT4 Terminal
  └── CapitalMT4Bridge.mq4 (EA)
        ├── TCP socket server on :5002
        ├── Same HTTP API surface as mt5_bridge_v2.py
        │   GET  /health       → { connected, account, server, balance, equity }
        │   GET  /account      → { login, balance, equity, margin, ... }
        │   GET  /positions    → { positions: [...] }
        │   GET  /candles      → { bars: [...] }
        │   GET  /quote        → { symbol, bid, ask }
        │   POST /order        → { success, ticket, price }
        │   POST /close/{tkt}  → { success }
        │   POST /switch/{n}   → switch account
        └── JSON responses — identical format to MT5 bridge
```

### Thin Python Wrapper (optional)

A minimal Python script that wraps the raw MQL4 socket into proper HTTP responses (handles HTTP parsing, JSON formatting, timeouts). The MQL4 EA handles raw TCP — the Python wrapper makes it a proper HTTP server.

Alternatively: the MQL4 EA could handle HTTP parsing directly, but this is more complex in MQL4. A Python wrapper (50-100 lines) is simpler.

### Integration — zero NestJS changes

Once the bridge responds on `:5002`, just add to `.env`:

```
MT5_ACTIVE_BROKERS=2,3,4
MT5_BROKER_URL_4=http://localhost:5002
```

The existing `Mt5ConnectionManager` multi-broker system picks it up automatically. The `/api/providers/mt5/brokers` endpoint would show all 3.

### tcs-launch.ps1

MT4 terminal won't be launched by the script — the EA must be manually attached or auto-started. The Python wrapper process is spawned like any other bridge.

## Tasks

### Task 1 — MQL4 EA Development
- [ ] Create `scripts/mt4-bridge/CapitalMT4Bridge.mq4`
- [ ] Implement TCP socket server (bind to 127.0.0.1:5002)
- [ ] Parse incoming request paths
- [ ] Route to MQL4 native functions:
  - `AccountInfoDouble()`, `AccountInfoString()` for /health, /account
  - `PositionsTotal()`, `PositionGetTicket()` etc. for /positions
  - `CopyRates()` for /candles
  - `SymbolInfoDouble()` for /quote
  - `OrderSend()` for /order
  - `trade.PositionClose()` for /close
- [ ] Format JSON responses (manual string building in MQL4)
- [ ] Compile in MetaEditor (MT4's built-in IDE)
- [ ] Test with Capital.com-Demo account

### Task 2 — Python Wrapper
- [ ] Create `scripts/mt4-bridge/mt4_bridge.py`
- [ ] Connect to MQL4 EA socket
- [ ] Add HTTP parsing layer (headers, methods, paths)
- [ ] Handle timeouts, reconnection, error responses
- [ ] Log to `bridge-mt4.log`

### Task 3 — Integration
- [ ] Add `MT5_BROKER_URL_4` and `MT5_ACTIVE_BROKERS=2,3,4` to `.env`
- [ ] Add bridge instance to `tcs-launch.ps1` (conditional — skip if MT4 terminal not running)
- [ ] Verify `/api/providers/mt5/brokers` shows Capital.com
- [ ] Verify `/api/providers/mt5/accounts` includes Capital.com account
- [ ] Test placing a demo order through the full pipeline

### Task 4 — Documentation
- [ ] `scripts/mt4-bridge/README.md` — setup instructions (compile EA, attach to chart, start Python wrapper)
- [ ] Update `DEVELOPMENT.md` — MT4 bridge section

## MQL4 Socket Programming Notes

MQL4 socket support (since build 600+):
```cpp
int socket = SocketCreate();
SocketConnect(socket, "127.0.0.1", 5002, 5000);
// Read request
char req[];
SocketRead(socket, req, sizeof(req), 5000);
// Write response
string json = "{\"connected\":true}";
char resp[];
StringToCharArray(json, resp);
SocketSend(socket, resp, StringLen(json));
SocketClose(socket);
```

Key limitations:
- No built-in JSON library — must build strings manually
- No `mt5.initialize()` equivalent — EA runs inside the terminal, always connected
- Account switching requires `AccountInfoInteger()` checks
- Candles via `CopyRates()` — similar API to MT5

## Estimated Effort

| Task | Hours |
|------|-------|
| MQL4 EA (socket + endpoints) | 4-6 |
| Python wrapper | 2-3 |
| Integration + launcher | 1-2 |
| Testing | 2-3 |
| **Total** | **~12 hours** |

## Acceptance
- [ ] Capital.com MT4 terminal shows in `/api/providers/mt5/brokers` with health
- [ ] Positions, account info, candles, quotes all return from Capital.com
- [ ] Demo order can be placed and closed through the bridge
- [ ] Bridge auto-recovers if MT4 terminal is restarted
- [ ] No changes required in NestJS backend
- [ ] Launcher starts Python wrapper alongside other bridges
