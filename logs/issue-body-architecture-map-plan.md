# The Architecture Map — a long-term plan, and a measurable way to compare B / C / D

**Owner, 2026-10-04:**

> *"When I started this project and visioned an 'architecture' and 'pipeline' I visioned a map to the entire project… a map of every pathway, based on data and values, even boolean returns from functions, all mapped out to show the complete depth of the algorithm, with both expected values, samples where possible, and even live examples where possible."*

> *"I'm willing to try all three if it helps me determine how strong each solution is for the future. But if D is the master of all and offers the most value I would consider it."*

---

## Phase 0 — DONE (2026-10-04): the Outline was a missing PROJECT, not a missing map

**The observable problem** was *"the Outline section is blank"*. The cause was not a missing architecture map.

| | |
|---|---|
| `nest/tsconfig.json` + `tsconfig.build.json` | **present** — the backend always had Outline, definitions, references |
| root `jsconfig.json` | **ABSENT** — `src/` had no project at all, so the language server had nothing to build symbols from |
| Files affected | **388** |

**Added `jsconfig.json`.** `checkJs: false` deliberately — this is a JS codebase and turning checking on would emit thousands of inferred-type complaints; a gate that produces noise gets ignored, which this repo has already documented twice for its own validators. `maxNodeModuleJsDepth: 0` to keep the server fast.

**What it unlocks at zero maintenance:** Outline for every component/hook/function, go-to-definition and find-references **across** the frontend, workspace symbol search, breadcrumbs. **Derived from code, so it cannot drift.**

⚠️ **Verify it landed by opening a `.jsx` file.** If the Outline is still blank, the cause is elsewhere and this phase is incomplete.

---

## The reframing — B, C and D are NOT three rival solutions

They are a **pipeline**, and seeing that changes which one carries the risk:

```mermaid
flowchart LR
  C["C · GENERATE<br/>read the source"] -->|emits| D["D · THE DATASET<br/>nodes + edges + I/O"]
  D -->|renders as| B["B · THE GRAPH<br/>the lab view"]
```

**D is the data. C is how you make it. B is how you show it.**

**A correction that matters.** Earlier the agent cited the owner's own words as a rejection of D:

> *"I've considered registering all functions, their input, and output, their purpose. But that could be a huge registry, that needs constant updating and gives agentic AI yet another document to read."*

**That was misused, three ways, and the misuse is recorded here so it is not repeated:**

1. **It was not a rejection.** It was a weighing — *"that COULD be… Occasional revisions might be the way to go."*
2. **The context was different.** It answered the **duplication** finding — a registry to stop agents duplicating *work*. Not a map to understand a *pipeline*.
3. **It was used as a trump card** — "you already rejected this" ends a discussion rather than opening one.

**And the instinct in it was right, and it points at the answer:** *"needs constant updating"* is a correct objection to a **hand-written** registry. **C is exactly what removes it.** Derived from source, D cannot drift — the same mechanism `docs/GENERATED-FACTS.md` and `docs/TOOLS-INDEX.md` already prove in this repo.

**So the risk is inverted.** D is not the dangerous one. **B alone is** — a hand-maintained graph becomes the fifth surface, and this repo already has four (`architecture-reference.js` at **340 KB**, the Architecture Framework page, the Capability Map, the pipeline graph lab) plus a `prebuild` gate whose only job is checking that two of them agree.

---

## What already exists — read before building anything

| Surface | Size / state | Maintained how |
|---|---|---|
| `src/core/architecture-reference.js` | **340 KB** | hand-written |
| `ArchitectureFrameworkPage.jsx` + `.data.js` | — | hand-written |
| `CapabilityMapPage.jsx` | — | hand-written |
| `/development/pipeline-graph-lab` | — | `pipeline-graph-positions.json` |
| `docs/GENERATED-FACTS.md`, `docs/TOOLS-INDEX.md` | — | **generated** |
| `scripts/validate-architecture-*.cjs` | — | the two-surface agreement gate |

⚠️ **A fourth surface for something that already exists makes the problem worse, not better** — this repo's own words, written into `tools-index.cjs` after finding **175 tools and 73 orphans**. Any phase below must say which surface it **replaces or feeds**, not which it adds beside.

---

## The comparison — a FALSIFIABLE test, using defects we already know

An opinion about which approach is "stronger" is not measurable. **This is**, and it costs almost nothing because the evidence is dated and already filed.

**Take three real defects found this week and ask of each approach: would it have found this, and how fast?**

| # | Defect | The question a map should answer |
|---|---|---|
| 1 | **#1068** — the bar refresh fabricated 1,172 bars from quotes | Which writers can reach `marketbar`, and what does each one's input come from? |
| 2 | **R37** — 90 symbols held bars that nothing scored | Which nodes have no consumer? |
| 3 | **#1069** — the signed profit % exists **4 times**, with divergent edges | Which values are produced in more than one place? |

**Scoring:** for each approach, record *found / not found / found only after being told*, and the time to answer. An approach that scores zero is not a failure of the attempt — it is the measurement that stops us building the wrong one.

⚠️ **These three are chosen because they are KNOWN.** A map evaluated only on discoveries made *after* it exists proves nothing about its ability to find things.

---

## Phases

### Phase 1 — C, proved on ONE pipeline end-to-end (not all of them)

**Goal:** demonstrate the source can yield **nodes + edges** mechanically. Pick **one** path with real depth: `quote → bar write → marketbar → directive → composite → gate → order`. If that cannot be extracted, C is not viable and we learn it cheaply.

**Deliverable:** a generated file, checked into `docs/`, with a `--check` mode in `prebuild` alongside `docs-facts` and `tools-index`. **Fails the build when stale**, so it cannot silently rot.

**Falsifier:** if the generated graph cannot answer question 1 or 2 above, C is weaker than hoped.

### Phase 2 — D as the DERIVED dataset (only if Phase 1 succeeds)

**Goal:** the emitted dataset becomes a first-class artefact — nodes with **inputs, outputs, returned types, and a `consumers: []` list**, so "no consumer" is a query rather than an investigation.

**This is where the owner's original ask actually lands:** expected values where declared, samples where measurable, live examples where an endpoint can be cited.

**Falsifier:** if it cannot answer question 3 (a value produced in more than one place), it does not replace the duplication review the owner already asked for.

### Phase 3 — B as a RENDERER over D (never over hand-written nodes)

**Goal:** `/development/pipeline-graph-lab` gains input/output lines per node — multiple where sources genuinely differ — reading **D**, so the view and the dataset can never disagree.

⚠️ **B must consume D.** A lab view with its own hand-maintained node list is the fifth surface, and it will drift within a month.

### Phase 4 — Decide, using the scores

Only after 1–3 have produced numbers. **If C+D answers two of the three questions and B adds nothing measurable, stop at D and render it minimally.** D does not have to be "master of all" to be the right place to stop.

---

## Not done, deliberately

- **No fourth architecture surface.** Every phase feeds or replaces an existing one.
- **Nothing about "every function".** The valuable question is *"what is unreachable?"* — a graph of everything is a graph nobody reads. The three test questions are all **absence** questions, for that reason.
- **No predicted payoff.** The numbers from Phase 1 decide whether Phases 2–3 are worth doing at all.
