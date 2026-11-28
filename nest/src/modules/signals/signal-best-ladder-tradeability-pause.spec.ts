/**
 * #1359 — a symbol that is not tradeable in the current market state must never reach `buildEnvelope()`.
 *
 * ⚠️ WHY THIS IS A SOURCE SCAN, NOT A UNIT TEST — the same reasoning as
 * `signal-envelope-closed-market-gate.spec.ts`, whose pattern this follows. The rule is *placement*:
 * the pause has to sit between "for each symbol" and "score this symbol". A behavioural test of the
 * filter would still pass if the check were moved BELOW `buildEnvelope()` — the score would be
 * computed and discarded, which is exactly the defect (the work is the cost, not the row). Nothing
 * else in the repo can see that ordering.
 *
 * The assessor's own rules are unit-tested in `calendar/symbol-tradeability.spec.ts` (extended is
 * tradeable, closed pauses, unknown fails open). This file guards only the WIRING.
 *
 * Canary: moving `if (!verdict.tradeable) continue;` below `await this.buildEnvelope(...)` fails
 * tests 1 and 2. Verified by mutation on 2026-11-28 — see the comment on the placement test.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

describe('buildBestLadder pauses a non-tradeable symbol BEFORE scoring (#1359)', () => {
  const raw = readFileSync(join(__dirname, 'signal-envelope.service.ts'), 'utf8');
  // Comments name the gate, so they are stripped first: a scan that cannot tell code from prose
  // would pass on the docblock alone.
  const code = raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  const start = code.indexOf('async buildBestLadder(');
  const end = code.indexOf('async dismissSignal(');
  const ladder = start === -1 ? '' : code.slice(start, end === -1 ? undefined : end);

  it('the file still has the method this spec scans (a scan that reads nothing must not pass)', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(ladder).toContain('await this.buildEnvelope(');
  });

  it('the verdict is taken ONCE per protocol, before the symbol loop', () => {
    const verdictAt = ladder.indexOf('this.protocolGating.assessTradeability(');
    const loopAt = ladder.indexOf('for (const { ticker, verdict } of tradeability)');
    expect(verdictAt).toBeGreaterThan(-1);
    expect(loopAt).toBeGreaterThan(-1);
    expect(verdictAt).toBeLessThan(loopAt);
  });

  it('a paused symbol is skipped BEFORE it is scored (placement, not existence)', () => {
    const guardAt = ladder.indexOf('if (!verdict.tradeable)');
    const scoreAt = ladder.indexOf('await this.buildEnvelope(');
    expect(guardAt).toBeGreaterThan(-1);
    expect(scoreAt).toBeGreaterThan(-1);
    // ⚠️ The canary for this line: move the guard below `buildEnvelope` and this flips. Measured by
    // mutation, not assumed.
    expect(guardAt).toBeLessThan(scoreAt);
  });

  it('the skip STOPS the symbol, not merely notes it', () => {
    // CRLF-safe: a guard that fails on correct code teaches the next reader to weaken the guard.
    expect(ladder).toMatch(/if \(!verdict\.tradeable\)\s*continue;/);
  });

  it('an all-paused protocol stands by BEFORE any scoring attempt', () => {
    const standbyAt = ladder.indexOf("state: 'standby'");
    const scoredCounterAt = ladder.indexOf('let protoScored');
    expect(standbyAt).toBeGreaterThan(-1);
    expect(scoredCounterAt).toBeGreaterThan(-1);
    expect(standbyAt).toBeLessThan(scoredCounterAt);
  });

  it('the pause is CARRIED, not only logged', () => {
    expect(ladder).toContain('symbolsPaused: paused.length');
    expect(ladder).toContain('pausedSymbols:');
  });

  it('it reads the shared assessor and does NOT re-implement market hours', () => {
    expect(ladder).toContain('this.protocolGating.assessTradeability(');
    expect(ladder).not.toContain('getUTCHours()');
    expect(ladder).not.toContain('marketCalendar');
  });
});
