/**
 * AppearanceSurfacesPage — the Surfaces & Cards group of the Appearance area.
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

export default function AppearanceSurfacesPage() {
  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">How a container should look. A plain card groups content; a neon-border or corner-glow card asserts STATUS — use those when the surface itself is making a point, not merely holding things.
        </p>
              <PageInfoPopover>Card backgrounds, neon border variants and corner-glow surfaces. The glowing treatments are for status (healthy, caution, critical) — using one decoratively spends the signal.</PageInfoPopover>
      </header>

      <ThemeLabSections group="surfaces" />
    </div>
  );
}
