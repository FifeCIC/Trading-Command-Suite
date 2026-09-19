/**
 * session-utils.test.js — the session countdown must always look FORWARD.
 * ======================================================================
 * Created 2026-09-18. Run with: `npm run test:session`
 *
 * WHY A TEST AND NOT A REVIEW
 * ---------------------------
 * The marquee read `🇬🇧 London in 0m` on a Friday evening when London's next open was
 * Monday morning — about 59 hours away. The cause was one clamp:
 *
 *     minutesUntilOpen: !active && isMarketDay ? Math.max(0, openMin - now) : null
 *
 * `Math.max(0, …)` turns "this session's open already passed TODAY" into `0`, which
 * every reader takes as "opens in 0 minutes". The second, worse half is that
 * `nextSessionLabel()` RANKS sessions by this value — so every already-passed session
 * reported `0`, the sort became useless, and the winner was simply whichever session sat
 * first in `SESSION_ROSTER`. Two control cases both answered `🇦🇺 Sydney in 0m` while
 * London opened in 60 minutes: the wrong session AND the wrong time.
 *
 * These assertions exist because the failure mode is silent and plausible. `0m` looks
 * like a real countdown; a session name looks like a real answer. Nothing throws, the
 * strip renders, and the only way to notice is to already know what time it is in Tokyo.
 *
 * ⚠️ EVERY ASSERTION HERE WAS CANARIED. Reverting the clamp to `Math.max(0, …)` makes
 * the "never a zero" and "names the soonest" cases fail — verified by doing it, not by
 * assuming. A guard that has never been seen to fail is a decoration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeSessionStates, nextSessionLabel, SESSION_ROSTER } from './session-utils.js';

/** Minutes-since-midnight for a session, or null. */
const byName = (sessions, name) => sessions.find((s) => s.name === name);

test('a session whose open has passed today reports a real countdown, never 0', () => {
  // Friday 19:47 UTC === 20:47 UK. London (08:00–16:30 UK) closed 4h17m ago; its next
  // open is Monday 08:00 UK. The regression made this 0 and the tape said "in 0m".
  const sessions = computeSessionStates(new Date('2026-09-18T19:47:00Z'));
  const london = byName(sessions, 'London');

  assert.equal(london.active, false, 'London is closed at 20:47 UK on a Friday');
  assert.notEqual(london.minutesUntilOpen, 0, 'must not claim London opens in 0 minutes');
  assert.ok(
    london.minutesUntilOpen > 3000,
    `London's next open is Monday 08:00 (~3553 min), got ${london.minutesUntilOpen}`,
  );
});

test('an already-passed open never yields minutesUntilOpen === 0', () => {
  // The property, not an example: a NON-ACTIVE session either has a future open (> 0)
  // or could not be resolved (null). Zero is always a lie — it means "the open time has
  // already gone today", which is information about the past, not a countdown.
  const probes = [
    '2026-09-18T19:47:00Z', // Fri evening — London/Sydney/Tokyo all passed
    '2026-09-21T06:00:00Z', // Mon pre-London
    '2026-09-22T12:00:00Z', // Tue, London+NY active
    '2026-09-23T02:00:00Z', // Wed overnight
    '2026-09-19T09:00:00Z', // Saturday — every session shut
  ];
  for (const iso of probes) {
    for (const s of computeSessionStates(new Date(iso))) {
      if (s.active) continue;
      assert.ok(
        s.minutesUntilOpen === null || s.minutesUntilOpen > 0,
        `${iso}: ${s.name} reported minutesUntilOpen=${s.minutesUntilOpen} while closed`,
      );
    }
  }
});

test('nextSessionLabel names the session that actually opens soonest', () => {
  // Monday 06:00 UTC. London opens 08:00 UK = 07:00 UTC → 60 minutes. The regression
  // answered "Sydney in 0m" because Sydney is first in the roster and also reported 0.
  const sessions = computeSessionStates(new Date('2026-09-21T06:00:00Z'));
  assert.match(nextSessionLabel(sessions), /London in 1h 0m/);
});

test('nextSessionLabel names New York when New York is genuinely next', () => {
  // Tuesday 12:00 UTC. London is open; NY opens 09:30 EDT = 13:30 UTC → 90 minutes.
  const sessions = computeSessionStates(new Date('2026-09-22T12:00:00Z'));
  assert.match(nextSessionLabel(sessions), /New York in 1h 30m/);
});

test('nextSessionLabel always names the session with the smallest countdown', () => {
  // The REAL property, and the one the regression destroyed. Asserting "every session
  // wins at some point" was wrong: Sydney (10:00–16:00 AEST) and Tokyo (09:00–15:00 JST)
  // have IDENTICAL UTC windows — both run 00:00–06:00 UTC — so they always tie and a
  // stable sort keeps roster order. Tokyo therefore can never win, and that is a fact
  // about the roster, not a defect in the ranking.
  //
  // What must hold is that the named session is an argmin of minutesUntilOpen. A no-op
  // sort (the regression) fails this immediately, because roster order is not sorted.
  for (let day = 21; day <= 27; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const iso = `2026-09-${day}T${String(hour).padStart(2, '0')}:00:00Z`;
      const sessions = computeSessionStates(new Date(iso));
      const label = nextSessionLabel(sessions);
      const named = SESSION_ROSTER.find((s) => label.includes(s.name));
      assert.ok(named, `${iso}: label "${label}" names no known session`);

      const namedRow = byName(sessions, named.name);
      const soonest = Math.min(
        ...sessions.filter((s) => s.minutesUntilOpen != null).map((s) => s.minutesUntilOpen),
      );
      assert.equal(
        namedRow.minutesUntilOpen,
        soonest,
        `${iso}: named ${named.name} at ${namedRow.minutesUntilOpen}m but ${soonest}m was available`,
      );
    }
  }
});

test('Sydney and Tokyo share a UTC window — the roster has a genuine tie', () => {
  // Documented because it explains why Tokyo never wins the "next" slot, and because a
  // trader reading "Sessions: Sydney / Tokyo" should know the two lines always move
  // together. Sydney 10:00–16:00 AEST and Tokyo 09:00–15:00 JST are both 00:00–06:00 UTC.
  // If either window is ever retuned, this test fails and the tie can be reconsidered.
  const sydney = SESSION_ROSTER.find((s) => s.scope === 'sydney');
  const tokyo = SESSION_ROSTER.find((s) => s.scope === 'tokyo');
  assert.equal(sydney.open, '10:00');
  assert.equal(tokyo.open, '09:00');

  // Both open at the same UTC instant on a given date.
  const sessions = computeSessionStates(new Date('2026-09-22T12:00:00Z'));
  assert.equal(
    byName(sessions, 'Sydney').minutesUntilOpen,
    byName(sessions, 'Tokyo').minutesUntilOpen,
    'Sydney and Tokyo are expected to tie — retune this test if the roster changed',
  );
});

test('opensSoon stays a short-window warning and is not confused with the countdown', () => {
  // `opensSoon` gates on `now < openMin` in its own right, so it was never affected by
  // the clamp. Guarding it keeps a future "simplification" from deriving it from
  // minutesUntilOpen, which is unbounded once the weekend is crossed.
  const sessions = computeSessionStates(new Date('2026-09-21T06:00:00Z'));
  const london = byName(sessions, 'London');
  assert.equal(london.opensSoon, true, 'London opens in 60 min → opensSoon');
  assert.ok(london.minutesUntilOpen <= 120);

  const sydney = byName(sessions, 'Sydney');
  assert.equal(sydney.opensSoon, false, 'Sydney is ~18h away — not "soon"');
  assert.ok(sydney.minutesUntilOpen > 120);
});
