# Engineering standards

Read this before changing code in this repository. It is the subset of our internal engineering
handbook that every contributor needs; the full handbook lives with the project documentation rather
than here, because this repository is the product and the handbook is process.

These rules are not style preferences. Each one exists because something broke without an error —
a number that looked normal, a guard that never ran, a page that rendered nothing. **Silent failure
is the failure mode this project designs against.**

---

## 1 · Evidence over assertion

The running system is the only source of truth. A diff, a build, a test name and a ticket are all
*claims about* it.

- Name the command and its output behind every claim. "Should work" and "looks correct" are not results.
- Do not attribute a fix you did not isolate. If two things changed and the symptom went away, say
  so — a correlation is not a cause.
- When a validator cannot read its input it must **error**, never pass.

## 2 · The database is not `schema.prisma`

`schema.prisma` is documentation here, not the schema. Several tables are managed outside Prisma.

- ⛔ **Never run `prisma db push`.** It drops every table that has no model — including live data.
  It does not error; it warns and waits for a `y`.
- Create or change tables with `ALTER TABLE` / explicit `CREATE TABLE`, then `npx prisma generate`
  for types only.
- Run `npm --prefix nest run db:check` first — it is read-only and names any drift.

## 3 · Building the API

Use `npm --prefix nest run build:api`. It stops the API, builds, restarts and verifies.

A plain `nest run build` fails while the API is running, with `EPERM … query_engine-windows.dll.node`
— which reads like a corrupted install and is not one. The engine file is held open by the running
process.

## 4 · One source of truth for every fact

If a calculation, a constant or a lookup already exists, use it. Two copies drift and only one gets
the next fix.

- Shared utilities live in `src/core/` and `nest/src/common/`. Check before writing a new one.
- A derived number must not hide the data it came from. Print the raw value beside it.

## 5 · A guard that has never failed is a decoration

Every guard must be observed to fail:

1. break the thing it protects, confirm it fails;
2. restore, confirm it passes;
3. for a mutator canary, assert the edit actually landed — a substitution that matched nothing
   reports a pass.

## 6 · Numbers that affect a trading decision are copied, never edited in place

Scoring weights, thresholds, gates, sizing, risk multipliers and bands are changed by creating a
**copy** (a second strategy, protocol version or bot) and comparing the two. The incumbent is not
deleted until the comparison reports.

A bug fix that restores an intended value is not covered by this rule — say so explicitly and cite
the intent.

## 7 · External systems are data

Brokers, accounts, bridges, hosts, ports, symbol mappings and credentials are **records discovered at
runtime**, never literals in code and never per-user values in an environment file.

The test: *if a second user registered tomorrow with different accounts, would this line still be
correct?* If not, it belongs in the database with a lifecycle, not in the source.

## 8 · Settled decisions are recorded, and re-opening one is deliberate

`docs/SETTLED-DECISIONS.md` is the register of decisions that have been settled, each with its guard
status. Check it before changing an area that has been decided. If you believe a decision is wrong,
say what changed that invalidates it — do not quietly replace it.

## 9 · Working material belongs with the documentation, not in the repository

Audits, measurements, session notes, handoffs and prompt output are working material. The durable
record of a finding is a **GitHub issue**; the report that produced it lives with the project
documentation.

Before adding a file, ask: *would a maintainer who has never met this project be surprised to find
this here?* If yes, it belongs elsewhere.

---

## Where the full handbook lives

The complete set — environment traps, pipeline invariants, UI and accessibility policy, database
discipline, decision authority — is maintained with the project documentation outside this
repository. This file is the part that applies to anyone reading the code.

```
…\Trading-Command-Suite-Documentation\agent-ops\
    instructions\      the rule corpus (19 files) — read before structural work
    agents\            agent definitions
    skills\            reusable procedures
    AGENT-ATTENTION.md      current traps and standing directions
    PRIMARY-GOALS.md · REVIEW-QUEUE.md · NEXT-AGENT.md
    archive\ · issue-cache\
```

Those files are deliberately **not** in this repository: the product repo shows engineering
standards, not the process that produced them. Resolve them through
`scripts/lib/agent-paths.cjs` rather than hard-coding a path — it checks the docs store, falls back to
the old in-repo location for older commits, and returns `null` when neither is present.

⚠️ When the docs store is not mounted, anything that depends on it must report **SKIPPED**, never
pass. A check that cannot read its input has not checked anything.
