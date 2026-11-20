/**
 * AppearanceAreaPage — the landing page of the new **Appearance** area.
 * ======================================================================
 * Requirement (2026-10-13): *"I'm using this project to establish a theme package that can be
 * carried forward to other projects."* The area is deliberately TEMPORARY-or-GALLERY: either it
 * becomes an advanced visual-options gallery, or it is the place the package is defined and then
 * adopted. Either way it is the one home for visual decisions.
 *
 * ⚠️ WHY THE LAYOUT GUIDANCE IS THE POINT OF THIS PAGE, NOT DECORATION.
 * The requirement: *"add framing/context to especially the cards with a lot of details and page layouts with
 * advanced table + column layouts so that when agentic AI helps to build a page. It has guidance built
 * into the theme area that will help it choose layouts that best suit the new page."*
 *
 * That is a real problem in this repo, measured repeatedly: the A/B Ladder shipped a layout where the
 * two columns ordered independently and "protocols sat opposite different protocols" — a layout
 * mistake that no amount of CSS fixes, because the ROW SHAPE was wrong for the question being asked.
 * So the guidance below is written as DECISIONS, each with the failure it prevents, rather than as a
 * menu of options. An agent choosing a layout should be able to read the situation and get one answer.
 *
 * ⚠️ STYLING IS SEPARATE. Colour schemes are the theme packs, listed at the bottom from the SAME
 * `THEME_CARDS` the shell used to duplicate. Structure and colour must not be coupled — the deleted
 * `ai-original` pack was the counter-example: it carried ~80 structural overrides, so the app's
 * geometry depended on which colour scheme was active.
 */
import ThemePacksChooser from '../components/ThemePacksChooser';
import PageInfoPopover from '../components/PageInfoPopover';
import ModernEffectsLab from '../components/appearance/ModernEffectsLab';
import '../core/forms.css'; // the canonical form standard — the form specimen uses the real .ff-* classes
import './appearance-area.css';

/**
 * LAYOUT_GUIDANCE — the decision table. One row per situation, each naming the failure it avoids.
 *
 * ⚠️ Every "avoid" below is a real defect from this codebase, not a hypothetical. If a new rule is
 * added, it should earn its place the same way: a layout that was built wrong, and what went wrong.
 */
const LAYOUT_GUIDANCE = [
  {
    situation: 'A handful of comparable records (≈3–12), few fields each',
    use: 'Card grid — one card per record, equal weight',
    avoid: 'A table. Below ~10 rows a table spends its width on column headers and reads as a form.',
  },
  {
    situation: 'Many records, many fields, users scanning one column',
    use: 'Table, with the scanned column first and the rest de-emphasised',
    avoid: 'Cards with everything exposed — detail density beats discoverability past ~30 rows.',
  },
  {
    situation: 'Two things compared across the same rows',
    use: 'Paired columns where the LEFT orders and the RIGHT shows its counterpart of the same row',
    avoid: 'Two independently-sorted columns. Measured on the A/B Ladder: each column ranked at its own score, so the row opposite a protocol was a different protocol — the comparison silently stopped being a comparison.',
  },
  {
    situation: 'One record in depth',
    use: 'A detail page with sections, each section answering one question',
    avoid: 'One long card. Sections can be collapsed, linked to, and read in any order.',
  },
  {
    situation: 'Continuous monitoring of values that move',
    use: 'Ladder / strip rows — compact, fixed-height, aligned columns',
    avoid: 'Cards. A moving value needs a stable position to be readable; cards reflow as content changes.',
  },
  {
    situation: 'A number whose meaning depends on another number',
    use: 'Show both, adjacent, at the same precision',
    avoid: 'A bare percentage. "Score 106 / max 100" was reported as a 106% score because the denominator lived one page away — a value separated from its denominator is a claim, not a reading.',
  },
  {
    situation: 'A form of more than about five fields',
    use: 'Grouped fields with a section per decision, and validate on the group',
    avoid: 'One flat column (or one wrapping row). Measured on /lab/movers-strategy-backtest 2026-11-20: five mixed-width controls in a single flex-wrap row read as a form sprinkled down the page — "this area is a mess".',
  },
];

/**
 * PAGE_METHOD — the build order, in the sequence a page is actually made. This is the "methodology" the
 * owner asked for: not a menu of styles, but the order of decisions that produces a page usable for a
 * whole working day rather than for a first glance. Order matters — each step assumes the one before it.
 */
const PAGE_METHOD = [
  { step: 'Name the ONE question the page answers', because: 'If you cannot state it in a sentence, it is two pages. Every element serves that question or moves to its own page.' },
  { step: 'Choose the shape from the situation (table below)', because: 'Shape before component. The wrong row shape cannot be CSS-fixed — the A/B Ladder proved it.' },
  { step: 'Put the decision before the data', because: 'A reader sets what they are asking before they can read an answer. Filters, day, leg and mode live above results.' },
  { step: 'Group inputs by decision', because: 'Past ~5 fields an ungrouped form scatters. One group per decision, one primary action.' },
  { step: 'Give every number its unit and its denominator', because: 'A value separated from what it is measured against is a claim, not a reading.' },
  { step: 'Make every table sort, and open on its subject', because: 'A provider feed order makes correct data look broken (measured: 16.10, 10.31, 8.57).' },
  { step: 'Prose is the last resort', because: 'Two lines maximum before content. Facts go in a term/value grid; explanation goes in the ℹ or the issue.' },
  { step: 'Design for the fourth hour, not the first glance', because: 'A workspace read for hours needs stable positions, restrained colour, and motion that never competes with data.' },
  { step: 'State the source of every live figure', because: 'An unchecked number is a claim. The source is what lets the next reader check it.' },
];

export default function AppearanceAreaPage() {
  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">
          The one home for visual decisions: the agreed designs, how a page should be laid out, and which
          colour scheme it wears. Structure and colour are deliberately separate concerns.
        </p>
              <PageInfoPopover>
            The visual system for this app and the projects it is carried into. Layout guidance sits
            here so an agent building a new page can choose a structure that suits it, and the theme
            packs below are colour schemes only — a pack must never change structure.
          </PageInfoPopover>
      </header>

      {/* ══ AGREED DESIGNS — live specimens, not pictures ═══════════════════════════════════════ */}
      <section className="appearance-section">
        <h3>Agreed designs</h3>
        <p className="appearance-note">
          The patterns this project has actually chosen, shown rather than described. Each is the real
          component at small size; open the link for the full page and the copyable markup.
        </p>
        <div className="appearance-spec-grid">
          <article className="appearance-spec">
            <h4>Fact strip, not a paragraph</h4>
            <p className="appearance-spec-rule">
              Facts a reader needs before a table are a term/value grid — fixed terms left, one-line
              values right. Sentences longer than two lines belong in the ℹ.
            </p>
            <div className="appearance-spec-demo">
              <dl className="appearance-facts">
                <div><dt>Session</dt><dd>Wed 19 Nov</dd></div>
                <div><dt>Symbols</dt><dd>10</dd></div>
                <div><dt>Cutoff</dt><dd>15:30 UTC</dd></div>
              </dl>
            </div>
            <a className="appearance-spec-link" href="/appearance/data-display">
              See the data patterns →
            </a>
          </article>

          <article className="appearance-spec">
            <h4>Numeric table, aligned at both ends</h4>
            <p className="appearance-spec-rule">
              Header and every cell right-aligned with tabular figures, so columns sit under their
              headers. It opens on the column that IS the subject.
            </p>
            <div className="appearance-spec-demo">
              <table className="appearance-table appearance-table--num">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Alpha</td><td>16.10</td></tr>
                  <tr><td>Beta</td><td>12.38</td></tr>
                  <tr><td>Gamma</td><td>8.57</td></tr>
                </tbody>
              </table>
            </div>
            <a className="appearance-spec-link" href="/appearance/data-display">
              See the table patterns →
            </a>
          </article>

          <article className="appearance-spec">
            <h4>Grouped form by decision</h4>
            <p className="appearance-spec-rule">
              Past five fields, fields are grouped into a section per decision with one primary action.
              The control is a segmented switch, not a second dialect of button.
            </p>
            <div className="appearance-spec-demo">
              <div className="ff-field">
                <span className="ff-label">Rank at</span>
                <div className="ff-seg" role="group" aria-label="Specimen segmented control">
                  <button type="button" className="ff-seg-btn" aria-pressed="true">15:00</button>
                  <button type="button" className="ff-seg-btn" aria-pressed="false">15:30</button>
                  <button type="button" className="ff-seg-btn" aria-pressed="false">16:30</button>
                </div>
              </div>
            </div>
            <a className="appearance-spec-link" href="/appearance/forms">
              See the form standard →
            </a>
          </article>

          <article className="appearance-spec">
            <h4>Status as a bordered chip</h4>
            <p className="appearance-spec-rule">
              A state is a rounded chip with an icon and a word — colour on the border, never on body
              text. Status is never encoded by colour alone.
            </p>
            <div className="appearance-spec-demo">
              <div className="ap-summary">
                <span className="ap-chip ap-chip--strong">✅ Proven</span>
                <span className="ap-chip ap-chip--requested">🎯 Wanted</span>
                <span className="ap-chip ap-chip--undecided">⚠️ Undecided</span>
              </div>
            </div>
            <a className="appearance-spec-link" href="/appearance/patterns">
              See the pattern library →
            </a>
          </article>
        </div>
      </section>

      {/* ══ MODERN EFFECTS — original animation & dynamic lighting, to judge before adopting ═══ */}
      <ModernEffectsLab />

      {/* ══ THE METHOD — the build order the owner asked for ═══════════════════════════════════ */}
      <section className="appearance-section">
        <h3>Building a page — the method</h3>
        <p className="appearance-note">
          The order decisions are actually made in. Each step assumes the one before it is settled; a
          page that skips a step usually has to be rebuilt around it later.
        </p>
        <ol className="appearance-method">
          {PAGE_METHOD.map((m) => (
            <li key={m.step} className="appearance-method-step">
              <span className="appearance-method-do">{m.step}</span>
              <span className="appearance-method-why">{m.because}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="appearance-section">
        <h3>Choosing a layout</h3>
        <p className="appearance-note">
          Read the situation, take the answer. Every “avoid” is a defect this app has already shipped —
          they are here so the same layout is not chosen twice.
        </p>
        <div className="appearance-table-wrap">
          <table className="appearance-table">
            <thead>
              <tr>
                <th scope="col">Situation</th>
                <th scope="col">Use</th>
                <th scope="col">Avoid, and why it failed here</th>
              </tr>
            </thead>
            <tbody>
              {LAYOUT_GUIDANCE.map((row) => (
                <tr key={row.situation}>
                  <td>{row.situation}</td>
                  <td className="appearance-use">{row.use}</td>
                  <td className="appearance-avoid">{row.avoid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="appearance-section">
        <h3>Theme packs</h3>
        <p className="appearance-note">
          Colour schemes only. Selecting one changes tokens — never layout, spacing or the size of a
          control. Pack selection moved here from the shell’s Settings rail and from the Theme Packs
          page, so it exists in one place.
        </p>
        <ThemePacksChooser />
      </section>
    </div>
  );
}
