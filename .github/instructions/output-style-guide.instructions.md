---
description: "Reply formatting for Trading Command Suite — brevity budget, scannable blocks, pros/cons and input/output tables, and a cost-ordered list of visuals. Read before writing any reply to the owner."
applyTo: "**"
---

# Output Style Guide — Trading Command Suite agent replies

> **This file is a MIRROR.** The portable source is the owner's VS Code prompt file:
>
> ```
> %APPDATA%\Code\User\prompts\output-style-guide.instructions.md
> ```
>
> That file is **versioned nowhere** — it is untracked in the home repo and sits outside this repo —
> so a reinstall or a fresh clone would lose the whole thing. This copy exists so the rules survive
> with the repository. The owner asked for it directly: *"mirror it then."*
>
> Everything between the markers below is copied **verbatim** from the source.
>
> | Task | Command |
> |---|---|
> | Check for drift | `node scripts/validate-output-style-sync.cjs` |
> | Repair drift from the source | `node scripts/validate-output-style-sync.cjs --sync` |
>
> ⚠️ Two copies of the same rules is the technical debt this repo warns about most often. The sync
> check is the guard. It is **on demand, not in `prebuild`** — a prose-style divergence should not
> fail the build for a change that has nothing to do with reply formatting, and a gate that fires
> for unrelated reasons gets allowlisted. Run it after editing either copy.
>
> ⚠️ The markers are the mechanism, not decoration. Everything between `MIRROR:BEGIN` and
> `MIRROR:END` must equal the source byte-for-byte. Without them the check could not tell the
> mirrored rules from this explanatory header.

> ⚠️ **Measured 2026-10-12 — the declared source is GONE on this machine.** The path above does
> not exist: `%APPDATA%\Code\User\prompts\` contains no files, so
> `validate-output-style-sync.cjs` exits **2 (UNVERIFIED)** and **cannot pass here**. Two
> machine-local summaries still point at that missing path — `output-style-guide.md` (1.2 KB) and
> `output-style-tcs.md` (1.3 KB) under `…\globalStorage\github.copilot-chat\memory-tool\memories\`
> — so **this file is now the only full copy of these rules.** Nothing decides whether that makes
> this file canonical; recorded as **REVIEW-QUEUE R56**.
>
> ⚠️ **A second, machine-local style rule asks for something different.** `communication-style.md`
> (same memories directory, updated 2026-10-01) reads: *"Prefer emojis and bullet lists over
> symbol-dense tables"* and *"Avoid monochrome glyph furniture: `->`, `*`, `|`…"*. That is a
> different default from this file's **"tables over prose"**, and **the repo holds no trace of it.**
> Same row, **R56**.
>
> ⚠️ The paragraph below says this check is *"on demand, not in `prebuild`"*. **It is in `prebuild`** —
> `nest/package.json` runs `validate-output-style-sync.cjs --report`. The `--report` flag is what
> keeps it non-fatal.

<!-- MIRROR:BEGIN -->

---
description: "Reply formatting for Trading Command Suite — brevity budget, scannable blocks, pros/cons and input/output tables, and a cost-ordered list of visuals. Read before writing any reply to the owner."
applyTo: "**"
---

# Output Style Guide — Trading Command Suite agent replies

Use this guide when replying to the user. The goal: **keywords, key steps, and key
benefits stand out**. Minimise dense paragraphs. Prefer tables, short bullets,
and a clear visual hierarchy.

## Core rules
- Lead with a status keyword (✅ / 🛑 / 🚧 / 🎯 / 👉) so intent is scannable in 1s.
- Use tables over prose for multi-item comparisons.
- One idea per bullet. Keep bullets under ~12 words where possible.
- End with a single, explicit "next action" ask.
- **Always state the data source** for any fact: which table / API / broker /
  provider / file the numbers came from, plus a timestamp when relevant.
- If uncertain about a number's origin, say so instead of implying it's from the
  canonical source.

## Reusable blocks (pick per task type)

### 1. Status / health report
Sections in order:
`✅ Live` → `🛑 Blockers` → `🚧 Data gaps` → `🎯 Options` → `👉 one-line ask`
Each table: Item | Status | Why/Note. Add a **Data source** line under tables.

### 2. Findings / investigation result
Start with a one-line verdict, then:
`Evidence` (file:line / endpoint / table) → `Root cause` → `Impact` → `Fix options (priority order)`.

### 3. Decision / options for the user
Options as a compact table: Option | Steps | Benefit | Safety/Effort.
Mark the recommendation with 🟢. Ask A/B/both.

### 4. Code-change summary (after implementing)
Sections: `Changed` (file list) → `What` (1-2 lines each) → `Verified` (tests/build/
live output) → `Side effects / notes`.

### 5. Decision with pros and cons
Owner request 2026-09-23: *"The pros and cons of decisions listed."*
One row per option. **Every option names what it costs**, not only what it gains.

| Option | Pros | Cons | Effort |
|---|---|---|---|
| 🟢 A | … | … | … |

⚠️ An option with no listed con is not a real option — name its cost or drop it.

### 6. Input / Output contract
Owner request 2026-09-23: *"the input and output listed, when I need to be made to understand a
matter."* Use this to explain a mechanism — never prose.

| | |
|---|---|
| **Input** | what it reads, from where, in what unit |
| **Output** | what it writes, where, in what unit |
| **Transform** | one line: how input becomes output |
| **Fails when** | the observable symptom |

## Data-source annotation
When you cite a number or state, add provenance inline, e.g.:
- `(broker bridge :5000, 2026-09-09 21:02Z)`
- `(score_snapshot table, snappedAt 2026-09-09 20:47Z)`
- `(/api/portfolio/summary, 2026-09-08)`
- `(nest/.env MT5_ACTIVE_BROKERS=2,3)`

## Brevity budget — the default, not a preference

> Owner, 2026-09-23: *"I need things to be straight to the point... The amount of text and
> sentences has been intense."*

**A reply is a report, not a narrative.** If the reader wants the reasoning, it is in the issue.

| Rule | Cap |
|---|---|
| Reply length | **One screen** where the answer allows it |
| Prose lead-in | 1–2 lines, then a table |
| Prose between blocks | **One sentence maximum** |
| Headings | Skip on short replies — each one costs a line |
| Repetition | No block that restates another block |

### The cut list — delete on sight

| Cut | Because |
|---|---|
| "Let me explain why…" / "For context…" | The table *is* the context |
| Restating the question | The reader wrote it |
| A number in a sentence **and** a table | Pick one |
| Narrating what you are about to do | Do it, then report |
| A summary section after a set of tables | The tables were the summary |
| Caveats about dev-induced disruption | In dev mode, not news |
| Narrating the commit, or echoing `git log` / `git status` | The owner commits manually 2–3× a day — the commit is not yours to report |

- Prefer a **"Key numbers" strip** at the top when the reply has hard metrics.
- Emoji are status markers, not decoration.

---

## Where the detail goes — the issue, not the reply

> Owner, 2026-09-23: *"the additional details stored in the github issues should I need more
> information or ask for it."*

| Content | Home |
|---|---|
| The decision, the key numbers, pros/cons, the next action | **The reply** |
| Reasoning, alternatives rejected, measurements, dead ends, code excerpts | **The GitHub issue** — body or closing comment |
| Durable "how it works" explanation | **The issue**; the Librarian folds it into the docs |

**Practically:** if a reply would need a third depth to be honest, that depth is an issue comment.
Write the comment first, then let the reply carry one line and a link.

---

## Visuals — cost-ordered, cheapest first

> Owner, 2026-09-23: *"Diagram/icon/picture approaches could help as well. But only if that
> doesn't cost a lot more tokens."*

| Visual | Token cost | Use for |
|---|---|---|
| **Status emoji** ✅🛑🚧🎯👉 | ~1 | Every reply — the 1-second scan |
| **Table** | cheap | Every comparison and every list |
| **`mermaid` block** | ~50–200 | Flow, order, a state machine, a boundary |
| **ASCII diagram** | ~30–150 | Same, where mermaid will not render |
| **Screenshot** | **very expensive** | Only when *appearance* is the question |

⚠️ A screenshot costs orders of magnitude more than a mermaid block for the same information.
Reach for mermaid or ASCII first; screenshot only when *how it looks* is the point.

---

## Large-reply layout — progressive depth (EXCEPTION — only to make a matter understood)

> Owner 2026-09-22. **Demoted 2026-09-23** from *"the primary shape for long replies"* to an
> **exception**. It runs ~30% longer than a flat reply, and the owner's feedback is that text
> volume has been intense. Use it when the reader must **understand a mechanism** — not for a
> status report, not for "here's what I did", not for a list of facts.
>
> The failure mode it solves: a long reply where **every fact carries equal weight and the reader
> must read all of it to reach the one thing they came for.**

### The shape

```
🛑 <status keyword> <headline — one line, may carry the number>

> ### <one sentence that IS the answer>

<one or two lines: "if you read nothing else, here is the point">

---

### ⏱️ The 60-second version
<small table — max 4-5 rows — the numbers that changed>

<one line explaining the single cause behind all of them>

---

### 🔍 The detail — how I know, and what changed
<sub-sections, one per question the reader would actually ask>

<closing: what's left / what's blocked / the next action>
```

### The rules that matter

1. **Repeat the HEADLINE at three depths. Say the MECHANISM exactly once.**
   Depth 1 is a sentence. Depth 2 is a table. Depth 3 is the explanation. Never explain the
   mechanism twice, and never go past three depths — four reads as padding.
2. **Space is information.** A blank line before *and* after every heading and every table buys
   more readability than any formatting trick. Two dense blocks adjacent is the actual defect.
3. **One idea per visual block.** If a table cell needs a comma-spliced parenthesis, that content
   wants to be its own row.
4. **`---` between major movements.** Three movements or more, always dividers.
5. **A sentence must not carry two numbers that are compared.** Put them in a two-column row so
   the comparison is visible without arithmetic.
6. **Lead-in and lead-out stay short.** Headline, then one or two lines, then the detail.
7. **Answer the obvious next question in place** — "was anything deleted?", "did you restart it?"
   — as its own short block, not buried in a paragraph.

### Worked example (abbreviated)

**Before** — one flat paragraph, every fact equal weight:

> The 24 rows are a one-off MANUAL Trading 212 import (batch-written 2026-07-31 01:25, ms-apart
> timestamps; no scheduler calls the writer) — and critically, `portfolio.service` serves them as
> the cached fallback for the `source=trading212` portfolio view, by design. **Decision: KEEP
> them** — deleting would have broken a feature and possibly destroyed real holdings.

**After** — the same facts at the right depth:

> ### 99.4% of the "position P&L" you were shown was stale import data.
> Your P&L read **−£1,021.77**. It was really **−£6.65**.
>
> **If you read nothing else** — 24 frozen import rows were counted as live by every reader.
> Nothing was deleted; the fix went into the readers.

Then a 4-row table for the numbers, then "why the rows exist" and "what changed" as separate
short blocks. The decision (`KEEP`) moves to the top, because it is the thing the reader is
actually anxious about.

### What this costs, stated honestly

- Roughly **30% longer** than the flat version. That is the trade: length for readability.
- It only pays on replies with **one important fact and a lot of support**. A genuinely
  multi-fact reply wants the status-report block instead, not three depths.
- **Not available:** real layout control. Markdown only — no columns, no colour, no boxes.
  Tables are the only grid, and 5+ columns scroll badly on a narrow pane.
- `<details>` would allow true "detail on demand" in one message. It renders on GitHub;
  **unverified in the VS Code chat pane** — do not rely on it until someone confirms.

<!-- MIRROR:END -->
