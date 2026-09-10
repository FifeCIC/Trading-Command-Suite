/**
 * Session time maths — the ONE place a session-local wall clock becomes an instant.
 *
 * Why this exists (2026-09-10, epic #731):
 *
 * Sessions are defined as LOCAL market hours plus an IANA zone
 * (`market-sessions.service.ts`: London 08:00 Europe/London, NY 09:30
 * America/New_York, Tokyo 09:00 Asia/Tokyo). Several call sites converted that
 * wall clock to a `Date` like this:
 *
 *     const d = new Date(onDay.toLocaleString('en-US', { timeZone: iana }));
 *     d.setHours(oh, om, 0, 0);
 *
 * `toLocaleString` produces the ZONE's wall clock as TEXT, and `new Date(text)`
 * then parses it in the MACHINE's timezone — so the result is only correct when
 * the machine happens to sit in the session's zone. Measured on a Europe/London
 * machine: New York's 09:30 open resolved to 08:30 UTC (5h early) and Tokyo's
 * 09:00 open to 08:00 UTC (8h late). Downstream, `session-open-effect` scored
 * 6,308 times without ever emitting anything but 0, because its ±30-minute
 * window almost never lined up with a real session open.
 *
 * The fix is a two-step offset refinement: treat the wall clock as if it were
 * UTC, read the zone's offset AT that approximation, shift, then refine once.
 * That is DST-correct for both sides of a transition and needs no dependency.
 */

/** Offset of `iana` from UTC at instant `t`, in milliseconds (east positive). */
export function zoneOffsetMs(iana: string, t: Date | number): number {
  const instant = typeof t === 'number' ? t : t.getTime();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // `hour` is reported as 24 for midnight in some ICU builds.
  const wallAsUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'),
  );
  return wallAsUtc - instant;
}

/** Calendar date (y/m/d) of `instant` as seen in `iana`. */
function zonedDateParts(iana: string, instant: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: iana, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * The true instant at which `iana`'s local clock reads `hhmm` on the calendar
 * day that `onDay` falls on IN THAT ZONE (DST-aware, no UTC offsets involved).
 */
export function zonedWallClockInstant(iana: string, onDay: Date, hhmm: string): Date {
  const [h, m] = String(hhmm).split(':').map(Number);
  const { year, month, day } = zonedDateParts(iana, onDay);

  // Treat the wall clock as UTC, then remove the zone's offset (twice — the
  // second pass uses the offset at the approximated instant, which is what makes
  // this correct across a DST boundary).
  const wallAsUtc = Date.UTC(year, month - 1, day, h || 0, m || 0, 0);
  const approx = wallAsUtc - zoneOffsetMs(iana, wallAsUtc);
  return new Date(wallAsUtc - zoneOffsetMs(iana, approx));
}

/** Minutes since local midnight in `iana` for `instant` (0–1439). */
export function minutesInZone(instant: Date, iana: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: iana, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return (get('hour') % 24) * 60 + get('minute');
}

/**
 * Signed minutes from the session's local open to `instant`, using the zone's
 * own wall clock so a DST change cannot skew the distance.
 */
export function minutesFromOpen(instant: Date, iana: string, openHhmm: string): number {
  const [oh, om] = String(openHhmm).split(':').map(Number);
  const delta = minutesInZone(instant, iana) - ((oh || 0) * 60 + (om || 0));
  // Wrap into (-720, 720] so "just before" and "just after" are both small.
  return ((delta + 720 + 1440) % 1440) - 720;
}
