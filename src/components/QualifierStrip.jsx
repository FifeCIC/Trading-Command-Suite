/**
 * QualifierStrip — what qualifies a set of figures, as a ROW OF CHIPS, with the sentences on demand.
 *
 * ── WHY THIS EXISTS (owner, 2026-11-26) ─────────────────────────────────────────────────────────
 * The stop-fill block printed four blocks of prose above a table:
 *
 *   "17 of 17 stop exit(s) had a bar extreme beyond the stop level · POTENTIAL SLIPPAGE …
 *    Overshoot past the stop — median 0.61–9.65%, p90 0.61–24.38%, worst 25.52% …
 *    The engine fills at the level … 3 of 5 day(s) recorded no stop exit at all …"
 *
 * Owner's verdict: *"If I'm doing many tests I can't afford the time of reading those … the numbers
 * don't stand out, not that I would even understand the point of them."*
 *
 * The diagnosis is not that the writing was long — it is that a **sentence cannot be scanned**. The
 * server emits caveats as finished prose, so every surface renders paragraphs and the only variable is
 * how many. This component takes the same facts as a CHIP: a state, a subject and ONE figure.
 *
 * ── THREE LAYERS ────────────────────────────────────────────────────────────────────────────────
 *   1. CHIP      always visible — tone + subject + a single decisive figure
 *   2. DETAIL    on hover / click / keyboard — the sentence, with its other figures
 *   3. MEANING   the same panel — what the reader should do with it
 *
 * ── ⚠️ TONE IS A CLAIM, SO IT MUST BE DERIVED ───────────────────────────────────────────────────
 * A chip is believed faster than a paragraph, so a wrong colour is worse than wrong prose. Tones are
 * therefore never chosen by vibes here: the caller derives them from a comparison the data supports
 * (e.g. worst stop overshoot against the bot's own stop distance). `muted` is reserved for
 * NOT MEASURED and must never borrow the `ok` colour — "cannot judge" and "fine" must not look alike.
 */
import { usePopover } from '../core/use-popover';
import './qualifier-strip.css';

/** One chip. Its own component so each panel owns one open/close state. */
function Chip({ item }) {
  const pop = usePopover({ hover: true });
  const tone = item.tone ?? 'info';

  return (
    <li className="qstrip-item" ref={pop.ref} {...pop.hoverProps}>
      <button type="button" className={`qchip qchip--${tone}`} {...pop.triggerProps}>
        <span className="qchip-dot" aria-hidden="true" />
        <span className="qchip-label">{item.label}</span>
        {item.value != null && item.value !== '' && (
          <span className="qchip-value">{item.value}</span>
        )}
      </button>
      {pop.open && (
        <span className="qchip-panel" id={pop.id} role="note">
          {item.detail && <span className="qchip-detail">{item.detail}</span>}
          {item.meaning && (
            <span className="qchip-meaning">
              <b>What it means: </b>
              {item.meaning}
            </span>
          )}
        </span>
      )}
    </li>
  );
}

/**
 * @param {{
 *   items: Array<{
 *     code?: string,
 *     tone?: 'ok'|'info'|'warn'|'risk'|'muted',
 *     label: string,
 *     value?: string|null,
 *     detail?: string,
 *     meaning?: string,
 *   }>,
 *   label?: string,
 * }} props
 */
export default function QualifierStrip({ items, label = 'What qualifies these figures' }) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) return null;

  return (
    <ul className="qstrip" aria-label={label}>
      {list.map((item, i) => (
        <Chip key={item.code ?? `${item.label}-${i}`} item={item} />
      ))}
    </ul>
  );
}
