import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A backtest trade's timestamp is an INSTANT, not a day bucket (#819).
 *
 * ⚠️ WHY THIS SPEC EXISTS. `entryDate` and `exitDate` were both written as
 *
 *   currentBar.timestamp.toISOString().split('T')[0]
 *
 * which silently discards the time of day. Measured 2026-09-23: **556 of 556** persisted trades
 * sat at `00:00:00.000`, and on 5m runs `entryDate == exitDate` for **117 of 117** — while
 * `marketBar` holds true 5-minute bars (XAUUSD 5m: 11,405 of them). The replay view (#819) cannot
 * place a marker on a price timeline from a date alone, so this is the prerequisite it was
 * blocked on — and nothing in the pipeline complained, because a midnight timestamp is a
 * perfectly well-formed value. Plausible output, no error.
 *
 * The durable guard is this scan plus the live check recorded in the handoff (a fresh run must
 * show intraday times). The scan is deliberately a SYMPTOM guard: it forbids the truncation,
 * not any particular way of computing the timestamp.
 *
 * Canary: re-adding `.split('T')[0]` to either assignment fails the second test; restoring it
 * byte-for-byte passes again.
 */
describe('backtest trade timestamps carry an instant, not a day bucket (#819)', () => {
  const raw = readFileSync(join(__dirname, 'backtest.service.ts'), 'utf8');
  // Comments are stripped before scanning: the docblock above legitimately QUOTES the truncated
  // form, and a scan that cannot tell code from prose would fail for the wrong reason.
  const code = raw.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  it('the entry timestamp is written as a full ISO instant', () => {
    expect(code).toContain('entryDate: currentBar.timestamp.toISOString()');
  });

  it('no trade timestamp is truncated to a date (the class, not one instance)', () => {
    const truncated = [
      ...code.matchAll(/\b(?:entryDate\s*[:=]|exitDate\s*=)[^;\n]*split\('T'\)\[0\]/g),
    ].map((m) => m[0]);
    expect(truncated).toEqual([]);
  });

  it('the persist path stores both ends as dates, so an instant survives the round trip', () => {
    expect(code).toContain('entryDate: new Date(t.entryDate)');
    expect(code).toContain('exitDate: new Date(t.exitDate)');
  });

  it('the results payload serves both as ISO strings', () => {
    expect(code).toContain('entryDate: t.entryDate.toISOString()');
    expect(code).toContain('exitDate: t.exitDate.toISOString()');
  });
});
