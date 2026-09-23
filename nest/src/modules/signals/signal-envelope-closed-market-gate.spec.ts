import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * #R13 — the closed-market skip must run BEFORE the work, and must fail open.
 *
 * ⚠️ WHY THIS SPEC IS A SCAN AND NOT A UNIT TEST. The rule it guards is *placement*: the gate has
 * to sit between "for each symbol" and "score this symbol". A behavioural test of the private
 * helper would pass with the gate called after `buildEnvelope()` — i.e. after the expensive work
 * had already happened, which is exactly the defect (a gate that exists but gates nothing is a
 * decoration). Nothing else in the repo can catch that, so the ordering itself is asserted.
 *
 * Owner, 2026-09-23: *"if the market is closed there is not meant to be new data for those symbols
 * so why score?"* — ruled a development decision, so there is no A/B copy to compare against; the
 * measurement is the before/after count in the handoff.
 *
 * Canary: moving the `closedMarketSkipReason` call below `buildEnvelope` fails the first test.
 */
describe('live ladder scoring skips a closed market (#R13)', () => {
  const raw = readFileSync(join(__dirname, 'signal-envelope.service.ts'), 'utf8');
  // Comments mention the gate by name, so they are stripped before the ordering scan: a scan that
  // cannot tell code from prose would pass on this docblock alone.
  const code = raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const ladderStart = code.indexOf('async buildLadder(');
  const ladderEnd = code.indexOf('async buildComparisonLadder(');
  const ladder = code.slice(ladderStart, ladderEnd === -1 ? undefined : ladderEnd);

  it('the skip runs BEFORE the symbol is scored (placement, not existence)', () => {
    const gateAt = ladder.indexOf('closedMarketSkipReason(ticker)');
    const scoreAt = ladder.indexOf('await this.buildEnvelope(ticker, protocolId)');
    expect(gateAt).toBeGreaterThan(-1);
    expect(scoreAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(scoreAt);
    // …and it must actually stop this symbol, not merely note it.
    expect(ladder).toMatch(/skipped\.push\(\{ symbol: ticker, reason: closed \}\);\s*\n\s*continue;/);
  });

  it('the skip is CARRIED, not only logged (a symbol must not just vanish)', () => {
    expect(code).toMatch(/skipped\?: Array<\{ symbol: string; reason: string \}>/);
    // ⚠️ CRLF-safe on purpose: the first version of this assertion used `\n` on both sides and
    // failed on CORRECT code because the file's line ending is `\r\n`. A guard that fails when the
    // code is right teaches the next reader to weaken the guard.
    expect(ladder).toMatch(/topConflicts,\s*skipped,/);
    // Typed on the interface rather than reached for with a cast (#976's lesson).
    expect(ladder).not.toContain('as any');
  });

  it('it FAILS OPEN — a status check must never silently stop the pipeline', () => {
    const helperStart = code.indexOf('closedMarketSkipReason(ticker: string)');
    expect(helperStart).toBeGreaterThan(-1);
    const helper = code.slice(helperStart, helperStart + 1400);
    // No bars is a FEED problem, not a closure — and an error must fall through to scoring.
    expect(helper).toContain('if (!bars || bars.length === 0) return null;');
    expect(helper).toMatch(/catch \{\s*\n\s*return null;/);
  });

  it('it uses the canonical predicate, so "closed" means one thing in this system', () => {
    expect(code).toContain("import { computeMarketStatus } from '../directives/market-status';");
    expect(code).toContain('const status = computeMarketStatus(bars);');
    // And it does NOT re-implement market hours locally.
    expect(code).not.toMatch(/getUTCHours\(\)\s*[<>=]/);
  });
});
