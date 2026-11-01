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

---

## [Unreleased]

_Nothing yet._

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
