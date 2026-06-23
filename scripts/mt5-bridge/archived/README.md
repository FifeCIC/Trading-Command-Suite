# MT5 Bridge v1 — Archived 2026-06-23

## Why archived

v1 used Flask (WSGI), which spawns worker threads. The MetaTrader5 Python
package is **not thread-safe**, causing intermittent IPC failures under
concurrent requests.

v2 (`mt5_bridge_v2.py`, one directory up) replaced it with Python's
single-threaded `http.server`, maintaining a persistent MT5 connection.

## Files

- `mt5_bridge.py` — Flask bridge, port 5000 (Q139, 2026-06-12)
- `mt5_bridge.py.bak` — backup copy

## Timeline

| Q# | Date | What |
|----|------|------|
| Q139 | 2026-06-12 | Initial Flask bridge |
| Q155 | 2026-06-12 | Order/trading endpoints |
| Q237 | 2026-06-16 | v2 bridge replaces v1 |

All NestJS services point at v2 (port 5001).
