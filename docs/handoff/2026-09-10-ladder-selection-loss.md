# LadderPage selection state — two separate defects, both confirmed by reading the code

**Date:** 2026-09-10 · **Route:** `/scoring/live-ordering-stack` · **Investigation only — no changes made**

Reported as one symptom ("does not have a memory, losing checked boxes" + "No active
protocols"), but they are **two independent bugs** with different causes and different fixes.

---

## Defect 1 — `No active protocols.` is a swallowed API error, not an empty registry

### What the message actually means

`LadderPage.jsx:655`:

```jsx
{applicableProtocols.length === 0 ? (
  <p className="lad-proto-empty">No {direction === 'all' ? 'active' : 'applicable'} protocols.</p>
) : ( ... )}
```

So it renders when `applicableProtocols` is empty — which happens either because there
genuinely are none, **or** because the protocol list failed to load and the failure was
converted into an empty array.

### The cause

`src/core/useProtocolData.js:21`:

```js
queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
```

`apiGet` (`src/core/api/client.js`) carefully builds a rich error — status **and** the
server's own message:

```js
const err = new Error(`Request failed with ${res.status}${detail}`);
err.status = res.status;
throw err;
```

…and the `.catch()` **discards all of it**, returning the exact same shape as a successful
response with no protocols. Three consequences:

1. **The failure is indistinguishable from a real empty state.** The UI says "No active
   protocols" — a confident factual claim — when the truth is "I could not ask".
2. **React-query's error machinery is defeated.** Because `queryFn` *resolves*, react-query
   records a **success**. `isError`, `error` and the retry policy never engage. The hook's
   own `isLoading` is `false`, so the page believes it is showing real data.
3. **It persists for `staleTime: 60_000`.** One transient failure — including a 502 while
   the API restarts — pins the empty state for a full minute with no retry. I observed 502s
   from the Vite proxy repeatedly during today's work, so this is reachable in normal use.

### Scope — this is systemic, not a Ladder bug

**18 occurrences across 13 files.** Every one converts an API failure into a silent empty
result:

| File | Endpoints |
|---|---|
| `core/useProtocolData.js` | `/gated/protocols`, `/runs` |
| `core/api/scoring-hooks.js` | `/gated/protocols` |
| `pages/SymbolsLadderPage.jsx` | `/gated/protocols`, `/runs` |
| `pages/ProtocolsPerformancePage.jsx` | `/gated/protocols`, `/runs` |
| `pages/TradingStrategiesPage.jsx`, `StrategyCreatePage.jsx`, `SnapshotReplayPage.jsx`, `MetaStackExplorerPage.jsx`, `CreateProtocolsPage.jsx`, `AutomationOverviewPage.jsx`, `ABTestingPage.jsx`, `MarketContextPage.jsx`, `components/ProtocolPicker.jsx` | various |

Every affected surface can therefore show a plausible empty state that is actually an
outage. That is the same *"plausible, silent, wrong"* failure shape the `INV-*` contracts
exist for — it just lives in the UI layer, where there is no build-time gate.

### What to consider

- **Let the error propagate.** Remove the `.catch()`; react-query will then set `isError`
  and retry. This is almost certainly the right default — the catch was presumably added to
  stop a crash, but react-query handles that.
- **If a fallback is genuinely wanted**, it must be **distinguishable**: return
  `{ protocols: [], __failed: true }` (or set an explicit flag) and have the page render
  "Could not load protocols — retry" rather than "No active protocols". A fallback that
  cannot be told apart from real data is worse than no fallback.
- **Never claim a fact you did not verify.** "No active protocols" asserts something about
  the registry. On error it should assert something about the request instead.
- **Check whether the catch exists to mask a real error** — if some endpoint genuinely 404s
  in a normal configuration, that should be fixed rather than swallowed.
- Worth an invariant or lint rule: *a `queryFn` must not resolve on failure.*

---

## Defect 2 — selections are pruned against a list that may not have loaded yet

### The mechanism

`LadderPage.jsx:332-340` — an effect that prunes selections to applicable protocols;

```js
useEffect(() => {
  const applicableIds = new Set(applicableProtocols.map((p) => p.id));
  const cur = selectedByDir[direction] || [];
  const kept = cur.filter((id) => applicableIds.has(id));
  if (kept.length !== cur.length) {
    setSelectedByDir((prev) => ({ ...prev, [direction]: kept }));   // ← persists the pruning
  } else if (kept.length === 0 && applicableProtocols.length > 0) {
    setSelectedByDir((prev) => ({ ...prev, [direction]: [applicableProtocols[0].id] }));
  }
}, [direction, applicableProtocols, selectedByDir, setSelectedByDir]);
```

The guard is `applicableProtocols.length > 0` — but the pruning branch has **no such guard**.

### What goes wrong

If this effect runs **while the protocol list is empty** — during initial load, or during the
Defect 1 failure — then `applicableIds` is empty, `kept` is `[]`, and the code **persists the
emptied selection to localStorage**. When the protocols do arrive, the stored selection is
already gone.

**This is exactly "losing checked boxes" and "does not have a memory"** — and it means Defect 1
does not merely *display* wrongly, it can **destroy** the user's saved selection. The two
defects compound: the swallowed error creates the empty list, and the unguarded prune
consumes it as evidence that nothing is selected.

### What to consider

- **Do not prune against a list that is not loaded yet.** Gate the whole effect on
  "protocols have loaded successfully at least once" — e.g. `isLoading === false && !failed`,
  or simply require a non-empty `applicableProtocols`.
- **Selections are user data.** An empty *derived* list is not evidence that the user
  deselected everything. Pruning should be conservative: only drop an id when there is
  positive evidence the protocol no longer exists, not when we simply have no data.
- **Note the asymmetry** — the auto-select branch *does* guard on `.length > 0`, so whoever
  wrote it was aware of the empty case; the pruning branch just missed it.
- The related `usePersistentState` hook and the per-direction buckets appear **correct** — I
  verified persistence works in all three directions (BOTH/LONG/SHORT) when the list is
  loaded. The bug is the timing, not the storage.

---

## How to reproduce

1. Stop the API (`pwsh -File scripts\tcs-stop.ps1`), or let a 502 occur mid-load.
2. Open `/scoring/live-ordering-stack` — the panel reads **"No active protocols."** with no
   error anywhere.
3. Select some protocols, wait for a refetch to fail (or the 60s staleTime to lapse during an
   outage), then navigate away and back — **the selection is gone**.
4. Restart the API and reload: protocols return, but the saved selection does not.

## Acceptance

- [ ] An API failure on the protocols endpoint surfaces as an error with a retry, not as
      "No active protocols".
- [ ] A failed load cannot empty the saved selection.
- [ ] The 18 swallowed-`.catch()` sites are triaged — fixed, or given an explicitly
      distinguishable fallback.
- [ ] A test asserts a failed protocols fetch does **not** render the empty-state copy.
- [ ] A test asserts the stored selection survives a failed-then-successful load.

## Related

- Not caused by v0.6.5/v0.6.6 (card uniformity, denominator) — those touched rendering and
  scoring, not data loading. The Ladder was rebuilt in that work, which is likely when the
  empty-state copy was last touched.
- **#767** — multiple backends racing port 3201. That makes transient protocol-endpoint
  failures *more likely*, and therefore makes Defect 1 more reachable. Worth considering
  together.
