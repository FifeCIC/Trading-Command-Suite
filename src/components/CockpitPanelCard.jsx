/**
 * CockpitPanelCard — the ONE compact card for cockpit columns with no existing shared card.
 * =========================================================================================
 * WHY THIS EXISTS (2026-09-17)
 * The cockpit's Scores and Signals columns re-use the shared `ScoreCard` / `SignalCard`, because
 * those cards already existed on another page and a second implementation would drift.
 *
 * The remaining pipeline stages — Symbols, Strategy, Risk Rules, Execution, Results — have no
 * such card. The wrong move would be five bespoke cards; that is five new implementations, which
 * is exactly what "share the code" was meant to avoid. So they share THIS one instead: a compact
 * title + optional badge + a label/value row list.
 *
 * It is deliberately NOT trying to be a trading card. It has no score bar, no signal logic and no
 * actions — if a stage grows a real interaction (a quick-trade button, an inline setting), it
 * should either gain a narrow slot here or graduate to its own shared card. Do not let it grow
 * into a general-purpose card by accretion.
 *
 * ⚠️ `rows` takes tuple pairs `[label, value]`, keyed by label. Labels must therefore be unique
 * within a card — two rows called "Size" would collide as React keys AND read ambiguously.
 *
 * ⚠️ Styling is a CSS MODULE (`CockpitPanelCard.module.css`, ui-standards Rule B). Do not convert
 * these to global class names; that is the exact collision class this avoids.
 */
import styles from './CockpitPanelCard.module.css';

/** Card tone → module class. Card tone only colours the LEFT edge (up/down P&L). */
const CARD_TONES = { up: 'up', down: 'down' };

/** Badge tone → module class. The badge always states its meaning in TEXT as well. */
const BADGE_TONES = { long: 'long', short: 'short', both: 'both', warn: 'warn', muted: 'muted' };

export default function CockpitPanelCard({
  title,
  subtitle = null,
  /** `{ text, tone }` — tone is one of long | short | both | warn | muted. */
  badge = null,
  /** `[[label, value], …]` — labels must be unique within one card. */
  rows = [],
  /** 'up' | 'down' — colours the left edge only. */
  tone = null,
  /** Optional trailing line for provenance (e.g. "provider · age"). */
  meta = null,
}) {
  const toneClass = tone && CARD_TONES[tone] ? styles[CARD_TONES[tone]] : '';
  const badgeClass = badge && badge.tone && BADGE_TONES[badge.tone] ? styles[BADGE_TONES[badge.tone]] : '';

  return (
    <article className={`${styles.card} ${toneClass}`}>
      <header className={styles.head}>
        <span className={styles.title} title={title}>{title}</span>
        {badge && badge.text && <span className={`${styles.badge} ${badgeClass}`}>{badge.text}</span>}
      </header>
      {subtitle && <div className={styles.subtitle} title={subtitle}>{subtitle}</div>}
      {rows.length > 0 && (
        <dl className={styles.rows}>
          {rows.map(([label, value]) => (
            <div className={styles.row} key={label}>
              <dt className={styles.rowLabel}>{label}</dt>
              <dd className={styles.rowValue}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {meta && <div className={styles.meta}>{meta}</div>}
    </article>
  );
}
