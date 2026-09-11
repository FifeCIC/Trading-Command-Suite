# Handoff Files — canonical location

**This is the ONE canonical handoff directory: `docs/handoff/`.** *(Established 2026-09-11.)*

Agent-to-Librarian handoff files. Each records a completed unit of work plus the **reasoning** behind
it, for the Librarian to batch into the QA Testing page, Capability Map, and Architecture Framework.

---

## ⚠️ Why this file exists — read before changing the process

Handoffs were previously split across `.github/handoffs/` and `docs/handoff/`. **FOUR handoffs cited
by `.github/AGENT-ATTENTION.md` are now unfindable entirely** (only one was recoverable from git).
Three were never committed at all.

The reasoning had been written down, and it still vanished. That is the mechanism behind the project
re-opening the same areas for weeks: **the decisions were documented in files nobody could find.**

Two causes, both now fixed:

| Cause | Fix |
|---|---|
| Two directories, neither declared canonical | This directory is the only one. `scripts/validate-agent-docs.cjs` **fails the build** if `.github/handoffs/` reappears |
| The old process said *"the Librarian deletes the handoff after processing"* | **Handoffs are NEVER deleted.** They are the project's memory. The Librarian *summarises* into the docs and **leaves the handoff in place** |

---

## How it works

1. **Every agent** writes a handoff here when completing work — per
   `.github/instructions/agent-handoff.instructions.md`
2. **The Librarian** reads unprocessed handoffs and batch-updates the three documentation pages
3. **The handoff STAYS.** It is never deleted. It is the durable record of *why*.

⚠️ Deleting a handoff because "it has been processed" destroys the only record of the reasoning.
Processing means **summarising into the docs**, not consuming the source.

---

## Format

See `.github/instructions/agent-handoff.instructions.md` for the full template.

Quick reference:

```markdown
---
date: 2026-07-15
area: scoring
type: feature
---
```

**Required sections beyond the frontmatter — the parts that stop the loops:**

| Section | Why it is mandatory |
|---|---|
| **What changed** | the mechanical facts |
| **Why / theory** | the reasoning. Without this the next agent re-derives it (or reverses it) |
| **Verified** | the literal command **and output**. A claim is not evidence |
| **Not done / open** | explicitly, with why. Silent partial work reads as complete |
| **Related** | issue links, including any **prior** issue in the same area |

## Naming

```
docs/handoff/YYYY-MM-DD-{slug}.md
```

Example: `docs/handoff/2026-09-11-inv-gate-membership-guard.md`

Include the issue number in the slug where one exists so the handoff is greppable from the issue:
`2026-09-11-789-session-open-effect-placement.md`

---

## Finding the history

| Question | Tool |
|---|---|
| Has this area been worked before? | `node scripts/detect-circular-work.cjs <topic>` |
| What is settled here? | `docs/SETTLED-DECISIONS.md` |
| What is enforced? | `.github/instructions/meta-stack-contracts.instructions.md` |
| What is currently broken? | `.github/AGENT-ATTENTION.md` |
