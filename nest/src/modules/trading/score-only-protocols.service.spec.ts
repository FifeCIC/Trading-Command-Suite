/**
 * score-only-protocols.service.spec.ts — the seeder must not hand an inert bot an order route.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE MEASURED DEFECT THIS PINS (#1258, 2026-11-13)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `seedDefaults()` repairs a missing `strategy_protocol` row for every bot it seeds — correct,
 * because a bot with no subscription silently never trades (#874). But the repair cannot tell
 * "lost" from "deleted ON PURPOSE". Once the live fleet entered the seed, a routine seed run
 * reported `subscriptionsRepaired: 1` and that one row was `Silver Speed Scalp Bot (copy) Bot` on
 * `xau-speed-v1-long-copy` — a bot `scripts/protocol-copies.json` says must never queue an order:
 *
 *   *"its subscriptions were DELETED, so it cannot queue an order — a scoring question must not
 *   spend demo money."*
 *
 * ⚠️ These tests read the REAL manifest, not a fixture, because the declaration and the code must
 * agree about a specific slug. A fixture would prove the parser works and say nothing about whether
 * the bot in question is covered.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ScoreOnlyProtocolService } from './score-only-protocols.service';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

describe('ScoreOnlyProtocolService — declared score-only protocols (#1258)', () => {
  it('the manifest exists and this test is not vacuous', () => {
    // A service reading a missing file "passes" by suppressing everything. Prove the file is there.
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts', 'protocol-copies.json'))).toBe(true);
  });

  it('⚠️ THE MANIFEST IS ACTUALLY READ — not silently unreadable (which would suppress everything)', () => {
    // Measured 2026-11-13: a hardcoded `../../../..` depth resolved to `nest/` under `dist`, so the
    // service reported the manifest unreadable and the seed dry run suppressed ALL 75 subscriptions
    // instead of the one score-only protocol. Fail-closed made that invisible: every answer was the
    // safe one. This asserts the LOAD SUCCEEDED on an ordinary protocol, which is the only way to
    // tell "correctly allows" from "cannot read anything".
    const svc = new ScoreOnlyProtocolService();
    (svc as any).onModuleInit();
    expect((svc as any).loadError).toBeNull();
    expect(svc.resolve('xau-speed-v1-long').unreadable).toBe(false);
  });

  it('REFUSES a subscription for a protocol declared `scoreOnly: true`', () => {
    const svc = new ScoreOnlyProtocolService();
    (svc as any).onModuleInit();
    expect(svc.maySubscribe('xau-speed-v1-long-copy')).toBe(false);
    const why = svc.resolve('xau-speed-v1-long-copy');
    expect(why.scoreOnly).toBe(true);
    expect(why.reason).toContain('scoreOnly');
  });

  it('ALLOWS a subscription for a copy that is NOT score-only', () => {
    // `forex-session-v1-copy-core4-long` is a directive-count experiment whose twin bot DOES trade.
    const svc = new ScoreOnlyProtocolService();
    (svc as any).onModuleInit();
    expect(svc.maySubscribe('forex-session-v1-copy-core4-long')).toBe(true);
  });

  it('ALLOWS a subscription for an ordinary protocol nobody declared', () => {
    const svc = new ScoreOnlyProtocolService();
    (svc as any).onModuleInit();
    expect(svc.maySubscribe('xau-speed-v1-long')).toBe(true);
  });

  it('⚠️ FAILS CLOSED — an unreadable manifest suppresses EVERY subscription', () => {
    const svc = new ScoreOnlyProtocolService();
    // Simulate the read failing, which is what a missing or corrupt manifest does.
    (svc as any).loadError = 'could not read scripts/protocol-copies.json: ENOENT';
    expect(svc.maySubscribe('xau-speed-v1-long')).toBe(false);
    expect(svc.maySubscribe('xau-speed-v1-long-copy')).toBe(false);
    expect(svc.resolve('xau-speed-v1-long').unreadable).toBe(true);
  });

  it('comment keys (`__comment`, `__orphanScoreHistory`) are never treated as protocols', () => {
    const svc = new ScoreOnlyProtocolService();
    (svc as any).onModuleInit();
    expect(svc.maySubscribe('__comment')).toBe(true);
    expect(svc.maySubscribe('__orphanScoreHistory')).toBe(true);
  });
});
