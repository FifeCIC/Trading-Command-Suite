/**
 * symbol-protocol-authority.counts.spec.ts — guards the BATCH protocol count.
 *
 * ⚠️ WHY THIS EXISTS (measured 2026-10-02). The Active Symbols table's Protocols column counted
 * `directive.symbols[]` entries. `GET /api/directives` returns **109** directives and **0** carry a
 * non-empty `symbols[]`, so the column rendered **0 for every symbol** — including symbols with
 * positions — and nothing errored. `protocolCountsForSymbols()` replaced it.
 *
 * ⚠️ THE FOUR CASES ARE THE FOUR WAYS THAT REPLACEMENT CAN GO WRONG, and each was canaried:
 *   1. count two ids for ONE protocol as two  → the count inflates (UUID vs slug)
 *   2. take the first hit instead of a union  → the count collapses to one source's answer
 *      (this is #926's original defect: `symbol_protocol_assignment` said 2 for XAUUSD, 8 applied)
 *   3. swallow a failed source                 → "could not ask" renders as "none"
 *   4. compare tickers case-sensitively        → a real symbol silently reads 0
 *
 * A count that is merely *a number* is not evidence the mechanism works: every one of these
 * failures still produces a plausible integer. That is why they are asserted individually.
 */
import { SymbolProtocolAuthorityService } from './symbol-protocol-authority.service';

/** Two protocols, deliberately reachable by BOTH id and slug — the ID-space trap. */
const PROTOCOLS = [
  { id: 'uuid-a', slug: 'alpha-v1', name: 'Alpha', active: 1, recommendedTimeframe: null, tradingStyle: null, directionMode: null },
  { id: 'uuid-b', slug: 'beta-v1', name: 'Beta', active: 1, recommendedTimeframe: null, tradingStyle: null, directionMode: null },
];

type Stub = Partial<Record<'assignment' | 'bot' | 'watchlist' | 'observed', unknown[]>>;

function makePrisma(stub: Stub = {}) {
  return {
    protocol: { findMany: async () => PROTOCOLS },
    symbolProtocolAssignment: { findMany: async () => stub.assignment ?? [] },
    tradingStrategy: { findMany: async () => stub.bot ?? [] },
    watchlist: { findMany: async () => stub.watchlist ?? [] },
    scoreSnapshot: { findMany: async () => stub.observed ?? [] },
  } as any;
}

const service = (p: any) => new SymbolProtocolAuthorityService(p);

describe('SymbolProtocolAuthorityService.protocolCountsForSymbols', () => {
  it('counts ONE protocol when a UUID and a slug both name it', async () => {
    // `alpha-v1` arrives as a UUID from `assignment` and as a slug from `bot`. Two rows, one
    // protocol — the Set in `note()` is what collapses them.
    const p = makePrisma({
      assignment: [{ symbol: 'AAA', protocolId: 'uuid-a' }],
      bot: [{ symbol: 'AAA', protocolId: 'alpha-v1' }],
    });
    const r = await service(p).protocolCountsForSymbols(['AAA']);
    expect(r.counts.AAA).toBe(1);
  });

  it('UNIONS the sources rather than taking the first hit', async () => {
    // `assignment` knows only alpha; `observed` proves beta scored it. A first-hit chain would
    // return 1 and hide beta — exactly how XAUUSD under-reported before #926.
    const p = makePrisma({
      assignment: [{ symbol: 'AAA', protocolId: 'uuid-a' }],
      observed: [{ symbol: 'AAA', protocolId: 'beta-v1' }],
    });
    const r = await service(p).protocolCountsForSymbols(['AAA']);
    expect(r.counts.AAA).toBe(2);
  });

  it('reports a FAILED source instead of counting it as zero silently', async () => {
    const p = makePrisma({ assignment: [{ symbol: 'AAA', protocolId: 'uuid-a' }] });
    p.scoreSnapshot.findMany = async () => {
      throw new Error('boom');
    };
    const r = await service(p).protocolCountsForSymbols(['AAA']);
    const observed = r.sourcesQueried.find((s) => s.source === 'observed');
    // The count is still 1 (assignment answered) — but the caller can SEE that `observed` did not.
    expect(observed).toBeDefined();
    expect(observed!.ok).toBe(false);
    expect(observed!.error).toContain('boom');
    expect(r.counts.AAA).toBe(1);
  });

  it('matches tickers case-insensitively and leaves an unknown symbol at a real zero', async () => {
    const p = makePrisma({ assignment: [{ symbol: 'aaa', protocolId: 'uuid-a' }] });
    const r = await service(p).protocolCountsForSymbols(['AAA', 'ZZZ']);
    expect(r.counts.AAA).toBe(1);
    expect(r.counts.ZZZ).toBe(0);
    // Every source answered, so ZZZ's 0 is a real zero rather than an unanswered question.
    expect(r.sourcesQueried.every((s) => s.ok)).toBe(true);
  });

  it('reports an id that matches no protocol row rather than dropping it', async () => {
    const p = makePrisma({ assignment: [{ symbol: 'AAA', protocolId: 'ghost-protocol' }] });
    const r = await service(p).protocolCountsForSymbols(['AAA']);
    expect(r.counts.AAA).toBe(0);
    expect(r.unresolved.map((u) => u.id)).toContain('ghost-protocol');
  });
});
