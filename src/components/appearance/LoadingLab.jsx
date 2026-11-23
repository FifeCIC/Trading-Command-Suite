/**
 * LoadingLab — three loading animations, one per situation, for the Appearance area to judge.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-11-23: *"We lack a loading animation: please add three examples… as we'll potentially use
 * different animations for different situations."* The same day, opening `/lab/movers-strategy-backtest`
 * showed a blank form field for 2–3 seconds while the day list loaded, and the page read as broken. So
 * the gap is not decoration: it is **an unanswered wait rendered as absence**.
 *
 * ── THE RULE ALL THREE OBEY (development-philosophy §7, "make silence visible") ──────────────────
 * A loading state must say which of three things is true. They are not interchangeable:
 *
 *   1. **The shape is known, the content is not** → skeleton. The final layout is drawn at final size,
 *      so nothing jumps when the data lands. The default, and the one the movers page needed.
 *   2. **Something is happening and there is no shape to draw** → orbit. A pressed button, a refresh,
 *      one value awaited in an already-drawn panel.
 *   3. **The length is known** → step rail, driven by real counts. ⚠️ Only when `total` is real.
 *
 * ⚠️ **EVERY SPECIMEN IS THE REAL COMPONENT.** `LoadingSkeleton` is used by 80+ pages, and
 * `LoadingOrbit` / `LoadingSteps` are the shared components a page would import. A look-alike drawn in
 * this file would drift and only one copy would get the next fix (`shared-core`).
 *
 * ⚠️ **SPECIMEN 3 SHOWS ITS OWN GUARD.** The "no total" case renders a sentence rather than a bar,
 * because an indeterminate sweep styled as progress is exactly what the owner called out on the
 * backtest page — *"loading bars that aren't actually based on something loading."*
 */
import { useEffect, useState } from 'react';
import LoadingSkeleton from '../LoadingSkeleton.jsx';
import LoadingOrbit from '../LoadingOrbit.jsx';
import LoadingSteps from '../LoadingSteps.jsx';
import styles from './LoadingLab.module.css';

/** The choice, stated before the specimens — so the reader picks an effect, not a look. */
const SITUATIONS = [
  {
    situation: 'Content with a known shape has not arrived',
    effect: '1 · Skeleton',
    why: 'The layout is drawn at final size, so the page does not jump when the data lands.',
  },
  {
    situation: 'An action is in flight and there is no shape to draw',
    effect: '2 · Orbit',
    why: 'A pressed button, a refresh, one value awaited. Small enough to sit inside the control.',
  },
  {
    situation: 'The length of the work is known',
    effect: '3 · Step rail',
    why: 'One segment per real step, coloured when that step is done. Never a timer.',
  },
  {
    situation: 'The length is not known, and the shape is not known either',
    effect: '2 · Orbit',
    why: 'A rail would have to invent a total, and an invented total is a fabricated measurement.',
  },
];

/**
 * The step-rail specimen runs a REAL counter, so what is on screen is state rather than a CSS loop
 * pretending to be progress. Five steps, ~700ms each.
 */
const STEPS = ['Day list', 'Bars', 'Scores', 'Trades', 'Totals'];
const STEP_MS = 700;

export default function LoadingLab() {
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (done >= STEPS.length) return undefined;
    const timer = setTimeout(() => setDone((d) => d + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <section className="appearance-section">
      <h3>Loading states — three animations, three situations</h3>
      <p className="appearance-note">
        A wait that renders as nothing reads as a broken page. Which animation is right depends on what
        is <em>known</em> — the shape, the length, or neither — so these are three answers rather than
        three styles to pick by taste.
      </p>

      <div className="appearance-table-wrap">
        <table className="appearance-table">
          <thead>
            <tr>
              <th scope="col">The situation</th>
              <th scope="col">Use</th>
              <th scope="col">Because</th>
            </tr>
          </thead>
          <tbody>
            {SITUATIONS.map((row) => (
              <tr key={row.situation}>
                <td>{row.situation}</td>
                <td className="appearance-use">{row.effect}</td>
                <td className="appearance-avoid">{row.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.grid}>
        {/* ── 1 · SKELETON — the canonical component, not a copy ── */}
        <article className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardIndex}>1</span>
            <h4 className={styles.cardName}>Skeleton</h4>
            <span className={styles.cardTag}>known shape</span>
          </div>
          <div className={styles.demo}>
            <LoadingSkeleton variant="table" rows={4} cols={5} />
          </div>
          <p className={styles.cardUse}>
            <span className={styles.cardLabel}>Use it for</span> a table, card grid or chart that will
            appear where the placeholder is. This is <code>LoadingSkeleton</code> — the component the app
            already uses — so what you judge here is what ships.
          </p>
          <p className={styles.cardAvoid}>
            <span className={styles.cardLabel}>Avoid</span> where the real layout differs from the
            placeholder: the jump when data lands is worse than the wait it removed.
          </p>
        </article>

        {/* ── 2 · ORBIT — open-ended, small enough to sit inside a control ── */}
        <article className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardIndex}>2</span>
            <h4 className={styles.cardName}>Orbit</h4>
            <span className={styles.cardTag}>no shape</span>
          </div>
          <div className={`${styles.demo} ${styles.demoCentre}`}>
            <LoadingOrbit label="Running the day…" />
            <button type="button" className={styles.accentButton} disabled>
              <LoadingOrbit label="Retesting" size="sm" onAccent />
            </button>
          </div>
          <p className={styles.cardUse}>
            <span className={styles.cardLabel}>Use it for</span> an action whose result shape is not
            known — a button mid-flight, a refresh, one value awaited inside a panel already drawn. Pair
            it with a word: the label is what a screen reader, a screenshot and reduced motion can see.
          </p>
          <p className={styles.cardAvoid}>
            <span className={styles.cardLabel}>Avoid</span> as the only thing on an empty page. Three
            seconds of an unexplained ring is precisely what made the movers page read as broken.
          </p>
        </article>

        {/* ── 3 · STEP RAIL — real counts only, and it refuses when there are none ── */}
        <article className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardIndex}>3</span>
            <h4 className={styles.cardName}>Step rail</h4>
            <span className={styles.cardTag}>known length</span>
          </div>
          <div className={styles.demo}>
            <LoadingSteps done={done} total={STEPS.length} label="Days tested" stepLabel={STEPS} />
            <button
              type="button"
              className={styles.replay}
              onClick={() => setDone(0)}
              disabled={done === 0}
            >
              Replay
            </button>
            <LoadingSteps total={0} label="Import" />
          </div>
          <p className={styles.cardUse}>
            <span className={styles.cardLabel}>Use it for</span> work whose steps are countable — five
            days being tested, an import with a known file count.
          </p>
          <p className={styles.cardAvoid}>
            <span className={styles.cardLabel}>Refuses to render</span> without a real total: the last
            line above is what a caller with no count gets. A bar filling on a timer is a number nobody
            measured.
          </p>
        </article>
      </div>
    </section>
  );
}
