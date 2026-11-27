/**
 * Explanation — the "how to read this table" sentence, inline or one click away.
 *
 * ── WHY ONE COMPONENT (decided 2026-11-27) ─────────────────────────────────────────────────────────
 * The movers page carried eleven of these, one above each table, and they were the reason the page read
 * as a wall of text: a reader scrolling for a number passed a paragraph, a table, a paragraph, a table.
 * Eleven separate collapse implementations would drift — the first would get a keyboard handler and the
 * eleventh would not. One component means one behaviour, one focus treatment, one preference.
 *
 * ⚠️ IT IS NOT FOR WARNINGS. An `Explanation` may be collapsed, so anything a reader MUST see — a total
 * that is a mark rather than a result, a fill the engine assumed, a symbol that could not run — belongs
 * in `mvp-note--warn` or a notice block, which are never hidden. The rule: explanations describe how to
 * READ a number; warnings describe what is WRONG with one.
 *
 * ⚠️ THE MARKER IS ALWAYS VISIBLE, even collapsed: an explanation nobody can find is a deletion wearing
 * the word "optional". It carries the summary as its accessible name, so "how to read this" is stated.
 */
import { useExplanations } from '../core/use-explanations.js';
import WhyPopover from './WhyPopover.jsx';

/**
 * @param {{summary: string, children: React.ReactNode, className?: string}} props
 *   `summary` — the one-line label the collapsed marker carries, and the popover's title.
 */
export default function Explanation({ summary, children, className = '' }) {
  const [shown] = useExplanations();

  if (shown) {
    return <p className={`mvp-caption ${className}`.trim()}>{children}</p>;
  }

  return (
    <p className={`mvp-caption mvp-caption--collapsed ${className}`.trim()}>
      <WhyPopover title={summary} variant="inline">
        {children}
      </WhyPopover>
      <span className="mvp-caption__label">{summary}</span>
    </p>
  );
}
