/**
 * directive-fixtures.ts — the shared bar library the parameter conformance guard measures against.
 * ==============================================================================================
 * A parameter is only real if a fixture can DISTINGUISH it. That sentence is the whole design brief
 * here, and it was learned the hard way (#1165, 2026-11-01):
 *
 *  • `hammer-pattern`'s thresholds were unprovable on the original five fixtures, because every bar
 *    had identical geometry — the upper wick was always 6× the body, so the pattern was rejected
 *    before any threshold was reached.
 *  • `volume-confirmation`'s tiers were unprovable, because no series' last complete bar beat its own
 *    volume average, so every comparison landed in the "normal" branch.
 *  • `hurst-memory`'s mean-reversion level was unprovable, because five of seven series reported
 *    H ≥ 0.99 — a random walk with NO memory is what reaches the low band, and no fixture was one.
 *
 * So the set is built for COVERAGE, not prettiness: each fixture exists because some class of knob
 * cannot be measured without it, and the comment on each says which. When a new parameter cannot
 * move any fixture, the answer is to widen this file (or to refuse the parameter) — never to lower
 * the guard.
 *
 * ⚠️ EVERYTHING HERE IS DETERMINISTIC. No `Math.random`, no `Date.now`. A fixture that varies between
 * runs turns the BASELINE guard into noise, and the first thing it would hide is a default that
 * moved. The pseudo-random walks use an explicit LCG seed so a diff in a fingerprint always means a
 * change in the CODE.
 */

/** Deterministic pseudo-random in [0, 1). LCG from Numerical Recipes — same one used across the repo. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export type FixtureKind =
  // ── original five (2026-10-0x, baselined) ──────────────────────────────────────────────────────
  | 'decline-bounce'
  | 'mild-decline'
  | 'uptrend'
  | 'downtrend'
  | 'choppy'
  // ── added 2026-11-01 for pattern + volume-tier liveness ────────────────────────────────────────
  | 'reversal-hammer'
  | 'mean-reverting'
  // ── added 2026-11-01 (second landing): period sensitivity, pattern coverage, volume extremes ──
  | 'noisy-uptrend'
  | 'noisy-downtrend'
  | 'noisy-range'
  | 'volume-climax'
  | 'volume-drought'
  | 'range-compression'
  | 'doji-bar'
  | 'engulfing-bar'
  | 'harami-bar'
  | 'three-soldiers'
  | 'gap-up-bar'
  | 'long-wick'
  | 'volatility-burst'
  | 'long-rally-pullback'
  | 'long-crash-and-base'
  | 'long-gap-series'
  | 'long-range-tightening'
  | 'long-ceiling-zone';

interface WalkOpts {
  seed: number;
  n: number;
  start: number;
  /** Per-bar log drift. Small: 0.0015 over 260 bars is a ~48% move. */
  drift: number;
  /** Per-bar noise amplitude as a fraction of price. */
  vol: number;
  /** Intraday range as a fraction of price — drives wick/body/CLV variety. */
  intraday: number;
  volume?: (i: number, n: number) => number;
}

/**
 * A deterministic random walk rendered as OHLCV bars.
 *
 * ⚠️ A WALK, not a smooth curve. Period parameters (RSI-9 vs RSI-21, SMA-20 vs SMA-50) only differ
 * on series with real local structure; five of the original fixtures were monotone or single-cycle,
 * where every period reports the same thing and a working knob measures as inert.
 */
function walkBars(o: WalkOpts): any[] {
  const rand = lcg(o.seed);
  const start = Date.UTC(2026, 0, 1);
  const bars: any[] = [];
  let prevClose = o.start;
  for (let i = 0; i < o.n; i++) {
    const gap = (rand() - 0.5) * o.vol * 0.35;
    const open = prevClose * (1 + gap);
    const close = prevClose * (1 + o.drift + (rand() - 0.5) * o.vol);
    const hi = Math.max(open, close) * (1 + o.intraday * rand());
    const lo = Math.min(open, close) * (1 - o.intraday * rand());
    bars.push({
      timestamp: new Date(start + i * 3600_000),
      open,
      high: hi,
      low: lo,
      close,
      volume: o.volume ? o.volume(i, o.n) : 1_000_000 * (0.7 + 0.6 * rand()),
    });
    prevClose = close;
  }
  return bars;
}

/** Rebuild a smooth close series into bars with uniform geometry (what the original five use). */
function smoothBars(closes: number[], volumes?: number[]): any[] {
  const start = Date.UTC(2026, 0, 1);
  return closes.map((close, i) => ({
    timestamp: new Date(start + i * 3600_000),
    open: close * 0.999,
    high: close * 1.006,
    low: close * 0.994,
    close,
    volume: volumes?.[i] ?? 1_000_000,
  }));
}

/**
 * A deterministic news feed, ages in hours measured back from `asOf`.
 *
 * ⚠️ ADDED 2026-11-01 (#1165) for the same reason `dailyBarsFrom` exists: `news-catalyst` declares
 * `requiredDataFeeds = ['news']`, and `DirectiveInput` has no `news` field, so the harness supplied
 * nothing and the directive returned `unmeasured: true` on every fixture. Every parameter on it was
 * therefore unprovable by construction — the harness was testing its abstention, not its scoring.
 *
 * The ages are chosen so the two knobs are separable. One headline is 30 MINUTES old and two are
 * older, so window 1h sees one headline and window 24h sees three: the window changes both which
 * headlines count and the recency term, and therefore the score. A feed whose headlines were all the
 * same age would prove neither.
 */
export function newsFeed(asOf: Date, symbol = 'FIXTURE'): any[] {
  const hoursAgo = (h: number) => new Date(asOf.getTime() - h * 3_600_000).toISOString();
  return [
    { symbols: symbol, publishedAt: hoursAgo(0.5), title: 'Fresh catalyst' },
    { symbols: symbol, publishedAt: hoursAgo(2), title: 'Same story, second outlet' },
    { symbols: `${symbol},OTHER`, publishedAt: hoursAgo(10), title: 'Same story, third outlet' },
  ];
}

/**
 * Resample hourly bars into daily bars.
 *
 * ⚠️ ADDED 2026-11-01 (#1165) because the conformance harness supplied only `bars`, and a directive
 * that reads `input.dayBars` therefore returned "No daily bar data available" on EVERY fixture — for
 * ever. `gap-scanner` was in exactly that state: its `gapThreshold` parameter could not be proven, and
 * worse, the directive had never been exercised end to end by any guard. A harness that omits an input
 * the directive contract provides does not test the directive; it tests its abstention.
 */
export function dailyBarsFrom(hourly: any[]): any[] {
  const out: any[] = [];
  const dayMs = 86_400_000;
  let bucket: any[] = [];
  let dayKey = -1;
  const flush = () => {
    if (!bucket.length) return;
    out.push({
      timestamp: bucket[0].timestamp,
      open: bucket[0].open,
      high: Math.max(...bucket.map((b) => b.high)),
      low: Math.min(...bucket.map((b) => b.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((s, b) => s + b.volume, 0),
    });
    bucket = [];
  };
  for (const b of hourly) {
    const k = Math.floor(b.timestamp.getTime() / dayMs);
    if (k !== dayKey) { flush(); dayKey = k; }
    bucket.push(b);
  }
  flush();
  return out;
}

/** Append one explicitly-shaped candle — how each pattern fixture earns its liveness. */
function pushBar(bars: any[], shape: {
  open: number; high: number; low: number; close: number; volume?: number;
}): void {
  const last = bars[bars.length - 1];
  bars.push({
    timestamp: new Date(last.timestamp.getTime() + 3600_000),
    open: shape.open,
    high: shape.high,
    low: shape.low,
    close: shape.close,
    volume: shape.volume ?? 1_000_000,
  });
}

export function fixtureBars(kind: FixtureKind): any[] {
  const closes: number[] = [];
  const volumes: number[] = [];

  switch (kind) {
    // ── ORIGINAL FIVE ───────────────────────────────────────────────────────────────────────────
    case 'decline-bounce': {
      for (let i = 0; i < 60; i++) closes.push(100 - i * 0.9);
      for (let i = 0; i < 25; i++) closes.push(46 + i * 0.55);
      return smoothBars(closes);
    }

    // ⚠️ LOAD-BEARING. The first three fixtures left RSI at 0–3 or 75–100, where every threshold
    // variant saturates to the same tier — so an `oversoldLevel` knob looked inert while working.
    // This one lands RSI at ~46, inside the band the gate decides in.
    case 'mild-decline': {
      for (let i = 0; i < 30; i++) closes.push(100 - i * 0.9);
      for (let i = 0; i < 30; i++) closes.push(73 + i * 0.1);
      return smoothBars(closes);
    }

    case 'uptrend': {
      for (let i = 0; i < 90; i++) closes.push(100 + i * 1.1);
      return smoothBars(closes);
    }

    case 'downtrend': {
      for (let i = 0; i < 90; i++) closes.push(220 - i * 1.1);
      return smoothBars(closes);
    }

    // ⚠️ LOAD-BEARING for the volume-weighted directives. A monotone series with CONSTANT volume
    // drives MFI to 0 or 100, where every oversold gate saturates. A real up/down alternation with
    // varying volume lands MFI ~44, inside the 5–40 band the gate decides in.
    case 'choppy': {
      const rand = lcg(7);
      for (let i = 0; i < 90; i++) {
        closes.push(100 + 6 * Math.sin(i / 2.7) - 0.25 * i + (rand() - 0.5) * 1.5);
        volumes.push(1_000_000 * (0.4 + rand()));
      }
      return smoothBars(closes, volumes);
    }

    // A V-shaped run-up into a HAMMER bar: 3× lower wick, 0.1× upper wick. The V DEPTH is deliberate
    // — a 5-bar trend lookback reads the run-up (Hanging Man, 18) and a 30-bar lookback reads the
    // decline (Hammer, 71). An earlier version crossed the branch exactly at 30 bars, so
    // `trendLookback` measured as inert: a fixture must CLEAR a branch, not touch it.
    case 'reversal-hammer': {
      for (let i = 0; i < 40; i++) closes.push(100 - i * 0.5);
      for (let i = 0; i < 12; i++) closes.push(80.5 + i * 0.25);
      const bars = smoothBars(closes);
      const prior = closes[closes.length - 1];
      pushBar(bars, { open: prior, close: prior + 0.5, low: prior - 1.5, high: prior + 0.55 });
      return bars;
    }

    // Short-period oscillation: anti-persistent, so R/S gives a LOW Hurst exponent (~0.34 against
    // ~0.99 for every directional series) — the only fixture reaching hurst-memory's reversion band.
    // Varied geometry gives the CLV directives something to read, and one genuine 2.5× volume surge
    // gives the volume tiers a branch to enter.
    case 'mean-reverting': {
      const rand = lcg(11);
      for (let i = 0; i < 90; i++) {
        closes.push(100 + 8 * Math.sin(i / 1.6) + (rand() - 0.5) * 0.4);
        volumes.push(1_000_000 * (0.3 + 1.6 * rand()));
      }
      const start = Date.UTC(2026, 0, 1);
      let g = 3;
      const grand = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
      const bars = closes.map((close, i) => {
        const open = close * (0.994 + 0.012 * grand());
        const high = Math.max(open, close) * (1 + 0.004 * grand());
        const low = Math.min(open, close) * (1 - 0.004 * grand());
        return { timestamp: new Date(start + i * 3600_000), open, high, low, close, volume: volumes[i] };
      });
      const n = volumes.length;
      bars[n - 2].volume = (volumes.slice(0, n - 2).reduce((a, b) => a + b, 0) / (n - 2)) * 2.5;
      return bars;
    }

    // ── RANDOM WALKS: what makes PERIOD knobs provable ──────────────────────────────────────────
    // 260 bars so a 200-period SMA has enough history and a 50 vs 20 period actually differs.
    case 'noisy-uptrend':
      return walkBars({ seed: 101, n: 260, start: 100, drift: 0.0016, vol: 0.011, intraday: 0.006 });

    case 'noisy-downtrend':
      return walkBars({ seed: 202, n: 260, start: 210, drift: -0.0016, vol: 0.011, intraday: 0.006 });

    // Zero drift with real noise: RSI spends its time mid-band, ADX stays low, and every period
    // reports a different crossing. The single best fixture for period sensitivity.
    case 'noisy-range':
      return walkBars({ seed: 303, n: 260, start: 100, drift: 0, vol: 0.014, intraday: 0.007 });

    // ── VOLUME EXTREMES: what makes a volume TIER provable ──────────────────────────────────────
    // ⚠️ The spike covers the LAST TWO bars on purpose. Volume directives disagree about which bar
    // they read: several use `bars[length - 2]` because the newest bar is still accumulating (#1130),
    // while `volume-rhythm` examines the newest bar for a surge. A spike on only one of them would be
    // read by half the library and would prove nothing about the other half.
    case 'volume-climax':
      return walkBars({
        seed: 404, n: 260, start: 100, drift: 0.0004, vol: 0.012, intraday: 0.006,
        volume: (i, n) => (i >= n - 2 ? 4_200_000 : 1_000_000 * (0.85 + 0.3 * ((i * 37) % 11) / 11)),
      });

    case 'volume-drought':
      return walkBars({
        seed: 505, n: 260, start: 100, drift: 0.0004, vol: 0.012, intraday: 0.006,
        volume: (i, n) => (i >= n - 2 ? 180_000 : 1_000_000 * (0.85 + 0.3 * ((i * 41) % 13) / 13)),
      });

    // High volatility collapsing into a tight range by the series end — the only shape that reaches
    // a squeeze/contraction branch.
    case 'range-compression': {
      const rand = lcg(606);
      const start = Date.UTC(2026, 0, 1);
      const bars: any[] = [];
      let prev = 100;
      for (let i = 0; i < 260; i++) {
        const decay = Math.max(0.08, 1 - i / 240);
        const open = prev * (1 + (rand() - 0.5) * 0.004);
        const close = prev * (1 + (rand() - 0.5) * 0.02 * decay);
        bars.push({
          timestamp: new Date(start + i * 3600_000),
          open,
          high: Math.max(open, close) * (1 + 0.004 * decay),
          low: Math.min(open, close) * (1 - 0.004 * decay),
          close,
          volume: 1_000_000 * (0.8 + 0.4 * rand()) * (1 - 0.6 * (1 - decay)),
        });
        prev = close;
      }
      return bars;
    }

    // ── CANDLESTICK PATTERNS ────────────────────────────────────────────────────────────────────
    // Each ends with an explicitly shaped candle, after a move in the direction the pattern needs.
    // A body ratio, wick ratio or engulfing ratio is a THRESHOLD on geometry: without a candle that
    // sits near the boundary, every value of the knob gives the same answer.
    case 'doji-bar': {
      for (let i = 0; i < 60; i++) closes.push(140 - i * 0.6);
      const bars = smoothBars(closes);
      const prior = closes[closes.length - 1];
      // open ≈ close (tiny body), long wicks both ways — a textbook doji on a 0.1% body.
      pushBar(bars, { open: prior, close: prior + 0.06, low: prior - 1.2, high: prior + 1.25 });
      return bars;
    }

    case 'engulfing-bar': {
      for (let i = 0; i < 60; i++) closes.push(150 - i * 0.7);
      const bars = smoothBars(closes);
      const prior = closes[closes.length - 1];
      // a small down candle…
      pushBar(bars, { open: prior, close: prior - 0.6, low: prior - 0.75, high: prior + 0.15 });
      // …fully engulfed by a larger up candle (body 2.4× the prior body, both directions covered).
      pushBar(bars, {
        open: prior - 0.8, close: prior + 1.4, low: prior - 0.95, high: prior + 1.55,
      });
      return bars;
    }

    case 'harami-bar': {
      for (let i = 0; i < 60; i++) closes.push(150 - i * 0.7);
      const bars = smoothBars(closes);
      const prior = closes[closes.length - 1];
      // a LARGE down candle…
      pushBar(bars, { open: prior + 0.2, close: prior - 2.2, low: prior - 2.4, high: prior + 0.35 });
      // …contained by a SMALL inside body. ⚠️ 0.8 of a 2.4 body is 33%, INSIDE the 40% harami gate —
      // measured 2026-11-01, the first version used 1.0 (41.7%) and failed the gate by 1.7 points, so
      // the pattern never fired and `rsiPeriod` measured as inert. A fixture must clear a threshold,
      // not sit just outside it.
      pushBar(bars, { open: prior - 2.0, close: prior - 1.2, low: prior - 2.1, high: prior - 1.1 });
      return bars;
    }

    case 'three-soldiers': {
      for (let i = 0; i < 60; i++) closes.push(120 - i * 0.5);
      const bars = smoothBars(closes);
      let base = closes[closes.length - 1];
      // three consecutive strong up candles, each closing near its high, each opening inside the
      // previous body — the textbook shape, with bodies large enough to clear a body-ratio gate.
      for (let k = 0; k < 3; k++) {
        const open = base - 0.05;
        const close = base + 1.1;
        pushBar(bars, { open, close, low: open - 0.12, high: close + 0.1 });
        base = close;
      }
      return bars;
    }

    case 'gap-up-bar': {
      for (let i = 0; i < 60; i++) closes.push(100 - i * 0.35);
      const bars = smoothBars(closes);
      const prior = closes[closes.length - 1];
      // a 1.4% opening gap above the prior high, then a normal-bodied bar
      pushBar(bars, {
        open: prior * 1.014, close: prior * 1.019, low: prior * 1.013, high: prior * 1.021,
      });
      return bars;
    }

    // ── WICK GEOMETRY: what makes wick-filter's THREE thresholds provable ───────────────────────
    // ⚠️ wick-filter reads the LAST bar and compares its dominant wick against ATR(14), its retrace
    // ratio against a threshold, and its volume against a 9-bar average. All three must land in the
    // band where the threshold is the deciding factor, so the wick is tuned to ~2.5× ATR (significant
    // at the 1.5 default, NOT at the 4 maximum), retraced 1.5× (high at 0.5, NOT at 2.0), and the bar
    // carries 2.2× average volume (elevated at 1.5, NOT at 4).
    //
    // ⚠️ THE RETRACE RATIO IS STRUCTURALLY ≥ 1, which is why the parameter's range starts at 0.1 but
    // is only USEFUL above 1.0: for a bullish bar it is (close − low)/(open − low), and close > open.
    // A threshold below 1 can therefore never be false when a wick exists. Recorded here because it
    // looks like a bug in the fixture and is actually a property of the metric.
    case 'long-wick': {
      const rand = lcg(707);
      const start = Date.UTC(2026, 0, 1);
      const bars: any[] = [];
      let prev = 100;
      // quiet, tight bars so ATR(14) settles near 0.4
      for (let i = 0; i < 60; i++) {
        const open = prev;
        const close = prev * (1 + (rand() - 0.5) * 0.002);
        bars.push({
          timestamp: new Date(start + i * 3600_000),
          open,
          high: Math.max(open, close) + 0.15,
          low: Math.min(open, close) - 0.15,
          close,
          volume: 1_000_000,
        });
        prev = close;
      }
      // The bar under test: bullish, a 1.0 lower wick against a ~0.4 ATR, retraced 1.5×, on a volume
      // spike that is elevated against the 9-bar average but not extreme.
      const open = prev;
      const close = open + 0.5;
      bars.push({
        timestamp: new Date(start + 60 * 3600_000),
        open,
        high: close + 0.1,
        low: open - 1.0,
        close,
        volume: 2_200_000,
      });
      return bars;
    }

    // ── VOLATILITY BURST: what makes `bodyAvgPeriod` provable ───────────────────────────────────
    // An engulfing pattern whose body is only MARGINALLY above average, preceded by two large bodies.
    // The average INCLUDES the current bar (`slice(-bodyAvgPeriod)`), so a short window is dominated by
    // the three big candles and a long window is dominated by the preceding quiet ones — the size test
    // flips on the window length alone. Measured 2026-11-01: on the smooth `engulfing-bar` fixture the
    // engulfing body is 7× the average at EVERY period, so the knob could not move anything.
    case 'volatility-burst': {
      const rand = lcg(808);
      const start = Date.UTC(2026, 0, 1);
      const bars: any[] = [];
      let prev = 130;
      // ⚠️ A DECLINE into the burst, not a flat run-up. mt5-engulfing only SCORES an engulfing candle
      // when `prevMidpoint < avgClose` (its downtrend-context test); measured 2026-11-01, the first
      // version of this fixture closed the burst ABOVE the 10-bar average, so the context test failed
      // and every branch fell through to "No engulfing pattern" — the size parameter had nothing to
      // move. The burst now happens BELOW the average, which is what a real reversal looks like.
      for (let i = 0; i < 37; i++) {
        const open = prev;
        const close = prev - 0.25 + (rand() - 0.5) * 0.08;
        bars.push({
          timestamp: new Date(start + i * 3600_000),
          open, high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2, close,
          volume: 1_000_000,
        });
        prev = close;
      }
      const bar = (open: number, close: number, i: number) => bars.push({
        timestamp: new Date(start + i * 3600_000),
        open, high: Math.max(open, close) + 0.2, low: Math.min(open, close) - 0.2, close,
        volume: 1_000_000,
      });
      bar(prev, prev - 2.4, 37);            // large down
      bar(prev - 2.4, prev - 4.0, 38);      // large down  (body 1.6)
      // ⚠️ STRICT containment: the test is `curr.close > prev.open && curr.open < prev.close`. The
      // first version closed EXACTLY level with the prior open, so `engulfs` was false and the branch
      // never ran — measured 2026-11-01. A bar that touches the boundary is not an engulf, here or in
      // the market, so the fixture clears it by a margin in both directions.
      bar(prev - 4.1, prev - 2.2, 39);      // larger up   (body 1.9) engulfing bar 38
      return bars;
    }

    // ── LONG MULTI-REGIME SERIES (900 bars) ─────────────────────────────────────────────────────
    // One fixture cannot be everything, so four shapes cover what level/zone/trend directives need:
    // a swing to retrace from, a crash into a base, repeated gaps, a tightening range, and a ceiling
    // price keeps failing at. All are deterministic walks with real local structure.
    case 'long-rally-pullback': {
      const rand = lcg(1101);
      const start = Date.UTC(2026, 0, 1);
      const bars: any[] = [];
      let prev = 100;
      for (let i = 0; i < 900; i++) {
        // a rally with a scheduled 6% pullback every 120 bars — swings at two scales
        const pullback = i % 120 >= 96 ? -0.0022 : 0.0011;
        const open = prev * (1 + (rand() - 0.5) * 0.003);
        const close = prev * (1 + pullback + (rand() - 0.5) * 0.006);
        bars.push({
          timestamp: new Date(start + i * 3600_000),
          open, high: Math.max(open, close) * (1 + 0.002 * rand()),
          low: Math.min(open, close) * (1 - 0.002 * rand()), close,
          volume: 1_000_000 * (0.8 + 0.5 * rand()),
        });
        prev = close;
      }
      return bars;
    }

    case 'long-crash-and-base': {
      const rand = lcg(1202);
      const start = Date.UTC(2026, 0, 1);
      const bars: any[] = [];
      let prev = 100;
      for (let i = 0; i < 900; i++) {
        // 340 up, 130 hard down (−~1.6%/bar), 250 flat base, 180 recovering
        const drift = i < 340 ? 0.0014 : i < 470 ? -0.006 : i < 720 ? 0.0001 : 0.0012;
        const vol = i >= 470 && i < 720 ? 0.002 : 0.007;
        const open = prev * (1 + (rand() - 0.5) * 0.002);
        const close = prev * (1 + drift + (rand() - 0.5) * vol);
        bars.push({
          timestamp: new Date(start + i * 3600_000),
          open, high: Math.max(open, close) * (1 + 0.0015), low: Math.min(open, close) * (1 - 0.0015), close,
          volume: 1_000_000 * (i >= 340 && i < 470 ? 2.2 : 1) * (0.8 + 0.5 * rand()),
        });
        prev = close;
      }
      return bars;
    }

    case 'long-gap-series': {
      const rand = lcg(1303);
      const start = Date.UTC(2026, 0, 1);
      const bars: any[] = [];
      let prev = 80;
      for (let i = 0; i < 900; i++) {
        // an opening gap every 90 bars, in both directions, of ~1.2%
        const gap = i % 90 === 0 && i > 0 ? (i % 180 === 0 ? 1.012 : 0.988) : 1;
        const open = prev * gap * (1 + (rand() - 0.5) * 0.001);
        const close = open * (1 + (rand() - 0.5) * 0.007);
        bars.push({
          timestamp: new Date(start + i * 3600_000),
          open, high: Math.max(open, close) * (1 + 0.002), low: Math.min(open, close) * (1 - 0.002), close,
          volume: 1_000_000 * (0.8 + 0.5 * rand()),
        });
        prev = close;
      }
      return bars;
    }

    case 'long-range-tightening': {
      const rand = lcg(1404);
      const start = Date.UTC(2026, 0, 1);
      const bars: any[] = [];
      for (let i = 0; i < 900; i++) {
        // amplitude decays from 4% to 0.4% across the series, with a slow upward drift
        const amp = 0.04 * Math.pow(0.25, i / 900);
        const mid = 100 + i * 0.01;
        const open = mid * (1 + (rand() - 0.5) * amp * 0.5);
        const close = mid * (1 + (rand() - 0.5) * amp * 0.5);
        bars.push({
          timestamp: new Date(start + i * 3600_000),
          open, high: Math.max(open, close) * (1 + amp * 0.3), low: Math.min(open, close) * (1 - amp * 0.3), close,
          volume: 1_000_000 * (0.7 + 0.6 * rand()) * (1 - 0.5 * (i / 900)),
        });
      }
      return bars;
    }

    case 'long-ceiling-zone': {
      const rand = lcg(1505);
      const start = Date.UTC(2026, 0, 1);
      const bars: any[] = [];
      // price repeatedly rallies into ~118 and fails, so there is real overhead supply and a
      // memory zone above the current price — what overhead-supply and memory-zone directives need.
      for (let i = 0; i < 900; i++) {
        const phase = (i % 150) / 150;
        const mid = phase < 0.6 ? 100 + phase * 30 : 118 - (phase - 0.6) * 45;
        const open = mid * (1 + (rand() - 0.5) * 0.006);
        const close = mid * (1 + (rand() - 0.5) * 0.006);
        bars.push({
          timestamp: new Date(start + i * 3600_000),
          open, high: Math.max(open, close) * (1 + 0.002), low: Math.min(open, close) * (1 - 0.002), close,
          volume: 1_000_000 * (phase > 0.5 ? 1.8 : 1) * (0.8 + 0.4 * rand()),
        });
      }
      return bars;
    }
  }
}

/**
 * The fixture set under test in `directive-parameters.spec.ts`.
 *
 * The first seven are the 2026-10-0x/11-01 originals and their fingerprints are recorded in
 * `directive-parameters.baseline.json`; the rest were added with the second and third
 * parameterisation landings.
 *
 * ⚠️ THE LONG SERIES AT THE END EXIST BECAUSE SHORT FIXTURES CANNOT PROVE A LEVEL DIRECTIVE. A
 * directive that needs a swing high to retrace from, a zone price has revisited, supply sitting above
 * the current price, or a 200-bar average simply returns 0 on every 60–260 bar series — and a
 * parameter that is inert only because the setup never exists is indistinguishable, to the guard,
 * from a parameter nobody read. Sixteen of them measured that way on 2026-11-01 before these were
 * added.
 */
export const FIXTURES: readonly FixtureKind[] = [
  'decline-bounce',
  'mild-decline',
  'uptrend',
  'downtrend',
  'choppy',
  'reversal-hammer',
  'mean-reverting',
  'noisy-uptrend',
  'noisy-downtrend',
  'noisy-range',
  'volume-climax',
  'volume-drought',
  'range-compression',
  'doji-bar',
  'engulfing-bar',
  'harami-bar',
  'three-soldiers',
  'gap-up-bar',
  'long-wick',
  'volatility-burst',
  'long-rally-pullback',
  'long-crash-and-base',
  'long-gap-series',
  'long-range-tightening',
  'long-ceiling-zone',
];
