/**
 * AppearanceColourPage — the Colour group of the Appearance area.
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

export default function AppearanceColourPage() {
  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">Shades, contrast and text levels. Use these before inventing a colour: a panel that needs to sit "behind" another uses Panel Shading, and any text that is not body copy should be checked against Text Contrast Levels.
        </p>
              <PageInfoPopover>Shade presets, panel layering and text contrast levels. Every value here is a token the app already uses — copy the token, not the hex, so a theme pack can repaint it.</PageInfoPopover>
      </header>

      <ThemeLabSections group="colour" />
    </div>
  );
}
