---
description: "Documentation placement, standard headers, and lifecycle. Read before creating, moving, or archiving ANY .md file. Defines the document categories (A–G), which root each belongs in, the required header, and how a superseded document is retired without losing its reasoning."
applyTo: "**/*.md, docs/**"
---

# Documentation Standards

**Created:** 2026-09-13 · **Status:** active · **Category:** A (agent-operational)

## Why this file exists

A scan on 2026-09-13 found **195 `.md` files** across the two roots, **~70% of them inside the
repo that becomes public**, and **no rule governing any of it**. Consequences observed:

- **13 of 40 `docs/` files carry no date or status** — their age is invisible, so nobody can tell
  what is stale. (`sees-strategy-concept.md` is the example that prompted this.)
- **Six competing coordination surfaces** existed, five of them dead.
- Instructions pointed at a **retired directory** and at **empty queues**.

The root cause is the same one this repo keeps hitting: **a rule that does not exist is
indistinguishable from a rule that does not fire.** This is the one rule.

---

## 1. Two roots, one rule

| Root | Contains | Ships publicly? |
|---|---|---|
| `C:\wamp64\www\trading-command-suite\` | **operational + agent + contract** docs only | **YES — assume public** |
| `G:\My Drive\…\Trading-Command-Suite-Documentation\` | everything else: theory, product, commercial, working records, archive | no |

**Test before putting a file in the repo:** *does a developer or agent need this to build, run, or
change the app today?* If not, it belongs in GDrive.

---

## 2. Categories — decide the category FIRST, it dictates the destination

| Cat | Class | Lives in | Examples |
|---|---|---|---|
| **A** | Agent-operational | `.github/` (+ files it cites) | instructions, agents, skills, `AGENT-ATTENTION.md`, `SETTLED-DECISIONS.md` |
| **B** | Working / temporary | GDrive `archive/` | handoffs, plans, diagnoses, audits, reconciliations |
| **C** | Reference / contract | repo `docs/` | `scoring-architecture`, `SCREENER-CONTRACT`, `risk-controls` |
| **D** | Theory / design | GDrive `docs/theories/` | protocol & timeframe theory, scoring designs |
| **E** | Product / user | website → GDrive `docs/wiki-seed/` | `USER_GUIDE`, how-to pages |
| **F** | Build / setup | repo root, `nest/` | `README`, `SETUP`, `DEVELOPMENT`, `CHANGELOG` |
| **G** | Artefacts, not docs | — | generated caches, issue-body drafts → delete or gitignore |

⚠️ **A file's category must match its location.** A category-B working note in the repo is the
defect this rule exists to prevent.

---

## 3. Standard header — required on every new document

Every `.md` document starts with:

```markdown
# Title

**Status:** draft | working | active | stable | superseded | archived
**Category:** A | B | C | D | E | F | G
**Created:** YYYY-MM-DD
**Last updated:** YYYY-MM-DD
**Owner:** <agent name | human>
```

- **`applyTo`-bearing instruction files** (`.github/instructions/*.md`) keep their YAML
  frontmatter — that is their header; add `Last reviewed:` when you touch one.
- **Handoffs** keep the mandated `agent-handoff.instructions.md` frontmatter (`date:`, `area:`,
  `type:`) — do not add a second header.
- **When you edit a document, update its `Last updated`.** A header that is not maintained is
  worse than none, because it looks like provenance.

---

## 4. Lifecycle

```
draft → working → active → stable → superseded → archived
```

- **Never delete a document that carries reasoning.** Mark it `**Status:** superseded`, add a
  one-line pointer to what replaced it, and move it to GDrive `archive/`.
- **Superseded ≠ deleted.** The repo has already lost reasoning once by deleting processed
  handoffs (2026-09-11). Do not repeat it.
- **Generated artefacts** (caches, snapshots) are gitignored, never committed.

---

## 5. A document describes what IS — not what is left to do

**A document may not hold a task list.** Open work is a **GitHub issue**, attached to the relevant
epic. This is the same failure the retired `prompts/` queue had: work recorded outside the tracker is
invisible from the tracker, and it rots silently.

Measured 2026-09-13: **~40 open `- [ ]` items across 10+ non-roadmap files** in both roots — most of
them **already done, moot, or superseded**. Two examples: *"a trailing-stop monitoring loop needs to
be built"* (it had been built — `StopGuardianService` exists), and four Trading212 API questions
(Trading212 development was discontinued on 2026-08-27, #696).

| | |
|---|---|
| ❌ | A spec, guide, policy or contract containing `- [ ]` items |
| ✅ | A pointer: *"Q1–Q4 closed — see #696"* |
| ✅ | A **reusable template** — but it must opt in with `<!-- doc-tasks-allowed -->` |

Enforced by `scripts/validate-agent-docs.cjs` **check 9** (fails on an open checkbox under `docs/`).

## 6. Enforcement

`scripts/validate-agent-docs.cjs` runs in the backend `prebuild`:

| Check | Behaviour |
|---|---|
| **7** — docs with no date/status header | **reports** |
| **9** — an open checkbox under `docs/` | **fails** (§5) |
| **8** — the handoff rule must name the central store | **fails** |
| **2** — the retired `.github/handoffs/` directory | **fails** |

Checks that can be satisfied by back-filling are **reported** first and promoted to failures once the
legacy list reaches zero — a gate that fails on day one gets switched off.

---

## Related

- `.github/instructions/agent-handoff.instructions.md` — the handoff format and location
- `G:\…\DOCUMENTATION-INDEX.md` — the map of the *post-triage* layout
- `docs/SETTLED-DECISIONS.md` — check before re-opening a settled area
