# Changelog

**Status:** active
**Category:** F (build / setup — repo root, ships publicly)
**Created:** 2026-11-01
**Last updated:** 2026-11-01
**Owner:** TCS team

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versions match `nest/package.json`
(which is the runtime source of truth — the API reports it at `GET /api/version`).

## ⚠️ How this file is maintained, and why it restarts here

**This file starts at 0.147.0 and does not claim to be complete before it.**

The previous changelog under-reported the project: versions **0.7.0 → 0.15.0** shipped with no entry
at all, and the file said so itself. A changelog that is silently incomplete is worse than none,
because a reader assumes it is complete — so the old file was **archived, not deleted** (in the
documentation store, `archive/moved-from-app-docs-2026-11-01/CHANGELOG-superseded-2026-11-01.md`).

For anything before 0.147.0 the durable record is **`git log` plus the closed GitHub issues**, which
is where the reasoning was recorded at the time.

**Entries are written per batched landing, not per commit.** A changelog entry is a claim that
something changed in a way a user could notice; a refactor nobody can observe does not get a line.

### Backfilled 2026-11-17

Versions **0.149.0 → 0.164.0** were reconstructed from `git log`, because the file had been left at
0.147.0 while sixteen versions shipped. Each line derives from the commit subject for that version
range; internal-only commits (refactors, moves, test and documentation plumbing) were **omitted
rather than dressed up as changes a user would notice**. Where a commit subject was too vague to
support a specific claim, the entry says only what the commit actually asserted.

⚠️ **This is a reconstruction, not a release log.** It is honest about its source and it is not
guaranteed to name every change in those versions. Entries from 0.164.0 onward are written at the
time, as the rule above requires.

---

## [Unreleased]

### Security

- **Removed the development database password that was still written into `nest/README.md`.**
  #1252 cleared credentials from tracked files on 2026-11-08, but the setup documentation kept the
  value in a `mysql://user:password@` URL and an `IDENTIFIED BY '<password>'` clause — the two lines a
  new contributor copies. Both are now placeholders. No value is reproduced here (#1252).

## [0.164.0] — 2026-11-16

### Added

- **Top Movers** — a new strategy built on mover datasets, with its directive versions recorded.
- **Market-wide movers feed** — `GET /api/market-data/market-movers`, with its filter thresholds as
  settings. The only provider on this machine serves movers end-of-day, so it builds an overnight
  watchlist and is not an intraday discovery source (#1283).
- **`momentum-candidate` protocol** (9 directives) and its bot, created through the API (#1285).
- **`scripts/audit-webroot-exposure.cjs`** — asks the local web server whether any project folder
  serves `.git/config`, `.git/HEAD`, `.env` or `.htaccess`, and fails when one does. Written after
  `.git` was found readable in 18 of 31 local projects.

### Fixed

- **Backtests honour each bot's `maxHoldHours`.** It was set on 42 of 64 active bots and read by
  nothing, so runs held trades to the stop, the target or the end of the data — measured longest hold
  67 hours on a 5m chart. A new `TIME` exit reason marks the close (#1136).
- **Historical market data captures again.** The Yahoo adapter sent no `User-Agent` and was answered
  with 429; with the header it returns 200, so backtest datasets can be captured for any symbol
  (#1287).
- **The public website is dark on every page.** The showcase and the 404 page were still light — the
  showcase used the app's light palette and the 404 followed the operating system's preference, so the
  site changed identity at a link click.

## [0.163.0] — 2026-11-15

### Added

- **Supporter Programme** — controller, service and prompt components.

### Changed

- CSS refactor across several pages for layout and readability.
- Pipeline map documentation updated (source file and declaration counts).
- Unused scripts and tests removed.

## [0.162.0] — 2026-11-15

### Added

- Validation scripts for directive versions and threshold ranges.

### Changed

- Backtest page score-detail wording clarified.

### Removed

- Obsolete end-to-end test files and configuration.
- The generated strategy seed data file.

## [0.160.1] — 2026-11-13

### Added

- Script to generate strategy seed data from the live bot fleet.
- Broker directory and accounts folded into one expandable table.

### Fixed

- **Database backups are restorable** — archives are verified, temporary files cleaned up, and a
  stale backup is surfaced rather than silently offered.

## [0.160.0] — 2026-11-13

### Added

- **Per-trade money-at-risk ceiling** as a configurable bot rule (#1257).

### Changed

- **The Discord feed uses one layout** for signals, wins and losses, with both protocol and bot on
  every message and one fact per line.

## [0.159.0] — 2026-11-12

### Changed

- Trading 212 integration handles orders per account.

## [0.158.0] — 2026-11-10

### Added

- **In-app bug report** — captures console errors, failed requests and system state, shows the report
  before anything is copied, and includes response data only when the user opts in (#1248).
- **Help menu** in the topbar, linking issues, discussions, Discord and the wiki (#1248).
- Release-stage gate and public-claims validator (#613, #1188).

### Changed

- UI review pass: low-quality features hidden, layout consistency improved.
- Duplicate backtest archive index and stale archives removed.

### Fixed

- **The app rendered "App Failed to Load — item.items is not iterable" on every page.** Three prose
  strings had been added to the card contract, which is consumed both by the card grid and by a
  search-term builder that maps over each card's `items` — a string threw during render and the shell
  replaced every page. The prose now has its own export, with a build gate so the shape cannot break
  again (#1253).

## [0.156.0] — 2026-11-07

### Added

- **Code-health audit** — per-file size, function length and comment-ratio reporting, written to
  `docs/CODE-HEALTH.md` and `docs/code-health.json`.

## [0.155.0] — 2026-11-07

### Changed

- UI review continued: low-quality features hidden from navigation.
- Protocol slugs renamed for consistency.

## [0.153.0] — 2026-11-05

### Added

- **Support page** listing every funding option.
- Wiki **"Start here"** page with three reader paths.

### Changed

- **Experience level is honoured in navigation** — a first-time reader meets 68 pages rather than 87.
- Per-bot pyramid rules.
- Author credited in both footers; files attributed for anyone copying the project.

### Fixed

- Screenshot aspect ratios corrected.

## [0.152.0] — 2026-11-03

### Added

- Protocol/bot pairing.

### Changed

- Landing page rebuilt in the app's own visual language.

### Fixed

- **Four critical dependency advisories** pinned to patched versions.

## [0.150.0] — 2026-11-02

### Changed

- **Three protocols and three bots ship by default.** The rest are parked outside the seed, with the
  reason recorded — an unshipped strategy is listed, not silently dropped.

### Fixed

- Duplicate name that stopped the backend compiling.

## [0.149.0] — 2026-11-01

### Changed

- Directives rebuilt.
- Changelog restarted honestly at 0.147.0 rather than back-filling claims it could not support.
- Community links surfaced on the landing page.

### Added

- Standard public-repo files; README links to the site, wiki and screenshots.

## [0.147.0] — 2026-11-01

The public release. The project moved from a private, free-edition-oriented codebase to an
open-source project with public documentation.

### Added

- **`DISCLAIMER.md`** — a financial disclaimer stating that the software is **not configured to
  profit by default** and must be tested on demo accounts. The AGPL covers the licence; it says
  nothing about financial risk.
- **Public website** at <https://fifecic.github.io/Trading-Command-Suite/> — landing page with the
  risk statement above the fold, install tracks, and a "what is proven / what is not" section.
- **Screenshot tour** — 18 captioned alpha screens with a plain-language glossary.
- **Wiki** — 16 pages: disclaimer, installing, what it does, how it works, FAQ, glossary,
  troubleshooting, contributing, plus generated reference pages.
- **GitHub Discussions** — enabled, with a roadmap post, a defect-reporting guide, and polls.
- **`CONTRIBUTING.md`**, **`SECURITY.md`**, issue forms and a pull request template.
- **`accountKind`** on the MT5 bridge `/health` and `/account` — `demo` | `contest` | `real` |
  `unknown`. ⚠️ `unknown` is never treated as `demo`.
- **`scripts/publish-public-docs.cjs`** — publishes the wiki and enables Pages, from repository
  sources, so the public pages cannot drift from the code.
- **`scripts/validate-site-links.cjs`** — the public site has no build step, so this checks every
  local link and anchor, and rules that `404.html` must not depend on the request path.

### Changed

- **Licence is now AGPL-3.0** across `LICENSE`, the README badge, and both `package.json` files.
- **`SETUP.md` rewritten** — two install tracks (web + API, or full stack with MetaTrader 5),
  corrected environment-variable names, and the MT5 configuration documented for the first time.
- **README** opens with links to the site, screenshots, wiki, discussions, issues and security policy.
- **Repository metadata** — topics, homepage and description set, so the project is findable by
  category.

### Removed

- **The free edition, entirely** — build mode, generated page maps, nav filtering and the edition
  notice. It was cancelled on 2026-10-28 and the plan is kept only as history.
- **`LICENSE.txt`** — a *draft* free-edition end-user agreement that sat beside the AGPL licence and
  made GitHub report two licence entries.
- **`dist-free/`** — 18 build artefacts (6.2 MB) that were tracked in version control.
- **Planning notes** moved out of the public repository to the documentation store.

### Fixed

- **High-contrast text did not apply live** — it was written on mount and only picked up after a
  reload, because the `storage` event does not fire in the tab that made the change.
- **Every checked checkbox was dimmed app-wide** — an unscoped
  `input[type="checkbox"]:checked { opacity: 0.8 }` in a page stylesheet, and all CSS here is global,
  so ticked boxes looked fainter than unticked ones.
- **Native form controls stayed light in dark mode** — `color-scheme` was never set.
- **The in-app command reference was wrong** — it listed `prisma db push` (which drops 13 unmodelled
  tables in this repo), hardcoded absolute paths and a database password.
- **Dead links on the public site** — a 404 page whose every escape route used relative URLs, and a
  `#gallery` anchor pointing at an id that did not exist.

[Unreleased]: https://github.com/FifeCIC/Trading-Command-Suite/compare/v0.147.0...HEAD
[0.147.0]: https://github.com/FifeCIC/Trading-Command-Suite/releases/tag/v0.147.0
