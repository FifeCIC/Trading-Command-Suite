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
      minutesUntilOpen: !active && isMarketDay ? Math.max(0, openMin - now) : null,
    };
  });
}

/** Human label for the next session that hasn't opened yet (within 24h). */
export function nextSessionLabel(sessions = computeSessionStates()) {
  const now = new Date();
  let pending = sessions.filter((s) => !s.active);
  if (pending.length === 0) {
    const first = sessions[0];
    return first ? `${first.flag} ${first.name}` : '';
  }
  // Sort by when they next open (wrap-around aware).
  pending = pending
    .map((s) => {
      const diff = s.minutesUntilOpen ?? (24 * 60);
      return { ...s, diff };
    })
    .sort((a, b) => a.diff - b.diff);
  const closest = pending[0];
  if (closest.minutesUntilOpen == null || closest.minutesUntilOpen > (24 * 60) || (now.getUTCDay() >= 6 && closest.scope === 'sydney')) {
    return `${closest.flag} ${closest.name}`;
  }
  const h = Math.floor(closest.minutesUntilOpen / 60);
  const m = closest.minutesUntilOpen % 60;
  if (h > 0) return `${closest.flag} ${closest.name} in ${h}h ${m}m`;
  return `${closest.flag} ${closest.name} in ${m}m`;
}
