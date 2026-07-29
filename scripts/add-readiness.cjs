/**
 * add-readiness.cjs — One-time script to add readonly readiness = 'alpha' to all directives.
 * Run: node scripts/add-readiness.cjs
 * After running: manually promote READY/BRAVO directives per docs/directive-readiness-audit.md
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

const IMPL_DIR = path.resolve(__dirname, '..', 'nest', 'src', 'modules', 'directives', 'implementations');

const files = glob.sync('**/*.ts', { cwd: IMPL_DIR, absolute: true });

let added = 0;
let skipped = 0;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Skip if already has readiness
  if (content.includes("readonly readiness")) {
    skipped++;
    continue;
  }

  // Find a good insertion point: after `readonly version` or `readonly minBars` or `readonly maxScore`
  // Insert readiness right after the version line (which every directive has)
  const versionMatch = content.match(/^(\s+)readonly version = ['"].*['"];$/m);
  const minBarsMatch = content.match(/^(\s+)readonly minBars = .*;$/m);
  const maxScoreMatch = content.match(/^(\s+)readonly maxScore = .*;$/m);

  let insertAfter = versionMatch || minBarsMatch || maxScoreMatch;

  if (!insertAfter) {
    // Fallback: insert after the class opening line
    const classMatch = content.match(/^(.*class \w+.*\{)$/m);
    if (classMatch) {
      const line = classMatch[0];
      content = content.replace(line, line + '\n  readonly readiness = \'alpha\' as const;');
      added++;
      fs.writeFileSync(file, content, 'utf8');
      continue;
    }
    console.log(`⚠ Could not find insertion point in ${path.basename(file)}`);
    skipped++;
    continue;
  }

  const fullLine = insertAfter[0];
  const indent = insertAfter[1];
  const newLine = `${indent}readonly readiness = 'alpha' as const;`;

  content = content.replace(fullLine, fullLine + '\n' + newLine);
  fs.writeFileSync(file, content, 'utf8');
  added++;
}

console.log(`\nDone. Added: ${added}, Skipped: ${skipped}, Total: ${files.length}`);
