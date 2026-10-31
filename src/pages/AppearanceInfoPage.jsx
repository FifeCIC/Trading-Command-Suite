/**
 * AppearanceInfoPage — the ONE reference for how a sentence is displayed.
 * ======================================================================
 *
 * ⚠️ WHY THIS PAGE EXISTS. Owner report, 2026-10-30, on the backtest result page:
 *
 *   *"We've got too much mixed styling when displaying sentences. We should establish a strong
 *   structure and styling for UI scenarios like this by adding an example in the Appearance area too …
 *   This is a perfect example of agentic AI working on a UI without any reference to an established
 *   theme like we are trying to do in the appearance area."*
 *
 * A page cannot converge on a pattern that is not written down anywhere. This is that pattern, as
 * running code: five roles, one anatomy, and the reason each tone exists.
 *
 * ── WHAT MAKES THIS DIFFERENT FROM A STYLE GUIDE ──────────────────────────────────────────────
 * Every example below renders the app's OWN component (`src/components/InfoNote.jsx`) and the app's own
 * stylesheet (`info-note.css`). Nothing is copied to look like the app — `ui-standards` Rule for the
 * Appearance area: *"Only use this apps own real data to create examples."* So a change to the
 * component lands here at the same moment it lands on the backtest page.
 *
 * ── THE RULE THIS PAGE IS TRYING TO ENFORCE ───────────────────────────────────────────────────
 * If a UI needs to say something ABOUT the data on screen — where it came from, what it was compared
 * with, what was applied, what the system decided, what it cannot claim — that statement is an
 * `<InfoNote>`. Not a bare `<p>`, not an `app-notice`, not a `title=` attribute. The exception is a
 * FAILURE, which is a registry notice and belongs to `NoticeBlock` with its stable code, cause and fix.
 */
import InfoNote from '../components/InfoNote';
import './appearance-area.css';

/** One role, rendered, with the rule beside it. */
function Role({ n, title, why, tone, label, meta, children, avoid }) {
  return (
    <section className="ap-family">
      <h3>
        {n}. {title}
      </h3>
      <p className="ap-family-lede">{why}</p>
      <div className="dd-stage">
        <InfoNote tone={tone} label={label} meta={meta}>{children}</InfoNote>
      </div>
      <p className="ap-family-lede">
        <code>{`<InfoNote tone="${tone}" label="${label}">`}</code>
        {avoid && <> · <strong>not</strong> {avoid}</>}
      </p>
    </section>
  );
}

export default function AppearanceInfoPage() {
  return (
    <div className="appearance-area">
      <header className="appearance-head">
        {/* ⚠️ WRAPPED SO THE TWO PARAGRAPHS STACK. `.appearance-head` is a flex row, so two sibling
            `<p>`s sit side by side and the metadata crowds the lede. One wrapper makes them one flex
            item and the text reads as a block. */}
        <div>
          <p className="appearance-lede">
            One structure for every sentence that annotates data. Five roles, one anatomy — uppercase
            role label, one body, one optional caption. The tone lives on the border and the label only,
            so five of these can stack without the page shouting.
          </p>
          <p className="ap-meta">
            Component: <code>src/components/InfoNote.jsx</code> · stylesheet:{' '}
            <code>src/components/info-note.css</code> · reference page: this one
          </p>
        </div>
      </header>

      <section className="ap-family">
        <h3>The anatomy, and why it is fixed</h3>
        <div className="ap-summary">
          <span className="ap-chip ap-chip--strong">label 0.68rem · 600 · uppercase</span>
          <span className="ap-chip ap-chip--strong">body 0.82rem · 1.45</span>
          <span className="ap-chip ap-chip--strong">caption 0.62rem · tabular</span>
          <span className="ap-chip ap-chip--requested">tone = border + label, never body text</span>
        </div>
        <p className="ap-family-lede">
          <strong>Why the tone must not colour the body:</strong> <code>ui-standards</code> records that
          the semantic tones fail WCAG AA as text on a light panel. <code>.app-notice--warning</code>{' '}
          predates that rule and colours its whole body amber; this pattern does not repeat it, which is
          why a warning here is still comfortable to read.
        </p>
        <p className="ap-family-lede">
          <strong>Why the label names a ROLE, not a topic:</strong> “Window measured” and “What this
          cannot claim” tell the reader what kind of statement this is before they read it. “Period” and
          “Note” are topics, and a page of topic labels is a page of headings that all read alike.
        </p>
      </section>

      <Role
        n={1}
        title="Provenance — where this data came from"
        why="The window, the run, the snapshot. Says which data the reader is looking at, and is the one statement every result must carry."
        tone="neutral"
        label="Window measured"
        meta="2,000 bars imported · 2,000 scored"
        avoid="a bare `.bt-period` paragraph with its own font size"
      >
        <><strong>dev-window-v1</strong> · 2026-09-09 → 2026-10-20</>
      </Role>

      <Role
        n={2}
        title="Encoding key — what a colour or shape means"
        why="A colour with no key is a claim with no provenance. The key states the encoding once, in the same box shape as everything else, instead of an orphan paragraph under the tiles."
        tone="neutral"
        label="Comparison"
        avoid="a hand-styled `.bt-compare-legend`"
      >
        Tile border <span className="info-note-key is-better">better</span>{' '}
        <span className="info-note-key is-worse">worse</span> than run{' '}
        <code>2fd56ab8</code> — the accepted A. The figure itself keeps its profit-and-loss colour.
      </Role>

      <Role
        n={3}
        title="Applied configuration — what the numbers were produced with"
        why="Costs, sizing, filters. A result is only comparable with another result measured the same way, so the settings that produced it travel with it."
        tone="neutral"
        label="Costs applied"
        meta="2% risk on $10,000"
        avoid="a `.bt-execution-info` line with its own background and size"
      >
        Break-even <strong>0.97%</strong> · slippage 0.04% each way · spread 0.89% · commission $0.00/unit
      </Role>

      <Role
        n={4}
        title="Outcome — what the system decided"
        why="A decision nobody announced is indistinguishable from a decision that was never made. Tone carries the outcome, and the number that decided it is always printed so the reader can disagree."
        tone="warning"
        label="Auto-Accept · not promoted"
        avoid="an `app-notice--warning` banner, which is for failures"
      >
        This run stays <strong>B</strong>. P&amp;L moved +3.2% against A — under the 10% improvement gate.
      </Role>

      <Role
        n={5}
        title="Limitation — what this cannot claim"
        why="The one statement a reader must not skim past, so it is last, toned, and a list rather than a sentence. Dashes read as zero; this says what is missing instead."
        tone="warning"
        label="What this cannot claim"
        avoid="an unstyled `<ul>` of dashes"
      >
        <ul>
          <li>Per-signal rows are not stored with a run, so this view lists trades, not signals.</li>
          <li>464 of 1,027 trades crossed a hole in the bar series — their hold times are inflated.</li>
        </ul>
      </Role>

      <section className="ap-family">
        <h3>When it is NOT an InfoNote</h3>
        <ul className="ap-reject">
          <li>
            <strong>A failure</strong> — a machine-readable notice with a stable code, a cause and a fix
            belongs to <code>NoticeBlock</code>. A fact does not belong in an error channel, and an
            error does not belong in a fact box.
          </li>
          <li>
            <strong>An explanation behind ℹ</strong> — hover and click targets carry the “what is this
            control” text (<code>PageInfoPopover</code>). It is on demand precisely because it is not
            about the current data.
          </li>
          <li>
            <strong>A tooltip</strong> — a <code>title=</code> attribute is hover-only, unusable by
            keyboard, touch and screen-reader users. If the sentence matters, it is visible.
          </li>
          <li>
            <strong>A second paragraph under the first</strong> — if two statements need different
            labels, they are two notes; if they share one, they are one note with a line break.
          </li>
          <li>
            <strong>Which two things are being compared</strong> — a note explains the data; a control
            changes it. “A is this run, B is that one, change it here” is one row holding the value, its
            badge and the select. Written as a label plus a note above a wide select, the same fact
            appears three times and the select is pushed off the row that owns it.
          </li>
        </ul>
      </section>

      <section className="ap-family">
        <h3>How to use it</h3>
        <div className="ap-table-wrap">
          <table className="appearance-table ap-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">label reads like</th>
                <th scope="col">tone</th>
              </tr>
            </thead>
            <tbody>
              <tr><th scope="row">Provenance</th><td>“Window measured”, “Source”</td><td><code>neutral</code></td></tr>
              <tr><th scope="row">Encoding key</th><td>“Comparison”, “Reading this table”</td><td><code>neutral</code></td></tr>
              <tr><th scope="row">Applied configuration</th><td>“Costs applied”, “Filters applied”</td><td><code>neutral</code></td></tr>
              <tr><th scope="row">Outcome</th><td>“Auto-Accept · promoted / not promoted”</td><td><code>success</code> / <code>warning</code></td></tr>
              <tr><th scope="row">Limitation</th><td>“What this cannot claim”</td><td><code>warning</code></td></tr>
            </tbody>
          </table>
        </div>
        <p className="ap-family-lede">
          ⚠️ <strong><code>neutral</code> is the default and is not a cop-out.</strong> Most statements on
          a results page are provenance. Painting them all amber is how a reader learns to ignore amber.
        </p>
      </section>
    </div>
  );
}
