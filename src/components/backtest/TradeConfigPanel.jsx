/**
 * TradeConfigPanel — WHERE EACH TRADE-MANAGEMENT NUMBER CAME FROM.
 *
 * ── WHY THIS IS A PANEL AND NOT A LINE OF PROSE ─────────────────────────────────────────────────
 * "The strategy lost on a +430% mover because of its 1%/1% bracket" was a wrong sentence, and only a
 * table makes that class of error impossible to repeat. Measured 2026-11-20: `Movers V1 Long Bot` is
 * configured **2.5% / 6%**, entry bar **30%**, max hold **4h**, cooldown **30 min** — while the run that
 * produced the sentence used the engine's literals **1% / 1% / 0 / none**.
 *
 * The three sources answer the question "global config, hardcoded, or data-driven?", and each carries a
 * different weight when a result is read:
 *
 *   BOT            a `trading_strategy` record — the only source a live trade obeys.
 *   REQUEST        this run only. Not a fact about the strategy.
 *   ENGINE DEFAULT a literal in the engine — correct for no strategy in particular.
 *
 * ⚠️ `applied: false` is the second half of the answer, and it is NOT cosmetic. The engine has no
 * cooldown, no position cap, no session filter and sizes differently from the live loop, so those rows
 * say the result is silent about them. A row rendered as a plain value would read as measured.
 */
import { useState } from 'react';
import WhyPopover from '../WhyPopover.jsx';

const SOURCE_LABEL = {
  bot: 'bot',
  request: 'this run',
  'engine-default': 'engine default',
};

const SOURCE_TONE = {
  bot: 'bot',
  request: 'request',
  'engine-default': 'default',
};

const fmt = (v, unit) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') {
    const n = Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
    return unit ? `${n}${unit === '$' || unit === '%' ? unit : ` ${unit}`}` : n;
  }
  return String(v);
};

export default function TradeConfigPanel({ tradeConfig }) {
  const [showIgnored, setShowIgnored] = useState(true);

  if (!tradeConfig) return null;

  const fields = tradeConfig.fields ?? [];
  const ignored = fields.filter((f) => !f.applied);
  const shown = showIgnored ? fields : fields.filter((f) => f.applied);

  /** A bot value that differs from what the run used is the most interesting cell in the table. */
  const diverged = (f) => f.botValue != null && f.botValue !== f.value;

  return (
      <section id="mvp-sec-trade-config" className="mvp-block" aria-label="Trade management configuration">
      <div className="mvp-block-head">
        <h2>Trade management — where each number came from</h2>
        {ignored.length > 0 && (
          <button
            type="button"
            className="mvp-link-btn"
            aria-pressed={showIgnored}
            onClick={() => setShowIgnored((v) => !v)}
          >
            {showIgnored ? 'Hide' : 'Show'} {ignored.length} not applied
          </button>
        )}
      </div>

      <p className="mvp-config-summary">
        <span className={`mvp-source mvp-source--${tradeConfig.bot ? 'bot' : 'default'}`}>
          {tradeConfig.bot ? 'bot config' : 'engine defaults'}
        </span>
        <span>
          {tradeConfig.bot
            ? `${tradeConfig.bot.name}${tradeConfig.bot.active ? '' : ' · inactive'}`
            : 'no bot names this protocol'}
        </span>
        <WhyPopover title="What these sources mean" variant="block">
          <strong>A bot</strong> row is the only value a live trade obeys. An <strong>engine default</strong>{' '}
          row is a literal in the backtester — correct for no strategy in particular, so a result built on
          one describes signals at a bracket nobody chose. A <strong>no</strong> under Applied means the
          engine ignores the field entirely: the result says nothing about it, whichever source supplied it.
        </WhyPopover>
      </p>

      <div className="mvp-scroll">
        <table className="mvp-table">
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <th scope="col" className="mvp-num">This run used</th>
              <th scope="col">Source</th>
              <th scope="col">Applied by the engine?</th>
              <th scope="col">Where it lives</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id} className={f.applied ? '' : 'mvp-config-row--ignored'}>
                <td className="mvp-nowrap">{f.label}</td>
                <td className="mvp-num">
                  {fmt(f.value, f.unit)}
                  {diverged(f) && (
                    <span className="mvp-config-botv" title="the bot's own value, which this run did not use">
                      bot {fmt(f.botValue, f.unit)}
                    </span>
                  )}
                </td>
                <td className="mvp-nowrap">
                  <span className={`mvp-source mvp-source--${SOURCE_TONE[f.source] ?? 'default'}`}>
                    {SOURCE_LABEL[f.source] ?? f.source}
                  </span>
                </td>
                <td className="mvp-nowrap">
                  {f.applied ? (
                    <span className="mvp-state mvp-state--entry">yes</span>
                  ) : (
                    <span className="mvp-state mvp-state--warn">no</span>
                  )}
                </td>
                <td className="mvp-config-note">{f.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mvp-note">
        {tradeConfig.summary}
      </p>
    </section>
  );
}
