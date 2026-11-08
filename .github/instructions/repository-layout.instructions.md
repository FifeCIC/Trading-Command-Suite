---
description: "Where a file belongs. Read before adding a file at a package root, in nest/, src/ or scripts/, and before running a canary that backs a file up."
applyTo: "**"
---

# Repository Layout — a file lives where its concern lives

> **Owner, 2026-11-07:** *"I'm a perfectionist and the easy visuals are the first thing that bothers
> me. Look at `nest/` … it contains a mix of completely different files … If that was another
> developer's project it wouldn't give me confidence in their tidiness. If you're about to tell me
> that I'm right and other developers don't do what agentic AI has been doing then we need to work on
> our rules."*
>
> **He was right, and the repo already agreed with him.** `nest/` held, all TRACKED in a **PUBLIC**
> repo: five session-output `.txt` files (one a 10.8 KB Prisma stack trace), a 151 KB
> `canary-<md5>.bak` of `backtest.service.ts` from a canary that **never restored**, three compiled
> `prisma.config.*` files beside their own `.ts`, thirteen one-off `.sql` repairs beside
> `package.json`, and `check-*` / `tmp-` / `seed-*` scripts — with `nest/scripts/` already holding
> **135** scripts. Gate: `scripts/validate-repo-hygiene.cjs`.

---

## 1. A package root answers "what is this package" — nothing else

`nest/` and the repo root are **package roots**. A root is mixed by *necessity*, not preference:
`package.json`, `tsconfig*.json`, `Dockerfile`, `.env.example`, `eslint.config.mjs`, `README.md` sit
together because **the tooling searches for those exact names at that exact level**. Move one and the
tool stops finding it. That is the whole reason a root looks mixed, and it is the only reason.

| ✅ Belongs at a package root | ❌ Does not, and where it goes |
|---|---|
| `package.json`, `package-lock.json` | a script → `nest/scripts/` (already 135 of them) |
| `tsconfig*.json`, `nest-cli.json`, `vite.config.js` | SQL repair / migration → `nest/prisma/` |
| `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `nginx.conf` | seed data → `nest/prisma/seed-parked/` |
| `.env`, `.env.example`, `.env.docker` | probe output → `logs/` (gitignored) or the issue |
| `eslint.config.*`, `.prettierrc`, `.gitignore` | a note → `docs/` |
| `README.md`, `SETUP.md`, `CHANGELOG.md` | a handoff → the central Drive store |
| `prisma.config.ts` | **compiled `.js` / `.js.map` / `.d.ts` → nowhere** |
| `app-settings.json` — *allowlisted, see §4* | `.bak`, `.old`, `tmp-*`, `*-copy.*` → nowhere |

> **The test, one line:** *if a tool does not look for this filename at this depth, it is in the wrong
> place.*

## 2. Compiled output never sits beside its source

A `.js`, `.js.map` or `.d.ts` next to a `.ts` of the same name is **never** the executed file and
**never** the build artefact — `tsc` emits into `dist/`. So it can only ever be a copy that
**silently disagrees** with the `.ts` it sits beside. That is this repo's most expensive failure
signature: plausible output, no error.

⚠️ **This rule already existed — for `nest/prisma/` only (#897).** The identical defect was sitting
one directory up. **A rule enforced in one directory is not a rule**, which is why the guard checks
the pattern repo-wide rather than a path.

## 3. Scratch is not a deliverable

| Class | Rule |
|---|---|
| `.bak`, `.orig`, `.old`, `.rej`, `.save`, `.tmp` | never tracked. `scripts/mt5-bridge/archived/` is the ONE exception — a named record directory |
| `tmp-*`, `temp-*`, `*-copy.*` | never tracked |
| probe / audit / stack-trace output | `logs/` (gitignored, a bench not a shelf) — the durable record is the **issue** |
| canary backups | back up **in `logs/`**, and **restore and verify the restore** (`development-philosophy` §5). A committed `.bak` is proof a canary broke that rule |

## 4. The one allowlisted exception, and what an exception costs

`nest/app-settings.json` is a **runtime mirror** of the `appsetting` table — `SettingsService` writes
it and reads it at boot (`settings.service.ts` L193-207, L333), deliberately, because it is the copy
an agent reads to work from.

⚠️ **It is still a second copy of a fact the DB owns**, and every settings change dirties the tree.
It is allowlisted rather than moved because it is **read at boot**, so untracking it changes
fresh-install behaviour — a decision, not a tidy-up.

**An allowlist entry without a reason is a widened pattern with extra steps.** `ROOT_ALLOWLIST` in
`scripts/validate-repo-hygiene.cjs` requires a `why`.

## 5. The guard, and how to extend it

```powershell
node scripts/validate-repo-hygiene.cjs             # build gate (first step of `prebuild`)
node scripts/validate-repo-hygiene.cjs --self-test # prove all 4 rules can fail
node scripts/validate-repo-hygiene.cjs --report    # every tracked file at each package root
```

| Rule | What it catches |
|---|---|
| **R1** | a tracked file at a package root that is not a manifest/config/docker/linter/README |
| **R2** | compiled output beside its own `.ts`, outside `dist/` |
| **R3** | scratch classes (`.bak`, `tmp-*`, …), `archived/` excepted |
| **R4** | a tracked `.txt` no consumer reads (requirements, `robots.txt`, notices are named) |

⚠️ **It reads `git ls-files`, so it judges only what is committed** — local scratch in a gitignored
folder is `.gitignore`'s business. If `git` cannot run it **exits 2 (cannot judge)**, never 0: a
check that inspects nothing and reports OK is worse than no check.

⚠️ **Narrow beats broad.** If it fires on something legitimate, add **one** allowlist entry naming
the file and the reason. Never widen a pattern to cover a class of legitimate files — a guard that
fires for the wrong reason gets allowlisted, and an allowlisted guard is worse than none.

## Related

- `.gitignore` — carries the same rules as **ignore patterns**, which stop a file being *added*.
  ⚠️ An ignore rule says nothing about a file git **already has**; the guard is what catches that.
- `agent-environment.instructions.md` — `logs/` is agent scratch, and the naming convention for it.
- `documentation-standards.instructions.md` — which root a `.md` belongs in.
- `database-schema.instructions.md` — `nest/prisma/` and `raw-managed/`.
