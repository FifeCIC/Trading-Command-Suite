# Trading Command Suite

![Status](https://img.shields.io/badge/status-starter-blue)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)

**A production-ready React PWA command surface for Trader.CORE workflows.** Lean, opinionated, and architecture-first for rapid implementation.

Built by [FifeCIC](https://fifecic.scot) | [Ryan Bayne](https://github.com/RyanBayne)

---

## What's Included

- **React 18** + Vite for fast development and optimised builds
- **TanStack Query** for server state management
- **Zustand** for client state
- **Zod** for runtime validation
- **PWA plugin** for installability and offline support
- **Feature flags** for progressive rollout
- **API URL helper** for environment-aware endpoints
- **Dev Runtime overlay** with element tags for debugging
- **Privacy-safe analytics foundation**
- **Bundle budget checker** to prevent bloat

## Used By

- **[OmniCore](https://github.com/LOLinDark/StarCitizen-OmniCore)** — Star Citizen companion PWA
- **[StreamerOps](https://github.com/LOLinDark/StreamerOps)** — Browser-based OBS overlay control

## Quick Start

```bash
git clone <repo-url> trading-command-suite
cd trading-command-suite
npm install
npm run dev
```

## Available Scripts

- `npm run dev` — Start Vite dev server
- `npm run build` — Production build
- `npm run build:guard` — Build + bundle budget check
- `npm run preview` — Preview production build
- `npm run lint` — ESLint
- `npm run check:bundle` — Check bundle budget constraints

## Handoff And Ops

- AmazonQ handoff guide: [docs/AMAZONQ-HANDOFF.md](docs/AMAZONQ-HANDOFF.md)
- Optional local infra helper (placeholder scaffold): [scripts/setup-local-infra.ps1](scripts/setup-local-infra.ps1)

## Why Not Create React App / Next.js?

Trading Command Suite is for projects that need:
- PWA-first architecture without SSR overhead
- Full control over the build pipeline
- Minimal abstraction layers
- A known-good starting point that's already proven in production

## Support This Work

- **Buy Me a Coffee**: [buymeacoffee.com/ryanbayne](https://www.buymeacoffee.com/ryanbayne)
- **Sponsorship**: contact tradingcs@fifecic.scot

## Licence

GPL-3.0 — see [LICENSE](LICENSE) for details.
