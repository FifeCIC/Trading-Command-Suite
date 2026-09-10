# Procedure — Onboarding a Symbol into META.Stack

**Status:** authoritative
**Applies to:** adding any symbol that a protocol should score
**Last verified:** 2026-09-10 against the live database

---

## Why this procedure exists

A symbol can be made to produce bars **without** being wired into the pipeline. That is the
single most misleading thing an engineer or agent can do here, because the result looks
identical to success: bars appear, and a chart renders.

It is not wired. The three tell-tale signs:

| Symptom | What it means |
|---|---|
| Bars appear, then stop within one refresh interval | You wrote bars directly (`/bars/record`, a manual `INSERT`). The loop never resolved the symbol, so the next cycle ignores it. |
| The protocol scores but the symbol is not in the refresh set | The protocol resolved the symbol from the **name-guessing fallback**, not from a relationship. |
| The symbol is in the refresh set but no protocol scores it | The symbol is registered, but nothing references it. |

**A symbol is not onboarded until a protocol reaches it through a foreign key.** Writing bars
does not onboard a symbol; it hides the fact that it is not onboarded.

---

## The resolution chain (how a protocol finds its symbols)

`ProtocolDbService.resolveSymbols()` and `SymbolResolverService` resolve a protocol's symbols
in this priority order:

| # | Path | Mechanism | Rename-safe? |
|---|---|---|---|
| 0 | `symbol_protocol_assignment` | FK → `protocol.id` | ✅ yes |
| 1 | `watchlist.protocolId` | FK → `protocol.id` | ✅ yes |
| 2 | `SINGLE_SYMBOL_HINTS` | substring match on the protocol **slug** | ❌ **no** |
| 3 | `WATCHLIST_HINTS` | substring match on the protocol **slug** → watchlist **name** | ❌ **no** |

**Paths 2 and 3 are name-guessing fallbacks, not relationships.** They exist for convenience.
They go stale on any rename, and they cannot tell you they have gone stale — the protocol just
scores nothing. They now log a warning when they fire, but a warning is not a fix.

> **Rule:** if a protocol you are onboarding is resolving through path 2 or 3, you have not
> finished. Add a real link so it resolves through path 0 or 1.

---

## The procedure

### Step 1 — Confirm the broker actually offers the symbol

```powershell
$r = Invoke-RestMethod "http://localhost:5000/symbols" -TimeoutSec 25
$r.symbols | Where-Object { $_.name -eq 'CHINA50' } | Select-Object name, path
```

Use the broker's **own** symbol name. `CHINA50` is in the `Indexes` group; the registry ticker
must match what the bridge will accept.

> ⚠️ **A 404 or a refused connection is NOT evidence the symbol is unavailable.** Confirm the
> stack is up first (`5173`, `3201`, `5000`, `5001`). A dead service and an absent symbol look
> identical and have been confused for each other twice in this repo (`CHINA50`, `VIX`).
> `/quote?symbol=X` in particular 404s for symbols that fetch fine via `/candles`.

### Step 2 — Register the symbol

The symbol must exist in the `symbol` table with `active = 1`, and `exchange` is a vestigial
label (it is not the provider). The **provider** comes from `symbol_route.provider`:

```sql
SELECT s.ticker, s.active, sr.provider, sr.brokerSymbol
  FROM symbol s
  LEFT JOIN symbol_route sr ON sr.symbol = s.ticker
 WHERE s.ticker = 'CHINA50';
```

If there is no `symbol_route` row, the refresh loop assumes `mt5`. For a non-MT5 source, add one:

```sql
INSERT INTO symbol_route (symbol, brokerId, brokerSymbol, provider, priority, enabled)
VALUES ('BTC', 0, 'BTCUSDT', 'binance', 0, 1);
```

### Step 3 — Create the watchlist and link it BY FOREIGN KEY

This is the step that is easy to skip and the reason a symbol ends up on a fallback path.

```sql
INSERT INTO watchlist (id, name, symbols, createdAt, updatedAt, protocolId, source, isDefault, kind)
SELECT UUID(), 'china-index', CAST('["CHINA50"]' AS JSON), NOW(3), NOW(3),
       p.id, 'system', 0, 'system'
  FROM protocol p
 WHERE p.slug = 'china-speed-v1'
   AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM watchlist) w WHERE w.name = 'china-index');
```

- `protocolId` **must be the protocol UUID**, never the slug and never the name.
- `symbols` may be `["TICKER"]` or `[{"name": "...", "ticker": "TICKER"}]` — both are read.
- Naming convention matches the three working index protocols: `ftse-index`, `dax-index`,
  `cac-index` → so use `china-index`.

> **Do not rely on the name matching the protocol slug.** That is path 3. The FK is what makes
> this a relationship.

### Step 4 — Verify the FK resolves (do not skip)

```sql
SELECT w.name, w.symbols, p.slug, p.active, (w.protocolId = p.id) AS linked_by_fk
  FROM watchlist w JOIN protocol p ON p.id = w.protocolId
 WHERE w.name = 'china-index';
```

`linked_by_fk` must be `1`.

### Step 5 — Activate the protocol, then confirm bars arrive **by themselves**

```sql
UPDATE protocol SET active = 1, updatedAt = NOW(3) WHERE slug = 'china-speed-v1';
```

Then wait one refresh interval and check — **without** calling `/bars/record`:

```sql
SELECT b.timeframe, COUNT(*) bars, MAX(b.timestamp) newest
  FROM marketbar b JOIN symbol s ON s.id = b.symbolId
 WHERE s.ticker = 'CHINA50'
 GROUP BY b.timeframe;
```

**Every timeframe the protocol's `recommendedTimeframe` resolves to must now be present and
advancing.** If it is not, the FK is not being read — go back to step 4. Do not "fix" this by
writing bars.

### Step 6 — Confirm no fallback warning

Tail the API log after activation. You must **not** see:

```
Protocol "china-speed-v1" has NO assignment and NO linked watchlist — symbols were GUESSED from its name: [CHINA50].
```

If you do, the FK is not resolving and step 3 was not effective.

---

## Common mistakes

| Mistake | Why it misleads |
|---|---|
| Writing bars via `/bars/record` to "make it work" | Bars appear immediately and vanish next cycle. It makes a broken link look healthy. |
| Setting `watchlist.protocolId` to the protocol **slug** | The resolver matches on `protocol.id`. A slug never matches, so it silently falls through to guessing. |
| Relying on the symbol being named in the protocol slug | That is the fallback path. It works until someone renames the symbol. |
| Creating a watchlist whose name duplicates an existing one | Five watchlists existed twice; name resolution was `LIMIT 1` with no `ORDER BY`, so which row a protocol read was arbitrary — and the pairs differed in content. Now guarded by `INV-WATCHLIST-IDENTITY`. |
| Assuming a 404 means the symbol does not exist | Confirm the stack is up first. |
| Leaving the symbol assigned to nothing | A protocol-assigned symbol is what the refresh loop walks. An orphan symbol with bars will freeze, and that is correct behaviour, not a bug. |

---

## The guards that enforce this

| Invariant | Catches |
|---|---|
| `INV-SYMBOL-HINTS-RESOLVE` | A derivation hint pointing at a retired / absent / barless ticker |
| `INV-WATCHLIST-IDENTITY` | An ambiguous watchlist name; name-based resolution without pinned ordering |
| `INV-PROVIDER-REACHABLE` | A protocol-assigned symbol no provider has ever delivered bars for |
| `INV-CADENCE-COVERAGE` | A cadence a protocol resolves to that the refresh loop never fetches |

Run all of them:

```powershell
node nest\scripts\contract-probe.cjs
```

---

## Reference — `CHINA50` worked example

`CHINA50` was found frozen (101 bars, newest `2026-07-17`) with **zero assignments and zero
bots**. It was being served entirely by `SINGLE_SYMBOL_HINTS` (path 2) — a name guess.

| Step | State before | State after |
|---|---|---|
| Broker offers it | ✅ yes, `Indexes` group | ✅ |
| Registered `active=1` | ✅ | ✅ |
| `symbol_route.provider` | none → defaults to `mt5` | `mt5` (correct) |
| Linked watchlist | ❌ **none existed** | ✅ `china-index`, `linked_by_fk = 1` |
| Protocol active | ❌ `active = 0` | ⬜ **not changed — product decision** |
| Resolution path | 2 (**guess from slug**) | 1 (FK) once activated |

The earlier "fix" for this symbol was a `/bars/record` call that wrote 3,000 bars. That
addressed nothing: the symbol was still unwired, and it would have frozen again on the next
cycle. The watchlist above is the actual onboarding.
