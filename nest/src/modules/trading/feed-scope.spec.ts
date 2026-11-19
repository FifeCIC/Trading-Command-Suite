import { scopeVerdict, type FeedSnapshot } from './feed-scope';

/**
 * #1314 — feed scope. Every rule is exercised in BOTH directions.
 *
 * ⚠️ The last describe block is the CANARY, and it is the reason this file exists rather than a
 * handful of happy-path assertions: it replays the PRE-#1314 routing line verbatim and asserts the
 * two disagree. Without it, a `scopeVerdict` that returned `allowed: true` unconditionally would
 * still pass every other test here (most of them assert an allow somewhere), and the guard would be
 * a decoration.
 */

const feed = (over: Partial<FeedSnapshot> = {}): FeedSnapshot => ({
  entryAllowed: true,
  entryRefusalReason: null,
  winners: [{ ticker: 'NXXT' }, { ticker: 'BGS' }],
  losers: [{ ticker: 'CUE' }, { ticker: 'MDRN' }],
  ...over,
});

const base = {
  scopeMode: 'fixed',
  feedList: null,
  strategySymbol: 'AAPL',
  candidateSymbol: 'AAPL',
  feed: null,
} as const;

describe('scopeVerdict — fixed scope preserves pre-#1314 behaviour exactly', () => {
  it('allows the pinned symbol', () => {
    expect(scopeVerdict({ ...base })).toEqual({ allowed: true });
  });

  it('refuses a different symbol', () => {
    const v = scopeVerdict({ ...base, candidateSymbol: 'MSFT' });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('scope-symbol-mismatch');
  });

  it('allows any symbol when the bot names none — the old line treated empty as "no filter"', () => {
    expect(scopeVerdict({ ...base, strategySymbol: '' })).toEqual({ allowed: true });
    expect(scopeVerdict({ ...base, strategySymbol: null })).toEqual({ allowed: true });
  });

  it('treats a missing scopeMode (a row predating #1314) as fixed', () => {
    expect(scopeVerdict({ ...base, scopeMode: null })).toEqual({ allowed: true });
  });

  it('compares tickers case-insensitively', () => {
    expect(scopeVerdict({ ...base, strategySymbol: 'aapl', candidateSymbol: 'AAPL' })).toEqual({ allowed: true });
  });
});

describe('scopeVerdict — feed scope', () => {
  const feedBot = { ...base, scopeMode: 'feed', feedList: 'winners' } as const;

  it('allows a ticker that is on today\'s list, ignoring the placeholder symbol', () => {
    // strategySymbol is still 'AAPL'; the signal is for NXXT. The placeholder must not veto it.
    expect(scopeVerdict({ ...feedBot, candidateSymbol: 'NXXT', feed: feed() })).toEqual({ allowed: true });
  });

  it('refuses a ticker that is not on today\'s list', () => {
    const v = scopeVerdict({ ...feedBot, candidateSymbol: 'TSLA', feed: feed() });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('not-on-todays-list');
  });

  it('draws from the losers list when feedList says so, and not from winners', () => {
    const short = { ...feedBot, feedList: 'losers' } as const;
    expect(scopeVerdict({ ...short, candidateSymbol: 'CUE', feed: feed() })).toEqual({ allowed: true });
    const v = scopeVerdict({ ...short, candidateSymbol: 'NXXT', feed: feed() });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('not-on-todays-list');
  });

  it('refuses when the feed says entry is not allowed, carrying the feed\'s own reason', () => {
    const v = scopeVerdict({
      ...feedBot,
      candidateSymbol: 'NXXT',
      feed: feed({ entryAllowed: false, entryRefusalReason: 'delay is 20 minutes, past the 15-minute limit' }),
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.code).toBe('feed-entry-not-allowed');
      // The reason is passed through, not re-worded — the log and the banner cannot disagree.
      expect(v.reason).toContain('20 minutes');
    }
  });

  it('refuses when the feed could not be read at all', () => {
    const v = scopeVerdict({ ...feedBot, candidateSymbol: 'NXXT', feed: null });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('feed-unavailable');
  });

  it('refuses when the named list is empty', () => {
    const v = scopeVerdict({ ...feedBot, candidateSymbol: 'NXXT', feed: feed({ winners: [] }) });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('feed-list-empty');
  });

  it('refuses a feed bot that declares no feedList — it must not default to winners', () => {
    const v = scopeVerdict({ ...feedBot, feedList: null, candidateSymbol: 'NXXT', feed: feed() });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('feed-list-unspecified');
  });

  it('refuses an unrecognised feedList rather than treating it as one of the two', () => {
    const v = scopeVerdict({ ...feedBot, feedList: 'mostActive', candidateSymbol: 'NXXT', feed: feed() });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('feed-list-unspecified');
  });

  it('refuses an unrecognised scopeMode, neither dispatching on the placeholder nor widening', () => {
    const v = scopeVerdict({ ...base, scopeMode: 'FEEd ', candidateSymbol: 'AAPL', feed: feed() });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('scope-mode-unknown');
  });

  it('never lets a feed bot trade an arbitrary symbol when the list is the only authority', () => {
    // The widening this whole change defends against: 20 winners exist, 500 symbols were scored.
    // Only the 20 may pass.
    const many = feed({ winners: Array.from({ length: 20 }, (_, i) => ({ ticker: `W${i}` })) });
    expect(scopeVerdict({ ...feedBot, candidateSymbol: 'W7', feed: many })).toEqual({ allowed: true });
    expect(scopeVerdict({ ...feedBot, candidateSymbol: 'NOTALISTED', feed: many }).allowed).toBe(false);
  });
});

describe('CANARY — the pre-#1314 rule and this one must disagree, or the guard is decoration', () => {
  /** Verbatim from `signal-queue.service.ts` before #1314. */
  const oldRuleAllows = (strategySymbol: string, candidate: string) =>
    !(strategySymbol && strategySymbol !== candidate);

  it('OLD rule refuses every feed-scoped signal; NEW rule allows the on-list one', () => {
    const strategySymbol = 'AAPL'; // the placeholder both movers bots carry
    expect(oldRuleAllows(strategySymbol, 'NXXT')).toBe(false); // ← the defect #1314 names
    expect(scopeVerdict({ ...base, scopeMode: 'feed', feedList: 'winners', candidateSymbol: 'NXXT', feed: feed() }))
      .toEqual({ allowed: true });
  });

  it('OLD rule allows a signal the NEW rule must refuse (off-list ticker)', () => {
    // With no pinned symbol the old line let ANY scored symbol through — the "trade everything"
    // shape. The new rule refuses it, so the two verdicts differ here too.
    expect(oldRuleAllows('', 'NOTALISTED')).toBe(true);
    expect(
      scopeVerdict({ ...base, scopeMode: 'feed', feedList: 'winners', candidateSymbol: 'NOTALISTED', feed: feed() })
        .allowed,
    ).toBe(false);
  });
});
