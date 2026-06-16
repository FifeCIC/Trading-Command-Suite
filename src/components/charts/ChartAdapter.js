/**
 * ChartAdapter — common interface across all chart libraries.
 * Each library (TradingView Lightweight Charts, uPlot) implements this.
 */

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
