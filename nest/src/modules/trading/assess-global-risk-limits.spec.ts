import { TradingStrategyService } from './trading-strategy.service';
import { RiskService } from '../risk/risk.service';

/**
 * assessGlobalRiskLimits() — the gates that stand between a signal and a real order.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FILE WAS CREATED FOR (#848, measured live 2026-09-16)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The account was read as `account?.equity ?? account?.balance ?? 10_000`, and that value seeded
 * `peakEquity`, which is MONOTONIC (only ever increases). So a bridge outage — when `getAccount()`
 * fails and `account` is `null` — permanently stamped **10,000** as the high-water mark. When the
 * bridge RECOVERED, the real ~$1,389 account read as a catastrophic loss:
 *
 *     08:28-18:40   bridge unreachable — 707 FAILED decisions; account=null -> peak = 10,000
 *     ~18:40        bridge recovers (both bridges connected=true)
 *     18:42, 18:44  EURCAD/NZDJPY/EURCHF/GBPCAD blocked: "Drawdown 86.1% exceeds limit"
 *     arithmetic    (10_000 - 1,389.37) / 10_000 = 86.11%   <- the logged figure, exactly
 *
 * It was SELF-INFLICTED BY RECOVERY (the system got worse as infrastructure got better) and it
 * NEVER EXPIRED (the peak is in-memory, so trading stayed blocked until a restart).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE SECOND BUG, ADDED 2026-09-18 (#865)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The per-symbol cap compared an estimate against 25% of the portfolio, and the estimate was
 * `(size × 100_000) / (balance / margin)`. It had no price and no contract size, so **XAUUSD and
 * NZDJPY produced the same number**; and `balance / margin` is margin UTILISATION (8.62), not the
 * account's 1:100, so it was ~11x too high. It refused 78 trades in one day.
 *
 * That gate now reads real inputs — contract size from `/symbol/<SYM>/info`, the account's declared
 * leverage, and a converted price. See `common/trading/position-margin.ts` for the formula and the
 * live-account measurement that proves it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE PRINCIPLE BOTH DEFECTS SHARE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Neither errored. Both returned a plausible number and the output looked like a normal result.
 * So these tests use the REAL `RiskService` (mocking `checkDrawdown` would only prove the mock
 * agrees with itself), and they assert the DIRECTION of a refusal as well as its existence.
 */
describe('assessGlobalRiskLimits — drawdown baseline must be real (#848)', () => {
  /** Small enough that `canOpenPosition`'s maxPerSymbol (25%) never masks the drawdown result. */
  const SIZE = 0.001;

  /**
   * ⚠️ The per-symbol cap now needs the INSTRUMENT, not just a size (#865). Every call passes it.
   * A helper rather than a literal at each of the call sites, so a future signature change is one
   * edit rather than eight.
   */
  const SYMBOL = 'XAUUSD';
  const assess = (svc: any) => svc.assessGlobalRiskLimits(SIZE, SYMBOL);

  /**
   * The account fields the gates require.
   *
   * ⚠️ `leverage` and `currency` are REQUIRED by the per-symbol estimate (#865) and were unused by
   * this method before, so every fixture here had to gain them. A fixture missing `leverage` makes
   * the estimate `unavailable` and the gate REFUSES by design — which would otherwise look like
   * these drawdown tests failing.
   */
  const acct = (o: Record<string, unknown>) => ({ leverage: 100, currency: 'GBP', ...o });

  function build(mt5: Record<string, any>) {
    const notificationService = {
      notifyDrawdown: jest.fn().mockResolvedValue(undefined),
    } as any;
    // The real service — the arithmetic is part of what is being tested.
    const riskService = new RiskService(notificationService);

    // Only used for the daily-loss query, which is wrapped in try/catch and not under test.
    const prisma = {
      trade: { findMany: jest.fn().mockRejectedValue(new Error('not under test')) },
    } as any;

    /**
     * ⚠️ The risk caps moved from env to `SettingsResolverService` (risk.maxPositionSize,
     * risk.maxOpenPositions, risk.maxDailyLoss). This stub returns the DEFAULTS DECLARED IN
     * `settings-registry.ts` (1.0 / 5 / 100), which is what a real `get()` yields when no row
     * exists — `resolve()` falls back to the declared default rather than returning undefined.
     *
     * A bare `{}` would make `settings.get(...)` throw and the whole method would be skipped,
     * so these tests would pass while testing nothing. Same defect as the time-stop fixture that
     * fed a comment format the writer never emits.
     *
     * ⚠️ 2026-09-17 (#865) — `risk.maxPerSymbol` and `risk.maxDrawdown` were ADDED to this map when
     * they stopped being hardcoded literals. Leaving them out was not a harmless staleness: the caps
     * arrived as `undefined`, and `drawdown >= undefined` is `false`, so the drawdown gate silently
     * STOPPED BLOCKING and only the "still blocks a genuine drawdown" test noticed. A fixture that
     * mirrors the registry is load-bearing here; when the registry gains a cap, this map must too.
     */
    const settings = {
      get: jest.fn(async (key: string) =>
        ({
          'risk.maxPositionSize': 1.0,
          'risk.maxOpenPositions': 5,
          'risk.maxDailyLoss': 100,
          'risk.maxPerSymbol': 0.25,
          'risk.maxDrawdown': 0.25,
        } as Record<string, number>)[key],
      ),
    } as any;

    // ⚠️ 2026-09-18 (#865) — the per-symbol cap reads the instrument's CONTRACT SIZE and PRICE.
    // Supplied here (unless a test overrides them) so each test states only what it is testing.
    // A MISSING method throws, and the gate refuses on a throw — see the fail-closed test below.
    mt5.getSymbolInfo = mt5.getSymbolInfo ?? jest.fn(async () => ({
      name: SYMBOL, digits: 2, contractSize: 100, volumeMin: 0.01, volumeMax: 100,
    }));
    // Also serves the profit→account conversion. ⚠️ This mirrors the LIVE broker faithfully:
    // it quotes GBPUSD and GBPJPY and returns NOTHING for USDGBP/JPYGBP (both 404), so the
    // estimator is forced down its inverse path. A mock that answered every pair would make the
    // tests pass while the real conversion silently failed — and a rate of `4346.06` for USDGBP
    // (the gold price) is exactly the kind of plausible-looking wrong number this change exists to
    // eliminate.
    const FX_QUOTES: Record<string, number> = { GBPUSD: 1.33838, GBPJPY: 209.768 };
    mt5.getQuote = mt5.getQuote ?? jest.fn(async (s: string) => {
      if (s === SYMBOL) return { bid: 4346, ask: 4346.5, last: 4346.06 };
      const last = FX_QUOTES[s];
      return last != null ? { bid: last, ask: last, last } : null; // null = "broker does not quote it"
    });

    return new TradingStrategyService(
      prisma,
      mt5 as any,
      {} as any, // conditionDetector  — untouched by this method
      riskService,
      notificationService,
      {} as any, // protocolGating     — untouched by this method
      settings,  // SettingsResolverService — risk caps resolve from here
    );
  }

  it('a bridge outage must not become a permanent 86% drawdown once the bridge recovers', async () => {
    const mt5 = { getPositions: jest.fn(), getAccount: jest.fn() };
    const svc = build(mt5);

    // ── tick 1: bridge unreachable — exactly the 707 ticks measured on 2026-09-16 ──
    mt5.getPositions.mockRejectedValue(new Error('Bridge unreachable (circuit breaker active)'));
    mt5.getAccount.mockRejectedValue(new Error('Bridge unreachable (circuit breaker active)'));

    const first = await assess(svc);
    expect(first.allowed).toBe(true); // drawdown is 0% on the first call either way

    // ── tick 2: SAME account, bridge healthy again. Nothing about the account changed. ──
    mt5.getPositions.mockResolvedValue([]);
    mt5.getAccount.mockResolvedValue(acct({ equity: 1389.37, balance: 1389.37, margin: 100 }));

    const second = await assess(svc);

    // REGRESSION GUARD: before the fix this was
    //   { allowed: false, reason: 'Drawdown 86.1% exceeds limit' }
    // — a risk gate failing CLOSED on a number it had invented.
    expect(second.reason).not.toContain('Drawdown');
    expect(second.allowed).toBe(true);
  });

  it('does not record a peak at all while the account is unreadable', async () => {
    const mt5 = { getPositions: jest.fn(), getAccount: jest.fn() };
    const svc = build(mt5);

    mt5.getPositions.mockRejectedValue(new Error('bridge down'));
    mt5.getAccount.mockRejectedValue(new Error('bridge down'));

    await assess(svc);

    // The peak is private, so assert it through behaviour: a LARGE first real reading must not be
    // treated as a drawdown from anything, and a small one must not be reported as a loss.
    mt5.getPositions.mockResolvedValue([]);
    mt5.getAccount.mockResolvedValue(acct({ equity: 500, balance: 500, margin: 100 }));

    const after = await assess(svc);
    expect(after.allowed).toBe(true);
    expect(after.reason).not.toContain('Drawdown');
  });

  it('STILL blocks a genuine drawdown against a real peak — the gate is not disabled', async () => {
    const mt5 = { getPositions: jest.fn().mockResolvedValue([]), getAccount: jest.fn() };
    const svc = build(mt5);

    mt5.getAccount.mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 }));
    const atPeak = await assess(svc);
    expect(atPeak.allowed).toBe(true);

    // A real 40% fall — above the 25% maxDrawdown.
    mt5.getAccount.mockResolvedValue(acct({ equity: 600, balance: 600, margin: 100 }));
    const afterDrop = await assess(svc);

    expect(afterDrop.allowed).toBe(false);
    expect(afterDrop.reason).toContain('Drawdown');
    expect(afterDrop.reason).toContain('40.0%');
  });

  /**
   * REGRESSION GUARD — an unreadable cap must REFUSE, not disappear (#865, 2026-09-17).
   *
   * This test exists because the failure it describes actually happened while #865 was being
   * written. Adding `risk.maxPerSymbol` / `risk.maxDrawdown` to the profile turned a test fixture
   * that did not list them into one where both arrived as `undefined` — and:
   *
   *     allocation  > undefined   is false   ->  the per-symbol cap stopped blocking
   *     drawdown   >= undefined   is false   ->  the drawdown cap stopped blocking
   *
   * Nothing errored. Nothing was logged. The gate simply reported that everything was fine, which
   * is the single most expensive failure shape in this codebase — a risk control that is OFF while
   * reading as ON.
   *
   * Refusing is the correct direction. "We could not evaluate the limit" must never render as "the
   * limit is fine": on a money path the difference is a trade nobody authorised.
   */
  it('REFUSES the order when a cap cannot be read — an unreadable cap must not disable the gate', async () => {
    const mt5 = {
      getPositions: jest.fn().mockResolvedValue([]),
      getAccount: jest.fn().mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 })),
    };
    const svc = build(mt5);

    // Reach in and remove a cap, exactly as a missing setting row would.
    const settingsStub = (svc as any).settings;
    const realGet = settingsStub.get.getMockImplementation();
    settingsStub.get.mockImplementation(async (key: string) =>
      key === 'risk.maxDrawdown' ? undefined : realGet(key),
    );

    const result = await assess(svc);

    expect(result.allowed).toBe(false);
    // The reason must NAME the key — a bare "risk check failed" would send the next reader looking
    // through five gates instead of at the one setting that is missing.
    expect(result.reason).toContain('risk.maxDrawdown');
    expect(result.reason).toContain('unreadable');
  });

  it('the unreadable-cap guard is not vacuous — a fully readable set still trades', async () => {
    // ⚠️ Two-directional on purpose. The test above proves the refusal FIRES; this one proves it does
    // not fire when every cap is present. Without it, a guard that refused unconditionally would
    // pass the test above and quietly stop all trading.
    const mt5 = {
      getPositions: jest.fn().mockResolvedValue([]),
      getAccount: jest.fn().mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 })),
    };
    const svc = build(mt5);
    const result = await assess(svc);
    expect(result.allowed).toBe(true);
    expect(result.reason).not.toContain('unreadable');
  });

  /**
   * REGRESSION GUARD — a THROW inside the per-symbol estimate must REFUSE (#865, 2026-09-18).
   *
   * ⚠️ This test exists because the defect it covers happened while the fix was being written. The
   * estimate sits inside the portfolio-gate `try`, whose catch logs "proceeding with caution" and
   * lets the order through. A test double without `getSymbolInfo` made the method throw, the outer
   * catch swallowed it, and a gate expected to BLOCK returned `allowed: true`.
   *
   * "Proceeding with caution" is the right answer for an unreadable ACCOUNT — there is no drawdown
   * to measure, and the bridge-down path is handled elsewhere. It is the WRONG answer for a cap we
   * simply failed to compute, because the resulting trade looks like it passed a check that never
   * ran.
   */
  it('REFUSES when the per-symbol estimate throws — a broken input must not disable the cap', async () => {
    const mt5 = {
      getPositions: jest.fn().mockResolvedValue([]),
      getAccount: jest.fn().mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 })),
      getSymbolInfo: jest.fn(async () => { throw new Error('bridge exploded'); }),
    };
    const svc = build(mt5);

    const result = await assess(svc);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('per-symbol cap');
    expect(result.reason).toContain('bridge exploded');
    // ⚠️ And specifically NOT the "proceeding with caution" path, which is fail-OPEN.
    expect(result.reason).not.toContain('caution');
  });

  /**
   * REGRESSION GUARD — an index CFD must be PRICED, not refused (2026-09-18, follow-up to #865).
   *
   * Index symbols (`US500`, `GER40`, `UK100`, `FRA40`) carry no currency in their name and the
   * running bridge does not report `currencyProfit`, so the strict estimator returned `unavailable`
   * and the gate REFUSED them. Measured consequence: pending queue entries for GER40 and UK100 with
   * nowhere to go. Refusing is not "a stricter cap", it is no trades at all.
   *
   * The fallback is the ACCOUNT currency, and it is defensible rather than a guess because:
   *   - it fails CLOSED — a USD or EUR notional treated as GBP OVER-states the margin;
   *   - the error is bounded far inside the cap. Measured: UK100 0.1 lot = £102.27 assumed (7.4% of
   *     equity) and US500 = £7.62 (0.6%), against a 25% cap;
   *   - it is LABELLED — `profitCurrencyAssumed` and `describeMargin()` say so;
   *   - it stops being used the moment MT5 reports the real value.
   */
  it('prices an index CFD instead of refusing it, using a labelled account-currency fallback', async () => {
    const mt5 = {
      getPositions: jest.fn().mockResolvedValue([]),
      getAccount: jest.fn().mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 })),
      getSymbolInfo: jest.fn(async () => ({
        name: 'UK100', digits: 1, contractSize: 10, volumeMin: 0.1, volumeMax: 5,
      })),
      getQuote: jest.fn(async () => ({ bid: 10227, ask: 10228, last: 10227.4 })),
    };
    const svc = build(mt5);

    const result = await svc.assessGlobalRiskLimits(0.1, 'UK100');

    // 0.1 × 10 × 10227.4 = 10,227 notional, assumed GBP, ÷ 100 = £102.27 on £1,000 → 10.2%.
    // Under the 25% cap, so it is admitted — which is the point of the change.
    expect(result.allowed).toBe(true);
    expect(result.reason).not.toContain('profit currency unknown');
  });

  /**
   * THE PROPERTY THE OLD EXPRESSION COULD NOT SATISFY (#865).
   *
   * With no price and no contract size it returned the IDENTICAL estimate for gold and for a yen
   * cross — observed in the decision log as `62.7%` and `62.6%` on the same day, against a cap of
   * 25%. Both were refused, for the same reason, with the same number.
   *
   * Both must now be PERMITTED at 0.1 lot on a 1,000 portfolio: gold ties up ~£3.25 and NZDJPY
   * ~£0.47 at 0.001 lot. If the estimate ever regresses to the instrument-blind shape, at least one
   * of these flips to refused at the same time as the other, and this test fails.
   */
  it('the per-symbol estimate is not instrument-blind — different instruments are priced differently', async () => {
    const mt5 = {
      getPositions: jest.fn().mockResolvedValue([]),
      getAccount: jest.fn().mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 })),
      getSymbolInfo: jest.fn(async (s: string) => (s === 'XAUUSD'
        ? { name: 'XAUUSD', digits: 2, contractSize: 100, volumeMin: 0.01, volumeMax: 100 }
        : { name: 'NZDJPY', digits: 3, contractSize: 100_000, volumeMin: 0.1, volumeMax: 100 })),
      // ⚠️ Mirrors the live broker: the traded symbols price directly, and only GBPUSD / GBPJPY
      // exist as conversion pairs. Answering every pair here would let a broken conversion pass.
      getQuote: jest.fn(async (s: string) => {
        if (s === 'NZDJPY') return { bid: 89.34, ask: 89.35, last: 89.343 };
        if (s === 'XAUUSD') return { bid: 4346, ask: 4346.5, last: 4346.06 };
        const fx = ({ GBPUSD: 1.33838, GBPJPY: 209.768 } as Record<string, number>)[s];
        return fx != null ? { bid: fx, ask: fx, last: fx } : null;
      }),
    };
    const svc = build(mt5);

    const gold = await svc.assessGlobalRiskLimits(0.001, 'XAUUSD');
    const yen = await svc.assessGlobalRiskLimits(0.001, 'NZDJPY');

    // Both permitted. The old expression refused BOTH — at ~86%, for the same stated reason,
    // with the same number, which is precisely what made the defect hard to see.
    expect(gold.allowed).toBe(true);
    expect(yen.allowed).toBe(true);
  });

  /**
   * The number in a refusal must be explicable. `Allocation 62.7% exceeds max per symbol 25%` was
   * true, unactionable, and took an hour to explain; the reason now carries the estimate and the
   * portfolio value so the next reader can ask "why is that number that size?" immediately.
   */
  it('a refusal names the estimate and the portfolio it was measured against', async () => {
    const mt5 = {
      getPositions: jest.fn().mockResolvedValue([]),
      // A large size against a small account: 1 lot of gold is ~£3,250 of margin on a £1,000
      // portfolio, i.e. far above the 25% cap.
      getAccount: jest.fn().mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 })),
    };
    const svc = build(mt5);

    const result = await svc.assessGlobalRiskLimits(1, 'XAUUSD');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeds max per symbol');
    expect(result.reason).toContain('estimated capital');
    expect(result.reason).toContain('1000.00'); // the portfolio it was compared against
  });

  /**
   * REGRESSION GUARD — the per-symbol cap must measure the SYMBOL, not one order (#899, 2026-09-19).
   *
   * The owner's design is one protocol driving several bots on the same symbol
   * (docs/trading-bot-model.md §4) with the stated constraint "…for the same symbol, but not
   * increasing risk". Before this fix that guarantee did not exist at the CALLER either: every
   * bot's order was measured in isolation, so three bots at 20% could put 60% on one instrument
   * while each check passed. `risk.maxOpenPositions` counts positions, not exposure.
   *
   * This test pins the caller's half of the contract: assessGlobalRiskLimits() must sum the capital
   * ALREADY committed to the symbol — through the same margin estimator as the incoming order, so
   * both sides of the sum are comparable — and hand it to canOpenPosition().
   */
  it('blocks a small order when the SYMBOL is already near the cap (#899)', async () => {
    // 0.05 lot of gold ≈ £217 margin ≈ 21.7% of the £1,000 account (contract 100, GBP, 1:100).
    const existing = [{
      ticket: 42, symbol: 'XAUUSD', type: 'buy', volume: 0.05, price_open: 4300,
      price_current: 4346.06, sl: 0, tp: 0, profit: 0, comment: '', time: 0,
      currencyProfit: 'GBP',
    }];
    const mt5 = {
      getPositions: jest.fn().mockResolvedValue(existing),
      getAccount: jest.fn().mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 })),
    };
    const svc = build(mt5);

    // The order alone is ~4% — it would pass measured on its own. The SYMBOL total (~26%) refuses it.
    const blocked = await svc.assessGlobalRiskLimits(0.02, 'XAUUSD');
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('max per symbol');
    // And the reason exposes the existing term, so the refusal is explicable from the record.
    expect(blocked.reason).toContain('already open on this symbol');

    // ── Restore direction — the same order with NO existing exposure is admitted. ──
    // Without this half, a gate that refused unconditionally would pass the test above.
    const emptyMt5 = {
      getPositions: jest.fn().mockResolvedValue([]),
      getAccount: jest.fn().mockResolvedValue(acct({ equity: 1000, balance: 1000, margin: 100 })),
    };
    const clean = build(emptyMt5);
    const allowed = await clean.assessGlobalRiskLimits(0.02, 'XAUUSD');
    expect(allowed.allowed).toBe(true);
  });
});
