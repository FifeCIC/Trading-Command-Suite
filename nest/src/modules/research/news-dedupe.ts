/**
 * Canonical-news dedupe — "is this story already stored by the MAIN pipeline?"
 *
 * ── THE SITUATION, MEASURED 2026-11-17 ────────────────────────────────────────────────────────────
 * Two news pipelines write the same stories:
 *
 *   `newsarticle`  — written by `NewsImportService` (`@Cron('0 * * * *')`), read by 9 modules, and
 *                    the table the UI's tape renders. Owns the `NewsSource` taxonomy, `category`
 *                    and `impact`.
 *   `news_item`    — written by three research ingesters (RSS every 2 min, Finnhub every 5 min,
 *                    Alpha Vantage daily). Read by `screener.service` ONLY, as a fallback.
 *
 * Measured: of 28,350 `news_item` rows, **17,245 duplicated a `newsarticle` URL** and 11,105 were
 * genuinely unique.
 *
 * ── WHY THE INGESTERS MUST CHECK, NOT JUST BE CLEANED ─────────────────────────────────────────────
 * All three ingesters dedupe on `sourceHash` (namespaced `rss:` / `fh:` / `av:`). So deleting the
 * duplicate rows alone is UNSTABLE: the RSS scraper re-polls every 2 minutes and the Finnhub poller
 * every 5, and anything still in a feed comes straight back. A one-off `DELETE` would look like a
 * fix and quietly undo itself.
 *
 * Guarding the writer is what makes the cleanup stick: once a story is already in `newsarticle`, the
 * ingester declines to write it again, so a deleted duplicate stays deleted.
 *
 * ── WHY EXACT-MATCH, NOT NORMALISED ──────────────────────────────────────────────────────────────
 * The comparison is `newsarticle.url = news_item.url`, exactly as measured. Trimming, case-folding
 * or stripping query strings would each WIDEN the definition of "duplicate" beyond the set that was
 * actually measured, and a false positive here silently drops a story that was not a duplicate.
 * Narrow beats clever.
 */

/** Runs the existence probe. Injected so the decision is testable without a database. */
export type UrlExistsProbe = (url: string) => Promise<boolean>;

/**
 * TRUE when `url` is already stored by the canonical pipeline, so the caller must NOT insert it.
 *
 * ⚠️ AN EMPTY OR MISSING URL IS **NOT** A DUPLICATE. There is nothing to match on, so the item is
 * allowed through — refusing it would discard a story on the basis of a field the source did not
 * supply.
 *
 * ⚠️ A FAILED PROBE ALSO ALLOWS THE INSERT (fail-open), deliberately and only here. The two failures
 * are not symmetric: a duplicate is recoverable — `scripts/validate-news-dedupe.cjs` names it and it
 * can be deleted — whereas a story that was never stored is gone. Making this fail-closed would
 * trade a visible, fixable mess for an invisible, permanent loss.
 */
export async function isAlreadyInCanonicalNews(
  url: string | null | undefined,
  exists: UrlExistsProbe,
): Promise<boolean> {
  if (typeof url !== 'string') return false;
  if (url.trim() === '') return false;
  try {
    return await exists(url);
  } catch {
    return false;
  }
}
