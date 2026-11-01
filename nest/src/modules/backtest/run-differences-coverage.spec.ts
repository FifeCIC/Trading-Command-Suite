/**
 * run-differences-coverage.spec.ts — EVERY STORED COLUMN IS EITHER DIFFED OR DECLARED EXCLUDED.
 *
 * ── WHY THIS EXISTS (measured 2026-11-01, #1141) ───────────────────────────────────────────────────
 * `maxLeverage` and `windowSource` were added to `backtestrun` and written on every run — and
 * `describeRunDifferences()` never learned about them. So two runs sized 1× and 4× compared as
 * "everything the same", and the P&L difference between them (measured −15,763.42 vs −31,688.16) had
 * no cause on screen. Nothing failed. The column existed, the value was correct, and the comparison
 * was silently incomplete — the repo's most expensive defect signature.
 *
 * The `run-differences.spec.ts` cases prove the FIELDS THAT EXIST work. This file proves the SET is
 * complete, which is the half a behavioural test cannot see: a field that was never added cannot fail
 * an assertion about it.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────────────────────────────
 * Every scalar column of `model BacktestRun` in `schema.prisma` must be in ONE of two places:
 *   • `DIFF_FIELD_NAMES`  — compared, and therefore visible when it differs
 *   • `EXCLUDED`          — declared, with the reason it is not an input
 * A new column that is in neither FAILS, and the failure names it. The decision is then made by a
 * person rather than by omission.
 *
 * ⚠️ THE COLUMN LIST IS READ FROM `schema.prisma`, NOT TYPED. A hand-maintained list here would drift
 * exactly the way the diff drifted, and would have been green throughout the defect.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DIFF_FIELD_NAMES } from './run-differences';

/**
 * Columns deliberately NOT in the comparison, each with the reason. This is a DECISION list, not an
 * allowlist: every entry says why the column is not an input that can differ between two runs, or —
 * where it genuinely is one — says so plainly instead of hiding it.
 */
const EXCLUDED: Record<string, string> = {
  id: 'identity of the run being compared, not a setting',
  symbolId: 'the FK; the diff compares the reader-facing ticker (`symbol`) instead of an opaque id',
  createdAt: 'when the run was made, not what it was made with',
  // ── RESULTS. Correct to exclude: this module answers "what was configured", and `RunDiffPanel`
  // answers "what the result was". Storing a result in a settings diff would double-count it.
  scoresJson: 'the stored score series — that IS the result, differenced separately by the panel',
  winRate: 'result (signal win rate)',
  totalPnl: 'result',
  profitFactor: 'result',
  sharpeRatio: 'result',
  maxDrawdown: 'result',
  averageReturn10d: 'result',
  maxReturn10d: 'result',
  avgTradePnl: 'result',
  totalTrades: 'result (trade count)',
  totalSignals: 'result (signal count)',
  totalDays: 'derived span of the window; `startDate`/`endDate` already carry the window itself',
  /**
   * ⚠️ A REAL GAP, declared rather than hidden. `experimentId` groups runs into a series, and two
   * runs from DIFFERENT experiments are arguably not comparable — but nothing in the comparison
   * groups by experiment yet, so putting it in the diff would add a row that no reader asked for and
   * that does not change any verdict. It is named here so the gap is visible rather than absent.
   */
  experimentId: 'NOT COMPARED — identifies the series a run belongs to; grouping by experiment is unimplemented (declared gap, not an input nobody missed)',
};

/** Scalar columns of `model BacktestRun`, read from the schema so the list cannot drift. */
function backtestRunColumns(): string[] {
  const schema = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'), 'utf8');
  const start = schema.indexOf('model BacktestRun {');
  if (start < 0) throw new Error('model BacktestRun not found in schema.prisma — this guard cannot read its input, so it must fail rather than pass');
  const body = schema.slice(start + 'model BacktestRun {'.length);
  const end = body.indexOf('\n}');
  if (end < 0) throw new Error('unterminated model BacktestRun block');
  /**
   * ⚠️ A RELATION IS NOT A COLUMN. Prisma writes relation fields exactly like scalars —
   * `trades BacktestTrade[]`, `symbol Symbol @relation(...)` — so a `@relation` filter alone misses
   * the list relations, which was observed: `trades` came through and the guard reported it as an
   * undecided column. The type must be a SCALAR, and that is a closed list.
   */
  const SCALAR_TYPES = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt', 'Bytes']);
  return body
    .slice(0, end)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|@@|$)/.test(l))
    .map((l) => l.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && SCALAR_TYPES.has(parts[1].replace('?', '').replace('[]', '')))
    .map((parts) => parts[0])
    .filter((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name));
}

describe('the run-settings diff covers every stored column', () => {
  it('reads the model it claims to read (a guard that inspects nothing must fail)', () => {
    const cols = backtestRunColumns();
    expect(cols.length).toBeGreaterThan(20);
    expect(cols).toContain('maxLeverage');
    expect(cols).toContain('windowSource');
  });

  it('has no column that is neither compared nor declared excluded', () => {
    const cols = backtestRunColumns();
    const undecided = cols.filter((c) => !DIFF_FIELD_NAMES.includes(c) && !(c in EXCLUDED));
    // The message IS the deliverable: it must name the column so the next person can act on it.
    expect(undecided).toEqual([]);
  });

  it('declares no dead entry — every excluded name is still a real column', () => {
    // The other direction. An exclusion for a column that was renamed or dropped is a stale claim
    // that would silently stop guarding the new name.
    const cols = new Set(backtestRunColumns());
    const stale = Object.keys(EXCLUDED).filter((c) => !cols.has(c));
    expect(stale).toEqual([]);
  });

  it('declares no field twice', () => {
    const both = DIFF_FIELD_NAMES.filter((f) => f in EXCLUDED);
    expect(both).toEqual([]);
  });
});
