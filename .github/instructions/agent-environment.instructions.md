---
description: "Environment tooling available to agents. Use these before asking the user to provide information manually."
applyTo: "**"
---

# Agent Environment — Available Tooling

## 🛑 Read the facts. Do not remember them.

> **The system is the source of truth. Every document — including every file in this folder — is a
> CLAIM about it.** Two commands below make the correct move cheaper than the wrong one. Use them
> before asserting anything about this project.

### The volatile facts are GENERATED — the build fails if they go stale

```powershell
node scripts/docs-facts.cjs            # regenerate docs/GENERATED-FACTS.md
node scripts/docs-facts.cjs --check    # exit 1 if stale (this runs in `prebuild`)
```

- **`docs/GENERATED-FACTS.md`** — counts derived from files (protocols, adapters, versions)
- **`docs/generated-facts.json`** — the same, machine-readable
- Its rule, which binds every agent: **quote nothing from memory. Either read it here, or query the endpoint.**

Live values are deliberately NOT in that file (they change every tick). Query them:

| What | Endpoint |
|---|---|
| All facts, file-derived + live, as JSON | `GET /api/architecture/facts` |
| Version | `GET /api/version` |
| Registered directives | `GET /api/directives` |
| Protocols (all / gated) | `GET /api/scoring/protocols`, `GET /api/scoring/gated/protocols` |

### The SCHEMA — read the column AND its type before naming it

```powershell
node scripts/db-schema.cjs trade                # columns + types for a table
node scripts/db-schema.cjs --pattern 'ab_%'     # find tables by name
node scripts/db-schema.cjs --self-test          # prove the guard can fail (no database needed)
```

⚠️ **A column NAME is not a definition.** The same column name holds different types in different
tables — `score_snapshot.protocolId` is `varchar(36)` holding a **slug**, `strategy_protocol.protocolId`
is `varchar(100)` holding a **slug**, `watchlist.protocolId` is `varchar(100)` holding a **UUID**.
Joining the wrong one returns **no rows and no error** — it reads as "no such protocol", not as a bug.

⛔ **Never guess a column name.** Measured 2026-09-25: an agent guessed six in one session and was
wrong more than half; each wrong guess cost a round trip and produced a silently empty result.

### The SCHEMA can DRIFT — a model can silently under-report a table (#948)

```powershell
npm --prefix nest run db:schema-drift             # field-level drift: schema.prisma (DMMF) vs the live DB
npm --prefix nest run db:schema-drift:self-test   # prove BOTH directions can be detected
```

`db:check` (#769) covers **table-level** drift — a table with no model. This covers **field-level**
drift: a **modelled** table missing **columns** that exist in the database. Prisma then cannot read
them and every query silently under-reports — the repo's most expensive failure signature. Measured
instances, both found by accident: `symbol_route.provider`, and `Trade.pnlInvalid` (#805 — the P&L
report counted 82 fabricated rows as trades). It reads the **DMMF**, so it cannot disagree with what
the app actually does. Runs **on demand** (it needs a live DB), beside `db:check`.

### Any NEW audit or validator script must ship a `--self-test`

A guard that has never been observed to fail is a decoration. Ship one that can be made to fail in
**both** directions and prove it. Precedents: `validate-theories.cjs --self-test`,
`validate-route-capability.cjs --self-test`.

⚠️ Measured the same day: a new audit script **with no self-test** reported **two contradictory
answers on two runs, and both were wrong** — nothing noticed, and a false result nearly reached the
owner. That is the shape this rule exists to prevent.

### 🛑 Before building a tool, LOOK IT UP — the index is generated, and it counts orphans

```powershell
node scripts/tools-index.cjs --find <keyword>         # ← START HERE. Searches NAME **and PURPOSE**.
node scripts/tools-index.cjs --run <name> [args...]   # run one; prints the file it resolved to
node scripts/tools-index.cjs --orphans  # list only the tools named NOWHERE
node scripts/tools-index.cjs --write    # regenerate docs/TOOLS-INDEX.md + docs/tools-index.json
node scripts/tools-index.cjs --check    # exit 1 if stale (runs in `prebuild`)
node scripts/tools-index.cjs --self-test
```

⚠️ **`--find` searches the PURPOSE text, not just filenames, and that is the whole point.** An agent
asking *"why is the Signal denominator 725?"* will never guess `audit-signal-capacity.cjs` — but
`--find denominator` returns it, plus `audit-denominator-history.cjs` and two more. Canaried both
ways: restricting the matcher to filenames fails **2** self-test cases.

⚠️ **`--run` REFUSES an ambiguous prefix** and lists the candidates instead of picking the first.
It executes real scripts, so silently choosing one is a guess wearing a command's clothes. It also
prints the resolved path *before* running, and marks an orphan as an orphan.

**`docs/TOOLS-INDEX.md`** lists every tool in `scripts/` and `nest/scripts/`, each marked with where
it is reachable from: `prebuild` · `npm` · `docs` · **⚠️ ORPHAN** (named in none of them).

⚠️ **Measured 2026-09-26: 141 tools, 75 orphans (53%).** An orphan is a tool that works, that nobody
will find — `analyse-unreachable-capacity.cjs` was one, and it took three passes to locate while an
agent was actively looking for exactly that capability. **Three separate proposals in one session
were to BUILD something already in this list.**

⚠️ **Measured 2026-10-02: 175 tools, 75 orphans (43%).** The count has NOT moved — because
`--find`/`--run` make the library **reachable**, not **referenced**. Reachability is the thing that
mattered: an orphan with a working search is usable; the same orphan without one is lost. Do not
chase a zero orphan count; chase *findability*.

**The rule: `--find` the capability words FIRST. Then read the index. Then build.** A fourth surface
for something that already exists makes the problem worse, not better.

⚠️ **The index is not a build gate for orphans** — 75 of them is a backlog to work through, not a
build-breaker. `--check` fails only when the generated files are stale. Its success line reports the
**real** orphan count, because it used to print a hardcoded `0` — on the one path a hurried reader or
a gate is most likely to see.

## GitHub CLI (`gh`)

GitHub issues, PRs, and labels are accessible via the `gh` CLI. Always use it rather than asking the user to paste issue content.

```bash
gh issue list --limit 50                  # list open issues
gh issue view <number>                    # full issue detail
gh issue create --title "..." --body "..." --label "..."
gh issue close <number> --comment "..."
gh pr list
gh pr view <number>
```

Never ask the user to manually copy/paste GitHub issue content — fetch it directly.
### 🛑 GITHUB PROJECTS need their OWN scope — issues do not (#1246)

**Measured 2026-11-07.** The machine's single `gh` login (`gho_` token, keyring) carries
`gist, read:org, repo, workflow`. Issues, PRs, releases and file writes all work. **Projects v2 does
not**, and the failure is easy to misread:

```
The 'projectsV2' field requires one of the following scopes: ['read:project'],
but your token has only been granted the: ['gist', 'read:org', 'repo', 'workflow'] scopes.
```

⚠️ **The confusing part:** `{viewer{projectsV2{totalCount}}}` **succeeds** — it answered `5` on this
machine — while asking for `title`/`number` fails. So a probe that only asks for the COUNT reports
"Projects work", and the next field asked for 404s. **Probe with `title`, not `totalCount`.**

Two ways to grant it. **Both are one action by the owner**; neither can be done by an agent, because
`gh auth refresh` opens a browser and a PAT has to be created by a human:

| Fix | Command / action | Scope of the change |
|---|---|---|
| **A — widen the shared login** | `gh auth refresh -s project,read:project` | every agent, every repo on this machine |
| **B — a per-machine token** | create a token with **Projects: read & write**, put it in `C:\wamp64\www\.secrets\credentials.env` as `GITHUB_TOKEN=…` | only this file, and only callers that read it |

⚠️ **`scripts/gh-wrapper.ps1` already loads `GITHUB_TOKEN` from that file**, so Fix B needs no code
change and no restart — the next `pwsh -File scripts/gh-wrapper.ps1 …` picks it up. It only sets the
variable when a REAL value is present (a `<value>` placeholder is ignored), because setting
`GH_TOKEN` to an empty string would override the working keyring login and break issue/PR commands
that work today.

⚠️ Raw `gh` (not the wrapper) reads your shell environment, so export it there or keep using the
wrapper. The wrapper also appends a one-line diagnosis when a Projects call is refused, instead of
leaving the same three-paragraph error repeated once per requested field.

**Not needed for Projects:** more agents, a bot account, or a GitHub App. One token with the right
scope serves every agent on the machine, exactly like `repo` already does.
⚠️ **GraphQL through the WRAPPER mangles quoted string literals.** Measured 2026-11-07: the wrapper
passes args through `cmd /c`, so `-f query='{organization(login:"FifeCIC"){…}}'` arrives with the
quotes stripped and fails with `Argument 'login' … has an invalid value (FifeCIC)`. **Use raw `gh`
for any GraphQL query containing a string literal**, and the wrapper for everything else (its value is
the JSON/encoding handling, which `gh project` and simple queries do not need). A query with no
literal — `{viewer{projectsV2(first:1){totalCount}}}` — works through either.

**What already exists on this machine (measured 2026-11-07, read-only):** `viewer.projectsV2` **5**,
`organization(FifeCIC).projectsV2` **0**, and repo-linked projects unreadable for want of the scope.
So there is no org board yet — the count of 5 is the personal account's projects. Decide which owner
the board should live under BEFORE granting the scope, because a repo-linked Project and a
user-owned Project are different objects with different URLs.

## 🛑 Committing — the git index is SHARED between agents

**All agents run in ONE working tree.** When another agent runs `git add`, their files sit in the
same index you are about to commit, and `git commit -m "..."` with no pathspec commits **the whole
index**.

Measured 2026-09-23: an agent ran `git add` for one file, printed `git diff --cached --name-status`
— which showed **15 files, 14 of them not theirs** — and committed anyway. The commit carried
another agent's editions work *including their `0.71.0 → 0.72.0` version bump* under a
`docs(handoff)` message. **The check worked and its output was ignored.**

**Use the wrapper instead of a bare `git commit`:**

```powershell
node scripts/commit-only.cjs -m "subject" -m "body para" -- <file> [<file>...]
node scripts/commit-only.cjs --check -- <file>        # report only, commit nothing
```

It (1) commits by explicit pathspec so only your files go in, (2) **reads the commit back** and
asserts the file set matches — because a command reporting success is a claim, and the commit's own
file list is the evidence, and (3) reports anything staged that it is deliberately skipping. A named
file with **no changes is refused**: naming a file claims it changed.

### Commit cadence — BATCH, and do not narrate it

> **Owner instruction, 2026-10-02:** *"I do not mind commits not happening straight away and agent
> AI goes on about it too much. I commit manually myself 2-3 times a day… Maybe change the rules to
> commit every 4 hours."*

**Agents do not commit per change.** The owner commits manually 2–3× a day. Uncommitted work is
normal and expected here — do not treat it as a hazard, and do not mention it.

**Why (measured 2026-09-23):** 41 commits in 4.5 hours across all agents; **18** of them ≤2 minutes
apart; 10 touched a single file. Three instruction files each *independently* forced a commit, so
one logical change emitted six artefacts. **The cost is the owner's attention — and a commit every
3 minutes trains that reader to skim, which is the same as no evidence trail at all.**

| Do | Don't |
|---|---|
| Let changes **accumulate**; commit at a **~4-hour cadence at most** | A commit per issue, per file edit, or per green test |
| Commit **silently** — at most one line naming the SHA, in the final summary | Echo `git log` / `git status` / `git diff --cached` into the transcript |
| Let the **closed issue + handoff** carry the narrative | Narrate the commit in chat, then again in the handoff, then again in the commit body |

**The one exception — commit now if another agent is blocked.** A file that does not compile makes
the shared build red for everyone and blocks a concurrent agent from starting. Say so in one line
and move on.

⚠️ **Batching does NOT relax the wrapper.** When you do commit, still use `commit-only.cjs` with
explicit paths below — batching makes the shared-index trap *more* likely, not less, because more of
your uncommitted work is sitting where another agent's `git add` can reach it.

⚠️ **Committing often is not the same as committing safely.** A commit is evidence that the change
was gated — it is not a substitute for gating it (`change-completion.instructions.md`).

⚠️ **Never `git commit -a`, and never a bare `git commit`.** If you do commit by mistake and it is
not pushed, `git reset --mixed HEAD~1` unwinds it — that moves HEAD and the index and touches no
working file. If it **is** pushed, leave it and report instead of rewriting shared history.

## 📋 Review Queue — one list, shared by all agents (owner instruction, 2026-09-23)

> *"Store things I need to review and when I prompt for a review list give it to me — all agents
> could share the same list."*

**The queue is `.github/REVIEW-QUEUE.md`.** It is the one place a review item is recorded, so the
owner does not have to read six handoffs and an attention board to find what is waiting for them.

| When | Do |
|---|---|
| The owner says **"review list"**, "show me the review queue", "what needs me?" | **Print the OPEN table from `.github/REVIEW-QUEUE.md` in full, in the chat.** Do not summarise it, do not re-derive it from GitHub, do not tell them to open the file — that sentence is the whole point of the file |
| Work creates something a human must look at or decide | **Append a row** — subject to the limits below |
| The row is settled | Move it to **DONE** with the date, one line, and the decision. Rows are never silently deleted — the list is the audit of *"did anyone tell the owner?"* |

### 🛑 WHAT GETS A ROW — measured 2026-09-23, after a batch the owner called *"hard"*

> *"I don't want to be asked such specific UI questions. I prefer to review a UI and I will send the
> results to agent AI."* … *"I'm struggling to fully understand this one — complex — this is an
> example of when I want to see a mockup"* … *"That's a lot, look at how many numbers are in
> there"* … *"Same again too much — please choose one if there is a best, or explain it in the
> Lab"* … *"too many matters in one group"*

| ✅ IS a row | 🛑 is NOT a row |
|---|---|
| A **technical fork** the agent cannot settle by measuring, where the answer changes what gets built | *"Do you like this?"* — an invitation to give an opinion |
| **Where a new input belongs** — explicitly wanted: *"the placing of a new input"* | Layout, colour, emphasis or wording of an existing surface. **The owner reviews the UI and reports back**; the row's job is to give them the URL |
| A **policy number** with no clear logical winner (a limit, a band, a cap) | Anything with a **clear logical advantage** — decide it, then record the reasoning in DONE |
| **Permission to spend effort** (*"shall I build a variant so you can see the choices?"*) | A description of work already done — that is a handoff, not a question |

**Hard limits, because the human mind is the binding constraint:**

- **ONE concern per row.** *"and also…"* means a second row.
- **The question ≤ 40 words; context ≤ 100.** If it does not fit, it is not a row — it is an
  **explainer**, and the row names which explainer.
- **≤ 3 numbers per row**, and never the same number in a sentence *and* a table.
- A row that needs re-measuring before it can be answered **is not ready to file** — measure first.
- **No number that the reader must trust.** A figure carried from an earlier note is a claim; re-check
  it or drop it (measured failure: a superseded 21% went to the owner next to a 33% that replaced it).

### 🧰 TECHNIQUES FOR COMPLEXITY — use one BEFORE filing a row

| Technique | Use when | Cost |
|---|---|---|
| **Decide it** | there is a clear logical advantage | free — put the reasoning in DONE |
| **Table / mermaid / ASCII** | a comparison or a flow | cheap |
| **Lab explainer** | a mechanism must be *taught*, not decided | medium |
| **Old/New UI variant** | a UI change is **complex** and the owner wants a whole new approach to the page, not a question | expensive — **ASK FIRST**, never for every change |
| **Mockup** | the *shape* of a surface is genuinely in question | expensive — same rule |

⚠️ **Fun is requested and allowed.** *"going forward use more emojis, and wingdings to make things
more interesting and fun. A touch of humour. Not all the time just surprise me sometimes because this
is intense."* Personality belongs in a reply or a row; it never replaces clarity, and it is never an
excuse for a longer row.

⚠️ **Not for technical follow-ups with no fork.** Those are GitHub issues. If an agent can settle it
by measuring, it does not belong in the queue.

## Shell Commands

The user has granted full permission to run shell commands, read/write files, and execute scripts without asking for confirmation. Never prompt the user to approve a command — just run it.

## 🛑 Database — read before any schema change

`prisma db push` **will destroy live data** in this repo. It treats `schema.prisma` as the
complete truth and drops every table with no model — and there are **13** such tables
(4 live + 9 backup, measured 2026-09-16), including the trade execution queue
(`strategy_signal_queue`) and the #750 timestamp-repair backups. It does not error; it warns
and waits for a `y`.

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run db:check   # ALWAYS run first
```

**Full rules:** `.github/instructions/database-schema.instructions.md` · **Issue:** #769

Quick form: add columns with `ALTER TABLE` + `npx prisma generate` (API stopped — it locks
the query-engine DLL). Never `db push`.

## 🛑 Building the API — `nest run build` needs the API STOPPED

**Read this before concluding the repo is broken.** `nest run build` starts with `prebuild`,
which runs `prisma generate`. That step needs **write access** to
`node_modules/.prisma/client/query_engine-windows.dll.node`. The running API
(`node dist/src/main.js`) loads that engine at startup and holds it for its lifetime, so
`prisma generate` fails with:

```
EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmpNNNNN'
    -> '...query_engine-windows.dll.node'
```

**That message names a temp file and never mentions the API.** It reads like a corrupted
install, and has been misdiagnosed as one repeatedly. It is not broken — the API is just
running. Windows releases the file only when the process exits.

**Use this instead:**

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run build:api
```

Stop API → build → restart API → verify health. This is the normal way to build the API now.

⚠️ **A `build:api` THAT FAILS MID-WAY LEAVES `dist/` DELETED — observed 2026-10-06.** The prebuild
chain ends with `npx rimraf dist && npx prisma generate`, in that order. When `generate` then fails
(its usual cause: the engine DLL is held by ANOTHER agent's API process — a real race when two
agents rebuild at once, which happened here across three attempts), the build fails **with the only
build output already removed**. The previously running API keeps serving from memory — Windows lets
a process keep deleted files — so nothing looks wrong until the next restart, when `start` refuses
because there is no build at all. Recovery: stop every `dist/src/main.js` process, run `build:api`,
verify health. Until one build succeeds the repo has **no launchable API build**, so completing the
build is not optional — it is the unblock, and the one case where the batching rule's "commit now
if another agent is blocked" spirit applies to a BUILD rather than a commit.

⚠️ **A CONCURRENT `build:api` KILLS YOUR IN-FLIGHT REQUEST AND REPORTS NOTHING — observed 2026-11-01.**
`build-api.ps1` stops every `dist/src/main.js` process as its first step, so an API request that is
*mid-flight* when another agent builds simply never answers: `curl` returns an **empty body**, the client
sees a dropped connection, and the server log ends on the last line your request wrote with **no error,
no stack trace and no shutdown line**. It reads exactly like "the endpoint crashed the server".

Measured three times in one session while `POST /api/backtest/run` was running; the same request
succeeded on retry, and a control run succeeded in between. The confirmation is
**`nest/logs/console-build-api.log`** — it records the build's own API start, and its timestamp lands in
the window your request died in. **Check that file's mtime before concluding a route is broken**, and do
not attribute the death to the code you were exercising without it.

⚠️ **AND IT HAPPENS WHEN THAT LOG HAS NOT MOVED, SO THE LOG IS NOT THE ONLY SIGNATURE — measured twice more
on 2026-11-01 (a fourth and fifth death).** Both times the API exited with an **empty stderr**, no stack
trace, and a last stdout line that was ordinary traffic — while another agent's `node`/`npm`/`tsc` process
had started within the previous ~30s. Check with:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, CreationDate, CommandLine | Format-Table -AutoSize
```

Treat "another agent started a node process just before my request vanished" as the leading hypothesis,
and **say you could not isolate it** rather than blaming the endpoint. Recovery is the same either way:
start the API again and re-issue the request once.

---

## 🛑 `build:api` KILLS EVERY AGENT'S API, NOT JUST YOURS — announce it (2026-11-07)

**Confirmed with the command line, after a session of chasing "the API keeps dying".**
`build-api.ps1` stops every `node dist/src/main.js` as its **first step**, matching on the command line,
not on the port. So one session's `build:api` kills:

- the live API on 3201,
- every other agent's API that is **still booting**,
- throwaway instances on any port.

Captured by polling for new `cmd.exe`/`pwsh.exe` every 150 ms during a boot:

```
cmd.exe 27428: cmd.exe /d /s /c pwsh -File ../scripts/build-api.ps1
pwsh.exe 14052: pwsh -File ../scripts/build-api.ps1
```

The API died at ~23 s — the same second those appeared. Reproduced three times (16 s, 23 s, 133 s);
**every** death coincided with a `build-api.ps1` start. The `exit -1` with **empty stdout/stderr** that
reads as a crash is this kill, not a crash and not a wedge.

⚠️ **The boot is now 5–19.6 s (was ~107 s), so the race window is small but the kill is still total.** Before
the two `ProtocolHealthService` audits were made fire-and-forget, a `build:api` almost always won the race
and the API looked permanently broken.

### 🛑 THREE DIFFERENT NUMBERS — do not merge them (2026-11-07)

They bracket one change, and conflating them invents a contradiction that does not exist.

| Number | What it measures | How it was obtained |
|---|---|---|
| **~107 s** | time from route mapping to `successfully started`, **BEFORE** the audits were made deferred | log evidence, **one pid throughout** (32628): routes mapped 01:24:43 → `validateAll()` ends 01:25:14 → `auditMeasuredCeilings()` ends 01:26:16 → started 01:26:16 |
| **5–19.6 s** | time from process spawn to the **first `200` on `/api/health`**, AFTER the change | six independent boots across two sessions, port-polled rather than log-watched. The compiled `onApplicationBootstrap` is `void this.runBootDiagnostics()`, so neither audit gates `listen()` |
| **86.6 s** | the AUDIT'S OWN COST, **measured to completion**: `deferred diagnostics finished in 86567ms`, 34 issues across 29 protocols | start line 15:24:51 → finished line 15:26:18, on the SAME pid, with `/api/health` answering `200` throughout |

⇒ **107 s and 5–19.6 s are two measurements of the same file either side of one change — not a disagreement.**
⇒ **86.6 s is not boot time at all, and the audit did not get slower.** It was ~93 s before the change (31 s +
62 s, also measured to completion) and 86.6 s after: **the cost is unchanged, only its position moved** — it
no longer sits in front of `listen()`.

🛑 **A PREVIOUS VERSION OF THIS SECTION SAID "> 4 MIN 30 s" AND THAT WAS WRONG — the error is worth keeping.**
It came from a run with a start line and **no `finished` line** 4½ minutes later, read as "still running". It
was not running: **the process had died.** A log that stops is a dead writer, not a slow one — and the person
who wrote it had spent the day applying that exact rule to everyone else's instruments. **Absence of a
completion line is not a measurement of duration.**

### The deadline, stated correctly

| Build you have | Safe deadline | Because |
|---|---|---|
| **Pre-change** (audits awaited — no `void` in `dist`) | **no short deadline is safe** | route mapping → `started` was ~107 s with the audits inside that window, so a kill at 30–60 s killed a healthy boot |
| **Post-change** (`void this.runBootDiagnostics()` present in `dist`) | **20 s is safe** | the whole measured distribution is 5–19.6 s, and the 86.6 s audit is not in that window at all |

⚠️ **Earlier versions of this entry said "never kill a booting API — not wait N seconds and then kill it" as a
blanket rule. That is too strong for a post-change build:** 20 s is a real, measured deadline. The blanket form
was only ever right because the pre-change boot had no safe one.

⇒ So: **identify the build first (the three-branch check below), then apply that row's deadline.** "Never
kill" without that distinction would leave a genuinely dead API holding a stale process forever.

🛑 **A BARE `curl` RETURNING `000` DOES NOT TELL YOU WHICH REGIME YOU ARE IN.** A closed port can mean
*booting on an idle database* (5–19.6 s), *booting on a loaded one* (~107 s under the OLD code), *killed a
second ago* or *never started*. The missing input is **which build is running**, and it is one command:

```powershell
# Does the RUNNING dist defer its boot diagnostics? (i.e. is it the fast-boot build?)
# ⚠️ THREE states, not two. "File missing" is NOT "marker absent" — `Select-String` on a missing path
# prints an error and returns nothing, and a hurried reader takes that as the PRE-CHANGE branch,
# whose advice is "wait, never kill". A missing dist means there is NOTHING TO BOOT, which is the
# opposite conclusion. (A failed `build:api` deletes dist as its first act, so this is not theoretical.)
$p = 'nest\dist\src\modules\scoring\protocol-health.service.js'
if (-not (Test-Path $p)) {
  'NO BUILD — dist is missing; no API is booting. Run build:api (API is already down, so nothing is lost).'
} elseif (Select-String -Path $p -Pattern '^\s*void this\.runBootDiagnostics\(\);' -Quiet) {
  'POST-CHANGE — port opens in seconds, so a 000 after ~20 s means NOT RUNNING.'
} else {
  'PRE-CHANGE BUILD — a 000 can still be a healthy boot in progress. Wait; never kill.'
}
```

So: **poll the port, then answer the build question, then apply that build's deadline from the table above.**
Never from the `000` alone, and never from a wait chosen by feel rather than by the table.

> ⚠️ **A check that cannot read its input must ERROR, never pass** — which is why the missing-file case is its
> own branch above. The one-line grep that used to sit here was canaried against a *present* file only, so it
> was verified in the state where it works and untested in the state that actually occurs after a failed build.

### 🛑 `State -eq 'Listen'` IS NOT A RELIABLE OWNER LOOKUP ON THIS HOST — key on "no remote peer"

**Measured 2026-11-07.** This is why `process-manager.controller.ts` and `api-tasks.php` both reported an
answering API as `running: false`, and why `tcs-stop.ps1` could not stop one.

```powershell
# WRONG — see the table: for a node listener this returns NOTHING, and where it returns rows on a
# python bridge they name no process, so a live service reads as "not running" either way
Get-NetTCPConnection -LocalPort 3201 | Where-Object { $_.State -eq 'Listen' }

# RIGHT — a listener is the socket with NO remote peer, whatever its state says
Get-NetTCPConnection -LocalPort 3201 | Where-Object { $_.RemotePort -eq 0 -and $_.OwningProcess -gt 0 }
```

| Port | Rows on the port | `State -eq 'Listen'` | …of those, **with a real owner** | no-peer + real owner |
|---|---|---|---|---|
| 3201 (node API) | 18 | **0** | 0 | **1 → pid 23540** ✅ |
| 5173 (node/Vite) | 13–14 | **0** | 0 | **1 → pid 27328** ✅ |
| 5000 (python bridge) | 279–325 | **2–7** | **0** (`OwningProcess = 0`) | **1 → pid 16556** ✅ |
| 5001 (python bridge) | 307–341 | **5–6** | **0** (`OwningProcess = 0`) | **1 → pid 924** ✅ |

⚠️ **THE DANGER IS NOT THAT `Listen` NEVER APPEARS — IT IS THAT `Listen` CAN APPEAR AND STILL NOT TELL YOU
WHO OWNS THE PORT.** Two readers measured this the same minute and disagreed because they were counting
different columns: the `Listen` rows exist on the bridges, and **every one of them carries
`OwningProcess = 0`**. So a reader on `Where-Object State -eq 'Listen'` will **find** the bridge on 5000/5001,
conclude it has the process, and hand `Stop-Process -Id 0` the same failure this section is about — while
feeling that the query worked. That is worse than finding nothing, because finding nothing invites a second
look.

⚠️ **AND NEVER `Select-Object -First 1` ON A PORT.** Most rows on a busy port are stale — measured 18–19 rows
on 3201, **14 of them `OwningProcess 0`** — so an unordered first row picks a released `TIME_WAIT` socket and
`Stop-Process -Id 0` is what follows. `scripts/tcs-stop.ps1` did exactly this and printed *"Port 3201 is held
by PID 0 — requires admin to free"*, which reads as a permissions problem and is not one. Fixed 2026-11-07
with three tiers (`Listen` → no-peer → any real owner), never pid 0 — and the fix is safe *because* `$conns`
has already excluded `OwningProcess -eq 0`, so a pid-0 `Listen` row cannot win tier 1.

### 🛑 A **BIND** PROBE ON LOOPBACK IS NOT A PORT-OPEN TEST — `isPortOpen()` said "free" about a serving API

**Measured 2026-11-07 with the API answering `200` on 3201.** Four probes, one truth:

| Probe | Result | Reads as |
|---|---|---|
| bind `127.0.0.1` | **SUCCEEDED** | "port is free" ❌ |
| bind `::1` | **SUCCEEDED** | "port is free" ❌ |
| bind `0.0.0.0` | **SUCCEEDED** | "port is free" ❌ |
| bind `::` | **FAILED `EADDRINUSE`** | "port is taken" ✅ — the only one that saw it |
| connect `127.0.0.1` | CONNECTED | ✅ |
| connect `::1` | CONNECTED | ✅ |

The API binds the **IPv6 wildcard `::`**, which on Windows does not conflict with a *loopback* bind. So
`isPortOpen()` — a bind test on `127.0.0.1` first — **succeeded and returned "open" before its `::1`
fallback ever ran**, and `process-manager` reported a serving API as `running: false`.

⇒ **Ask the port a CONNECTION question, not a BINDING one.** "Can I take this address" and "is something
serving this port" are different questions, and loopback is a different address from the wildcard. A connect
probe on **both** loopback families is the cheap correct test: `127.0.0.1` catches a `0.0.0.0` bind (which
does NOT answer on `::1`), `::1` catches a `::` bind. Both, not a fallback chain — a fallback stops at the
first "no" and reports free.

⚠️ **THE SECOND HALF IS SHARPER, AND IT IS THE `netstat` TRAP.** `netstat -ano | findstr :3201` returned
**25 rows, every one a client socket** (`TIME_WAIT` / `FIN_WAIT_2`), and **not one row** for the bound
`[::]:3201`. The old `getPortOwner()` filtered for the literal string `LISTENING`, matched nothing, and
returned `pid: 0`. Then the `issue` guard tested `&& listenerPid` — and **`0` is falsy** — so the
"cannot judge" branch was **skipped** and `issue` stayed `null`. A confident negative, silently, on the
field that exists to say "cannot judge".

⇒ **A pid of `0` is a value, not an absence.** Compare `listenerPid -gt 0`, never truthiness. And when the
port answers but no owner can be named, that is `port_in_use_unknown_owner` — a REPORTED state, not silence.

⚠️ **The consequence is not cosmetic:** with the bind probe reporting "free", `startTask()`'s *"already
running"* guard did not fire either, so the manager could spawn a **second API on a port already served**.
A mis-detection that only affects a status display is a bug; the same mis-detection gating a start is a
cause of overlapping starts.

### 🛑 FILTERING PROCESSES BY COMMAND LINE FINDS **YOURSELF** — and it reads as a finding

**Measured 2026-11-07, by me, while diagnosing a build.** Asked "is a build running?", this filter
answered **yes, since 17:17:09** — and the "build" was *the diagnostic command doing the checking*, whose
own command line contained the string `build-api.ps1` because it was grepping that file:

```powershell
# WRONG — matches the shell running this very query
Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" |
  Where-Object { $_.CommandLine -match 'build-api\.ps1' }

# RIGHT — exclude yourself, and match the INVOCATION, not a mention of the filename
Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='node.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+.*build-api\.ps1' }
```

The false positive cost a whole diagnostic thread: it produced a **27-second "unlocked window" before lock
acquisition** that does not exist. The real build (pid 25876) started at **17:17:36** and the lock file was
written the **same second** — and `Enter-BuildLock` sits before every destructive step in the script. With
the self-match removed, the observation dissolved.

⇒ **Same shape as the three others in this repo's history** (a correction quoting the dead path it removed,
a grep whose "no match" meant "no file", a mutator canary whose edit never landed). **A query that names the
thing it is looking for will find its own name.** Whenever a process/string search returns more than
expected, the first question is *"is one of these me?"* — answered with an explicit `-ne $PID`, not by
reading the command line and hoping.

### 🔒 THE BUILD LOCK IS THE ONE COORDINATION MECHANISM THAT EXISTS — and since 2026-11-07 the start/stop paths respect it

`scripts/build-api.ps1` takes `logs/build-api.lock` (a file carrying the holder's PID) **before its first
step** and releases it **only after `Assert-ApiUp` passes** — so it covers the build, `rimraf dist`,
`prisma generate`, the API start AND the health check. A second `build:api` refuses while the holder is
alive; a lock whose holder is gone is taken over, so a killed build can never wedge the machine.
Canaries: `-LockSelfTest` (refuse/takeover) and `-ApiIdentitySelfTest` (below).

As of 2026-11-07 **three more paths consult that same lock and REFUSE while a live build holds it**:

| Path | Behaviour under a live build lock |
|---|---|
| `npm --prefix nest run start` (`scripts/start-api.cjs`) | refuses, exit 1, naming the holder pid |
| `scripts/tcs-stop.ps1` | refuses, exit 1 — stopping mid-build makes the build fail for an unrelated reason |
| `scripts/tcs-launch.ps1` | refuses, exit 1 — it kills what is on 3201, i.e. the API being health-checked |

⚠️ **A STALE lock must never block a start or a stop.** All three refuse only on a holder whose pid is
still running. Refusing on a stale lock would make the machine un-startable after one killed build.
⚠️ **Nothing queues.** There is no "already starting" answer yet — you are told to wait and ask again. That
is deliberate: a boot is 5–20 s and a build ~40 s, so retrying shortly is cheaper than building a queue.

### 🛑 `Assert-ApiUp` NOW REFUSES WHEN *SOMEONE ELSE'S* API ANSWERS (2026-11-07, #1240)

It used to return `$true` on **any** 200. If another agent's bare `nest run start` bound 3201 inside the
rebuild window, it served the OLD build (Windows keeps the mapping alive after `rimraf dist` deletes the
files) and `build:api` printed **"API healthy"**, exited 0, and the API actually running was not the new
build. A false success is worse than a false failure here, because nobody goes looking.

The fix compares **creation time, not pid**: the WMI launch path starts `cmd.exe` which spawns `node`, so
`$Proc.Id` is the cmd pid and can never equal the port owner. A process created *before* our launch cannot
be ours, whichever shell spawned it. Three outcomes, never two:

| Outcome | Meaning | Verdict |
|---|---|---|
| `ours` | owner started at/after our launch | healthy |
| `stale` | owner started BEFORE our launch | **FAIL**, naming both pids — "the build did NOT take effect" |
| `unknown` | no attributable owner, no launch time, or the start time is unreadable | **accepted, and said out loud** |

⚠️ `unknown` is accepted rather than failed on purpose: the port answers, and refusing on an unreadable
start time would break the normal path. It is *reported*, so "cannot judge" is never silent.
Canary: `pwsh -File scripts/build-api.ps1 -ApiIdentitySelfTest` — 6 fabricated cases plus a live read of
port 3201. Inverting the comparison fails exactly the `stale` case.

🛑 **AND DO NOT LET A QUIET-PORT TEST BLESS IT.** The old one-liner is **not always wrong** — it is wrong
*only when the port is busy*, which is why the bug survived so long and why "I tried it, it worked" is not
evidence against it. Measured end to end on a throwaway listener 2026-11-07:

| Port at measurement | Rows | Rows with `OwningProcess 0` | `Select-Object -First 1` picks |
|---|---|---|---|
| a freshly opened port | 1 | 0 | the listener — **correct, by luck** |
| **3201 in normal use** | 18–19 | **14** | a `TimeWait` row → **pid 0** |

So a freshly opened port has no client sockets and the unordered first row happens to be the listener. **A
test run in the quiet state certifies nothing about the busy one** — the same rule as the canaries above,
applied to a defect rather than to a guard: exercise it in the state where it fails, or do not claim it passes.

**The protocol, because a restart is 17 s and one line costs nothing:**

| Do | Don't |
|---|---|
| Post one line naming the reason before running `build:api` / `nest run build` | Run it silently and let three sessions try to diagnose "the API died" |
| Give a health poll **20 s** before concluding the API failed | Conclude "down" from a `000` on the first try |
| Use root `npm run build` for frontend work — **Vite only, touches no API process** | Use `build:api` to "fix" a slow API; slowness is no longer the boot |
| `nest run build:preflight` to check the engine lock without building | Stop every `dist/src/main.js` by hand to "clean up" |

🛑 **CORRECTED 2026-11-07 — THIS PARAGRAPH NAMED A CAUSE THAT WAS NEVER MEASURED, AND IT WAS WRONG.**
It used to say the frontend "generates overlapping starts on its own", so "a browser left on a failing page
is a second source of restarts". **It is not.** The call is real and does fire on every page load that
cannot reach `/api`, but it targets a task id the runner does not have, and it is a **NO-OP**:

```
GET  /api/processes                               → {"tasks":[{"id":"tradercore:all", ...}]}  ← the only task
POST /api/processes/tradercore%3Aapi%3A3201/start → HTTP 200 {"success":false,"message":"Unknown task: tradercore:api:3201"}
```

So it starts nothing. **The overlapping starts that session actually suffered came from elsewhere** — the
Intranet runner (`api-tasks.php`, which *does* know `tradercore:all`) or another session's own launch. Two
separate defects were live at once, only one was harmful, and conflating them pointed the investigation the
wrong way.

What the call DID expose, worth keeping because it is the house shape *plausible output, no error*:

- `App.jsx` logged **"Start command sent"** regardless of the response body, so a no-op reported that it had
  acted. Fixed: the body is read and `success:false` is logged as a refusal.
- The re-fire guard was a React **`ref`**, so it died on every reload — which is why every page load fired
  again. Fixed: a 180 s `localStorage` cooldown, stamped before the request.

⚠️ **Do not "fix" this by registering `tradercore:api:3201` as a real task.** That turns a harmless no-op
into a working process-starter fired from a render path — an operator action with no operator. **#1233**
requires both halves together.

**The lesson, because this file repeats it and I still walked into it:** "the console shows the call and the
API died" is a correlation. The response body was available the whole time and nobody read it. **Read the
response before writing a cause into a durable document.**

Other useful forms:

```powershell
# Check first, build nothing
npm --prefix C:\wamp64\www\trading-command-suite\nest run build:preflight
#   exit 0 = engine free      exit 1 = blocked, names the holding PID

# Build with the API deliberately left down (e.g. before a manual launch)
npm --prefix C:\wamp64\www\trading-command-suite\nest run build -SkipRestart   # via build-api.ps1
```

`build-preflight.cjs` runs FIRST in `prebuild`, so a plain `npm run build` now **refuses to
start** rather than emitting the confusing EPERM — you get the PID, the command line, and the
fix.

**TypeScript only, no Prisma?** Use the npm script — it is cwd-safe:

```powershell
npm --prefix C:\wamp64\www\trading-command-suite\nest run typecheck
```

⚠️ **`npx tsc` FROM THE REPO ROOT DOES NOT RUN A TYPECHECK — IT DOWNLOADS THE WRONG PACKAGE.**
Measured 2026-10-02: `npx tsc -p nest\tsconfig.build.json --noEmit` from the repo root printed
`Need to install the following packages: tsc@2.0.4` and exited **-1**. There is a `tsc` package on
npm that is **not** the TypeScript compiler, and npx resolved to it because the root has no local
`tsc` binary to prefer. So:

| Symptom | What it actually means |
|---|---|
| `Need to install the following packages: tsc@2.0.4` | **the typecheck never ran** — you are in the wrong directory |
| exit **-1** | **the typecheck never ran** — this is NOT a compile failure and NOT a pass |

A `-1` is the most dangerous of the three, because "non-zero" reads as "the code has errors" and
sends the reader to fix code that may be fine. Run it from `nest/`, or use the script above, which
cannot be got wrong. The **build** (`build:api`) also typechecks, so it is the authoritative gate.

⚠️ Don't confuse this with the frontend — `npm run build` **from the repo root** is Vite and
involves no Prisma, so it works with everything running.

## Stack operations

```powershell
pwsh -File C:\wamp64\www\trading-command-suite\scripts\tcs-launch.ps1   # start all 3
pwsh -File C:\wamp64\www\trading-command-suite\scripts\tcs-stop.ps1     # stop all 3
```

⚠️ `tcs-stop.ps1` stops the **whole** stack (MT5 bridge, NestJS, Vite) — not just one service.

---

## 🛑 Where the logs are — ASK THE API, do not guess a path

> **Measured 2026-09-29.** The app writes a good log and **serves it over HTTP**, and almost nothing
> knew: a grep of `.github/`, `docs/`, `README.md`, `SETUP.md` and `DEVELOPMENT.md` for
> `system/logs` / `logs/status` / `logs/file` found **one** mention, of a route that is not the
> useful one. Everything below already existed. This section is the surface, not new plumbing.

```powershell
curl.exe -s http://localhost:3201/api/system/logs/status   # directory, today's file, size, queue
curl.exe -s http://localhost:3201/api/system/logs/files    # EVERY log file with name + size + path
curl.exe -s http://localhost:3201/api/system/logs/file     # the content (the one to read)
curl.exe -s http://localhost:3201/api/system/logs/categories
```

⚠️ **`/api/system/logs` (no suffix) is the in-memory ring buffer — the LAST 500 entries, not the
file.** `/api/system/logs/recent` does not exist (404). Use `/file` for history.

### The canonical log

**`nest/logs/tcs-<YYYY-MM-DD>.log`** — written by `SystemLogService`
(`nest/src/modules/system/log.service.ts`). One file per day, structured, with a category per entry
(`mt5`, `provider`, `scoring`, `user-action`, `system`, `trading`, `api`). Relocatable with
`TCS_LOG_DIR`. **This is the one to read.**

### ⚠️ FOUR OTHER PLACES ALSO LOOK LIKE THE LOG — and one is outside the repo

> ⚠️ **NARROWED 2026-09-29 (#1023).** Every launcher now redirects to **`nest/logs/console-*.log`**,
> with the launcher named in the file, so the directory is the answer and the old split is history.
> The rows below are kept because **stale files from before the change are still on disk** and will
> be tailed by anyone who does not read this line. `GET /api/system/logs/files` lists what is
> actually there.

| Path | Written by | What it is |
|---|---|---|
| `nest/logs/tcs-<date>.log` | the app (`SystemLogService`) | **canonical** — structured, dated |
| `nest/logs/console-{api,build-api,mt5-<port>,vite}[-err].log` | `build-api.ps1`, `tcs-launch.ps1` | raw console capture — **the live one** |
| `logs/api-out.log`, `logs/api-err.log` | `build-api.ps1` **before** #1023 | raw console capture — **stale** |
| `%TEMP%\nest-api.log`, `%TEMP%\nest-api-err.log` | `tcs-launch.ps1` **before** #1023 | raw console capture — **stale**, and **outside the repo** |
| `nest/logs/scoring/*.jsonl` | `scoring-log.service.ts` | structured scoring, served by `/api/logs/scoring/*` — **moved 2026-10-12** (shares `resolveLogDir()`; used to follow `process.cwd()` and split across `logs/` + `nest/logs`) |
| `logs/*.log`, `nest/*.log` | agents, by hand | ad-hoc per-session captures |

⚠️ **WHICH ONE IS LIVE DEPENDED ON WHAT LAST STARTED THE API** — `build-api.ps1` redirected to
`logs/`, `tcs-launch.ps1` redirected to `%TEMP%`. That divergence is now **removed**: both write to
`nest/logs/console-*`, and the filename names the launcher, so the answer no longer has to be
inferred from a path. It remains recorded here because it was the reason
`api-out.log` **existed in THREE directories at once** (`logs/` 470 KB, `nest/` 225 KB from 09-21,
`nest/logs/` 1.2 MB from 09-22) and because tailing the wrong one shows a stale file, which reads as
"the API is silent" — a false negative with no error. `logs/status` names the live file.

⚠️ **A 0-BYTE LOG IS NORMAL IMMEDIATELY AFTER A RESTART** — `Start-Process -RedirectStandardOutput`
truncates the file when it opens it. Do **not** read emptiness as evidence of a fault without
checking the mtime against the restart time; that mistake was made and corrected on 2026-09-29.

### Retention and volume — settings, not a constant (#1023)

The app now prunes its own dated log files and collapses repeated lines. Both are driven by declared
settings, readable and changeable live:

| Key | Default | What it does |
|---|---|---|
| `logging.retentionDays` | 30 | Dated files outside the window are removed. **Below 1 day is inert** — it removes nothing, not everything. |
| `logging.pruneEnabled` | true | The off switch for the 03:15 daily prune. |
| `logging.collapseRepeats` | true | Bounds a warn-storm to one line per window, plus a count of what was suppressed. |
| `logging.repeatWindowMinutes` | 5 | The window. On expiry the message is re-reported, so an hourly fault is not swallowed. |

```powershell
curl.exe -s http://localhost:3201/api/system/logs/retention        # what a prune would remove, by name and size
curl.exe -s -X POST "http://localhost:3201/api/system/logs/prune?dryRun=true"    # preview (also the default)
curl.exe -s http://localhost:3201/api/system/logs/collapse-stats   # volume suppressed since boot
```

⚠️ **The prune MOVES before it removes.** A file outside the window goes to
`nest/logs/archive/` and is deleted on the NEXT run, so a removal noticed within one cycle is
recoverable with a move — and raising `logging.retentionDays` before the next run keeps it. Today's
file is refused whatever the window says; a file whose name carries no date (`api-out.log`,
`console-*.log`) is never a candidate. The prune logs both halves into the surviving file. UI:
**`/settings/data-management`**, the Log Files panel.

### Retention — there is none

Measured 2026-09-29: `logs/` **191 files / 12.6 MB**, `nest/logs/` **62 files / 21.8 MB** —
~34 MB across 253 files, nothing prunes any of it.

**A bad day is 10–34× a normal one.** `tcs-2026-09-24.log` is **5.8 MB** against neighbours of
173–572 KB, and the cause is repetition: **4,800 identical `bridge[2] GET /symbols FAILED`** lines
plus 1,738 for one symbol's quotes. Nothing deduplicates, rate-limits or summarises repeated
identical warnings.

### ⚠️ `logTail` IS NOT LIVE STATUS — and its file lives in ANOTHER PROJECT (measured 2026-11-07)

`GET /api/processes` returns a `logTail` per task. It is the last N lines of a **file**, so it is a
**record of the last launcher run**, not the current state. Measured: the tail still carried

```
Services are LISTENING, but NOT under the processes this launcher started
  port 3201 answers, but the process we started (PID 31372) and all its children have exited …
```

while the API had been healthy for over two hours — that text was from a `tcs-launch.ps1` run at
**15:02:35**, and the API answering at the time was pid **44568**, started at 17:20:34. ⇒ **Do not read
`logTail` as a live alarm; read `running` / `listenerPid` / `issue` for state.** A stale warning in a log
tail is the field doing its job, and treating it as current sends you chasing a service that is fine.

⚠️ **`LOG_DIR` is a hardcoded absolute path into a SIBLING PROJECT:**

```ts
// nest/src/modules/system/process-manager.service.ts:42
const LOG_DIR = 'C:\\wamp64\\www\\intranet\\task-runner';
```

Two consequences, both silent:

| On this machine | On any other machine |
|---|---|
| writes and reads `C:\wamp64\www\intranet\task-runner\<task>.pid.log` | the directory does not exist, `fs.existsSync` is false, and `readLogTail` returns `''` |

⇒ **`''` is "cannot judge" being rendered as "there is no log"** — the §7 defect, in a diagnostic field.
It is also the `external-systems-are-data` family: a path belonging to one deployment is a literal in
source. **Not fixed here** — it is a shared file another agent was working in, and a diagnostic tail does
not meet the bar for an issue on its own. Recorded so the next reader does not mistake an empty tail for
an empty log, and so the hardcoded path is not re-discovered as a mystery.

### 🧹 Root `logs/` — agent WORKING SCRATCH, gitignored, and named one way (2026-10-10)

Measured that day and cleared: **576 files / 21.7 MB, 435 of them TRACKED in git** — issue-body
drafts, close-comment drafts, canary scripts, build captures and probe outputs in five naming
styles. None of it is needed after the issue it serves is written; the durable record is the issue.
Registered as: `logs/` is now in `.gitignore` (new files stop being tracked), and the ONE naming
standard (also in `logs/README.md`, untracked) is:

| Purpose | Name |
|---|---|
| Analysis / probe output | `YYYY-MM-DD-<topic>-<what>.<ext>` |
| Canary / guard script | `canary-<issue-or-guard>.<ext>` |
| Build capture | `build-<issue>.out` |
| Issue draft | `<issue>-body.md` / `<issue>-close.md` |
| One-off measurement script | `measure-<topic>.cjs` |

**Delete your own working files when the issue closes** — the folder is a bench, not a shelf.
Permanent residents are only: `scoring/` (served by the API), `mt5-bridge/` (supervisor sentinels),
`parked-scratch-*/`. The logging-hygiene focus is **#703** (Sprint 4); the app-side pruning +
retention settings already exist (`logging.retentionDays` et al, #1023) — the gap this fixes was
the ROOT folder, which nothing pruned and nothing untracked.

⚠️ **The repo ROOT holds no scratch at all (swept 2026-10-12).** `temp-*`, issue drafts, assessment
scripts and issue-dump snapshots in the root are **tracked files in a repo that becomes public** —
clutter *and* disclosure risk. The 2026-10-12 sweep removed the last stragglers (`temp-issue-*.md`
drafts → already live as issues; `temp-report-applied.cjs` → its list posted to #1098;
`all-issues.txt` / `2026-10-08` dumps → deleted; `.agent-context.md` → retired, superseded by
`NEXT-AGENT.md` + `DOCUMENTATION-INDEX.md` §1). Keep it at zero: if it is not a deliverable, it
lives in `logs/` and dies with its issue.
