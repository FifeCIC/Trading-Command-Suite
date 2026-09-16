/**
 * DST correctness for the ET session conversion.
 *
 * WHY THIS SPEC EXISTS (2026-09-15)
 * =================================
 * "What is the ET time?" was answered by MONTH ARITHMETIC in two separate files:
 *
 *     const isDst = month >= 2 && month <= 10;   // Mar–Nov approximate DST
 *     let etHour = at.getUTCHours() - (isDst ? 4 : 5);
 *
 * Real US DST is **8 March → 1 November** (2026). So the rule treated ALL of March and ALL of
 * November as EDT, putting the ET clock an hour ahead for roughly **36 days a year** — and that
 * value feeds `sessions[].active`, `opensIn` and `closesIn`, i.e. which markets report as open.
 *
 * ⚠️ THE TWO COPIES WERE DELIBERATELY IDENTICAL. `session-window.ts` carried the note
 * *"identical to the historic MarketContextService behaviour, so session boundaries do not move
 * as a side effect of this file"* — a deliberate decision not to move boundaries while doing
 * unrelated work. The trap: fixing ONE of them would have made the two DISAGREE, which is worse
 * than both being consistently wrong. Both now read from `minutesInZone()`.
 *
 * These tests exist because the old rule passed every test the repo had — it was only wrong on
 * dates nobody had picked. A specific date per side of each transition is the only thing that
 * catches it.
 */
import { toEtMinutes } from './session-window';

const hm = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

describe('toEtMinutes — DST must be resolved, not approximated', () => {
  it('reads EST (UTC-5) on 5 March, BEFORE the spring transition (8 Mar 2026)', () => {
    // 14:00 UTC = 09:00 EST. The month rule said 10:00 (EDT) — an hour ahead.
    expect(hm(toEtMinutes(new Date('2026-03-05T14:00:00Z')))).toBe('09:00');
  });

  it('reads EDT (UTC-4) on 9 March, AFTER the spring transition', () => {
    expect(hm(toEtMinutes(new Date('2026-03-09T14:00:00Z')))).toBe('10:00');
  });

  it('reads EDT (UTC-4) on 30 October, BEFORE the autumn transition (1 Nov 2026)', () => {
    expect(hm(toEtMinutes(new Date('2026-10-30T14:00:00Z')))).toBe('10:00');
  });

  it('reads EST (UTC-5) on 3 November, AFTER the autumn transition', () => {
    // The month rule said 10:00 (EDT) — an hour ahead.
    expect(hm(toEtMinutes(new Date('2026-11-03T14:00:00Z')))).toBe('09:00');
  });

  it('is unchanged mid-summer and mid-winter, where the old rule happened to agree', () => {
    // Guards against "fixed DST" meaning "shifted everything": these two dates were CORRECT
    // before and must stay correct. 4 June = EDT (10:00), 15 January = EST (09:00).
    expect(hm(toEtMinutes(new Date('2026-06-15T14:00:00Z')))).toBe('10:00');
    expect(hm(toEtMinutes(new Date('2026-01-15T14:00:00Z')))).toBe('09:00');
  });

  it('carries minute precision, not whole hours only', () => {
    expect(toEtMinutes(new Date('2026-06-15T14:37:00Z'))).toBe(10 * 60 + 37);
  });

  it('stays inside 0..1439 even when the ET day differs from the UTC day', () => {
    // 02:00 UTC in summer is 22:00 ET the PREVIOUS day — still a valid minute-of-day.
    const v = toEtMinutes(new Date('2026-06-15T02:00:00Z'));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1440);
    expect(hm(v)).toBe('22:00');
  });
});
