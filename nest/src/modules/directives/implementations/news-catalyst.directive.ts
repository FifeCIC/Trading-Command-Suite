/**
 * news-catalyst.directive.ts — catalyst PRESENCE from the news already stored (#4, #630, #512).
 * ==============================================================================
 *
 * ── ⚠️ WHY THIS IS NOT A SENTIMENT DIRECTIVE, AND WHY THAT IS A MEASUREMENT ──────────────────
 *
 * Issue #4 ("VIX News Sentiment Analysis Engine") asks for AI sentiment scoring and a 1–5 severity
 * rating. Measured against the live `news_item` table on 2026-10-01, with **12,298** rows:
 *
 *   | column       | reality                                                              |
 *   |--------------|----------------------------------------------------------------------|
 *   | `sentiment`  | **0 of 12,298 populated — entirely NULL**                            |
 *   | `severity`   | **10,212 rows are the value `1`, 2,086 are `0`. Two values. No scale.**|
 *   | `publishedAt`| 12,298 of 12,298                                                     |
 *   | `symbols`    | 11,305 (92%)                                                         |
 *
 * So the two fields the issue is built on are exactly the two that carry nothing. `severity` is a
 * **boolean wearing a 1–5 label** — weighting by it would multiply every score by the same constant,
 * which is the "column that looks like a control but is not one" defect this repo keeps re-finding.
 * And a sentiment directive would return the same abstain on every call, forever.
 *
 * ⚠️ **THEREFORE THIS SCORES WHAT IS REAL**: relevance (`symbols`), recency (`publishedAt`), and
 * volume within a window. No AI, no new tables, no external API — so two identical reads give an
 * identical score, which is the property that makes A/B measurement possible at all. An
 * LLM-scored field would break that, and this repo's whole evaluation discipline rests on it.
 *
 * ── ⚠️ IT IS DIRECTION-NEUTRAL, AND THAT IS CORRECT RATHER THAN LAZY ─────────────────────────
 *
 * `#1020` / `#1027` found that `regime-shift-exit` and `time-stop` hardcoded `signalClass:
 * 'neutral'` and therefore could never argue an exit, even at score 100 — a directive that MUTE. The
 * lesson is not "never return neutral"; it is "**never return neutral as a substitute for looking**".
 *
 * This directive genuinely has no direction: news VOLUME is attention, not a direction. A headline
 * count says a catalyst exists, not which way price goes. Claiming bullish or bearish here would be
 * inventing a direction the input does not contain.
 *
 * **So it is a CONFIRMATION / QUALITY directive, and must never be used as an exit argument.** If a
 * future change wants it to argue exits, it needs a direction first — which means real sentiment,
 * which means populating `news_item.sentiment`, which does not exist today.
 *
 * ── ⚠️ REQUIRED NEXT STEP — THIS DIRECTIVE IS INERT UNTIL A PRODUCER EXISTS ───────────────────
 *
 * `DirectiveInput` has no `news` field, so nothing supplies these events yet. The directive is
 * correct and testable in isolation, but it will abstain on every live call until a producer
 * populates `input.news` from `news_item` for the symbol being scored. That is a real, named gap and
 * not a detail — the repository's own rule is that a capability with no surface is
 * indistinguishable from an absent one.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/** One stored headline, as `news_item` holds it. Only the fields that carry data are read. */
export interface NewsEventInput {
  /** Comma/space separated tickers, matching `news_item.symbols`. */
  symbols?: string | null;
  publishedAt?: string | Date | null;
  title?: string | null;
}

/** How far back a headline still counts as a live catalyst. */
const WINDOW_HOURS = 24;

/**
 * Catalysts saturate quickly. Twelve relevant headlines in a day is not twelve times the signal of
 * one — it is the same event being covered repeatedly, which is the NEGATIVE the strategy cares
 * about, not a bigger positive. So volume is capped rather than unbounded.
 */
const SATURATION_COUNT = 6;

function ageHours(publishedAt: string | Date | null | undefined, asOf: Date): number | null {
  if (!publishedAt) return null;
  const t = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(t.getTime())) return null;
  const hours = (asOf.getTime() - t.getTime()) / 3_600_000;
  // A headline dated in the FUTURE is a data error, not a very fresh catalyst. Refuse it rather
  // than score it as maximally recent — the clock-skew rule.
  return hours < 0 ? null : hours;
}

/** Does a stored `symbols` string mention this symbol? Exact ticker match, never substring. */
function mentions(symbols: string | null | undefined, symbol: string): boolean {
  if (!symbols || !symbol) return false;
  const want = symbol.trim().toUpperCase();
  return symbols
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .includes(want);
}

@Injectable()
export class NewsCatalystDirective implements IDirective {
  readonly id = 'news-catalyst-strength';
  readonly name = 'News Catalyst Presence';
  readonly description =
    'Whether a catalyst for this symbol is live: relevant headlines, how recent, how many. Direction-neutral by construction — it measures attention, not direction. ⚠️ Requires a producer for input.news.';
  readonly priority = 55;
  readonly maxScore = 90;
  readonly minScore = 1;
  // No bars are read, so no bar requirement. Declaring one would make the pipeline withhold input
  // this directive never asks for.
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;
  /** ⚠️ THE FEED THIS DEPENDS ON. Named so a missing producer is visible rather than silent. */
  readonly requiredDataFeeds = ['news'];

  calculate(input: DirectiveInput & { news?: NewsEventInput[] }): DirectiveResult {
    const all = input.news;

    // ⚠️ NO PRODUCER / NO FEED IS NOT "NO NEWS". One is an absence of EVIDENCE, the other is
    // evidence of ABSENCE, and only the second is a finding. They must not render identically.
    if (!Array.isArray(all)) {
      return {
        score: 0,
        confidence: 0,
        reason: 'News feed not supplied to this directive — cannot judge (this is not "no news")',
        signalClass: 'neutral',
        unmeasured: true,
      };
    }

    const asOf = input.asOf instanceof Date ? input.asOf : new Date();
    const symbol = String(input.symbol ?? '').trim().toUpperCase();
    if (!symbol) {
      return { score: 0, confidence: 0, reason: 'No symbol on the input — cannot match headlines', signalClass: 'neutral', unmeasured: true };
    }

    const relevant = all.filter((n) => mentions(n?.symbols, symbol));
    if (relevant.length === 0) {
      // A measured zero. The feed WAS read and found nothing — a real answer, so NOT `unmeasured`.
      return {
        score: 0,
        confidence: 0.4,
        reason: `No headline mentions ${symbol}`,
        signalClass: 'neutral',
      };
    }

    const inWindow = relevant
      .map((n) => ({ n, age: ageHours(n?.publishedAt, asOf) }))
      .filter((x): x is { n: NewsEventInput; age: number } => x.age !== null && x.age <= WINDOW_HOURS);

    if (inWindow.length === 0) {
      return {
        score: 0,
        confidence: 0.4,
        reason: `${relevant.length} headline(s) mention ${symbol} but none within ${WINDOW_HOURS}h — no live catalyst`,
        signalClass: 'neutral',
      };
    }

    // Volume, saturating — see SATURATION_COUNT.
    const volume = Math.min(1, inWindow.length / SATURATION_COUNT);
    // Recency, linear to the window edge.
    const freshest = Math.min(...inWindow.map((x) => x.age));
    const recency = Math.max(0, 1 - freshest / WINDOW_HOURS);

    // Recency dominates volume deliberately: one headline ten minutes old is a live catalyst; six
    // from twenty hours ago is yesterday's story still being indexed.
    const score = Math.round(30 + recency * 40 + volume * 20);

    return {
      score,
      confidence: Math.min(0.85, 0.4 + recency * 0.45),
      reason:
        `Catalyst live for ${symbol}: ${inWindow.length} headline(s) in ${WINDOW_HOURS}h, ` +
        `freshest ${freshest.toFixed(1)}h old`,
      // ⚠️ NEUTRAL IS THE TRUE ANSWER, not a withheld one — see the header. Do not "fix" this into a
      // direction; the input contains none.
      signalClass: 'neutral',
    };
  }
}
