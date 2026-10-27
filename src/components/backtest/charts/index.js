/**
 * charts/ — EVERY chart in this folder is **lightweight-charts** (`createChart`), nothing else.
 * ==============================================================================================
 *
 * Owner direction, 2026-10-27: *"Please sure that you maintain a tidy file system where related
 * library files are grouped together and we don't confuse different chart technology with one
 * another."*
 *
 * The app contains exactly TWO chart technologies, and they are not interchangeable:
 *
 *   · **lightweight-charts** — canvas, time-series, an axis per pane. `charts/` (this folder).
 *   · **hand-drawn SVG** — the replay timeline at `../replay/ReplayPlayer.jsx`, which animates bars
 *     and markers over a fixed viewBox. Improving it to show entries and exits is separate work in
 *     that folder, and it must not be done by reaching for `createChart` here.
 *
 * ⚠️ THE RULE: a lightweight-charts wrapper belongs in THIS folder, beside the others, because they
 * share the library's mounting, resize and theming behaviour. A component that draws its own SVG does
 * not belong here — putting it beside these makes two different lifecycles look like one.
 *
 * ⚠️ Why grouping matters more than it sounds: before this folder existed, three lightweight-charts
 * wrappers sat loose in `components/backtest/` next to panels, and the SVG replay sat in
 * `components/` — so "which renderer does this use?" had to be answered by opening a file. Thirteen
 * other files still import `lightweight-charts` directly (`pages/*`, `components/*`); they are the
 * backlog for the same treatment, not an example to follow.
 */

export { default as BacktestChart } from './BacktestChart.jsx';
export { default as BacktestChartPane } from './BacktestChartPane.jsx';
export { default as EquityCurveChart } from './EquityCurveChart.jsx';
