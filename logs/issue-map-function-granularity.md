## The observation behind it

Owner, 2026-10-07, after finding the A/B order path bypassed the pipeline:

> *"This probably means agentic AI is not tackling issues by walking through the architecture. I'm hoping
> the new map (which I want to consume every function/class) makes a difference in this regard."*

**The pattern is measurable, not a feeling.** Three instances in one working session:

| Instance | What was missed | Found by |
|---|---|---|
| A/B order path bypasses the signal queue + duplicate guard | the pipeline the repo documents | an audit, days later |
| `atr-trailing-stop` inert for its whole life (#1075) | four unreachable branches | hand-counting 133 log lines |
| `supertrend` builds its bands from one bar (#1077) | it is not a SuperTrend | reading the source after a metric looked odd |

In each case the code was reachable, documented nearby, and **nothing connected the behaviour to the
architecture**. An agent solving a local problem had no cheap way to ask *"does the pipeline already
answer this?"*

## What the map is today

`scripts/generate-pipeline-map.cjs` → `docs/PIPELINE-MAP.{json,md}` — **546 files scanned**, gated by
`prebuild` (`--check` fails the build when stale). It maps **files and their dependency edges**.

**It is file-level.** It does not answer the questions that would have prevented the three cases above:

- *"Which functions can place an order?"* — the call-site question
- *"What calls `placeOrder`?"* — the reverse-dependency question at symbol level
- *"Which functions are unreachable from the automation loop?"* — the orphan question, at function level

## Proposed direction (to be decided, not assumed)

Extend the generated map to **function/class granularity**, so these become answerable by query rather
than by reading:

1. **Every exported function and class**, with the file it lives in
2. **Call edges between them**, so a reverse lookup exists (*"everything that reaches `placeOrder`"*)
3. **A reachability verdict** — reachable from the automation loop, from a controller, from a tool, or
   **from nothing** (the function-level sibling of `tools-index --orphans`, which already reports **73 of
   176 tools** named nowhere)
4. **A `--find` entry point** like `tools-index.cjs --find`, which searches PURPOSE text — the precedent
   that made 175 scripts findable without changing any of them

⚠️ **Scope check before building.** This is a generator change with a `prebuild` gate, so it touches every
agent's build. `docs/tools-index.json` is the existing precedent for machine-readable output and
`PIPELINE-MAP.json` already has the shape — so the honest first step is a **spike measuring how much of
this is already derivable from the existing scan**, not a rewrite.

⚠️ **A map nobody queries changes nothing.** The evidence for that is in this repo: 43% of tools were
orphans *while an index existed*. What made them findable was `--find`, not the listing. Whatever is built
here needs a query surface an agent will actually reach for at the start of a task, and the place an agent
looks first is `.github/instructions/agent-environment.instructions.md` — so the entry point has to be
named there.

## Not this issue

- **Not** a rule telling agents to "walk the architecture" — that instruction already exists and did not
  hold. A declaration is not validated by being well-formed.
- **Not** the order choke point — that is filed separately and is a *guard*; this is a *map*.

## Related

- `scripts/generate-pipeline-map.cjs`, `scripts/tools-index.cjs --find/--orphans`
- **#1075**, **#1077** — the two directives the map would have surfaced
- The order choke point issue — the guard half of the same problem
