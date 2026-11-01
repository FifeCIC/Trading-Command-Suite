/**
 * ProtocolDirectiveSettings — step 6 ("Directive overrides") as a list of the protocol's DIRECTIVES.
 *
 * ── WHAT WAS WRONG BEFORE (owner, 2026-11-01) ───────────────────────────────────────────────────
 * The step rendered a flat settings INVENTORY of five override fields with an `honoured / reported /
 * ignored` badge each, a counts strip ("5 listed · 1 honoured · 0 reported · 4 ignored") and a
 * filter toolbar. The owner's reaction:
 *
 *   *"What does this even mean … Only one of these five fields is actually applied per protocol — the
 *   rest are inert? … Why would we have settings that aren't applied? … It's a bit much to cope with.
 *   I don't even think its needed."* … *"we should have a list of accordions for all the directives."*
 *
 * ⚠️ FOUR OF THOSE FIVE FIELDS DID NOTHING. Measured from `/api/backtest/settings-inventory`:
 * `maxScore` = **honoured**; `minScore`, `priority`, `category`, `directionBias` = **ignored** (they
 * exist and decide nothing in a run). Four controls that cannot change a result, plus two summary rows
 * to describe them, is the noise the owner was reacting to. They are now ONE line, not four rows.
 *
 * ── WHAT THIS SHOWS INSTEAD ────────────────────────────────────────────────────────────────────
 * One accordion per directive the protocol actually contains, in the protocol's own group order, so the
 * question "what can I change on this protocol" has one answer per directive. A directive with a preview
 * implementation opens into its settings and chart; one without says so in a line rather than pretending.
 *
 * ⚠️ NO COUNTS AND NO FILTERS. A filter is for a list too long to scan; a protocol has 7–15 directives and
 * the groups already organise them. `showFilters` on the old table was inherited from a 100-row
 * registry, not chosen for this step.
 */
import { useMemo, useState } from 'react';
import RsiDivergencePanel from './RsiDivergencePanel.jsx';

/** Directives this component can actually preview. Anything else says so instead of drawing nothing. */
const PREVIEWS = new Set(['rsi-divergence']);

export default function ProtocolDirectiveSettings({
  protocol,
  symbol,
  timeframe,
  days,
  periodId,
}) {
  /** Accordion state — collapsed by default except the first, so the step opens on something usable. */
  const [open, setOpen] = useState(() => new Set());

  /**
   * Flatten the protocol's groups into one row per directive, keeping group order and de-duplicating:
   * a directive can appear in more than one group and rendering it twice would offer two sets of controls
   * for one value.
   */
  const directives = useMemo(() => {
    const seen = new Set();
    const rows = [];
    for (const g of protocol?.groups ?? []) {
      for (const d of g.directives ?? []) {
        if (!d?.id || seen.has(d.id)) continue;
        seen.add(d.id);
        rows.push({ id: d.id, name: d.name ?? d.id, description: d.description ?? '', maxScore: d.maxScore, group: g.name ?? '' });
      }
    }
    return rows;
  }, [protocol]);

  if (!protocol) {
    return (
      <InfoNoteLike>
        Pick a protocol in step 1 and its directives appear here.
      </InfoNoteLike>
    );
  }

  if (directives.length === 0) {
    return (
      <InfoNoteLike>
        <strong>{protocol.name ?? protocol.id}</strong> resolves no directives, so there is nothing to
        configure — that is a data gap in the protocol, not an empty state of this step.
      </InfoNoteLike>
    );
  }

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="bt-directive-list">
      {directives.map((d) => {
        const canPreview = PREVIEWS.has(d.id);
        const isOpen = open.has(d.id);
        return (
          <section key={d.id} className={`bt-directive-item${isOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="bt-directive-head"
              aria-expanded={isOpen}
              onClick={() => toggle(d.id)}
            >
              <span className="bt-directive-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              <span className="bt-directive-name">{d.name}</span>
              {d.group && <span className="bt-directive-group">{d.group}</span>}
              <span className="bt-directive-max">ceiling {d.maxScore ?? '—'}</span>
              <span className={`bt-directive-tag ${canPreview ? 'is-live' : ''}`}>
                {canPreview ? 'settings + chart' : 'no preview'}
              </span>
            </button>

            {isOpen && (
              <div className="bt-directive-body">
                {canPreview ? (
                  <RsiDivergencePanel
                    symbol={symbol}
                    timeframe={timeframe}
                    days={days}
                    periodId={periodId}
                    inSelectedProtocol
                  />
                ) : (
                  <p className="ff-hint">
                    <strong>{d.name}</strong> has no settings panel yet — the backtester reads its
                    declared defaults. A chart for it would be an empty frame, so none is drawn: a blank
                    chart reads as &ldquo;this instrument shows nothing&rdquo;, which would be a false
                    negative with no error.
                  </p>
                )}

                {/*
                  ⚠️ THE INERT FIELDS, SAID ONCE. They were four badge-carrying rows plus a counts strip.
                  They are NOT controllable here because they change nothing in a run — the honest form is
                  a sentence naming them, so nobody goes looking for a control that has no effect.
                */}
                <p className="ff-hint bt-directive-inert">
                  Only <strong>maxScore</strong> (ceiling {d.maxScore ?? '—'}) is read by a run. The
                  protocol override also accepts <code>minScore</code>, <code>priority</code>,{' '}
                  <code>category</code> and <code>directionBias</code>; all four are stored and none is
                  read, so they are not offered as controls.
                </p>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Local, not `InfoNote` — this component renders two short "nothing here" states, and importing the
 * shared note for them would pull its stylesheet into a lazily-loaded chunk for no gain. Same markup
 * shape so it reads identically.
 */
function InfoNoteLike({ children }) {
  return <p className="ff-hint">{children}</p>;
}
