// One-off (#879): transform the 18 retired return-blocks into calls to the shared
// retiredCalendarClaim() helper, preserving each directive's distinct reason text.
// Deterministic; verify with git diff + the jest suite before committing.
const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\wamp64\\www\\trading-command-suite\\nest\\src\\modules\\directives\\implementations';

const FILES = [
  'september-slump.directive.ts', 'sell-in-may.directive.ts', 'january-effect.directive.ts',
  'october-relief.directive.ts', 'santa-claus-rally.directive.ts', 'opex-gamma.directive.ts',
  'triple-witching.directive.ts', 'election-cycle.directive.ts', 'monday-effect.directive.ts',
  'turnaround-tuesday.directive.ts', 'friday-drift.directive.ts', 'momentum-and-macro.directives.ts',
];

let total = 0;
for (const f of FILES) {
  const p = path.join(ROOT, f);
  let src = fs.readFileSync(p, 'utf8');
  const before = src;

  // Replace the retired return object with a helper call, capturing the reason expression
  // (which may be a single string or concatenated lines) up to its closing `};`.
  src = src.replace(
    /return \{\s*score: 0,\s*confidence: 0,\s*signalClass: 'neutral',\s*unmeasured: true,\s*reason:\s*([\s\S]*?),\s*\};/g,
    (_m, reason) => `return retiredCalendarClaim(${String(reason).trim()});`,
  );

  if (src !== before) {
    // Add the import after the existing interface import if not present.
    if (!src.includes("from './retired-calendar-claim'")) {
      src = src.replace(
        /(import \{[^}]*\} from '\.\.\/interfaces\/directive\.interface';)/,
        "$1\nimport { retiredCalendarClaim } from './retired-calendar-claim';",
      );
    }
    fs.writeFileSync(p, src, 'utf8');
    const n = (before.match(/unmeasured: true/g) || []).length;
    total += n;
    console.log(`${f}: ${n} block(s) replaced`);
  }
}
console.log(`total: ${total}`);
