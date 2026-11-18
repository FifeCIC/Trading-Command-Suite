/**
 * symbol-discovery.service.ts — movers are RECORDED as symbols, never ACTIVATED as symbols.
 * ==========================================================================================
 *
 * Owner directive, 2026-11-18: We will need the data to be stored in the database with normal symbol records:
 * they just won't be set as active until the users actions or a bot trades so that will need to be
 * looked at. We cannot activate every symbol that appears in top losers or top winners else by the end
 * of a month we'll have hundreds of active symbols being monitored.
 *
 * ── THE ARITHMETIC THAT MAKES THIS A HARD RULE, NOT A PREFERENCE ──
 * The feed offers ~95 gainers and ~174 losers *per fetch* (measured 2026-11-18). At one poll every five
 * minutes across two sessions that is thousands of distinct tickers a week, most of them penny stocks
 * having one bad day. `symbol.active` is what the scoring and monitoring paths read, so activating on
 * sight converts a discovery feed into an unbounded workload — and, worse, into a universe that is
 * indistinguishable from one the owner chose.
 *
 * ── THE THREE-WAY RULE ──
 *
 * | Row state | What discovery does |
 * |---|---|
 * | does not exist | INSERT with `active = 0` — recorded so the ticker is known, dormant so nothing scores it |
 * | exists, `active = 0` | leave it exactly as it is (idempotent; a re-discovery is not an event) |
 * | exists, `active = 1` | **NEVER TOUCH.** Activation is a decision someone made — a watchlist add, a protocol assignment, a bot trading it — and discovery has no standing to reverse it |
 *
 * ⚠️ THE THIRD ROW IS THE ONE WORTH GUARDING. A naive `upsert` with `update: { active: false }` would
 * DEACTIVATE a symbol the owner had activated, silently, every time it appeared in a movers list. That
 * is a far worse failure than activating one, because it removes a symbol from monitoring while looking
 * like a successful write. So the write is an insert-if-absent and nothing else: `update: {}` is
 * deliberate, and `symbol-discovery.service.spec.ts` fails if anyone gives it a body.
 *
 * ⚠️ IT IS A SEPARATE SERVICE, NOT A PRIVATE METHOD. The strategies area will record discovered
 * candidates too, and "discovery must not activate" is exactly the kind of rule that gets re-implemented
 * slightly differently in the second caller.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** One ticker to record. `type` is NOT NULL on `symbol`, so a caller must supply something honest. */
export interface DiscoveredSymbol {
  ticker: string;
  name?: string | null;
  exchange?: string | null;
  /** The feed's own instrument kind (`EQUITY`, `ETF`, …). Defaults to `UNKNOWN` rather than guessing. */
  type?: string | null;
}

export interface DiscoveryResult {
  created: number;
  existing: number;
}

/**
 * symbolType() — the feed's `quoteType` mapped ONTO the `symbol.type` vocabulary, honestly.
 *
 * ⚠️ IT MAPS, IT DOES NOT LOWERCASE-AND-PASS-THROUGH. The feed speaks Yahoo's vocabulary
 * (`EQUITY`, `CRYPTOCURRENCY`, `CURRENCY`) and this column speaks the app's
 * (`stock`, `crypto`, `forex` — measured across 401 rows). `suitability.service.ts` compares a
 * symbol's type against the protocol's declared `symbolTypes` by exact lowercased equality, so a
 * `cryptocurrency` row would be REJECTED by a protocol declaring `crypto` — the scoring gate would
 * refuse to score a symbol the owner had just discovered. That is a money-path miss produced by a
 * dictionary disagreement, not by a bug anyone could see.
 *
 * ⚠️ `unknown` IS A REAL ANSWER. `symbol.type` is `NOT NULL`, and inventing `stock` for a row whose
 * kind the feed did not state would be a fabricated fact in a column other code may trust. An
 * unmapped value passes through lowercased rather than being dropped, so the next reader can see
 * what the feed actually said.
 *
 * ── 🛑 THE LOWERCASE HALF: THIS FUNCTION RETURNED UPPERCASE FOR A DAY ──
 *
 * Measured 2026-11-19, one day after discovery first ran: `symbol.type` held **STOCK ×120** and
 * **ETF ×11** against an established lowercase vocabulary (`stock` 233 · `forex` 15 · `etf` 2 ·
 * `index` 10 · `crypto` 7 · `commodity` 3), and **this was the only uppercase writer** — every other
 * one (`import-jobs.service.ts` ×2, `portfolio.service.ts`, `trading212-import.service.ts`) writes
 * `'stock'`.
 *
 * ⚠️ **The database hid it and the JS did not.** The column collates `utf8mb4_unicode_ci`, so
 * `WHERE type = 'stock'` matched all 353 and every SQL-level check looked correct — while two
 * case-SENSITIVE comparisons in JavaScript silently disagreed:
 *
 * | Site | What an uppercase row did |
 * |---|---|
 * | `symbols.service.ts` `isEquity` | `false` → the 5-adapter profile chain was SKIPPED and the UI was told *"A STOCK instrument has no company profile"* — a fabricated fact, no error |
 * | `import-jobs.service.ts` Yahoo suffix retry | skipped → a foreign-listed discovered ticker returned no bars where a lowercase row retried `.L`/`.CO` |
 *
 * ⇒ This is the repo's signature failure (plausible output, no error) produced by a *case*, so both
 * consumers now lowercase as well and the spec asserts the whole map rather than one branch.
 */
export function symbolType(quoteType?: string | null): string {
  const q = String(quoteType ?? '').trim().toLowerCase();
  if (!q) return 'unknown';
  const MAP: Record<string, string> = {
    equity: 'stock',
    cryptocurrency: 'crypto',
    currency: 'forex',
    future: 'commodity',
  };
  return MAP[q] ?? q;
}

/**
 * ── DECISION (2026-11-18, TCS-Dev) ──
 * WHAT:       Discovery is INSERT-ONLY, always `active: false`, and the type vocabulary it writes is
 *             the COLUMN'S (lowercase, mapped) rather than the feed's.
 * WHY:        owner directive, 2026-11-18: We cannot activate every symbol that appears in top losers or top
 *             winners else by the end of a month we'll have hundreds of active symbols being
 *             monitored. ~95 gainers + ~174 losers per fetch, and `symbol.active` is what scoring
 *             and monitoring read — so activating on sight is unbounded, and produces a universe
 *             indistinguishable from one the owner chose. The vocabulary half is not cosmetic
 *             either: the column collates `utf8mb4_unicode_ci`, so SQL matches both spellings and
 *             only case-sensitive JavaScript disagrees — which is exactly how 120 `STOCK` rows
 *             silently skipped the profile chain (see symbolType()).
 * INSTEAD OF: An `upsert` converging every mover to `active: false`. That would DEACTIVATE an
 *             owner-activated symbol every time it appeared in a movers list — removing a symbol
 *             from monitoring while reporting a successful write.
 * REVERSE BY: Accepting activation as a discovery outcome, which needs a bounded, owner-set limit on
 *             how many symbols may be active — not a change to this service. See #1299.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 210
 * GUARD:     nest/src/modules/market-data/symbol-discovery.service.spec.ts (asserts update/upsert
 *            never called; asserts the whole type map is lowercase and lands in the real vocabulary)
 */
@Injectable()
export class SymbolDiscoveryService {
  private readonly logger = new Logger(SymbolDiscoveryService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * recordDiscovered() — insert any ticker we do not already know, ACTIVATE NOTHING, change nothing.
   *
   * Returns counts rather than a boolean so the caller can report what actually happened. A silent
   * success is not evidence of a write, and this is a write that is deliberately close to a no-op.
   */
  async recordDiscovered(rows: DiscoveredSymbol[]): Promise<DiscoveryResult> {
    const byTicker = new Map<string, DiscoveredSymbol>();
    for (const r of rows) {
      const ticker = String(r.ticker ?? '').trim().toUpperCase();
      if (ticker) byTicker.set(ticker, { ...r, ticker });
    }
    if (byTicker.size === 0) return { created: 0, existing: 0 };

    const tickers = [...byTicker.keys()];
    const known = await this.prisma.symbol.findMany({
      where: { ticker: { in: tickers } },
      select: { ticker: true },
    });
    const knownSet = new Set(known.map((k) => k.ticker.toUpperCase()));

    const missing = tickers.filter((t) => !knownSet.has(t));
    let created = 0;
    for (const ticker of missing) {
      const r = byTicker.get(ticker)!;
      try {
        await this.prisma.symbol.create({
          data: {
            // ⚠️ `active: false` IS THE WHOLE POINT OF THIS SERVICE. See the docblock.
            active: false,
            ticker,
            name: (r.name ?? ticker).slice(0, 200),
            exchange: r.exchange ? String(r.exchange).slice(0, 50) : null,
            type: symbolType(r.type).slice(0, 50),
          },
        });
        created += 1;
      } catch (err) {
        /**
         * ⚠️ A DUPLICATE KEY HERE IS NOT AN ERROR TO SWALLOW SILENTLY — it means a concurrent discovery
         * inserted the same ticker between the read and the write. It is reported as `existing` because
         * that is what it now is, and counted, not ignored.
         */
        const message = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate/i.test(message)) {
          knownSet.add(ticker);
          continue;
        }
        // Any other failure is real: state it, and keep going so one bad row cannot stop the batch.
        this.logger.warn(`symbol discovery could not record ${ticker}: ${message.slice(0, 200)}`);
      }
    }

    this.logger.log(
      `symbol discovery: ${tickers.length} seen, ${created} created (active=0), `
      + `${tickers.length - created} already known — NOTHING was activated`,
    );
    return { created, existing: tickers.length - created };
  }
}
