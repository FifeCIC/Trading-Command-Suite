# Trading Command Suite Documentation

This folder contains technical documentation for the Trading Command Suite application.

## About Trading Command Suite

Trading Command Suite is a standalone React application for advanced trading analysis, featuring the SEES (Scoring Engine Execution System) and MT5 integration. It was separated from the TradePress WordPress plugin to focus on sophisticated trading operations without WordPress dependencies.

## Documentation Structure

| Folder | Purpose |
|---|---|
| `systems/` | SEES scoring system, directive architecture, strategy framework |
| `diagrams/` | Data flow, strategy decision trees, testing procedures |
| `data/` | Data architecture, freshness management, analysis workflows |
| `indicators/` | Technical indicator documentation and usage guides |

## Key Documents

### Scoring & Strategy
- `systems/SCORING-SYSTEM.md` - SEES scoring architecture and directive contracts
- `systems/DIRECTIVE-TESTING-STRATEGY.md` - Testing strategy for scoring directives
- `systems/TRADING-STRATEGY-ARCHITECTURE.md` - Trading strategy framework
- `systems/TRADING-STRATEGY-TRAINING-SCENARIOS.md` - Strategy training and optimization

### Directives
- `systems/VIX-REGIME-DIRECTIVE.md` - Volatility regime analysis
- `systems/CAD-USD-OIL-CORRELATION-DIRECTIVE.md` - CAD/USD/Oil correlation analysis
- `systems/CRYPTO-SPECIFIC-DIRECTIVES.md` - Cryptocurrency-specific scoring
- `systems/GOLD-MACRO-CORRELATION-DIRECTIVE.md` - Gold macro correlation analysis
- `systems/SPY-QQQ-INDEX-TIMING-DIRECTIVES.md` - Index timing directives
- `systems/SYMBOL-SPECIFIC-EQUITY-DIRECTIVES.md` - Symbol-specific equity analysis

### Data & Architecture
- `data/DATA-ARCHITECTURE.md` - Core data architecture patterns
- `data/DATA-FRESHNESS-FRAMEWORK.md` - Data freshness and staleness management
- `data/trading-analysis-data-flow-contract.md` - Trading analysis data flow contracts

### Diagrams
- `diagrams/api-data-standardization-flow.md` - API data normalization flow
- `diagrams/directive-testing-procedure.md` - Directive testing workflow
- `diagrams/trading-strategy-decision-flow.md` - Strategy decision tree

## Migration from TradePress

This application was extracted from TradePress WordPress plugin to provide:
- Advanced SEES scoring without WordPress constraints
- MT5 integration for professional trading platforms
- Real-time strategy execution and analysis
- Standalone deployment options

TradePress (WordPress) now focuses on:
- Trading platform API integration for WordPress sites
- Market data display on websites
- Portfolio tracking and management
- Informational content and manual trading support

## Technology Stack

- React 18 + Vite
- TanStack Query for server state
- Zustand for client state
- PWA capabilities
- Feature flags and runtime controls

## Related Projects

- [TradePress WordPress Plugin](https://github.com/RyanBayne/TradePress) - WordPress integration for data display
- [TradePress Documentation](https://github.com/RyanBayne/TradePress-Documentation) - Project management docs

## License

GPL-3.0 - See LICENSE file for details
