# Handoff — 2026-07-16 Session 2 (Per-Broker P&L Dashboard)

## Completed: Per-Broker P&L on Dashboard

### What was done
Replaced the small inline P&L-by-broker section inside the Portfolio Summary card with a **dedicated "💼 P&L by Broker" card** showing three brokers + total:

| Broker | Icon | Badge | Metrics |
|--------|------|-------|---------|
| **MT5** | 📡 | DEMO/OFFLINE | Balance, Equity, Positions, P&L, W/L ratio |
| **Trading 212** | 🏦 | GIA | Balance, Equity, Positions, P&L, W/L ratio |
| **Stocks ISA** | 🏛️ | ISA | Value (£), Positions, P&L |
| **All Brokers** | — | — | **Grand Total P&L** (sum of all three) |

### Design details
- Each broker is a row with icon + name + colored mode badge
- Metrics aligned right: Balance, Equity, Positions, P&L (colored green/red), Win/Loss ratio
- Total row has a blue tint background and larger font
- Always visible — shows $0.00 / "—" instead of hiding when no data
- Responsive: stacks vertically on mobile
- ISA value shown in £ (GBP) as it's a UK tax-wrapper

### Files Changed
```
src/pages/DashboardPage.jsx      — ISA query, redesigned P&L card (3 brokers + total)
src/pages/HomeDashboard.css      — New .dash-broker-* CSS classes
```

### Data Sources
- **MT5**: `GET /api/providers/mt5/diagnostics` + `GET /api/providers/mt5/positions`
- **T212**: `GET /api/portfolio?source=trading212`
- **ISA**: `GET /api/isa/dashboard` (new query added)

### Build Status
- Vite: ✅ 93 entries, 6142 KiB
- NestJS: ✅ API healthy, DB connected
- MT5 Bridge: ✅ 3 positions, -$1.55 P&L
