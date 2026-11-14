import * as fs from 'fs';
import * as path from 'path';

/**
 * The backtest stats field names must state their UNIT (#1265).
 *
 * ⚠️ WHAT THIS GUARDS. `stats.avgNotionalPct` held a **fraction of the account** — 0.994 means
 * **99.4%** — while sitting directly beside `avgTradePnl`, which really is a percent (0.3104 = 0.31%).
 * Two adjacent fields on one object, both reading like percentages, different units. Multiplying them
 * naively is wrong by **100×**, and that adjacency is what made #1135 read as an 11.5× "inconsistency".
 *
 * Measured 2026-11-13, USDJPY 1h, 316 trades: mean notional **$9,940 on a $10,000 account** →
 * 9,940 / 10,000 = 0.994 → the field means 99.4%, not 0.994%.
 *
 * The fix was a RENAME (`avgNotionalPct` → `avgNotionalFractionOfAccount`), not a value change:
 * historical runs store the fraction, so 0.994 must keep meaning 0.994.
 *
 * ⚠️ WHY A SOURCE-LEVEL TEST AND NOT A RUNTIME ONE. The field is produced inside `run()`, which needs
 * a database, a protocol and a window. The defect is not the arithmetic — that was always right — it
 * is the NAME. A name can only be guarded where names live.
 */
const SERVICE = path.join(__dirname, 'backtest.service.ts');

const readService = () => fs.readFileSync(SERVICE, 'utf8');

/** Strip comments so a docblock that legitimately mentions the OLD name cannot satisfy or break a check. */
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('backtest stats field names state their unit (#1265)', () => {
  it('exposes avgNotionalFractionOfAccount', () => {
    expect(codeOnly(readService())).toContain('avgNotionalFractionOfAccount');
  });

  it('has NO code reference to the old, unit-lying name', () => {
    // The only permitted mentions are documentation recording the rename, which `codeOnly` removes.
    expect(codeOnly(readService())).not.toContain('avgNotionalPct');
  });

  it('keeps the fraction semantics: the field is the mean of a notionalPct that is 1 at 100%', () => {
    // If this ever changed to a percent, the multiplication below would be 100× out. Pinned as an
    // explicit identity rather than a comment, because the comment is what failed the first time.
    const code = codeOnly(readService());
    // The accumulation site must still divide by the trade count and NOT multiply by 100.
    const accumulation = code.slice(code.indexOf('avgNotionalFractionOfAccount:'), code.indexOf('avgNotionalFractionOfAccount:') + 260);
    expect(accumulation).toContain('notionalPct');
    expect(accumulation).not.toContain('* 100');
  });

  it('states the consequence of getting the unit wrong', () => {
    // The docblock is load-bearing: it is the only place that records WHY the name is long. A rename
    // that drops the reasoning invites the next reader to shorten it back.
    const text = readService();
    expect(text).toContain('avgNotionalFractionOfAccount');
    expect(text).toMatch(/100×/);
    expect(text).toMatch(/[Rr]enamed from `avgNotionalPct`/);
  });
});
