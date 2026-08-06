## Problem

The MT5 bridge is single-instance, single-port (5000). It connects to **one** MT5 terminal at a time via `mt5.initialize()`. The Python package's `mt5.initialize()` picks whichever terminal responds first — there's no reliable multi-terminal targeting.

This blocks multi-broker trading. We have 3 MT5 accounts across 3 separate desktop apps:
- **MetaQuotes-Demo** (default app, `C:\Program Files\MetaTrader 5`)
- **PepperstoneUK-Demo** (Pepperstone branded app, `C:\Program Files\Pepperstone MetaTrader 5`)
- **ICMarketsSC-Demo** (ICMarkets branded app, not yet installed)

Each runs as a separate Windows process with its own IPC pipe. One bridge = one terminal = one broker at a time.

## Current state audit

| Component | Current | Limitation |
|---|---|---|
| Bridge | Single process on :5000 | One terminal, one broker |
| Path support | Added to .env (`MT5_PATH_x`) but unreliable | `mt5.initialize(path=exe)` fails when terminal already running |
| .env | `MT5_ACTIVE_ACCOUNT` picks one of N | Only one can be active; no simultaneous multi-broker |
| NestJS backend | Single `mt5` broker in brokerStates | All strategies hardcode `brokerId: "mt5"` |
| UI | Single MT5 status card (AutomationDashboard) | No per-broker view |
| Strategies | All reference `brokerId: "mt5"` | Can't route to specific broker |

## Proposed architecture

### Design principle: single script, parameterized instances

The bridge script (`mt5_bridge_v2.py`) stays as **one file** — no code duplication. Each instance is the same Python process, launched with different env/config:

```
Bridge :5000 → MetaQuotes-Demo (forex majors)
Bridge :5001 → Pepperstone CFD (indices, commodities, crypto)
Bridge :5002 → ICMarkets forex (tighter spreads)
Bridge :5003 → ICMarkets live (future)
Bridge :5004 → Pepperstone live (future)
```

### Broker naming convention (supports N, not just 3)

Human-readable broker IDs reflecting the use case:
- `metaquotes-demo` — demo forex (current default)
- `pepperstone-cfd` — demo CFD for aggressive day trading
- `icmarkets-forex` — demo forex, tighter spreads
- `pepperstone-live` — live stocks (future)
- `icmarkets-live` — live forex (future)

The ID format is `{broker}-{purpose}`. Scales to any number.

### System resource scaling

| Instances | MT5 terminals | Bridge processes | ~RAM | Notes |
|---|---|---|---|---|
| 1 | 1 | 1 | ~200MB | Current |
| 3 | 3 | 3 | ~600MB | Comfortable target |
| 5 | 5 | 5 | ~1GB | Fine on 16GB+ |
| 10+ | 10+ | 10+ | ~2GB | Taxing; launcher should warn |

### Layer 1 — .env broker slots

Named slots (not numbered 1-99):
```
MT5_ACTIVE_BROKERS=metaquotes-demo,pepperstone-cfd

# metaquotes-demo — default terminal, no PATH needed
MT5_BROKER_metaquotes-demo_PORT=5000
MT5_BROKER_metaquotes-demo_ACCOUNT=10011309743
MT5_BROKER_metaquotes-demo_PASSWORD=...
MT5_BROKER_metaquotes-demo_SERVER=MetaQuotes-Demo

# pepperstone-cfd — separate MT5 app, needs PATH
MT5_BROKER_pepperstone-cfd_PORT=5001
MT5_BROKER_pepperstone-cfd_ACCOUNT=62135531
MT5_BROKER_pepperstone-cfd_PASSWORD=...
MT5_BROKER_pepperstone-cfd_SERVER=PepperstoneUK-Demo
MT5_BROKER_pepperstone-cfd_PATH=C:\Program Files\Pepperstone MetaTrader 5\terminal64.exe
```

### Layer 2 — NestJS multi-broker routing

- `Mt5ConnectionManager` becomes broker-aware: one HTTP client per broker port
- `brokerId` concept splits: `"mt5"` → `"mt5-metaquotes-demo"`, `"mt5-pepperstone-cfd"`
- Existing strategies with `brokerId: "mt5"` default-route to the first active broker (backward compatible)
- `brokerId` concept splits: `"mt5"` → `"mt5-metaquotes"`, `"mt5-pepperstone"`, `"mt5-icmarkets"`
- Existing strategies need `brokerId` migration (or a default mapping)
- New strategies can target specific brokers

### Layer 4 — UI changes

- **AutomationDashboard**: per-broker status cards (not single MT5)
- **AccountsDashboard**: show all 3 MT5 accounts with individual balances
- **Strategy forms**: broker selector becomes "MT5 - MetaQuotes" / "MT5 - Pepperstone" / etc.
- **Market Tape**: broker health could show per-instance

### Layer 5 — Strategy migration

All existing 20 strategies use `brokerId: "mt5"`. Migration path:
- Short term: default route `"mt5"` → MetaQuotes-Demo bridge (backward compatible)
- Medium term: add migration to rename `brokerId` per-strategy
- Long term: new strategies select specific broker

## Tasks

### Phase 1 — Bridge parameterized multi-instance (single script, no duplication)
- [ ] Update `mt5_bridge_v2.py` to accept `--port` and `--broker-id` CLI args (or env vars `MT5_BROKER_ID`, `MT5_BRIDGE_PORT`)
- [ ] Fix `path` parameter for `mt5.initialize()` — need to handle already-running terminals gracefully (probe without path first, fall back to path-based launch)
- [ ] Add bridge log prefix with broker ID: `[metaquotes-demo]` vs `[pepperstone-cfd]`
- [ ] Update `tcs-launch.ps1` to launch N bridge instances from `MT5_ACTIVE_BROKERS` list
- [ ] Add resource warning if N > 5 (MT5 terminals are RAM-heavy)
- [ ] Test 2+ bridges running simultaneously with their respective terminals

### Phase 2 — NestJS multi-broker
- [ ] Refactor `Mt5ConnectionManager` to maintain per-broker HTTP clients keyed by broker ID
- [ ] Add `GET /api/providers/mt5/brokers` — list all active MT5 broker instances with health
- [ ] Update automation loop to route orders to the correct broker based on strategy's `brokerId`
- [ ] Migration: `brokerId: "mt5"` → default-routes to first active broker (no existing strategy changes needed)
- [ ] New strategies can target a specific broker: `brokerId: "mt5-pepperstone-cfd"`

### Phase 3 — UI
- [ ] Replace single MT5 status card with per-broker status cards on AutomationDashboard
- [ ] Per-broker account cards on AccountsDashboard (balance, equity, positions per instance)
- [ ] Broker selector dropdown on strategy create/edit forms (populated from active brokers)
- [ ] Market Tape broker health shows per-instance dots (one per active broker)

## ICMarkets note

ICMarketsSC-Demo likely needs its own MT5 app (like Pepperstone). Download from IC Markets client area. Same pattern: separate install path, `mt5.initialize(path=C:\Program Files\ICMarkets MetaTrader 5\terminal64.exe)`.

## Use cases this enables

| Broker instance | Purpose | Pairs/assets |
|---|---|---|
| `metaquotes-demo` | Conservative forex | 20 current FX pairs |
| `pepperstone-cfd` | Aggressive day trading | Indices (US500, GER40), commodities, crypto CFDs |
| `pepperstone-live` | Live stock portfolio | Real equity positions |
| `icmarkets-forex` | Tight-spread forex scalping | EURUSD, GBPUSD at raw spreads |
| `icmarkets-live` | Live forex income | Real FX account |

## Acceptance

- [ ] Single `mt5_bridge_v2.py` script powers all instances (no code duplication)
- [ ] N bridge instances running on sequential ports (5000, 5001, ...5000+N)
- [ ] NestJS can query positions, place orders, get quotes from all active brokers
- [ ] UI shows per-broker status with individual balances
- [ ] Existing 20 strategies continue working on MetaQuotes-Demo via default routing
- [ ] New strategies can target specific broker instances
- [ ] `MT5_ACTIVE_BROKERS` controls which instances launch; adding a broker is just .env + terminal install
