## Close report — #1087: the gate is now the FULL suite (decision + implementation)

**Decision: full-suite gate.** `nest/package.json` `prebuild` now runs `npx jest --silent` in place of the seven named suites — the seven were a subset, so the change is a widen, not an addition.

### Why full rather than the cheaper named subset

| Option | Pros | Cons | Cost |
|---|---|---|---|
| **🟢 Full suite (chosen)** | Catches EVERY red suite on every build, including the data-ingestion suites (`import-bars-alignment`) a "money path" subset would still miss — the two suites that went invisible lived in DIFFERENT modules | +~24s on every build; any flaky suite now blocks a build | measured **23.8s** |
| Named subset (risk/trading/automation) | ~13s; money-path only | Would NOT have caught `import-bars-alignment` (not a trading module); the subset boundary is a judgement call that drifts | ~13s |
| Leave manual | 0s | The exact state that hid a 7-day regression on a risk gate | 0s |

The measured difference between the two real options is **~11 seconds on a 3–5 minute build**. The subset's saving does not buy the coverage that motivated the issue.

### Evidence

- `nest/package.json` `prebuild` — `npx jest --silent &&` replaces the seven-path invocation (verified by re-parsing the JSON).
- Full suite at decision time: **180 suites / 1,697 tests / 23.8s — all passing** (grown from the issue's 172/1,615).
- The two suites the issue was filed for are green inside it: `assess-global-risk-limits.spec.ts` (stale test double fixed) and `import-bars-alignment.spec.ts` (30s suite timeout).
- `build:api` with the widened gate — jest output now appears in the build log; build completes.

### Consequences, stated plainly

- **A failing test now blocks a build.** That is the point (the 7-day regression is impossible under this gate), and the mitigation is the suite itself: it is green, and the DB-backed suites it contains were already in `prebuild` (`position-time-stop.integration`).
- Rollback is one line: restore the seven-path invocation. The old list is preserved in this issue's history.

### Acceptance criteria

- [x] Decided: full-suite gate (pros/cons/cost table above).
- [x] Cite measured cost: 23.8s against a 3–5 min build (~8–10%).
- [x] The two fixed suites stay green — verified inside the full run and inside the build gate.
