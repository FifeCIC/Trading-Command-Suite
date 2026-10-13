/**
 * AppearanceAreaPage — the landing page of the new **Appearance** area.
 * ======================================================================
 * Owner direction, 2026-10-13: *"I'm using this project to establish a theme package that can be
 * carried forward to other projects."* The area is deliberately TEMPORARY-or-GALLERY: either it
 * becomes an advanced visual-options gallery, or it is the place the package is defined and then
 * adopted. Either way it is the one home for visual decisions.
 *
 * ⚠️ WHY THE LAYOUT GUIDANCE IS THE POINT OF THIS PAGE, NOT DECORATION.
 * The owner: *"add framing/context to especially the cards with a lot of details and page layouts with
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
    avoid: 'One flat column. Users lose the thread of what they are deciding.',
  },
];

export default function AppearanceAreaPage() {
  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">
          The one home for visual decisions: how a page should be laid out, and which colour scheme it
          wears. Structure and colour are deliberately separate concerns.
        </p>
              <PageInfoPopover>
            The visual system for this app and the projects it is carried into. Layout guidance sits
            here so an agent building a new page can choose a structure that suits it, and the theme
            packs below are colour schemes only — a pack must never change structure.
          </PageInfoPopover>
      </header>

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
