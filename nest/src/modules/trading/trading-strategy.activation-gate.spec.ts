import { BadRequestException } from '@nestjs/common';
import { TradingStrategyService } from './trading-strategy.service';

/**
 * TradingStrategyService — the activation ceiling gate (#905).
 *
 * ⚠️ WHY THIS EXISTS. Two ACTIVE bots (`Gold Swing 1H`, `Gold Day-Trade M15`) carried bars of
 * 9% and 10% while their protocols' all-time measured ceilings were 7.69% and 8.24% — they
 * could never fire, and nothing refused or surfaced it for as long as they existed. The fix
 * has two halves, and this spec pins the REFUSAL half:
 *
 *   1. The health audit (`auditMeasuredCeilings`) compared RAW composite against a PERCENT bar
 *      and was silently blind (fixed in protocol-health.service.ts — same commit).
 *   2. Activation now refuses a bot whose protocol's measured ceiling is below its bar, using
 *      the SAME measurement the audit uses.
 *
 * FAIL-OPEN is a first-class part of the contract: no history, unknown protocol, or a
 * measurement failure must ALLOW the activation. The defect fixed here is a false GREEN; the
 * fix must not become a false RED that blocks new protocols from being tried.
 *
 * Harness note: only `prisma`, `protocolHealth` and `abPair` are touched by these paths, so the
 * prototype is borrowed and those are stubbed (same pattern as the venue-standby spec).
 *
 * ⚠️ `abPair` added 2026-09-23 (#963). `update()` now asks whether the bot is inside a RUNNING A/B
 * comparison before it touches anything — invariant 6 of SETTLED-DECISIONS #25. `findFirst`
 * returning null means "no running comparison", which is the world these tests describe, so their
 * intent is unchanged. The stub is REQUIRED: without it every one of these tests failed with
 * `Cannot read properties of undefined (reading 'findFirst')`, which is how the dependency was
 * found at all — `update()` now genuinely needs the comparison table to answer.
 */
describe('TradingStrategyService — activation ceiling gate (#905)', () => {
  const doomedCeiling = { slug: 'xau-speed-1h', ceilingPct: 7.69, ceilingRaw: 70, capacity: 910, samples: 457 };

  function makeService(opts: { strategy?: any; ceiling?: any }) {
    const svc = Object.create(TradingStrategyService.prototype) as TradingStrategyService;
    const update = jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data }));
    (svc as any).prisma = {
      tradingStrategy: {
        findUnique: jest.fn(async () => opts.strategy ?? null),
        update,
      },
      // No running A/B comparison — see the harness note above (#963).
      abPair: { findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null) },
    };
    (svc as any).protocolHealth = {
      measureProtocolCeiling: jest.fn(async () => opts.ceiling ?? null),
    };
    return { svc, update };
  }

  const doomedBot = {
    id: 'bot-1',
    name: 'Gold Swing 1H',
    active: false,
    protocolId: 'xau-speed-1h',
    minComposite: 9,
  };

  it('REFUSES to activate a bot whose protocol can never reach its bar', async () => {
    const { svc, update } = makeService({ strategy: doomedBot, ceiling: doomedCeiling });
    await expect(svc.toggle('bot-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.toggle('bot-1')).rejects.toThrow(/never produced more than 7\.7%/);
    await expect(svc.toggle('bot-1')).rejects.toThrow(/minComposite is 9%/);
    // The refusal must NOT persist the activation.
    expect(update).not.toHaveBeenCalled();
  });

  it('ALLOWS activation when the ceiling clears the bar (restore direction)', async () => {
    const healthy = { slug: 'forex-session-v1', ceilingPct: 27.3, ceilingRaw: 198, capacity: 725, samples: 1500 };
    const { svc, update } = makeService({ strategy: doomedBot, ceiling: healthy });
    await svc.toggle('bot-1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'bot-1' }, data: { active: true } });
  });

  it('NEVER checks the ceiling when DEACTIVATING — that direction must always be allowed', async () => {
    const { svc } = makeService({ strategy: { ...doomedBot, active: true }, ceiling: doomedCeiling });
    await svc.toggle('bot-1');
    expect((svc as any).protocolHealth.measureProtocolCeiling).not.toHaveBeenCalled();
  });

  it('FAILS OPEN with thin history — cannot judge is not a refusal', async () => {
    const thin = { slug: 'new-proto', ceilingPct: 2, ceilingRaw: 9, capacity: 450, samples: 5 };
    const { svc, update } = makeService({ strategy: doomedBot, ceiling: thin });
    await svc.toggle('bot-1');
    expect(update).toHaveBeenCalled();
  });

  it('FAILS OPEN when the measurement is unavailable', async () => {
    const { svc, update } = makeService({ strategy: doomedBot, ceiling: null });
    await svc.toggle('bot-1');
    expect(update).toHaveBeenCalled();
  });

  it('refuses an UPDATE that would activate a doomed bot', async () => {
    const { svc, update } = makeService({ strategy: doomedBot, ceiling: doomedCeiling });
    await expect(svc.update('bot-1', { active: true })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses an UPDATE that raises the bar of an ACTIVE bot above its ceiling', async () => {
    const { svc } = makeService({
      strategy: { ...doomedBot, active: true },
      ceiling: doomedCeiling,
    });
    await expect(svc.update('bot-1', { minComposite: 20 })).rejects.toThrow(/never produced more than 7\.7%/);
  });

  it('ALLOWS lowering the bar below the ceiling on an active bot — that is the FIX direction', async () => {
    const { svc, update } = makeService({
      strategy: { ...doomedBot, active: true },
      ceiling: doomedCeiling,
    });
    await svc.update('bot-1', { minComposite: 7 });
    expect(update).toHaveBeenCalled();
  });

  it('ALLOWS a rename of an already-active doomed bot — operators are not locked out of edits', async () => {
    const { svc, update } = makeService({
      strategy: { ...doomedBot, active: true },
      ceiling: doomedCeiling,
    });
    await svc.update('bot-1', { name: 'Gold Swing 1H (review needed)' });
    expect((svc as any).protocolHealth.measureProtocolCeiling).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
  });

  it('does not check the ceiling for an update that does not activate or re-bar the bot', async () => {
    const { svc } = makeService({ strategy: doomedBot, ceiling: doomedCeiling });
    await svc.update('bot-1', { cooldownMinutes: 10 });
    expect((svc as any).protocolHealth.measureProtocolCeiling).not.toHaveBeenCalled();
  });
});
