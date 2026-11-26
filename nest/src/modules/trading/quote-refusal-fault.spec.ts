/**
 * quote-refusal-fault.spec.ts — a quote that cannot price an order becomes a COUNTED fault, and it
 * is counted in EPISODES, not in refusals (#1348, option A).
 *
 * ── THE DEFECT THIS GUARDS ────────────────────────────────────────────────────────────────────────
 * 8,387 entries were refused over seven weeks with "quote cannot price this order", across FOUR
 * unrelated causes (5,293 stale · 843 tick-ahead-of-clock · 961 no-tick-time · ~610 no-quote). The
 * refusal was correct every time; what was wrong is that in the run totals it is indistinguishable
 * from "this symbol never signalled", so the strategy's live performance was bounded by a data path
 * that appeared on no surface and owned no issue.
 *
 * ── THE TWO WAYS THIS FIX CAN BE WRONG, EACH ASSERTED BELOW ──────────────────────────────────────
 *   1. One code for all four causes. That would reproduce the defect INSIDE the registry: a growing
 *      cause could not be seen. So the four codes must be four DISTINCT codes, and a healthy read
 *      must produce none.
 *   2. Recording one row per refusal. `FaultsService.record()` counts EPISODES by contract —
 *      *"never from a poll loop, or the count becomes a measure of how often the caller ran"*.
 *      Measured 2026-11-26: 8,387 refusals across 7,472 symbol-minutes, i.e. 1.12 refusals per
 *      symbol-minute. Per-refusal recording would have inflated the count AND turned the registry
 *      into a log, which is the bloat `docs/FAULT-TAXONOMY-GUARDRAILS.md` exists to prevent.
 *
 * ⚠️ CANARY BOTH WAYS: make `quoteFaultObservation` return a code for `fresh` and the third test
 * fails; drop the `episode === 'started'` guard and the "once per episode" test fails.
 */
import { quoteFaultObservation, QUOTE_FAULT_CODES, TradingStrategyService } from './trading-strategy.service';
import { TradingModule } from './trading.module';
import { FaultsModule } from '../faults/faults.module';

/** The faults service's own identity rule — a code that is not a code cannot be counted. */
const CODE_RE = /^TCS-[A-Z0-9]+(-[A-Z0-9]+)*$/;

const KINDS: Array<[string, string]> = [
  ['stale', 'TCS-QUOTE-STALE'],
  ['future', 'TCS-QUOTE-FUTURE'],
  ['no-tick-time', 'TCS-QUOTE-NO-TICK-TIME'],
  ['no-quote', 'TCS-QUOTE-NO-QUOTE'],
];

describe('quoteFaultObservation() — which fault a freshness verdict describes', () => {
  it('gives each of the four causes its OWN code, because one code would hide the growing one', () => {
    const codes = KINDS.map(([kind]) => quoteFaultObservation(kind as never)?.code);
    expect(codes).toEqual(KINDS.map(([, code]) => code));
    expect(new Set(codes).size).toBe(4);
  });

  it('emits only codes the registry will accept — a phrase cannot be counted', () => {
    for (const [, code] of KINDS) expect(CODE_RE.test(code)).toBe(true);
  });

  it('returns NOTHING for a healthy read — so no number of healthy ticks can create a fault', () => {
    expect(quoteFaultObservation('fresh')).toBeNull();
    // `disabled` means the allowance is 0 and the check is switched off: not a fault either.
    expect(quoteFaultObservation('disabled')).toBeNull();
  });

  it('every code carries a title, because a row with no title is unreadable in a registry', () => {
    for (const [kind] of KINDS) {
      const o = quoteFaultObservation(kind as never);
      expect(o?.title.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('the exported code table is the whole set — no fifth cause can appear unnoticed', () => {
    expect(Object.keys(QUOTE_FAULT_CODES).sort()).toEqual(['future', 'no-quote', 'no-tick-time', 'stale']);
  });
});

function make() {
  const recorded: Array<Record<string, unknown>> = [];
  const svc = Object.create(TradingStrategyService.prototype) as TradingStrategyService;
  (svc as any).faults = {
    record: jest.fn(async (o: Record<string, unknown>) => {
      recorded.push(o);
      return { view: {}, recurredAfterRetirement: false };
    }),
  };
  const note = (symbol: string, kind: string) =>
    (svc as any).noteQuoteUnpriceable(
      symbol,
      { ok: kind === 'fresh' || kind === 'disabled', kind, ageSeconds: 901, reason: `${kind} reason` },
      300,
    );
  return { svc, note, recorded };
}

describe('noteQuoteUnpriceable() — recorded once per EPISODE, not once per refusal', () => {
  it('records on the FIRST refusal and not on the ones that follow in the same episode', () => {
    const { note, recorded } = make();
    for (let i = 0; i < 25; i++) note('NVDA', 'stale');
    expect(recorded).toHaveLength(1);
  });

  it('records AGAIN after a healthy read clears the episode — a recurrence is the point', () => {
    const { note, recorded } = make();
    note('NVDA', 'stale');
    note('NVDA', 'fresh');   // the episode ends here
    note('NVDA', 'stale');   // …so this is a SECOND episode
    expect(recorded).toHaveLength(2);
  });

  it('a healthy read alone records nothing, however many times it runs', () => {
    const { note, recorded } = make();
    for (let i = 0; i < 50; i++) note('NVDA', 'fresh');
    expect(recorded).toHaveLength(0);
  });

  it('episodes are per SYMBOL — one symbol recovering does not clear another', () => {
    const { note, recorded } = make();
    note('NVDA', 'stale');
    note('TSLA', 'stale');
    note('NVDA', 'fresh');
    note('TSLA', 'stale');   // still the same TSLA episode
    note('NVDA', 'stale');   // a new NVDA episode
    expect(recorded.map((r) => (r.evidence as Record<string, unknown>).symbol)).toEqual(['NVDA', 'TSLA', 'NVDA']);
  });

  it('carries the evidence that makes the row actionable: age, allowance, and the issue', () => {
    const { note, recorded } = make();
    note('AVGO', 'stale');
    const row = recorded[0];
    expect(row.issueUrl).toBe('https://github.com/FifeCIC/Trading-Command-Suite/issues/1348');
    expect(row.area).toBe('bridge');
    expect(row.evidence).toMatchObject({ symbol: 'AVGO', kind: 'stale', ageSeconds: 901, maxQuoteAgeSeconds: 300 });
  });

  it('never throws when the registry is absent or broken — a diagnostic may not block a trade', () => {
    const svc = Object.create(TradingStrategyService.prototype) as TradingStrategyService;
    expect(() =>
      (svc as any).noteQuoteUnpriceable('NVDA', { ok: false, kind: 'stale', ageSeconds: 1, reason: 'x' }, 300),
    ).not.toThrow();

    (svc as any).faults = { record: jest.fn(async () => { throw new Error('registry down'); }) };
    expect(() =>
      (svc as any).noteQuoteUnpriceable('NVDA', { ok: false, kind: 'stale', ageSeconds: 1, reason: 'x' }, 300),
    ).not.toThrow();
  });
});


/**
 * ⚠️ THE WIRING ITSELF IS THE THING THAT CAN BE SILENTLY ABSENT.
 *
 * The injection is `@Optional()`, so a TradingModule that did NOT import FaultsModule would boot
 * perfectly and simply never record anything — the fault would be "recorded" by code that never ran,
 * which is the same shape as a validator that inspects nothing and reports OK. This asserts the
 * module edge from the metadata Nest actually reads, with no boot and no database.
 */
describe('TradingModule imports FaultsModule — otherwise nothing is ever recorded', () => {
  it('declares FaultsModule in its imports', () => {
    const imports = (Reflect.getMetadata('imports', TradingModule) ?? []) as unknown[];
    expect(imports).toContain(FaultsModule);
  });
});