## ⚠️ Defect in the Phase 1/2 generator — `--check` was NON-DETERMINISTIC

Found 2026-10-06 while deploying unrelated work. **It made the prebuild gate fail on trees nobody had touched**, and it is exactly the risk Phase 1 flagged when it warned this gate would stale far more often than `docs-facts` or `tools-index`.

### The measurement

Two consecutive `node scripts/generate-pipeline-map.cjs --write` runs on an **unchanged** tree:

```
phase2.nodes:        1470 -> 1470   first differing index 266
phase2.unreferenced:  129 ->  129   first differing index 30
phase2.maths:        DIFFERENT
```

Same content, **different order**. `phase2.files` was already sorted, which is why only some sections showed it.

### The cause

`program.getSourceFiles()` order is not stable, and the artefact carried it through:

| section | inherited order from |
|---|---|
| `nodes` | `records` scan order |
| `unreferenced` | `nodes` order |
| each group's `sites` | `sites` scan order |
| each node's `consumers` | the call-site walk order |
| group order | unequal site counts, ties by insertion |

### The fix

Every emitted array is sorted by a key that is **unique per entry** — `(file, line)` for nodes and sites, `localeCompare` for unreferenced, and group order ties broken by fingerprint. Two consecutive runs are now **byte-identical** (SHA-256 compared) and `--check` passes.

**Four new self-test checks (23 → 27):** three assert the ordering, and a **canary** proves the predicate can fail — an always-true ordering check would be a decoration.

### ⚠️ The diagnosis was wrong first, and that belongs in the record

The gate went red immediately after a source edit, so the edit was blamed — twice. **It had nothing to do with it.** The measurement that settled it was comparing two generations section by section rather than reasoning from the diff.

This is the repo's own rule, paid for before: **do not attribute a fix you did not isolate.** A gate that fails for no reason gets switched off, and then it guards nothing — which is what would have happened here had the cause not been pinned.

### Effect on Phase 4's carried-forward costs

The **6.8 s** cost stands. The "stales often" cost is now bounded: it stales when the **source** changes, which is the intended behaviour, not when the scan order happens to differ.
