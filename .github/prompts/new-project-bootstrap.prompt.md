---
description: "Bootstrap a new project against the practice set — audit what is missing, then set up the environment in the right order. Use when starting a new project, or when adopting an existing one that has no guardrails yet."
argument-hint: "[path to the project, defaults to the current workspace]"
---

# New project bootstrap — set up the guardrails before the features

You are setting up a project so that **good structure is cheap and bad structure is loud**. Work in
the order below. Do not skip ahead to features: every rule added after code exists has to grandfather
that code as debt.

**Target:** `${input:path}` — if empty, use the current workspace.

---

## Step 1 — measure, do not assume

Run the auditor and read the output in full. Do not summarise it away — the `why it matters` line for
each gap is the reason the work is worth doing.

```powershell
node <TCS>/scripts/audit-project-readiness.cjs --path <target>
```

If that script is not reachable, get it from Trading Command Suite `scripts/` and copy it in, then run
it. It is dependency-free and audits **any** directory.

**Four states, and they are not interchangeable:**

| State | Means | Action |
|---|---|---|
| ✅ present | exists and was read | leave alone |
| 🟨 partial | exists, a required part is absent | finish it |
| ❌ missing | not there | build it |
| ⚠️ cannot-judge | the path could not be READ | **investigate — never assume it is fine** |

> ⚠️ **`cannot-judge` is not "fine" and not "missing".** If a check cannot read its input, the honest
> answer is a refusal, never a pass. A verifier that inspects nothing and reports OK is worse than no
> check at all — that is the single most repeated defect in the source project.

---

## Step 2 — report back BEFORE building anything

Give the owner a table of what was found, in this order:

1. **required + missing** — these block the set-up
2. **partial** — half-built, cheap to finish
3. **cannot-judge** — say plainly you could not see them, and why
4. **optional + missing** — list, and ask which they want now

Then state the **proposed order** you will work in, and stop for confirmation. Do not build nine
things and present them as a fait accompli.

---

## Step 3 — the setup order, and why this order

| # | Do this | Because |
|---|---|---|
| 1 | `.gitignore` first — logs, scratch, `.env`, `dist`, generated output | Measured: 576 files in a `logs/` folder, **435 of them tracked** in a public repo |
| 2 | A **layout rule**: a file lives where its concern lives | Location decides whether a file is validated at all — 13 SQL files sat outside both scan roots and were checked by nothing |
| 3 | A **decision register** — `docs/SETTLED-DECISIONS.md`, numbered rows, a guard-status column | An unrecorded decision gets re-opened by accident, which is the most expensive thing in a maintained codebase |
| 4 | A **philosophy rule** — the three or four sentences that stop the recurring mistake | One page, written by a human, that the agent is told to read before claiming anything is done |
| 5 | **Gates** — `prebuild` chaining the validators | A check nobody runs is not a check |
| 6 | **`--self-test` on every gate** | A guard that has never been observed to fail is a decoration |
| 7 | **A tool index** with `--find` searching PURPOSE text | 232 tools with 64 orphans is what happens without one, and three proposals in one session were to build something already in the list |
| 8 | **Now** the features | They arrive into a governed tree instead of creating debt |

---

## Step 4 — the rules that must be written down, not assumed

Each of these was paid for by a real failure. If the project has no equivalent, add one — and say
where you put it.

1. **Evidence over assertion.** Every claim needs a named command and its output. "Verified" with no
   command is indistinguishable from a guess.
2. **Do not attribute a fix you did not isolate.** Two changes and the symptom goes is a correlation.
   Say "recovered with X and Y; not isolated".
3. **A declaration is not validated by being well-formed.** A seeder that runs is not a seeder that
   restores. A config that parses is not a config that works. Test round-trip, not just syntax.
4. **Prefer a symptom guard over a cause guard** when the cause is unknown. A symptom guard fires
   without needing your theory to be right.
5. **An allowlisted guard is worse than none.** If a check fires on correct code, narrow the check —
   never widen the exemption.
6. **Honest-partial is a pass.** Report what you did *not* do. Concealing a limitation is the only
   real failure.
7. **A canary must prove its own edit landed.** A mutation that never applied reports a clean pass,
   and the obvious repair is then to "fix" a guard that was correct.

---

## Step 5 — acceptance before you call it done

For every gate you add:

- [ ] Runs clean on the project **before** being wired into `prebuild`
- [ ] **Made to fail on purpose**, in both directions, then restored, and **the restore verified**
- [ ] Three exit codes: `0` pass · `1` violation · `2` **cannot judge**
- [ ] Its header states the **measured defect** it closes and **what it does NOT check**
- [ ] Its own commit, so it can be reverted without unpicking the rest

Then re-run the auditor and show the before/after counts. **A number that moved is the evidence.**

---

## What NOT to do

- **Do not copy a whole rule corpus into a public repo.** Measured: 19 instruction files sat in an
  ordinary tracked folder and were public for weeks. Choose deliberately: a private corpus plus a
  published, contributor-facing subset is the shape that worked.
- **Do not port a gate without its reasoning.** A gate with no stated purpose gets allowlisted the
  first time it is inconvenient.
- **Do not add a gate that fails on a healthy new project.** It gets switched off, and then nothing
  is guarded. Report-and-promote later beats fail-on-day-one.
- **Do not claim a practice the project does not actually enforce.** If it cannot be demonstrated by
  running something, it is a paragraph, not a guardrail.
