/**
 * Earnings Whispers — rule-based parser.
 *
 * Takes a pasted Earnings Whispers email dump (raw text, images/links included)
 * and extracts the per-symbol metadata: consensus EPS/revenue, whisper number,
 * company guidance, beat expectations, short-interest, implied move, and the
 * stock's position relative to its 200-day average.
 *
 * Every extractor is best-effort: a missing field stays null rather than
 * throwing. The full source paragraph is always preserved in `rawText`, and any
 * other scraps are kept in `meta` so nothing is lost for later AI enrichment.
 */

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export interface ParsedEarningsWhisper {
  symbol: string;
  name: string | null;
  headline: string | null;
  reportDate: string | null;          // ISO date
  reportDateLabel: string | null;     // human label e.g. "Wed, Aug 26, 2026 · 4:20 PM ET"
  reportTime: string | null;          // e.g. "4:20 PM ET"
  consensusEps: number | null;
  consensusRevenue: number | null;    // stored in billions
  consensusRevenueLabel: string | null;
  whisperEps: number | null;
  guidanceEpsLow: number | null;
  guidanceEpsHigh: number | null;
  guidanceRevLow: number | null;      // billions
  guidanceRevHigh: number | null;     // billions
  beatPct: number | null;
  beatSide: string | null;            // 'beat' | 'miss'
  shortInterestChangePct: number | null;
  shortInterestDirection: string | null; // 'up' | 'down'
  impliedMovePct: number | null;
  recentAvgMovePct: number | null;
  stockChangePct: number | null;
  priceVs200dmaPct: number | null;
  dma200Price: number | null;
  rawText: string;
  meta: Record<string, unknown>;
}

// ── Small helpers ────────────────────────────────────────────────

function parseNum(s: string | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Convert an amount + unit string ("91.71", "billion") into a number in billions. */
function toBillions(amount: number | null, unit?: string): number | null {
  if (amount == null) return null;
  return unit?.toLowerCase().startsWith('m') ? amount / 1000 : amount;
}

function signed(v: number, direction: string | undefined, negativeOn: string[]): number | null {
  if (v == null) return null;
  const d = (direction ?? '').toLowerCase();
  return negativeOn.some((w) => d.includes(w)) ? -Math.abs(v) : Math.abs(v);
}

// ── Section splitting ────────────────────────────────────────────

/** Common parenthesised tokens that are NOT tickers. */
const TICKER_STOPWORDS = new Set([
  'ET', 'PM', 'AM', 'TM', 'INC', 'LLC', 'LTD', 'CO', 'CORP', 'PLC', 'US', 'UK', 'EU',
  'AI', 'EPS', 'ARR', 'PBM', 'CRPO', 'GAAP', 'NYSE', 'NASDAQ', 'S&P', 'FY', 'CEO',
  'CFO', 'CTO', 'IPO', 'ETF', 'SEC', 'FDA', 'FOMC', 'Q1', 'Q2', 'Q3', 'Q4', 'PT',
  'ISA', 'CFD', 'H1', 'H2', 'YOY', 'FT', 'EMEA', 'APAC', 'ACV', 'TCV',
]);

interface WhisperBlock {
  ticker: string;
  name: string | null;
  heading: string | null;
  body: string;
}

/**
 * Split the raw email into per-symbol blocks. Handles BOTH formats:
 *   markdown  "NVIDIA ([NVDA](https://www.earningswhispers.com/stocks/NVDA)) …"
 *   plain     "NVIDIA (NVDA) …"   (what Gmail produces on copy/paste)
 * Sections may or may not carry "###" headings — headings are recovered from
 * '#' lines, falling back to the short line directly above the company name.
 */
function extractBlocks(raw: string): WhisperBlock[] {
  const anchors: Array<{
    index: number; end: number; ticker: string; name: string | null; heading: string | null; nameStart: number;
  }> = [];

  const tickRe = /\(\[([A-Z0-9.]{2,10})\]\([^)]*\)\)|\(([A-Z0-9.]{2,10})\)/g;
  let m: RegExpExecArray | null;
  while ((m = tickRe.exec(raw))) {
    const ticker = (m[1] || m[2]).toUpperCase();
    if (TICKER_STOPWORDS.has(ticker)) continue;

    // Must appear in an earnings/report context (filters stray "(ET)" etc.)
    const ctx = raw.slice(Math.max(0, m.index - 80), Math.min(raw.length, m.index + 180));
    if (!/\b(?:report|reports|reporting|earnings|steps? up|stepped up|is (?:set|confirmed) to|consensus|whisper|guidance|beat|miss)\b/i.test(ctx)) continue;

    // Name = trailing word cluster of the line the ticker sits on.
    const before = raw.slice(Math.max(0, m.index - 120), m.index).replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
    const lineTail = before.slice(before.lastIndexOf('\n') + 1);
    const nameM = lineTail.match(/([A-Z][A-Za-z0-9&.'\- ]{1,70})\s*$/);
    let name = nameM ? nameM[1].replace(/\s+/g, ' ').trim() : null;
    if (name && /^(logo|chart|list|image)$/i.test(name)) name = null;

    let nameStart = m.index;
    if (name) {
      const idx = raw.lastIndexOf(name, m.index);
      if (idx >= 0) nameStart = idx;
    }

    anchors.push({ index: m.index, end: m.index + m[0].length, ticker, name, heading: null, nameStart });
  }

  if (anchors.length === 0) return [];

  // Attach the nearest preceding '#' heading to each anchor.
  for (const a of anchors) {
    const upto = raw.slice(0, a.index);
    const hs = [...upto.matchAll(/^#{1,4}\s+(.+)$/gm)];
    a.heading = hs.length ? hs[hs.length - 1][1].trim() : null;
  }

  const blocks: WhisperBlock[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const next = anchors[i + 1];
    const start = Math.max(0, a.nameStart);
    const end = next ? next.nameStart : raw.length;
    const body = raw.slice(start, end).replace(/^#{1,4}\s+.+$/gm, '').trim();

    // Headline fallback for plain pastes (no '#' markers): the short line
    // directly above the name that does not look like prose.
    let heading = a.heading;
    if (!heading) {
      const before = raw.slice(0, a.nameStart);
      const lines = before.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length) {
        const cand = lines[lines.length - 1];
        if (cand.length <= 140 && !/[.?!]$/.test(cand) && !/https?:/i.test(cand) && !/^(logo|chart|list|image)/i.test(cand)) {
          heading = cand;
        }
      }
    }

    blocks.push({ ticker: a.ticker, name: a.name, heading, body });
  }

  return blocks.filter((b) => b.body.length > 0);
}

// ── Field extractors ─────────────────────────────────────────────

function extractReportDate(body: string, fallbackYear: number) {
  const re = /(?:report(?:s|ing)?(?: earnings)?|steps up to (?:report earnings|the plate|the mic)|is (?:confirmed|set) to report(?: earnings)?)\s*[^.]*?(?:on\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?\s*,?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*,?\s+at\s+(?:approximately|about|around|roughly)?\s*([\d:]{1,5}\s*[AP]M)\s*ET/i;
  const m = body.match(re);
  if (!m) return { reportDate: null, reportTime: null, reportDateLabel: null };

  const month = MONTHS[m[1].toLowerCase()];
  const day = parseInt(m[2], 10);
  const year = m[3] ? parseInt(m[3], 10) : fallbackYear;
  const time = `${m[4].toUpperCase()} ET`;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const d = new Date(year, month - 1, day);
  const short = `${d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${time}`;
  return { reportDate: iso, reportTime: time, reportDateLabel: short };
}

/** "The consensus calls for $2.09 per share" / "Wall Street is looking for $0.93 per share". */
function extractConsensus(body: string): { eps: number | null; revenue: number | null; revenueLabel: string | null } {
  let eps: number | null = null;
  const epsRe = /(?:consensus calls for|is looking for|wants|bracing for|expects|eyeing)\s*(?:a loss of\s*)?\$?([\d.]+)\s*per share/i;
  const epsM = body.match(epsRe);
  if (epsM) {
    eps = parseNum(epsM[1]);
    if (/loss of/i.test(epsM[0])) eps = -Math.abs(eps!);
  }

  let revenue: number | null = null;
  let unit: string | undefined;
  const revRe = /(?:on revenue of|on|eyeing)\s*(?:\$)?([\d.]+)\s*(million|billion)\s*(?:in (?:sales|revenue))?/i;
  const revM = body.match(revRe);
  if (revM) {
    revenue = parseNum(revM[1]);
    unit = revM[2];
  }
  const revenueBillions = toBillions(revenue, unit);
  const revenueLabel = revenueBillions != null
    ? (unit?.toLowerCase().startsWith('m') ? `$${revenue!.toFixed(2)}M` : `$${revenueBillions.toFixed(2)}B`)
    : null;

  return { eps, revenue: revenueBillions, revenueLabel };
}

/** "the Earnings Whisper number sits a touch higher at $2.12 per share". */
function extractWhisper(body: string): number | null {
  const m = body.match(/[Ww]hisper(?: number)?[^.]*?\$([\d.]+)/);
  if (!m) return null;
  let v = parseNum(m[1]);
  if (v == null) return null;
  if (/loss/i.test(m[0])) v = -Math.abs(v);
  return v;
}

/** Guidance ranges: "guided to $1.93 to $2.10 per share on revenue of $89.18 billion to $92.82 billion". */
function extractGuidance(body: string) {
  let epsLow: number | null = null;
  let epsHigh: number | null = null;
  const epsRe = /(?:guided (?:to|for)|expect|told us to expect)\s*(?:a loss of\s*)?\$?([\d.]+)\s*to\s*\$?([\d.]+)\s*(?:per share)?/i;
  const epsM = body.match(epsRe);
  if (epsM) {
    epsLow = parseNum(epsM[1]);
    epsHigh = parseNum(epsM[2]);
  }

  let revLow: number | null = null;
  let revHigh: number | null = null;
  const revRe = /(?:on revenue (?:of|between)|on|expect|within[^.]*?)\s*(?:between\s*)?\$?([\d.]+)\s*(?:million|billion)?\s*to\s*\$?([\d.]+)\s*(million|billion)/i;
  const revM = body.match(revRe);
  if (revM) {
    revLow = toBillions(parseNum(revM[1]), revM[3]);
    revHigh = toBillions(parseNum(revM[2]), revM[4]);
  }

  return { guidanceEpsLow: epsLow, guidanceEpsHigh: epsHigh, guidanceRevLow: revLow, guidanceRevHigh: revHigh };
}

/** "83.0% expecting a beat" / "42.9% betting on a miss" / "half of investors betting on a beat". */
function extractBeat(body: string): { beatPct: number | null; beatSide: string | null } {
  const re = /(\d+(?:\.\d+)?|half)%?\s*(?:of (?:investors|them))?\s*(?:still\s*)?(?:expect(?:ing|s)?|betting on|are betting on|bet on|think the company will)\s*(?:a\s+)?(beat|miss)/i;
  const m = body.match(re);
  if (!m) return { beatPct: null, beatSide: null };
  const pct = m[1].toLowerCase() === 'half' ? 50 : parseNum(m[1]);
  return { beatPct: pct, beatSide: m[2].toLowerCase() };
}

const SHORT_UP = /up|exploded|jumped|jumping|piled|boosted|grew|climbed|crept up|nudged|rose/i;
const SHORT_DOWN = /down|thrown in the towel|backed off|trimmed|slid|dropped|exits|headed for the exits|quietly headed/i;

/** "Short interest crept up 3.4% since last quarter" → { 3.4, 'up' }. */
function extractShortInterest(body: string): { change: number | null; direction: string | null } {
  const m = body.match(/short (?:interest|sellers?)[^.]*?(\d+(?:\.\d+)?)%/i);
  if (!m) return { change: null, direction: null };
  const change = parseNum(m[1]);
  const segment = m[0];
  let direction: string | null = null;
  if (SHORT_DOWN.test(segment)) direction = 'down';
  else if (SHORT_UP.test(segment)) direction = 'up';
  return { change, direction };
}

/** "Options traders are bracing for a 6.2% swing". */
function extractImpliedMove(body: string): number | null {
  const m = body.match(/(?:bracing|braced|betting|bet|expecting|looking)\s+(?:for|on)\s+(?:a|an)\s+(\d+(?:\.\d+)?)%\s+swing/i);
  return m ? parseNum(m[1]) : null;
}

/** Recent average move — the second % in the options sentence. */
function extractRecentAvgMove(body: string, impliedMovePct: number | null): number | null {
  const idx = impliedMovePct != null ? body.search(new RegExp(`${impliedMovePct}%\\s+swing`, 'i')) : -1;
  const after = idx >= 0 ? body.slice(idx + 8) : body;
  const m = after.match(/(\d+(?:\.\d+)?)%/);
  if (m) return parseNum(m[1]);
  const alt = body.match(/(?:averaging a wild|average lately|averaged an|shuffle|norm|moves? about|moved about)[^.]*?(\d+(?:\.\d+)?)%/i);
  return alt ? parseNum(alt[1]) : null;
}

/** "the stock has drifted 3.4% lower from where it opened after the last report". */
function extractStockChange(body: string): number | null {
  const m = body.match(/(?:stock|shares?|it)\s+(?:has\s+)?(?:quietly\s+)?(?:drifted|drift|climbed|climbing|slid|slipped|moved|risen)\s+(?:up\s+|down\s+|about\s+|roughly\s+)?(\d+(?:\.\d+)?)%\s+(lower|higher|up|down|from|since)/i);
  if (!m) return null;
  const v = parseNum(m[1]);
  if (v == null) return null;
  const verb = m[0].toLowerCase();
  const fall = /drift|slid|slipped|fell|lower/.test(verb);
  const dir = m[2].toLowerCase();
  if (dir === 'higher' || dir === 'up') return Math.abs(v);
  if (dir === 'lower' || dir === 'down') return -Math.abs(v);
  // 'from'/'since' — direction from verb
  return fall ? -Math.abs(v) : Math.abs(v);
}

/** "9.9% above its 200 day moving average of $195.35". */
function extractDma(body: string): { pct: number | null; price: number | null } {
  const m = body.match(/(\d+(?:\.\d+)?)%\s*(above|below|under|beneath)\s+its\s+200[ -]day\s+(?:moving\s+)?average(?:\s+of\s+\$?([\d.]+))?/i);
  if (!m) return { pct: null, price: null };
  const v = parseNum(m[1]);
  const pct = m[2].toLowerCase() === 'above' ? Math.abs(v!) : -Math.abs(v!);
  return { pct, price: m[3] ? parseNum(m[3]) : null };
}

/** Notable options bet + estimate trend (kept as raw text in meta for later use). */
function extractMeta(body: string): Record<string, unknown> {
  const opts = body.match(/[Oo]n (?:August|Friday|Monday|Tuesday|Wednesday|Thursday|Saturday|Sunday)[^.]*?(?:put|call)s?[^.]*\./);
  const trend = body.match(/[Ee]stimates have been [^.]+\.|Analysts have quietly trimmed estimates[^.]*\./);
  return {
    optionsBet: opts ? opts[0].replace(/\s+/g, ' ').trim() : null,
    estimateTrend: trend ? trend[0].replace(/\s+/g, ' ').trim() : null,
  };
}

// ── Main entry ───────────────────────────────────────────────────

export function parseEarningsWhispers(raw: string): ParsedEarningsWhisper[] {
  const blocks = extractBlocks(raw);
  const fallbackYear = new Date().getFullYear();
  const entries: ParsedEarningsWhisper[] = [];

  for (const { ticker, name, heading, body } of blocks) {
    const consensus = extractConsensus(body);
    const guidance = extractGuidance(body);
    const beat = extractBeat(body);
    const short = extractShortInterest(body);
    const impliedMovePct = extractImpliedMove(body);
    const dma = extractDma(body);
    const { reportDate, reportTime, reportDateLabel } = extractReportDate(body, fallbackYear);

    entries.push({
      symbol: ticker,
      name,
      headline: heading || null,
      reportDate,
      reportDateLabel,
      reportTime,
      consensusEps: consensus.eps,
      consensusRevenue: consensus.revenue,
      consensusRevenueLabel: consensus.revenueLabel,
      whisperEps: extractWhisper(body),
      guidanceEpsLow: guidance.guidanceEpsLow,
      guidanceEpsHigh: guidance.guidanceEpsHigh,
      guidanceRevLow: guidance.guidanceRevLow,
      guidanceRevHigh: guidance.guidanceRevHigh,
      beatPct: beat.beatPct,
      beatSide: beat.beatSide,
      shortInterestChangePct: short.change,
      shortInterestDirection: short.direction,
      impliedMovePct,
      recentAvgMovePct: extractRecentAvgMove(body, impliedMovePct),
      stockChangePct: extractStockChange(body),
      priceVs200dmaPct: dma.pct,
      dma200Price: dma.price,
      rawText: body,
      meta: extractMeta(body),
    });
  }

  return entries;
}
