/**
 * AppearanceFormsPage — the Form System, in the Appearance area.
 * =============================================================
 * Owner direction, 2026-10-13: *"A dedicated page for Forms that includes this system would be good:
 * <section.tl-section> Form System — One canonical form standard. Import src/core/form…"*
 *
 * ⚠️ MOVED VERBATIM from `ThemeLabPage.jsx`, and the section was REMOVED there in the same change.
 * The owner's standing rule is that a second implementation is the most expensive kind of debt: two
 * copies drift, and only one gets the next fix. So this is a MOVE, not a copy — if you are looking for
 * the Form System and find it in two places, one of them is a mistake.
 *
 * ⚠️ THE ONLY STANDARD IS `src/core/forms.css` (`.ff-*`). There is deliberately no `.app-form` set.
 * A page with a form imports that file and uses these classes; a new class invented here would be a
 * fourth form dialect.
 *
 * ⚠️ ON SAMPLE DATA — the owner's rule for this area is *"Only use this apps own real data to create
 * examples"* (2026-10-13). That rule is about VIEWS that demonstrate app content, where an invented
 * ticker or a fake P&L reads as a working feature. A FORM demo is different and is left as-is: the
 * strings below are field placeholders, not data claims — they show what a field looks like when it
 * holds an error, a disabled control or a hint. When a view example is added to this area, it must
 * render real app data.
 */
import PageInfoPopover from '../components/PageInfoPopover';
import '../core/forms.css'; // the canonical form standard — .ff-*
import './theme-lab.css'; // the `.tl-*` classes this section was written against
import './appearance-area.css';

const FORM_STANDARD_CLASSES = [
  '.ff-form              /* Form container — column, 1rem field gap */',
  '.ff-field             /* Field group: label + control + hint */',
  '.ff-field--error      /* Field in error (red border) */',
  '.ff-field--success    /* Field in success (green border) */',
  '.ff-label             /* Uppercase micro-label */',
  '.ff-input/.ff-select/.ff-textarea  /* Unified controls */',
  '.ff-hint              /* Hint/description below a field */',
  '.ff-error/.ff-success /* Padded status banners */',
  '.ff-row-2/.ff-row-3   /* Responsive 2/3-col grids */',
  '.ff-seg/.ff-seg-btn   /* Segmented control (few options) */',
  '.ff-bar               /* Compact filter toolbar (dense) */',
  '.ff-checkbox-label    /* Checkbox + label */',
  '.ff-actions           /* Right-aligned action row */',
  '.ff-btn/.ff-btn-primary/.ff-btn-secondary  /* Buttons */',
].join('\n');

export default function AppearanceFormsPage() {
  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">
          The live standard, not a description of it. Copy a block below and it behaves as shown.
        </p>
              <PageInfoPopover>
            One canonical form standard. Import src/core/forms.css on any page with a form and use the
            .ff-* classes — comfortable field density for forms, .ff-bar for dense filter toolbars.
            There is no longer a separate .app-form set.
          </PageInfoPopover>
      </header>

      <section className="tl-section">
        <h3>Form System</h3>
        <p className="tl-hint">
          One canonical form standard. Import <code>src/core/forms.css</code> on any page with a form and use the{' '}
          <code>.ff-*</code> classes — comfortable field density for forms, <code>.ff-bar</code> for dense filter
          toolbars. There is no longer a separate <code>.app-form</code> set.
        </p>

        <div className="tl-form-demos">
          {/* Single-column demo */}
          <div className="tl-form-demo">
            <h3>Single Column</h3>
            <div className="ff-form">
              <div className="ff-field">
                <label className="ff-label" htmlFor="tl-strategy">Strategy Name</label>
                <input id="tl-strategy" type="text" className="ff-input" placeholder="e.g., Tech Dip Accumulation" defaultValue="" />
                <span className="ff-hint">Give your strategy a descriptive name.</span>
              </div>
              <div className="ff-field">
                <label className="ff-label" htmlFor="tl-watchlist">Watchlist</label>
                <select id="tl-watchlist" className="ff-select" defaultValue="">
                  <option value="">— Select a watchlist —</option>
                  <option>Momentum Stocks</option>
                  <option>Primary</option>
                </select>
                <span className="ff-hint">Symbols will come from the selected watchlist.</span>
              </div>
              <div className="ff-field">
                <label className="ff-label" htmlFor="tl-desc">Description</label>
                <textarea id="tl-desc" className="ff-textarea" placeholder="What does this strategy aim to do?" rows={2} />
              </div>
            </div>
          </div>

          {/* Two-column demo */}
          <div className="tl-form-demo">
            <h3>Two Column (responsive)</h3>
            <div className="ff-form">
              <div className="ff-row-2">
                <div className="ff-field">
                  <label className="ff-label" htmlFor="tl-min">Min Score</label>
                  <input id="tl-min" type="number" className="ff-input" placeholder="25" />
                  <span className="ff-hint">Composite score threshold (0-100).</span>
                </div>
                <div className="ff-field">
                  <label className="ff-label" htmlFor="tl-max">Max Positions</label>
                  <input id="tl-max" type="number" className="ff-input" placeholder="5" />
                  <span className="ff-hint">Maximum concurrent positions.</span>
                </div>
              </div>
              <div className="ff-row-2">
                <div className="ff-field">
                  <label className="ff-label" htmlFor="tl-sl">Stop Loss %</label>
                  <input id="tl-sl" type="number" className="ff-input" placeholder="2.0" step="0.1" />
                </div>
                <div className="ff-field">
                  <label className="ff-label" htmlFor="tl-tp">Take Profit %</label>
                  <input id="tl-tp" type="number" className="ff-input" placeholder="5.0" step="0.1" />
                </div>
              </div>
            </div>
          </div>

          {/* Segmented + buttons demo */}
          <div className="tl-form-demo">
            <h3>Segmented &amp; Actions</h3>
            <div className="ff-form">
              <div className="ff-field">
                <label className="ff-label">Session</label>
                <div className="ff-seg" role="group" aria-label="Session">
                  <button type="button" className="ff-seg-btn ff-seg-btn--active" aria-pressed="true">Any</button>
                  <button type="button" className="ff-seg-btn" aria-pressed="false">☀️ BMO</button>
                  <button type="button" className="ff-seg-btn" aria-pressed="false">🌙 AMC</button>
                </div>
              </div>
              <div className="ff-field">
                <label className="ff-label">Filter Style</label>
                <div className="ff-seg" role="group" aria-label="Filter style">
                  <button type="button" className="ff-seg-btn" aria-pressed="false">Table</button>
                  <button type="button" className="ff-seg-btn ff-seg-btn--active" aria-pressed="true">Cards</button>
                  <button type="button" className="ff-seg-btn" aria-pressed="false">Split</button>
                </div>
              </div>
              <div className="ff-actions">
                <button type="button" className="ff-btn ff-btn-secondary">Cancel</button>
                <button type="button" className="ff-btn ff-btn-primary">Save Strategy</button>
              </div>
            </div>
          </div>

          {/* Error/disabled + compact toolbar demo */}
          <div className="tl-form-demo">
            <h3>Error &amp; Disabled States</h3>
            <div className="ff-form">
              <div className="ff-field ff-field--error">
                <label className="ff-label" htmlFor="tl-ticker">Ticker Symbol</label>
                <input id="tl-ticker" type="text" className="ff-input" defaultValue="INVALID!" />
                <span className="ff-field-error">Symbol not found. Check the ticker and try again.</span>
              </div>
              <div className="ff-field">
                <label className="ff-label" htmlFor="tl-exch">Exchange</label>
                <select id="tl-exch" className="ff-select" disabled>
                  <option>NASDAQ</option>
                </select>
                <span className="ff-hint">Exchange selection is locked for this symbol.</span>
              </div>
              <div className="ff-field ff-field--success">
                <label className="ff-label" htmlFor="tl-protocol">Protocol</label>
                <select id="tl-protocol" className="ff-select" defaultValue="built-in">
                  <option>built-in</option>
                  <option>custom</option>
                </select>
                <span className="ff-hint" style={{ color: '#22c55e' }}>✓ Protocol is valid and ready to use.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Compact toolbar demo */}
        <div className="tl-form-demo" style={{ marginTop: '1.25rem' }}>
          <h3>Compact Toolbar (.ff-bar) — data-page filter row</h3>
          <div className="ff-bar">
            <div className="ff-field">
              <span className="ff-label">Horizon</span>
              <div className="ff-seg" role="group" aria-label="Horizon">
                <button type="button" className="ff-seg-btn" aria-pressed="false">1mo</button>
                <button type="button" className="ff-seg-btn" aria-pressed="false">2mo</button>
                <button type="button" className="ff-seg-btn ff-seg-btn--active" aria-pressed="true">3mo</button>
              </div>
            </div>
            <div className="ff-field">
              <label className="ff-label" htmlFor="tl-sector">Sector</label>
              <select id="tl-sector" className="ff-select" defaultValue="all">
                <option value="all">All Sectors</option>
                <option>Technology</option>
                <option>Healthcare</option>
                <option>Financials</option>
              </select>
            </div>
            <div className="ff-field">
              <span className="ff-label">Session</span>
              <div className="ff-seg" role="group" aria-label="Session">
                <button type="button" className="ff-seg-btn ff-seg-btn--active" aria-pressed="true">Any</button>
                <button type="button" className="ff-seg-btn" aria-pressed="false">☀️ BMO</button>
                <button type="button" className="ff-seg-btn" aria-pressed="false">🌙 AMC</button>
              </div>
            </div>
            <label className="ff-checkbox-label" style={{ paddingBottom: '0.4rem' }}>
              <input type="checkbox" />
              <span>Estimates only</span>
            </label>
          </div>
          <p className="tl-hint" style={{ margin: '0.75rem 0 0' }}>
            Slim on desktop for tidy screenshots; tap targets return to 44px on touch devices.
          </p>
        </div>

        {/* CSS snippet reference */}
        <details className="tl-code-block" style={{ marginTop: '1.5rem' }}>
          <summary>CSS Classes Reference</summary>
          <pre className="tl-pre">{FORM_STANDARD_CLASSES}</pre>
        </details>
      </section>

      {/* ── Add-items form — TWO ARRANGEMENTS, CHOSEN BY THE OWNER ──────────────────────────────
          Owner request, from /protocols/protocol-builder: *"add 2-3 examples of a similar 'add items'
          form arrangement and I will choose one."* Three were offered on 2026-10-13; the owner chose
          **A and B**, and C (the compact add-bar variant) was DELETED on 2026-10-14. Do not re-add C
          without asking — it was rejected, not overlooked.

          Both keep only `.ff-*` classes, and the fields are the ones the real builder uses (name,
          weight, risk gate), so these are two arrangements of ONE task, not two different forms. */}
      <section className="tl-section">
        <h3>Add-Items Form — two arrangements</h3>
        <p className="tl-hint">
          One task — build a list of items, each with a name, a weight and a risk-gate flag — laid out
          two ways. Source: <code>/protocols/protocol-builder</code> (“Directive Groups”), which the
          owner rated 7/10 with the note that the only fault was that “everythings black and white”.
        </p>

        <div className="tl-form-demos">
          {/* A — inline rows, add at the bottom. Densest. */}
          <div className="tl-form-demo">
            <h3>A · Inline rows, add at the bottom</h3>
            <div className="ff-form">
              <fieldset className="ff-fieldset">
                <legend className="ff-legend">Directive groups</legend>
                <div className="ff-row-3">
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-a1">Name</label>
                    <input id="ai-a1" className="ff-input" type="text" defaultValue="Momentum" />
                  </div>
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-a2">Weight</label>
                    <input id="ai-a2" className="ff-input" type="number" defaultValue="5" />
                  </div>
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-a3">Risk gate</label>
                    <label className="ff-checkbox-label">
                      <input id="ai-a3" type="checkbox" defaultChecked />
                      <span>Applies a risk multiplier</span>
                    </label>
                  </div>
                </div>
                <div className="ff-row-3">
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-a4">Name</label>
                    <input id="ai-a4" className="ff-input" type="text" defaultValue="Trend" />
                  </div>
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-a5">Weight</label>
                    <input id="ai-a5" className="ff-input" type="number" defaultValue="3" />
                  </div>
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-a6">Risk gate</label>
                    <label className="ff-checkbox-label">
                      <input id="ai-a6" type="checkbox" />
                      <span>Applies a risk multiplier</span>
                    </label>
                  </div>
                </div>
              </fieldset>
              <button type="button" className="ff-btn ff-btn-secondary">+ Add item</button>
            </div>
          </div>

          {/* B — one card per item. Most comfortable; better for a few items with more detail.

              ⚠️ THE OWNER'S REASON FOR KEEPING B (2026-10-14), recorded here so the choice is not
              re-opened by accident: B is the arrangement to reach for "when the values might need
              messages displayed underneath such as warnings or confirmation that the values are
              correct". Because each item is its own `<fieldset>`, it has somewhere natural to put a
              message that belongs to THAT item — the `.ff-hint` lines below are already doing exactly
              this, one per card.

              To extend it: `.ff-field--error` / `.ff-field--success` mark a field and pair with
              `.ff-field-error`, `.ff-hint-warn` gives a caution, and plain `.ff-hint` confirms.
              Those states are rendered in full in "Error & Disabled States" above.

              That is the trade against A: A is a flat grid, and a grid row has nowhere to hang a
              per-item message without breaking the columns. A is for many items, B is for items that
              need a verdict attached. */}
          <div className="tl-form-demo">
            <h3>B · One card per item</h3>
            <div className="ff-form">
              <fieldset className="ff-fieldset">
                <legend className="ff-legend">1 · Momentum</legend>
                <div className="ff-row-2">
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-b1">Weight</label>
                    <input id="ai-b1" className="ff-input" type="number" defaultValue="5" />
                  </div>
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-b2">Min multiplier</label>
                    <input id="ai-b2" className="ff-input" type="number" step="0.1" defaultValue="0.5" />
                  </div>
                </div>
                <span className="ff-hint">Risk gate — caps the composite when conditions are poor.</span>
              </fieldset>
              <fieldset className="ff-fieldset">
                <legend className="ff-legend">2 · Trend</legend>
                <div className="ff-row-2">
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-b3">Weight</label>
                    <input id="ai-b3" className="ff-input" type="number" defaultValue="3" />
                  </div>
                  <div className="ff-field">
                    <label className="ff-label" htmlFor="ai-b4">Min multiplier</label>
                    <input id="ai-b4" className="ff-input" type="number" step="0.1" defaultValue="1" />
                  </div>
                </div>
                <span className="ff-hint">Not a gate — contributes to the composite only.</span>
              </fieldset>
              <button type="button" className="ff-btn ff-btn-secondary">+ Add item</button>
            </div>
          </div>

        </div>
      </section>

      {/* ── Segmented filter, second variant ─────────────────────────────────────────────────────── */}
      <section className="tl-section">
        <h3>Segmented filter — the two proven variants</h3>
        <p className="tl-hint">
          Both come from <code>/research/earnings-calendar</code>, where the owner singled them out: *“The
          screen options are good … they work especially good with icons.”* A segmented control is for a
          FEW fixed options; past about five, use a <code>.ff-select</code> instead.
        </p>
        <div className="ff-form">
          <div className="ff-field">
            <span className="ff-label">Time window — five options, plain text</span>
            <div className="ff-seg" role="group" aria-label="Time window">
              <button type="button" className="ff-seg-btn ff-seg-btn--active" aria-pressed="true">All</button>
              <button type="button" className="ff-seg-btn" aria-pressed="false">Today</button>
              <button type="button" className="ff-seg-btn" aria-pressed="false">Tomorrow</button>
              <button type="button" className="ff-seg-btn" aria-pressed="false">This Week</button>
              <button type="button" className="ff-seg-btn" aria-pressed="false">Next Week</button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Inline trigger ───────────────────────────────────────────────────────────────────────── */}
      <section className="tl-section">
        <h3>Inline trigger — the ℹ affordance</h3>
        <p className="tl-hint">
          The owner asked for this in the library: *“This needs to be a part of all pages.”* It is
          <code>PageInfoPopover</code> — a small circular ℹ button opening a native popover. It is what sits
          on this page&apos;s own heading, and the shell renders it in the top row for any view with an
          explanation entry, so it is already app-wide. It is NOT a symbol opener.
        </p>
        <div className="ff-field">
          <span className="ff-label">Any label that needs explaining</span>
          {/* ⚠️ SIBLING, not a child of that span. PageInfoPopover renders a <div>, and a <div> inside a
              <span> or <p> is invalid HTML — React logs validateDOMNesting on every page that does it. */}
          <PageInfoPopover>
            A short explanation of whatever sits beside it. This is the whole component: a trigger button
            and a popover panel, no configuration.
          </PageInfoPopover>
        </div>
      </section>
    </div>
  );
}
