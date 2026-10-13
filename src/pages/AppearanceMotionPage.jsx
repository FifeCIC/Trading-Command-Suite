/**
 * AppearanceMotionPage — Motion, in the Appearance area.
 * =====================================================
 * Owner direction, 2026-10-13: *"We don't need View: Theme Lab as it is but the new area could offer
 * views such as a 'Motion' page that includes features like: <section.tl-section> Motion Lab
 * (motion.dev — 3.5KB animation library. Fade, slide...)"*
 *
 * ⚠️ THIS PAGE ADDS NO MARKUP OF ITS OWN. The three sections it renders already existed as components
 * on Theme Lab (`ThemeLabMotion`, `ThemeLabScroll`, `ThemeLabPopover`), each exporting a SECTION with
 * no page wrapper — see the note in ThemeLabPage.jsx. Reusing them is the whole point: a "Motion page"
 * that re-implemented the same fades would be a second copy to keep in step, and only one copy ever
 * receives the next fix.
 *
 * ⚠️ ALL THREE, NOT JUST MOTION. Scroll-reveal and popover transitions are the same subject — motion.dev
 * driven animation — and they were previously reachable only as sections of one long page. Splitting
 * off only the named one would have orphaned the other two when Theme Lab is retired.
 *
 * ⚠️ `theme-lab.css` IS IMPORTED ON PURPOSE, despite the name. It is the stylesheet the sections were
 * written against (`.tl-section`, `.tl-hint`, …). Renaming it is a separate change; if it is ever
 * renamed, this import must follow or every section here renders unstyled — a failure that looks like
 * "the motion examples are broken" rather than like a missing stylesheet.
 */
import MotionLabSection from './ThemeLabMotion';
import ScrollLabSection from './ThemeLabScroll';
import PopoverLabSection from './ThemeLabPopover';
import { ThemeLabSections } from './ThemeLabSections';
import PageInfoPopover from '../components/PageInfoPopover';
import './theme-lab.css';
import './appearance-area.css';

export default function AppearanceMotionPage() {
  return (
    <div className="appearance-area">
      <header className="appearance-head">
        
        <p className="appearance-lede">
          The app’s motion vocabulary in one place. Every example below is the live component — open
          one and it behaves exactly as it does on the page it was built for.
        </p>
              <PageInfoPopover>
            Motion examples grouped by technique: entrance and hover animation, scroll-driven reveal,
            and popover transitions. Each section shows the real component the app uses, not a
            screenshot of one. Motion is presentation only — nothing here changes data, scoring or
            trading behaviour, and prefers-reduced-motion is honoured app-wide.
          </PageInfoPopover>
      </header>

      <MotionLabSection />
      <ScrollLabSection />
      <PopoverLabSection />

      {/* The four card-motion sections from Theme Lab's `motion` group. They are separate from the
          three components above — those are their own files, these are inline sections. Both belong
          on this page: they are the same subject (animation), and leaving them behind would have
          stranded them when Theme Lab was retired. */}
      <ThemeLabSections group="motion" />
    </div>
  );
}
