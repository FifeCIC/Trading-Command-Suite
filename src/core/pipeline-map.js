/**
 * pipeline-map.js — the GENERATED pipeline map, read as DATA (#1071, Phase 3).
 * ============================================================================
 *
 * ⚠️ WHY THIS MODULE EXISTS, AND IT IS NOT "A HELPER".
 *
 * `docs/PIPELINE-MAP.json` is generated from source by `scripts/generate-pipeline-map.cjs` and
 * `--check`ed in the backend `prebuild`, so it cannot drift from the code it describes. Phase 3 of
 * #1071 is the rule that follows: **the view consumes the dataset, it never restates it.** The lab
 * page already carries a hand-written node list; hand-written input/output lines beside it would be
 * a fifth architecture surface — and this repo has four, plus a `prebuild` gate whose only job is
 * checking that two of them still agree.
 *
 * So every input/output line rendered on that page is computed HERE, at render time, from the
 * artefact. Typed into the node object, it starts drifting the first time a service moves.
 *
 * ── LOADED LAZILY, ON PURPOSE ───────────────────────────────────────────────
 * The artefact is ~700 KB. A dynamic `import()` gives it its own chunk, paid for only when the lab
 * page mounts — expert-only tooling. A static import would add it to the entry bundle of every page.
 *
 * ── WHAT IT DERIVES ────────────────────────────────────────────────────────
 *   ioForFiles()        — which resources a set of files READS and WRITES
 *   unreferencedIn()    — functions nothing calls, within those files
 *   divergentMathsIn()  — groups where the same maths is written with DIFFERENT edges (#1069)
 *
 * ⚠️ "MULTIPLE WHERE SOURCES GENUINELY DIFFER" IS A SHAPE, NOT A DISPLAY CHOICE. A resource is
 * reported ONCE with every file that touches it, so `trade` written by three files reads as one
 * output with three sources — not as three competing outputs.
 *
 * ⚠️ AND AN ABSENT RESULT IS NOT AN EMPTY ONE. A file the dataset has no row for is returned rather
 * than dropped — and it is returned in one of TWO buckets, because the causes are different facts:
 * `missing` (not in the scanned source — the path is stale) versus `untracked` (the file exists and
 * touches none of the eleven tracked resources). Collapsing them would let a live file be reported
 * as a dead path, which is what the lab page did before this distinction existed.
 */

let cached = null;

/** Normalise a repo path — lowercase, forward slashes. The artefact emits `nest/src/...`. */
const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

/**
 * Load and index the artefact. Resolves once; concurrent callers share the same promise.
 * @returns {Promise<{resources: Map, unreferenced: Array, maths: Array, loadedAtCounts: object}>}
 */
export function loadPipelineMap() {
  if (!cached) {
    cached = import('../../docs/PIPELINE-MAP.json')
      .then((mod) => buildIndex(mod.default ?? mod))
      .catch((err) => {
        cached = null;                       // let a later mount retry rather than cache the failure
        throw err;
      });
  }
  return cached;
}

function buildIndex(raw) {
  const resources = new Map();
  for (const [name, r] of Object.entries(raw.resources || {})) {
    resources.set(name.toLowerCase(), {
      stage: r.stage,
      writers: new Set((r.writerFiles || []).map(norm)),
      readers: new Set((r.readerFiles || []).map(norm)),
    });
  }

  // `phase2.unreferenced` is written as "<file>:<line> <name>".
  const unreferenced = (raw.phase2?.unreferenced || []).map((entry) => {
    const m = /^(.*):(\d+)\s+(\S+)$/.exec(entry);
    return m ? { file: m[1], line: Number(m[2]), name: m[3] } : { file: String(entry), line: null, name: '' };
  });

  // Only the DIVERGENT groups are carried: identical maths that all behaves the same is a copy, and
  // a copy is usually benign. The interesting set is the one where the sites disagree (#1069).
  const maths = [];
  for (const group of (raw.phase2?.maths?.exact || [])) {
    if (!group.divergent) continue;
    maths.push({ key: group.key, sites: (group.sites || []).map((s) => ({ ...s, norm: norm(s.file) })) });
  }

  return {
    resources,
    unreferenced: unreferenced.map((u) => ({ ...u, norm: norm(u.file) })),
    maths,
    // Every source file the generator read. Used ONLY to tell a stale path from an untracked one.
    scanned: new Set((raw.phase2?.files || []).map(norm)),
    counts: {
      files: raw.phase2?.tsFiles ?? null,
      declarations: raw.phase2?.declarations ?? null,
      nodes: (raw.phase2?.nodes || []).length || null,
      scanned: raw.scanned ?? null,
    },
  };
}

const group = (rows) => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.resource)) m.set(r.resource, []);
    m.get(r.resource).push(r.file);
  }
  return [...m.entries()]
    .map(([resource, files]) => ({ resource, files }))
    .sort((a, b) => b.files.length - a.files.length || a.resource.localeCompare(b.resource));
};

/**
 * The inputs and outputs of a set of files, derived from the artefact.
 *
 * @param {object} index     from loadPipelineMap()
 * @param {string[]} files   the node's declared source files
 * @returns {{inputs: Array, outputs: Array, untracked: string[], missing: string[]}}
 *   inputs/outputs: `[{ resource, files: string[] }]` — one row per resource, every contributing file
 *   untracked: the file is in the scanned source and touches none of the tracked resources
 *   missing:   the file is NOT in the scanned source — a stale path in the caller's list
 */
export function ioForFiles(index, files) {
  const inputs = [];
  const outputs = [];
  const untracked = [];
  const missing = [];
  if (!index) return { inputs, outputs, untracked, missing };

  const seen = new Set();
  for (const file of files || []) {
    const key = norm(file);
    if (seen.has(key)) continue;
    seen.add(key);

    let touched = false;
    for (const [resource, d] of index.resources) {
      if (d.writers.has(key)) { outputs.push({ resource, file }); touched = true; }
      if (d.readers.has(key)) { inputs.push({ resource, file }); touched = true; }
    }
    if (touched) continue;

    // ⚠️ FAIL TO `untracked` WHEN THE SCANNED LIST IS ABSENT. An older artefact without the list
    // would otherwise classify EVERY file as missing, which is a worse error than saying nothing.
    if (index.scanned.size && !index.scanned.has(key)) missing.push(file);
    else untracked.push(file);
  }
  return { inputs: group(inputs), outputs: group(outputs), untracked, missing };
}

/** Functions in these files that nothing calls, that are not exported, and that no decorator marks. */
export function unreferencedIn(index, files) {
  if (!index) return [];
  const keys = new Set((files || []).map(norm));
  return index.unreferenced.filter((u) => keys.has(u.norm));
}

/** Divergent maths groups with at least one site inside these files — the #1069 signal. */
export function divergentMathsIn(index, files) {
  if (!index) return [];
  const keys = new Set((files || []).map(norm));
  return index.maths
    .map((g) => ({ key: g.key, sites: g.sites.filter((s) => keys.has(s.norm)) }))
    .filter((g) => g.sites.length > 0);
}
