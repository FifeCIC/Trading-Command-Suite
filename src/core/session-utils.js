/**
 * ⚠️ AXIS: frontend mirror of the FX-SESSION axis (`market-sessions.service.ts`). NOT the venue
 * axis and NOT the bot-policy axis — see #851.
 *
 * ⚠️ A HAND-MAINTAINED MIRROR IS A DRIFT RISK, and this one duplicates a roster that is already
 * reachable over HTTP (`market-calendar.controller.ts`). The "keep in sync" note below is asking
 * people to remember something a machine could enforce. #851 proposes serving the roster from the
 * API and deleting this copy — do that rather than editing the numbers here.
 *
 * Market session utilities — canonical frontend mirror of the backend
 * MarketSessionsService (nest/src/modules/calendar/market-sessions.service.ts).
 *
 * Sessions are defined by IANA timezone + LOCAL market-open/close times so DST
 * is handled automatically via Intl. Do NOT hardcode UTC offsets here — they
 * drift with daylight saving (NY open is 13:30 UTC in summer, 14:30 in winter).
 *
 * Keep in sync with the backend roster:
 *   Sydney  10:00–16:00 (Australia/Sydney)
 *   Tokyo    09:00–15:00 (Asia/Tokyo)
 *   London   08:00–16:30 (Europe/London)
 *   New York 09:30–16:00 (America/New_York)
 */

export const SESSION_ROSTER = [
  { scope: 'sydney', name: 'Sydney', flag: '🇦🇺', iana: 'Australia/Sydney', open: '10:00', close: '16:00' },
  { scope: 'tokyo', name: 'Tokyo', flag: '🇯🇵', iana: 'Asia/Tokyo', open: '09:00', close: '15:00' },
  { scope: 'london', name: 'London', flag: '🇬🇧', iana: 'Europe/London', open: '08:00', close: '16:30' },
  { scope: 'ny', name: 'New York', flag: '🇺🇸', iana: 'America/New_York', open: '09:30', close: '16:00' },
];

/** Local wall-clock minutes (0–1439) in a given IANA timezone. */
function minutesInZone(date, iana) {
  try {
    const parts = date.toLocaleString('en-GB', {
      timeZone: iana, hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const [h, m] = parts.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

/** Local day-of-week (0=Sun) in a given IANA timezone. */
function dowInZone(date, iana) {
  try {
    const s = date.toLocaleString('en-US', { timeZone: iana, weekday: 'short' });
    return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[s] ?? date.getUTCDay());
  } catch {
    return date.getUTCDay();
  }
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Minutes until this session next OPENS — looking forward across midnight and the
 * weekend. `null` only while the session is genuinely open right now.
 *
 * ⚠️ WHY THIS EXISTS (2026-09-18). The previous expression was
 *     `!active && isMarketDay ? Math.max(0, openMin - now) : null`
 * and `Math.max(0, …)` turned a session whose open time had ALREADY PASSED TODAY into
 * `0`, which every reader takes as "opens in 0 minutes". Two measured consequences:
 *
 *   1. THE LABEL. Friday 20:47 UK the tape read `🇬🇧 London in 0m`. London's next open
 *      is Monday 08:00 — about 59 hours away. A countdown that says "imminent" when the
 *      true answer is "not until Monday" is worse than showing no countdown at all.
 *
 *   2. THE SORT — the more damaging half. `nextSessionLabel()` ranks candidates by this
 *      value, and EVERY session whose open had passed reported `0`, so the winner was
 *      whichever session sat first in SESSION_ROSTER (always Sydney). Measured Monday
 *      06:00 UTC, with London opening in 60 minutes, the tape read `🇦🇺 Sydney in 0m`:
 *      the wrong session AND the wrong time. Reproduced in both control cases.
 *
 * ⚠️ DST: days are added as fixed 24h offsets, so a countdown spanning a DST change can
 * be out by one hour. The previous version could be out by an entire day, and a countdown
 * display does not need better than ±1h — noted rather than hidden.
 */
function minutesUntilNextOpen(date, iana, openMin) {
  const nowMinToday = minutesInZone(date, iana);
  const dowToday = dowInZone(date, iana);

  // Still ahead of us today, and today is a market day?
  if (dowToday >= 1 && dowToday <= 5 && nowMinToday < openMin) {
    return openMin - nowMinToday;
  }

  // Otherwise roll forward to the next market day at the same open time.
  for (let addDays = 1; addDays <= 8; addDays++) {
    const dow = dowInZone(new Date(date.getTime() + addDays * 86400000), iana);
    if (dow < 1 || dow > 5) continue; // weekend
    return (24 * 60 - nowMinToday) + (addDays - 1) * 24 * 60 + openMin;
  }
  return null; // no market day inside 8 days — unreachable for a Mon–Fri roster
}

/**
 * Compute the live state of every session at `date` (defaults to now).
 * Mirrors backend MarketSessionsService.getSessionStates().
 */
export function computeSessionStates(date = new Date()) {
  return SESSION_ROSTER.map((s) => {
    const dow = dowInZone(date, s.iana);
    const now = minutesInZone(date, s.iana);
    const openMin = toMin(s.open);
    const closeMin = toMin(s.close);
    const isMarketDay = dow >= 1 && dow <= 5;
    const active = isMarketDay && now >= openMin && now < closeMin;
    const opensSoon = isMarketDay && !active && now < openMin && (openMin - now) <= 120;
    const closesSoon = active && (closeMin - now) <= 30;
    return {
      ...s,
      active,
      opensSoon,
      closesSoon,
      openMin,
      closeMin,
      nowMin: now,
      minutesUntilClose: active ? closeMin - now : null,
      // ⚠️ Forward-looking, never clamped — see minutesUntilNextOpen() for what the
      // old `Math.max(0, openMin - now)` did to both this value and the sort below.
      minutesUntilOpen: active ? null : minutesUntilNextOpen(date, s.iana, openMin),
    };
  });
}

/**
 * Human label for the NEXT session to open, with a real countdown.
 *
 * ⚠️ REWRITTEN 2026-09-18. The previous version hid the number whenever it exceeded
 * 24h (`return \`${flag} ${name}\``) — a workaround for `minutesUntilOpen` being
 * clamped to 0, which made "in 4000m" unreadable. With the countdown now correct, the
 * number is the useful part and is always shown: "London in 2d 11h" tells a trader when
 * they can next act, whereas a bare "London" tells them nothing they did not know.
 *
 * The weekend/Sydney special-case is also gone. It existed to paper over the UTC day
 * disagreeing with Sydney's local day; the computation above is already per-timezone,
 * so the guard could only suppress a value that is now right.
 *
 * Oldest measured bad output: "🇦🇺 Sydney in 0m" while London opened in 60 minutes.
 */
export function nextSessionLabel(sessions = computeSessionStates()) {
  const pending = sessions.filter((s) => s.minutesUntilOpen != null);
  if (pending.length === 0) return ''; // every session open right now
  const closest = [...pending].sort((a, b) => a.minutesUntilOpen - b.minutesUntilOpen)[0];
  const mins = closest.minutesUntilOpen;
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const when = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return `${closest.flag} ${closest.name} in ${when}`;
}
