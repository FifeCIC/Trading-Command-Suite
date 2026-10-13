/**
 * AppearancePatternsPage — the owner's approved UI patterns, read back from the Page Walkthrough.
 *
 * ⚠️ WHY THIS PAGE EXISTS. The owner asked to work out "what views I find most acceptable" from the
 * walkthrough's Preferred Elements and UI/10 columns, and to use that to offer strong samples in the
 * Appearance area. This is that reading, on a page — not a chat message that scrolls away.
 *
 * ⚠️ EVERY ROW IS TRACEABLE. Each pattern names the view(s) it was proven on and the owner's score for
 * that view. Nothing here is an agent's taste dressed as a finding — the quotes are the owner's own
 * walkthrough text. A pattern sourced from a LOW-scoring page says so, because the owner sometimes
 * names the one strong element on an otherwise weak page.
 *
 * ⚠️ `state: 'undecided'` MUST STAY VISIBLE. The status-pill entry records a question the owner
 * deliberately left open (*"Please display these along side the rectangle shaped ones… so [I] can make
 * a decision"*). Building a sample that quietly picks one would answer a question they are holding.
 *
 * ⚠️ NO APP DATA IS FETCHED. The register is a static reading of a measurement, so this page works
 * with the API down and can be lifted out of this app with its data file untouched.
 */
import PageInfoPopover from '../components/PageInfoPopover';
import { UI_PATTERNS, PATTERN_FAMILIES, PATTERN_SOURCE, REJECTED_PATTERNS } from '../data/ui-patterns';
import './appearance-area.css';

const STATE = {
  strong: { label: 'Proven', icon: '✅', hint: 'The owner scored the source page well and named this pattern.' },
  requested: { label: 'Sample wanted', icon: '🎯', hint: 'The owner asked for a sample of this in the library. Not built yet.' },
  undecided: { label: 'Undecided', icon: '⚠️', hint: 'The owner wants two approaches shown side by side before choosing.' },
};

export default function AppearancePatternsPage() {
  const byFamily = PATTERN_FAMILIES.map((f) => ({ ...f, rows: UI_PATTERNS.filter((p) => p.family === f.id) }));
  const counts = {
    strong: UI_PATTERNS.filter((p) => p.state === 'strong').length,
    // ⚠️ `requested` EXCLUDES the ones with a `sampleAt`. "The owner asked for this" and "it does not
    // exist yet" are two different facts; a single counter would report the first as the second.
    requested: UI_PATTERNS.filter((p) => p.state === 'requested' && !p.sampleAt).length,
    built: UI_PATTERNS.filter((p) => p.sampleAt).length,
    undecided: UI_PATTERNS.filter((p) => p.state === 'undecided').length,
  };

  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">
          {UI_PATTERNS.length} patterns from your own walkthrough notes. These are what the samples in
          this area should be built from — and what the app&apos;s own views should converge on.
        </p>
        <p className="ap-meta">
          {PATTERN_SOURCE.entries} pages recorded · {PATTERN_SOURCE.scored} scored ·{' '}
          {PATTERN_SOURCE.preferred} with Preferred Elements — measured {PATTERN_SOURCE.measuredAt}
        </p>
              <PageInfoPopover>
            The UI patterns the owner approved, read from the Page Walkthrough on{' '}
            {PATTERN_SOURCE.measuredAt}: {PATTERN_SOURCE.entries} recorded pages, {PATTERN_SOURCE.scored}{' '}
            with a UI/10 score and {PATTERN_SOURCE.preferred} with Preferred Elements. Source:{' '}
            <code>{PATTERN_SOURCE.store}</code> in the database. Nothing here is an agent&apos;s
            preference — every row names the view it was proven on and that view&apos;s score.
          </PageInfoPopover>
      </header>

      <div className="ap-summary">
        <span className="ap-chip ap-chip--strong">✅ {counts.strong} proven</span>
        <span className="ap-chip ap-chip--strong">🛠️ {counts.built} sample built</span>
        <span className="ap-chip ap-chip--requested">🎯 {counts.requested} sample wanted</span>
        <span className="ap-chip ap-chip--undecided">⚠️ {counts.undecided} undecided</span>
      </div>

      {byFamily.map((family) => (
        <section className="ap-family" key={family.id}>
          <h3>{family.label}</h3>
          <p className="ap-family-lede">{family.lede}</p>
          <div className="appearance-table-wrap">
            <table className="appearance-table ap-table">
              <thead>
                <tr>
                  <th scope="col">Pattern</th>
                  <th scope="col">What it is</th>
                  <th scope="col">Best for</th>
                  <th scope="col">Proven on</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {family.rows.map((p) => (
                  <tr key={p.id} className={p.state === 'undecided' ? 'ap-row--flag' : undefined}>
                    <th scope="row">
                      {p.name}
                      {p.elements && p.elements.length > 0 && (
                        <span className="ap-elements">{p.elements.join(' · ')}</span>
                      )}
                    </th>
                    <td>{p.what}</td>
                    <td>{p.bestFor}</td>
                    <td className="ap-sources">
                      {p.sources.map((s) => (
                        <span key={s.view}>
                          <code>{s.view}</code>
                          <span className="ap-score">{s.score == null ? 'unrated' : `${s.score}/10`}</span>
                        </span>
                      ))}
                    </td>
                    <td>
                      <span
                        className={`ap-chip ap-chip--${p.sampleAt ? 'strong' : p.state}`}
                        title={p.sampleAt ? `Sample built — see ${p.sampleAt}` : STATE[p.state].hint}
                      >
                        {p.sampleAt ? '🛠️' : STATE[p.state].icon}{' '}
                        {p.sampleAt ? 'Sample built' : STATE[p.state].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The owner's own words, per family — the evidence, kept next to the claim. */}
          <details className="ap-quotes">
            <summary>Your notes behind these</summary>
            <ul>
              {family.rows.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong> — {p.owner}
                </li>
              ))}
            </ul>
          </details>
        </section>
      ))}

      <section className="ap-family">
        <h3>Deliberately not carried forward</h3>
        <ul className="ap-reject">
          {REJECTED_PATTERNS.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong> — {r.why}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
