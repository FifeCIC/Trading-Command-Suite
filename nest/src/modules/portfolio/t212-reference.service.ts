import { Injectable, Logger } from '@nestjs/common';
import { cleanT212Ticker } from '../providers/t212-ticker-map';

/**
 * Trading212ReferenceService — the two LOOKUP tables Trading212 exposes beside the portfolio.
 * ============================================================================================
 *
 * A position row from `/equity/portfolio` carries a ticker and nothing else a reader recognises:
 * `ASMLa_EQ` is not a company name, and nothing in the row says which **pie** it belongs to. Both
 * facts live in separate endpoints, and both are asked for on `/trading212/t212-portfolio`.
 *
 *   GET /equity/metadata/instruments   18,579 instruments · `name` ("ASML"), `shortName`, `isin`
 *   GET /equity/pies                   the pie ids, in this account
 *   GET /equity/pies/{id}              `settings.name` ("AI Giants") + `instruments[]`
 *
 * ── ⚠️ THE TWO HAVE OPPOSITE COSTS, AND ARE THEREFORE FETCHED DIFFERENTLY ────────────────────────
 *
 * **Instrument names: one call, 4.67 MB, 824 ms (measured 2026-11-19).** Cheap enough to fetch
 * during an import, which is already an explicit multi-second action. It is NOT fetched per page.
 *
 * **Pies: throttled.** Measured: a second pies request inside ~2 s returns
 * `429 {"code":"BusinessException","context":{"type":"TooManyRequests"}}`, and the list and each
 * detail are separate calls. So pies are cached, refreshed in the BACKGROUND, and a page load is
 * never made to wait for them — the same rule the symbols provenance map follows: a decoration may
 * not spend the request's budget.
 *
 * ── ⚠️ "no pie" AND "not looked up yet" ARE DIFFERENT ANSWERS ────────────────────────────────────
 *
 * `pieNames()` returns `{ names, ready }`. `ready: false` means the map has never been loaded, and a
 * caller must render "unknown" rather than "no pie" — collapsing the two would state that a held
 * symbol is not in a pie when the truth is that nobody has asked yet. This is the repo's
 * cannot-judge rule applied to a column.
 */

/** The credentials one Trading212 account answers on. Each account has its own key. */
export interface T212Creds {
  baseUrl: string;
  key: string;
  secret: string;
  /** Cache key — `isa`, `live`, `demo`. NOT the key itself, which must never be logged or keyed. */
  label: string;
}

export interface PieNamesResult {
  /** cleaned ticker → pie name. */
  names: Map<string, string>;
  /** false until a lookup has SUCCEEDED at least once. See the note above. */
  ready: boolean;
}

@Injectable()
export class Trading212ReferenceService {
  private readonly logger = new Logger(Trading212ReferenceService.name);

  private static readonly NAMES_TTL_MS = 24 * 60 * 60 * 1000;
  /** Well inside the 429 window, and a pie's membership changes only when a user edits it. */
  private static readonly PIES_TTL_MS = 30 * 60 * 1000;
  /** Spacing between pies calls — measured: ~2 s apart trips 429, so leave room. */
  private static readonly PIES_GAP_MS = 4000;

  private namesCache = new Map<string, { at: number; map: Map<string, string> }>();
  private piesCache = new Map<string, { at: number; names: Map<string, string> }>();
  private piesInFlight = new Map<string, Promise<void>>();
  private namesInFlight = new Map<string, Promise<Map<string, string>>>();

  private auth(creds: T212Creds): string {
    const { key, secret } = creds;
    return key && secret
      ? 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64')
      : key;
  }

  private async getJson(creds: T212Creds, path: string, attempt = 1): Promise<any | null> {
    try {
      const res = await fetch(`${creds.baseUrl}${path}`, {
        headers: { Authorization: this.auth(creds) },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return await res.json();
      /**
       * ⚠️ 429 IS NORMAL HERE AND GETS ONE REAL RETRY (fixed 2026-11-19). Trading212 throttles these
       * endpoints hard — measured: the very first `/equity/metadata/instruments` call after a burst of
       * manual probes returned **429**, and the next schedule succeeded (17,125 names in 311 ms).
       *
       * The warning used to say "(will retry once)" while **no retry existed**: `getJson` returned
       * `null` and the message described behaviour that did not happen. A message that claims an
       * action the code does not take is the same defect class as a ticked box for an unrun check, so
       * the retry is now real.
       */
      if (res.status === 429 && attempt < 3) {
        const waitMs = 5000 * attempt;
        this.logger.warn(
          `Trading212 ${creds.label} GET ${path} -> HTTP 429; retrying in ${waitMs}ms (attempt ${attempt + 1} of 3)`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        return this.getJson(creds, path, attempt + 1);
      }
      this.logger.warn(`Trading212 ${creds.label} GET ${path} -> HTTP ${res.status}`);
      return null;
    } catch (err: any) {
      this.logger.warn(`Trading212 ${creds.label} GET ${path} failed: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * `cleaned ticker → instrument name` from `/equity/metadata/instruments`.
   *
   * ⚠️ The result is keyed by the CLEANED ticker (`MSFT_US_EQ` → `MSFT`) because that is what our
   * `symbol.ticker` holds and what every page displays. Keying by the raw T212 ticker would produce
   * a map that never matches a row.
   *
   * Returns an EMPTY map on failure — the caller decides what to do, and `importPortfolio` already
   * treats a missing name as "leave the existing value alone".
   */
  async instrumentNames(creds: T212Creds, opts: { force?: boolean } = {}): Promise<Map<string, string>> {
    const cached = this.namesCache.get(creds.label);
    if (!opts.force && cached && Date.now() - cached.at < Trading212ReferenceService.NAMES_TTL_MS) {
      return cached.map;
    }
    const inFlight = this.namesInFlight.get(creds.label);
    if (inFlight) return inFlight;

    const task = (async () => {
      const started = Date.now();
      const rows = await this.getJson(creds, '/equity/metadata/instruments');
      if (!Array.isArray(rows)) return cached?.map ?? new Map<string, string>();

      const map = new Map<string, string>();
      for (const row of rows) {
        if (!row?.ticker || !row?.name) continue;
        map.set(cleanT212Ticker(row.ticker), String(row.name));
      }
      this.namesCache.set(creds.label, { at: Date.now(), map });
      this.logger.log(
        `Trading212 ${creds.label}: ${map.size} instrument name(s) in ${Date.now() - started}ms`,
      );
      return map;
    })();

    this.namesInFlight.set(creds.label, task);
    try {
      return await task;
    } finally {
      this.namesInFlight.delete(creds.label);
    }
  }

  /**
   * `cleaned ticker → pie name`, from `/equity/pies` plus one detail call per pie.
   *
   * ⚠️ NEVER BLOCKS A REQUEST. When the cache is cold or stale this returns immediately with
   * whatever is known and refreshes behind the caller — a pie name is a label, and the reader must
   * not wait seconds for it. `ready` says whether an answer has ever been obtained.
   */
  /**
   * `cleaned ticker → instrument name`, WITHOUT fetching.
   *
   * ⚠️ This is the reader for a PAGE. `instrumentNames()` is 4.67 MB / 824 ms, which is fine for an
   * import and wrong for a dashboard refresh — the ISA page polls every 60 s, and paying a megabyte
   * for labels would be a self-inflicted outage. So: answer from the cache if it is warm, and ask for
   * a background warm if it is not. `ready: false` means UNKNOWN, and a caller must render the ticker
   * alone rather than an empty name.
   */
  instrumentNamesIfReady(creds: T212Creds): { map: Map<string, string>; ready: boolean } {
    const cached = this.namesCache.get(creds.label);
    const stale = !cached || Date.now() - cached.at >= Trading212ReferenceService.NAMES_TTL_MS;
    if (stale && !this.namesInFlight.has(creds.label)) {
      void this.instrumentNames(creds, { force: true }).catch((err) =>
        this.logger.warn(`Trading212 ${creds.label}: instrument-name warm failed — names stay unknown: ${String(err)}`),
      );
    }
    return { map: cached?.map ?? new Map<string, string>(), ready: !!cached };
  }

  pieNames(creds: T212Creds): PieNamesResult {
    const cached = this.piesCache.get(creds.label);
    const ready = !!cached;
    const stale = !cached || Date.now() - cached.at >= Trading212ReferenceService.PIES_TTL_MS;
    if (stale && !this.piesInFlight.has(creds.label)) {
      // Fire-and-forget BY DESIGN, with the catch logging rather than swallowing: a refresh that
      // fails repeatedly must leave a trace, or the column quietly stays empty forever.
      void this.refreshPies(creds).catch((err) =>
        this.logger.warn(`Trading212 ${creds.label}: pie refresh failed — keeping the previous map: ${String(err)}`),
      );
    }
    return { names: cached?.names ?? new Map<string, string>(), ready };
  }

  private async refreshPies(creds: T212Creds): Promise<void> {
    const existing = this.piesInFlight.get(creds.label);
    if (existing) return existing;

    const task = (async () => {
      const list = await this.getJson(creds, '/equity/pies');
      if (!Array.isArray(list)) return; // 429 / auth — the previous map stands.

      const names = new Map<string, string>();
      for (const pie of list) {
        if (!pie?.id) continue;
        await new Promise((r) => setTimeout(r, Trading212ReferenceService.PIES_GAP_MS));
        const detail = await this.getJson(creds, `/equity/pies/${encodeURIComponent(pie.id)}`);
        const pieName = detail?.settings?.name || `Pie ${pie.id}`;
        for (const ins of detail?.instruments ?? []) {
          if (ins?.ticker) names.set(cleanT212Ticker(ins.ticker), pieName);
        }
      }
      this.piesCache.set(creds.label, { at: Date.now(), names });
      this.logger.log(
        `Trading212 ${creds.label}: ${list.length} pie(s), ${names.size} instrument(s) mapped to a pie`,
      );
    })();

    this.piesInFlight.set(creds.label, task);
    try {
      await task;
    } finally {
      this.piesInFlight.delete(creds.label);
    }
  }
}
