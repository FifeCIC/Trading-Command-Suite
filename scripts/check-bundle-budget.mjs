import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const ASSETS_DIR = path.join(ROOT_DIR, 'dist', 'assets');
const MAX_JS_BYTES = Number(process.env.BUNDLE_MAX_JS_BYTES || 280000);
const MAX_CSS_BYTES = Number(process.env.BUNDLE_MAX_CSS_BYTES || 12000);

function fail(message) {
  console.error(`Bundle budget check failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(ASSETS_DIR)) {
  fail(`Assets folder not found at ${ASSETS_DIR}. Run build first.`);
}

const files = fs.readdirSync(ASSETS_DIR);
const mainJs = files.find((name) => /^index-.*\.js$/.test(name));
const mainCss = files.find((name) => /^index-.*\.css$/.test(name));

if (!mainJs) {
  fail('Main JS bundle not found in dist/assets.');
}

if (!mainCss) {
  fail('Main CSS bundle not found in dist/assets.');
}

const jsBytes = fs.statSync(path.join(ASSETS_DIR, mainJs)).size;
const cssBytes = fs.statSync(path.join(ASSETS_DIR, mainCss)).size;

const jsBudgetOk = jsBytes <= MAX_JS_BYTES;
const cssBudgetOk = cssBytes <= MAX_CSS_BYTES;

console.log(`Bundle budgets: JS ${jsBytes}/${MAX_JS_BYTES} bytes | CSS ${cssBytes}/${MAX_CSS_BYTES} bytes`);

if (!jsBudgetOk || !cssBudgetOk) {
  const reasons = [];
  if (!jsBudgetOk) {
    reasons.push(`JS exceeded by ${jsBytes - MAX_JS_BYTES} bytes`);
  }
  if (!cssBudgetOk) {
    reasons.push(`CSS exceeded by ${cssBytes - MAX_CSS_BYTES} bytes`);
  }

  fail(reasons.join('; '));
}

console.log('Bundle budget check passed.');
