/**
 * AppearanceInteractivePage — the Interactive group of the Appearance area.
 *
 * ⚠️ THIN WRAPPER, DELIBERATELY. The examples live in ONE file (`ThemeLabSections`) and this page
 * selects a group from it. Copying the markup here would be a second implementation to keep in step.
 *
 * ⚠️ SAMPLE VALUES ARE TOKENS AND CONTROLS, NEVER INVENTED DATA. Owner direction for this area
 * (2026-10-13): *"Only use this apps own real data to create examples"* — a demo that shows a made-up
 * ticker, price or P&L reads as a working feature. Colour swatches and form fields are not data
 * claims; anything that shows app CONTENT must render the real thing.
 */
import PageInfoPopover from '../components/PageInfoPopover';
import { ThemeLabSections } from './ThemeLabSections';
import './theme-lab.css';
import './appearance-area.css';

export default function AppearanceInteractivePage() {
  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">Container queries: a component that responds to its own width rather than the window. Drag the demo’s bottom-right corner — the cards re-flow at 400px and 600px with no JavaScript involved.
        </p>
              <PageInfoPopover>A live resizable container-query demo (drag the corner) plus the CSS pattern behind it. This replaced the Active Preview section, which only renders once a shade is picked on the Colour page — a page that shows nothing until you visit a different page is a buried ability, not a page.</PageInfoPopover>
      </header>

      <ThemeLabSections group="interactive" />
    </div>
  );
}
