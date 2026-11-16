/**
 * movers-treatment.spec.ts — canaries for the two pure functions behind the movers view (#1281).
 *
 * ⚠️ WHAT THESE ARE FOR. The view collapses several facts into ONE word (`treatment`), and the
 * whole value of it is that the word means the right thing. A wrong classification here is
 * invisible: the page renders, the number is plausible, and an operator concludes "TCS ignored a
 * 40% mover" when in fact it refused it with a reason. So the ORDER and the four-state separation
 * are asserted, not assumed.
 */
import { clampInt, classifyTreatment, hotCandidates, verdictSentence } from './movers-treatment.service';

const base = {
  barsInWindow: 10,
  openPositions: 0,
  tradesToday: 0,
  queued: 0,
  decision: null as { decision: string } | null,
  bestCompositePct: null as number | null,
};

describe('clampInt', () => {
  it('falls back when the value is not a number, so a bad parameter cannot empty the result', () => {
    // Measured defect 2026-11-15: Number('abc') is NaN, NaN passes through Math.min/max, the SQL
    // bind is unusable, nothing matches, and the page reads "no movers" — a false empty.
    expect(clampInt('abc', 6, 1, 60)).toBe(6);
    expect(clampInt(undefined, 6, 1, 60)).toBe(6);
    expect(clampInt(null, 10, 1, 50)).toBe(10);
    expect(clampInt(NaN, 6, 1, 60)).toBe(6);
    expect(clampInt(Infinity, 6, 1, 60)).toBe(6);
    // An EMPTY query parameter is absence, not zero: `?bars=` must not silently mean 1 bar.
    expect(clampInt('', 6, 1, 60)).toBe(6);
    expect(clampInt('   ', 6, 1, 60)).toBe(6);
  });

  it('clamps a real number into range and truncates it', () => {
    expect(clampInt('12', 6, 1, 60)).toBe(12);
    expect(clampInt(999, 6, 1, 60)).toBe(60);
    expect(clampInt(-5, 6, 1, 60)).toBe(1);
    expect(clampInt(6.9, 6, 1, 60)).toBe(6);
    expect(clampInt(0, 6, 1, 60)).toBe(1);
  });
});

describe('classifyTreatment', () => {
  it('traded outranks everything, because an order is the furthest TCS got', () => {
    expect(classifyTreatment({ ...base, openPositions: 1, queued: 3, bestCompositePct: 90, tradesToday: 2 })).toBe('traded');
    expect(classifyTreatment({ ...base, tradesToday: 1 })).toBe('traded');
  });

  it('a pending queue row outranks a refusal, because the queue is newer work', () => {
    expect(classifyTreatment({ ...base, queued: 1, decision: { decision: 'BLOCKED' } })).toBe('queued');
  });

  it('a recorded refusal outranks a score — the score exists and the loop said no', () => {
    expect(classifyTreatment({ ...base, decision: { decision: 'SKIP' }, bestCompositePct: 88 })).toBe('refused');
  });

  it('scored-but-nothing-subscribed is its own state, not "refused" and not "unscored"', () => {
    expect(classifyTreatment({ ...base, bestCompositePct: 42 })).toBe('scored');
  });

  it('bars but no score is a COVERAGE GAP and is reported as one', () => {
    expect(classifyTreatment({ ...base })).toBe('unscored');
  });

  it('no bars is "cannot judge" — never a 0% move, never "unscored"', () => {
    expect(classifyTreatment({ ...base, barsInWindow: 0 })).toBe('no-data');
  });

  it('a non-refusal decision does not claim "refused"', () => {
    // decision_log records SCORED / ENTERED / EXITED too. Only the refusals are refusals.
    expect(classifyTreatment({ ...base, decision: { decision: 'ENTERED' }, bestCompositePct: 70 })).toBe('scored');
  });
});

describe('hotCandidates', () => {
  const t = 50;
  it('top-scoring mode reads the score, not the volume', () => {
    expect(hotCandidates({ mode: 'top-scoring', volumeSpike: false, compositePct: 60, topScoringThresholdPct: t })).toBe(true);
    expect(hotCandidates({ mode: 'top-scoring', volumeSpike: true, compositePct: 49, topScoringThresholdPct: t })).toBe(false);
  });

  it('volume-spike mode reads the volume, not the score', () => {
    expect(hotCandidates({ mode: 'volume-spike', volumeSpike: true, compositePct: null, topScoringThresholdPct: t })).toBe(true);
    expect(hotCandidates({ mode: 'volume-spike', volumeSpike: false, compositePct: 99, topScoringThresholdPct: t })).toBe(false);
  });

  it('all is the union', () => {
    expect(hotCandidates({ mode: 'all', volumeSpike: false, compositePct: 99, topScoringThresholdPct: t })).toBe(true);
    expect(hotCandidates({ mode: 'all', volumeSpike: true, compositePct: 0, topScoringThresholdPct: t })).toBe(true);
    expect(hotCandidates({ mode: 'all', volumeSpike: false, compositePct: 0, topScoringThresholdPct: t })).toBe(false);
  });

  it('an unknown or missing mode selects NOTHING — a typo must not behave like "all"', () => {
    expect(hotCandidates({ mode: 'typo', volumeSpike: true, compositePct: 99, topScoringThresholdPct: t })).toBe(false);
    expect(hotCandidates({ mode: null, volumeSpike: true, compositePct: 99, topScoringThresholdPct: t })).toBe(false);
  });

  it('is case- and whitespace-insensitive, so the stored value does not have to be exact', () => {
    expect(hotCandidates({ mode: ' Top-Scoring ', volumeSpike: false, compositePct: 60, topScoringThresholdPct: t })).toBe(true);
  });
});

describe('verdictSentence', () => {
  const row = {
    ticker: 'AAPL', changePct: 12.345, barsInWindow: 10,
    score: { protocolId: 'p', compositePct: 61.2, signal: 'BUY', snappedAt: '' },
    trading: { queued: 0, openPositions: 0, tradesToday: 0, lastTradeAt: null },
    decision: { decision: 'BLOCKED', reason: 'volume below floor', at: '' },
  } as any;

  it('names the move and what happened, so the row is readable without the table', () => {
    expect(verdictSentence({ ...row, treatment: 'refused' })).toContain('+12.35%');
    expect(verdictSentence({ ...row, treatment: 'refused' })).toContain('volume below floor');
  });

  it('says "cannot judge" for no-data, and never implies a flat price', () => {
    const s = verdictSentence({ ...row, treatment: 'no-data', changePct: null, barsInWindow: 0 } as any);
    expect(s).toContain('NO bars');
    expect(s).not.toContain('0.00%');
  });
});
