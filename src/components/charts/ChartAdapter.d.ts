/**
 * ChartAdapter — PLANNED interface for a shared chart-library abstraction.
 *
 * ⚠️ NOTHING IMPLEMENTS THIS YET, and nothing imports it. Measured 2026-10-09: a repo-wide search
 * for `ChartAdapter` found the name only inside this file. The 12 chart surfaces (BacktestChart,
 * EquityCurveChart, SnapshotLibrary, SnapshotReplay, PatternScanner, SupportResistance, SymbolDetail,
 * VolatilityAnalysis, ChartComparison, CandlePatternsGuide, CandlePatternChart, TrailingStopDemo)
 * each call `createChart` from 'lightweight-charts' directly, and that is NOT a bypass of an existing
 * abstraction — there is none. `SpeedChart.jsx` is a page-level WIDGET (it fetches candles from the
 * bridge itself and renders volume + EMA), so it is not a primitive they could adopt.
 *
 * ⚠️ WHY THE FILE IS NOW `.d.ts`: it previously lived at `ChartAdapter.js` while containing
 * TypeScript `export interface` declarations — a `.js` file that no bundler or runtime could parse.
 * A `.d.ts` is the correct home for declarations with no runtime code, so a future implementer can
 * actually import these types. There is no behavioural change: nothing imported the old file either.
 *
 * ⚠️ UNIFYING THE 12 IS A REAL OPTION, NOT A RECORDED DEFECT. It needs its own decision and a
 * measurement of what those surfaces genuinely duplicate before anyone starts — the premise that
 * they were bypassing a canonical primitive was measured FALSE, and acting on a refuted premise is
 * how a page ends up rewritten for no gain.
 *
 * Each library (TradingView Lightweight Charts, uPlot) would implement this.
 */

// ── DECISION (2026-10-09, primary) ──
// WHAT:      Keep this as a PLANNED abstraction (a uPlot adapter beside lightweight-charts) rather
//            than deleting it, and rename it to a valid declaration file so it can be imported.
// WHY:       The premise that 12 surfaces bypass a unified chart wrapper is REFUTED by measurement —
//            `SpeedChart` is a page widget and this file was unimportable and unreferenced. So there
//            is no duplication defect to fix, and deleting a deliberate plan artefact is not the same
//            act as deleting an accident.
// INSTEAD OF: Deleting the file as dead code, or migrating the 12 surfaces onto `SpeedChart` (which
//            cannot serve them — they render backtest curves, snapshots and S/R levels, not a live
//            bridge feed).
// REVERSE BY: Renaming back to `ChartAdapter.js`. There is no behavioural difference either way,
//            which is exactly why nothing depended on it.
// REGISTER:  docs/SETTLED-DECISIONS.md row 81
// GUARD:     none — nothing would notice this being abandoned, or having been unimportable.

/** OHLCV candle data point */
export interface CandleData {
  time: number | string; // Unix timestamp (seconds) or ISO date string
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** A marker on the chart (pattern, BOS, etc.) */
export interface ChartMarker {
  time: number | string;
  price: number;
  text: string;
  color?: string;
  shape?: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  position?: 'aboveBar' | 'belowBar' | 'inBar';
}

/** A shaded zone on the chart (fair value gap, volatility envelope) */
export interface PriceZone {
  startTime: number | string;
  endTime: number | string;
  topPrice: number;
  bottomPrice: number;
  color: string;
  opacity?: number;
  label?: string;
}

/** A horizontal line overlay (support/resistance) */
export interface HorizontalLine {
  price: number;
  color: string;
  width?: number;
  style?: 'solid' | 'dashed' | 'dotted';
  label?: string;
}

/** Core adapter interface */
export interface ChartAdapter {
  /** Render OHLCV candlestick data */
  renderCandlesticks(data: CandleData[]): void;

  /** Add a discrete marker to the chart */
  addMarker(marker: ChartMarker): void;

  /** Add a shaded price zone */
  addZone(zone: PriceZone): void;

  /** Add a horizontal line (S/R, VWAP, etc.) */
  addHorizontalLine(line: HorizontalLine): void;

  /** Toggle an indicator overlay on/off */
  toggleIndicator(indicatorId: string, visible: boolean): void;

  /** Switch to a different timeframe */
  setTimeframe(tf: string): void;

  /** Register a crosshair move callback */
  onCrosshairMove(callback: (data: { time: string; price: number } | null) => void): void;

  /** Remove and destroy the chart */
  destroy(): void;
}

/** Chart creation options */
export interface ChartOptions {
  width?: number;
  height?: number;
  theme?: 'dark' | 'light';
  container: HTMLElement;
}
