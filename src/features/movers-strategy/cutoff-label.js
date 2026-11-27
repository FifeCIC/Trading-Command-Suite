/**
 * cutoff-label.js — WHAT THE RANKING CUTOFF ACTUALLY IS, IN ET, ON THE DAY BEING MEASURED.
 *
 * ── THE DEFECT THIS FIXES (2026-11-27) ──────────────────────────────────────────────────────────
 * The cutoff buttons showed `15:00 / 10:00`, `15:30 / 10:30`, `16:30 / 11:30` — UTC and a hardcoded
 * ET companion. Those ET values are only true in **EST**. From 11 March to 4 November (EDT) the same
 * UTC moment is **11:00 / 11:30 / 12:30 ET**, so for roughly half the year the control claimed a screen
 * time an hour earlier than the one being used, and the `title` said *"30 min in"* when it was an hour
 * and a half in.
 *
 * ⚠️ THE CUTOFF IS THE ONE RULE THIS PAGE SAYS MUST NEVER BE SIMPLIFIED — ranking on a day's full move
 * and then trading from the open scores the strategy against the answer key. A label that misreports
 * the cutoff is therefore not cosmetic: it is the only thing telling the reader WHEN the strategy was
 * allowed to start knowing.
 *
 * ⚠️ **THE UTC VALUE IS NOT CHANGED HERE, AND MUST NOT BE.** `cutoffUtc` is the contract with the API
 * (`applySelection()` compares `minuteOfDayUtc(entry)` against it). This module derives a LABEL. Moving
 * the value would silently change what every stored run measured.
 *
 * ⚠️ NOT `new Date().getTimezoneOffset()` AND NOT A LOCAL DATE. The browser's own zone says nothing
 * about New York, and `Intl` with an explicit `timeZone` is the only thing in a browser that knows when
 * the US changes its clocks. The date comes from the DATASET, not from today — a run of a November
 * dataset is measured under November's offset, even if you run it in July.
 *
 * ── AND THE REGULATORY CHANGE FROM 6 DECEMBER 2026 ─────────────────────────────────────────────
 * US pre-market opens at 21:00 ET the evening before from that date. **It does not move this cutoff and
 * it does not move the strategy**: regular hours stay 09:30–16:00 ET, which is what `SESSION_DEFS` and
 * the market calendar encode, and the app models no pre-market boundary at all. What DOES move is the
 * ET↔UTC mapping, twice a year — which is why the label is derived rather than typed.
 */

const ET_ZONE = 'America/New_York';

/** 09:30 ET in minutes from midnight — the only reference this module needs. */
export const US_OPEN_MIN = 9 * 60 + 30;

/** ET clock minutes for a UTC `HH:MM` on a given `YYYY-MM-DD`. `null` when either input is unusable. */
function etMinutesOfDay(utc, dateISO) {
  if (!utc || !dateISO) return null;
  const at = new Date(`${dateISO}T${utc}:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ET_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  // ⚠️ Some engines render midnight as hour "24" with hour12:false — `% 24` is not defensive noise.
  return (h % 24) * 60 + m;
}

/** `570` → `09:30`. Always 24-hour, always zero-padded, so a table of them lines up. */
export function clockLabel(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * How far into the US session the cutoff falls. Negative means BEFORE the open, which is a real state
 * (an early cutoff on a dataset with pre-market bars) and must not render as "0 min in".
 */
export function offsetLabel(minutesSinceOpen) {
  if (!Number.isFinite(minutesSinceOpen)) return null;
  if (minutesSinceOpen < 0) return `${Math.abs(minutesSinceOpen)} min before the open`;
  if (minutesSinceOpen === 0) return 'at the open';
  if (minutesSinceOpen < 60) return `${minutesSinceOpen} min in`;
  const h = Math.floor(minutesSinceOpen / 60);
  const m = minutesSinceOpen % 60;
  const hours = `${h} h`;
  return m === 0 ? `${hours} in` : `${hours} ${m} min in`;
}

/**
 * cutoffLabel(utc, dates) — the ET clock, the offset from the open, and whether the selected days
 * disagree.
 *
 * `dates` is the selected datasets' answer dates. It is an ARRAY because a multi-day run can straddle
 * the US clock change, and one label would then be wrong for some of the days it describes. When the
 * days disagree the result says `varies` rather than picking one and hoping.
 */
export function cutoffLabel(utc, dates) {
  const days = (Array.isArray(dates) ? dates : [dates]).filter(Boolean).sort();
  if (days.length === 0) return { et: null, offset: null, varies: false, perDay: [] };

  const perDay = days.map((date) => {
    const minutes = etMinutesOfDay(utc, date);
    return {
      date,
      et: clockLabel(minutes),
      offset: minutes == null ? null : offsetLabel(minutes - US_OPEN_MIN),
      minutes,
    };
  });

  const known = perDay.filter((d) => d.et != null);
  if (known.length === 0) return { et: null, offset: null, varies: false, perDay };

  const ets = new Set(known.map((d) => d.et));
  const offsets = new Set(known.map((d) => d.offset));
  return {
    et: ets.size === 1 ? known[0].et : [...ets].join('/'),
    offset: offsets.size === 1 ? known[0].offset : [...offsets].join(' or '),
    varies: ets.size > 1 || offsets.size > 1,
    perDay,
  };
}
