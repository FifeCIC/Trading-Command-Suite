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

## Step 1b — scaffold the mechanical parts instead of hand-writing them

Most of a new project's setup is not a judgement call. The scaffolder writes the deterministic files
and skips everything that needs a decision.

```powershell
# 1. See what it WOULD write. This is the default and it writes NOTHING.
node <TCS>/scripts/audit-project-readiness.cjs --path <target> --scaffold

# 2. Write it once you are happy with the list.
node <TCS>/scripts/audit-project-readiness.cjs --path <target> --scaffold --apply
```

**What it creates** — each with real content and a header stating the defect it prevents:

| File | Why it is not optional |
|---|---|
| `.gitignore` | logs, scratch, secrets, build output — measured: 435 tracked log files in a public repo |
| `README.md` | required by the gate it installs; a README saying "Project name" reads as abandoned |
| `.github/copilot-instructions.md` | the published contributor rules — the seven that stop the recurring mistakes |
| `docs/SETTLED-DECISIONS.md` | numbered rows with an honest guard-status column, seeded with real entries |
| `.github/REVIEW-QUEUE.md` | one list of what needs the human |
| `scripts/lib/self-test.cjs` | the shared assertion harness every gate uses |
| `scripts/validate-required-files.cjs` | a real first gate: manifest, README, `.gitignore`, scratch, credentials |
| `scripts/validate-repo-hygiene.cjs` | package-root contents, compiled-beside-source, scratch, `.txt`, credentials |
| `scripts/validate-agent-docs.cjs` | `applyTo` present, kebab-case frontmatter keys, dangling citations, no work items in docs |
| `package.json` → `prebuild` | chains **six** gate invocations (each validator's `--self-test`, then itself) |

**The before/after on an empty project:** `0 present · 12 missing` → **`8 present · 1 required missing`**.
The remaining required gap is the **licence**, which is deliberately the one thing no scaffold will
supply — see below.

**Three guarantees, and you should verify them rather than trust them:**

1. **Dry run by default.** No `--apply`, no writes.
2. **Never overwrites.** An existing file is skipped and reported. `package.json` is only ever given a
   *missing* `prebuild` key.
3. **Idempotent.** A second `--apply` creates nothing — run it twice and confirm.

⚠️ **What it deliberately does NOT create**, because these are decisions and not templates:

| Not scaffolded | Why |
|---|---|
| `LICENSE` | **The one required gap it leaves.** A licence choice is the owner's: AGPL-3.0 keeps a fork open, MIT/BSD permit a closed one. A public repo with no licence is "all rights reserved" by default, which contradicts an open-source claim — so this must be a deliberate act. The report marks it 🧑 *"YOUR DECISION, not an agent's"*. |
| `.github/instructions/` corpus | The rule corpus is the *process*. Decide deliberately whether it is private, published, or both. |
| Feature code | It arrives into a governed tree, or it becomes debt. |
| `releaseStage` | A project's maturity is a claim the owner makes, not one an agent infers. |

---

## Step 2 — report back BEFORE building anything else

After scaffolding, re-run the audit. **The before/after counts are the evidence the scaffold did
anything** — quote both.

Then give the owner a table of what remains, in this order:

1. **required + missing** — these still block the set-up
2. **partial** — half-built, cheap to finish
3. **cannot-judge** — say plainly you could not see them, and why
4. **optional + missing** — list, and ask which they want now

Then state the **proposed order** you will work in, and stop for confirmation. Do not build nine
things and present them as a fait accompli.

---

## Step 3 — the setup order, and why this order

| # | Do this | Because |
|---|---|---|
| 0 | **Run `--scaffold --apply`** for the mechanical files | Deterministic files should never be hand-typed, and hand-typing them is where the drift starts |
| 1 | `.gitignore` first — logs, scratch, `.env`, `dist`, generated output | Measured: 576 files in a `logs/` folder, **435 of them tracked** in a public repo |
| 2 | A **layout rule**: a file lives where its concern lives | Location decides whether a file is validated at all — 13 SQL files sat outside both scan roots and were checked by nothing |
| 3 | A **decision register** — `docs/SETTLED-DECISIONS.md`, numbered rows, a guard-status column | An unrecorded decision gets re-opened by accident, which is the most expensive thing in a maintained codebase |
| 4 | A **philosophy rule** — the three or four sentences that stop the recurring mistake | One page, written by a human, that the agent is told to read before claiming anything is done |
| 5 | **Gates** — `prebuild` chaining the validators | A check nobody runs is not a check |
| 6 | **`--self-test` on every gate** | A guard that has never been observed to fail is a decoration |
| 7 | **A tool index** with `--find` searching PURPOSE text | 232 tools with 64 orphans is what happens without one, and three proposals in one session were to build something already in the list |
| 8 | **Now** the features | They arrive into a governed tree instead of creating debt |
| — | **`LICENSE`** — whenever the owner decides | It is the one required item a scaffold cannot supply, and the only one an agent must not choose |

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

⚠️ **And for the scaffolded set specifically, RUN the gates it installed:**

```powershell
node scripts/validate-required-files.cjs --self-test ; node scripts/validate-required-files.cjs
node scripts/validate-repo-hygiene.cjs   --self-test ; node scripts/validate-repo-hygiene.cjs
node scripts/validate-agent-docs.cjs     --self-test ; node scripts/validate-agent-docs.cjs
```

All six must exit **0** on a freshly scaffolded project. A scaffold that produces a red build on day
one is the *"a gate that fails on day one gets switched off"* trap, and it is invisible unless you
execute what was written rather than reading it.

Then prove each gate can still fail — plant one defect and confirm the owning gate reports it:

```powershell
# repo hygiene: a scratch file at the package root
New-Item scripts\..\service.ts.bak -ItemType File ; node scripts/validate-repo-hygiene.cjs   # exit 1
Remove-Item service.ts.bak                        ; node scripts/validate-repo-hygiene.cjs   # exit 0
```

Then re-run the auditor and show the before/after counts. **A number that moved is the evidence.**

---

## What NOT to do

- **Do not copy a whole rule corpus into a public repo.** Measured: 19 instruction files sat in an
  ordinary tracked folder and were public for weeks. Choose deliberately: a private corpus plus a
  published, contributor-facing subset is the shape that worked.
- **Do not hand-write what the scaffolder writes.** Deterministic files typed by hand is where the
  drift begins — and the second project will type them differently.
- **Do not run `--scaffold --apply` twice and assume the second run was harmless.** It is idempotent
  *by design*; verify it rather than assuming, because "nothing appeared" and "it silently rewrote a
  file" look identical from the outside.
- **Do not let the scaffold write `LICENSE`.** That is a decision, not a template.
- **Do not port a gate without its reasoning.** A gate with no stated purpose gets allowlisted the
  first time it is inconvenient.
- **Do not add a gate that fails on a healthy new project.** It gets switched off, and then nothing
  is guarded. Report-and-promote later beats fail-on-day-one.
- **Do not claim a practice the project does not actually enforce.** If it cannot be demonstrated by
  running something, it is a paragraph, not a guardrail.
