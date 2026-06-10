# Q15 — CSS Theme Consistency Audit

> Generated: 2026-06-11 | Read-only audit — no code changes

---

## Summary

| Metric | Count |
|---|---|
| CSS files | 15 |
| Total `var()` references | 364 |
| Unique chip class patterns | 6 families |
| Mode badge patterns | 2 families |

---

## Chip Class Family Fragmentation

| Family | Defined In | Used By |
|---|---|---|
| `.chip` + `.chip--ok/warn/neutral/info/error` | `sees-live-stack.css:202-215` | SeesScoringPanel, SeesLiveStackMockPage |
| `.tp-chip` + `.tp-chip--ok/warn/neutral` | `trading-platforms.css` | ApiEndpointsPage, ActiveSymbolsPage, PlatformComparisonsPage, TradingPlatformsPage |
| `.sb-chip` + `.sb-chip--neutral` | `symbols-browser.css` | SymbolsBrowserPage |
| `.db-chip` + `.db-chip--neutral` | `database-tables.css` | DatabaseTablesPage |
| `.skeleton-chip` | `feature-skeleton.css` | FeatureSkeletonPage, PluginTabSkeletonPage |
| `.so-*` (custom) | `scoring-overview.css` | ScoringOverviewPage |

**Risk:** SeesScoringPanel uses `.chip chip--warn` without importing `sees-live-stack.css`. It only works when rendered inside SeesLiveStackMockPage (which does import the CSS). If rendered standalone (e.g., future `/sees` route), the chip styling is missing.

---

## Mode Badge Patterns

| Pattern | Defined In | Used By |
|---|---|---|
| `.mode-badge` + `.mode-fallback/full/local/unknown` | `trading-platforms.css` + `sees-live-stack.css` | SeesScoringPanel, SeesLiveStackMockPage, SystemStatusPage |
| `.architecture-mode-badge` | `architecture-framework.css` | ArchitectureFrameworkPage (custom variant) |

**Finding:** `ArchitectureFrameworkPage` uses a custom `.architecture-mode-badge` class instead of the shared `.mode-badge`. Consistent visually but not CSS-reusable.

---

## CSS Variable Usage

| File | `var()` refs | Notes |
|---|---|---|
| `index.css` | 73 | Global tokens — heavily uses `--color-*`, `--space-*` |
| `trading-platforms.css` | 62 | Good use of `--color-surface`, `--color-text` |
| `directives-status.css` | 45 | Moderate |
| `directives-manager.css` | 37 | Moderate |
| `scoring-overview.css` | 36 | Good |
| `theme-page.css` | 29 | Moderate |
| `symbols-browser.css` | 23 | Moderate |
| `system-status.css` | 22 | Moderate |
| `feature-skeleton.css` | 21 | Moderate |
| `database-tables.css` | 16 | Low |
| `App.css` | 0 | ❌ No CSS variables |
| `architecture-framework.css` | 0 | ❌ No CSS variables — hardcoded colors |
| `sees-live-stack.css` | 0 | ❌ No CSS variables — hardcoded colors |
| `settings.css` | 0 | ❌ No CSS variables |
| `setup-wizard.css` | 0 | ❌ No CSS variables |

**Finding:** 5 of 15 CSS files use zero CSS variables — all colors are hardcoded. These would not respond to theme switching.

---

## Card Border Consistency

All major page cards use the pattern:
- `tp-card` (trading-platforms.css) — ApiEndpointsPage, ActiveSymbolsPage, PlatformComparisonsPage
- `.sees-summary-card` (sees-live-stack.css) — SeesLiveStackMockPage
- `.stack-card` (sees-live-stack.css) — SeesLiveStackMockPage
- Custom cards in architecture-framework.css, database-tables.css, symbols-browser.css

**Finding:** Three distinct card-border patterns (tp-card rounded with subtle border, sees-card with shadow, architecture-card with heavy border). Not blocking but visually inconsistent.

---

## Recommendations (Not Applied — Read-Only)

| # | Issue | Suggested Fix |
|---|---|---|
| 1 | SeesScoringPanel uses `.chip` without importing CSS | Add `import './sees-live-stack.css'` or move chip CSS to `index.css` |
| 2 | 5 CSS files use zero `var()` | Migrate hardcoded colors to `var(--color-*)` tokens from `index.css` |
| 3 | ArchitectureFrameworkPage uses custom mode badge | Replace `.architecture-mode-badge` with shared `.mode-badge` |
| 4 | Multiple chip families (tp-chip, sb-chip, db-chip, chip) | Consolidate to single `.tcs-chip` family in `index.css` |
| 5 | Card border inconsistency | Standardize on `tp-card` pattern across all pages |

**Priority:** #1 is the only one that could cause a visual bug (SeesScoringPanel chips unstyled when rendered outside SeesLiveStackMockPage). #2-#5 are design polish.
