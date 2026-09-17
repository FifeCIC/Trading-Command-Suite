import { BOT_RULES, LIVE_RULES, NOT_LIVE_RULES, NON_BEHAVIOURAL_COLUMNS, ruleEnforcementCounts } from './bot-rules';

/**
 * The bot rule REGISTRY — invariants the build gate cannot check.
 *
 * `nest/scripts/validate-bot-rules.cjs` proves every column on `trading_strategy` has a declaration
 * and that each declared enforcer exists. It CANNOT check the registry's own hygiene: duplicate
 * field entries, a missing `summary`, an invalid stage, or a `none` rule with no caveat warning the
 * reader. Those are the checks here.
 *
 * The last test is the named regression guard for the finding that started this file: 8 behavioural
 * columns were enforced nowhere while the create form offered every one of them. If someone
 * implements hot-stock trading, that test SHOULD fail — and the fix is to update the registry, which
 * is exactly the point.
 */
describe('bot-rules registry — a bot declared once', () => {
  const VALID_STAGES = ['identity', 'scope', 'routing', 'entry', 'sizing', 'exit', 'risk'];
  const VALID_ENFORCEMENT = ['live', 'legacy-only', 'display-only', 'none'];

  it('declares each column exactly once', () => {
    const seen = new Map<string, number>();
    for (const r of BOT_RULES) seen.set(r.field, (seen.get(r.field) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([f]) => f);
    expect(dupes).toEqual([]);
  });

  it('never declares an id/bookkeeping column as a rule', () => {
    for (const col of NON_BEHAVIOURAL_COLUMNS) {
      expect(BOT_RULES.find((r) => r.field === col)).toBeUndefined();
    }
  });

  it('gives every rule a valid stage, a valid enforcement value, a label and a summary', () => {
    for (const r of BOT_RULES) {
      expect(VALID_STAGES).toContain(r.stage);
      expect(VALID_ENFORCEMENT).toContain(r.enforcement);
      expect(r.label.trim().length).toBeGreaterThan(0);
      expect(r.summary.trim().length).toBeGreaterThan(0);
    }
  });

  it('warns the reader on every rule that could mislead — legacy-only and none', () => {
    // ⚠️ NARROW ON PURPOSE. Requiring a caveat on every non-live rule was the first version of this
    // test and it failed on `name` and `description` — labels nobody could mistake for a rule.
    // Demanding prose there is noise, and a noisy guard gets allowlisted, and an allowlisted guard is
    // worse than none (development-philosophy §5). So the requirement is scoped to the two cases
    // that genuinely mislead:
    //
    //   `legacy-only` — the field IS enforced, so it looks real, but not on the path that trades
    //   `none`        — the field is offered in the create form and does nothing at all
    //
    // A `display-only` rule may carry a caveat (`timeframe`, `shortProtocolId`, `scoringStrategyId`
    // all do, and it is useful) but is not required to.
    const mustWarn = BOT_RULES.filter((r) => r.enforcement === 'legacy-only' || r.enforcement === 'none');
    expect(mustWarn.length).toBeGreaterThan(0); // guards against the filter silently matching nothing
    for (const r of mustWarn) {
      expect(`${r.field}: ${r.caveat ?? ''}`).not.toBe(`${r.field}: `);
      expect((r.caveat ?? '').trim().length).toBeGreaterThan(20);
    }
  });

  it('if a display-only rule does carry a caveat, it is not empty', () => {
    for (const r of BOT_RULES.filter((x) => x.enforcement === 'display-only' && x.caveat !== undefined)) {
      expect(r.caveat!.trim().length).toBeGreaterThan(10);
    }
  });

  it('keeps the live / not-live split consistent with the registry', () => {
    expect(LIVE_RULES.length + NOT_LIVE_RULES.length).toBe(BOT_RULES.length);
    for (const r of LIVE_RULES) expect(r.enforcement).toBe('live');
    for (const r of NOT_LIVE_RULES) expect(r.enforcement).not.toBe('live');
  });

  it('only claims a file for rules that assert enforcement', () => {
    for (const r of BOT_RULES) {
      if (r.enforcement === 'live' || r.enforcement === 'legacy-only') {
        expect(r.enforcedBy).toBeTruthy();
      } else if (r.enforcement === 'none') {
        expect(r.enforcedBy).toBeNull();
      }
    }
  });

  it('counts match the registry', () => {
    const counts = ruleEnforcementCounts();
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(BOT_RULES.length);
    expect(counts['live']).toBe(LIVE_RULES.length);
  });

  /**
   * REGRESSION GUARD — the four hot-stock fields are declared, persisted, offered in the create
   * form, covered by QA round-trip tests, and marked `devCompletion: 'complete'` in
   * `known-features.js` — while being enforced NOWHERE in trading.
   *
   * That combination is the whole problem: every signal a reader has says "this works", and the one
   * thing that would tell them otherwise is this declaration. If hot-stock trading is built, this
   * test fails and must be updated deliberately.
   */
  it('reports the hot-stock fields as enforced nowhere', () => {
    for (const field of ['hotStockEnabled', 'hotStockAllocation', 'hotStockDetectionMode', 'hotStockMaxHoldHours']) {
      const rule = BOT_RULES.find((r) => r.field === field);
      expect(rule).toBeDefined();
      expect(rule!.enforcement).toBe('none');
      expect(rule!.caveat).toMatch(/NO READER/);
    }
  });

  it('records the fields whose enforcement is only on the legacy execute() path', () => {
    // These are the trap: they ARE enforced, just not where the live loop trades. A UI "Execute"
    // button applies them; the automation loop does not.
    const legacy = NOT_LIVE_RULES.filter((r) => r.enforcement === 'legacy-only').map((r) => r.field);
    expect(legacy).toEqual(
      expect.arrayContaining(['minRarityBand', 'useRaritySizing', 'maxSize', 'maxPositions', 'maxDailyLoss']),
    );
  });
});
